package handler

import (
	"encoding/json"
	"log"
	"net/http"
	"sync"

	"cloud-obsidian/auth"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true // Allow all origins (CORS handled at HTTP layer).
	},
}

// WSClient is a single connected WebSocket client.
type WSClient struct {
	UserID int
	Conn   *websocket.Conn
	Send   chan []byte
}

// WSHub manages all connected WebSocket clients and routes messages per user.
type WSHub struct {
	clients   map[*WSClient]bool
	broadcast chan userMessage
	register  chan *WSClient
	unregister chan *WSClient
	mu        sync.RWMutex
}

type userMessage struct {
	UserID  int
	Payload []byte
}

// NewWSHub creates and starts a WebSocket hub.
func NewWSHub() *WSHub {
	h := &WSHub{
		clients:    make(map[*WSClient]bool),
		broadcast:  make(chan userMessage, 256),
		register:   make(chan *WSClient),
		unregister: make(chan *WSClient),
	}
	go h.run()
	return h
}

func (h *WSHub) run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			h.clients[client] = true
			h.mu.Unlock()
			log.Printf("[ws] client connected (user=%d), total=%d", client.UserID, len(h.clients))

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client]; ok {
				delete(h.clients, client)
				close(client.Send)
			}
			h.mu.Unlock()
			log.Printf("[ws] client disconnected (user=%d), total=%d", client.UserID, len(h.clients))

		case msg := <-h.broadcast:
			h.mu.RLock()
			for client := range h.clients {
				if client.UserID == msg.UserID {
					select {
					case client.Send <- msg.Payload:
					default:
						// Slow client — skip to avoid blocking the hub.
						go func(c *WSClient) {
							h.unregister <- c
						}(client)
					}
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends a JSON message to all connected devices of a specific user.
func (h *WSHub) Broadcast(userID int, payload interface{}) {
	data, err := json.Marshal(payload)
	if err != nil {
		log.Printf("[ws] broadcast marshal error: %v", err)
		return
	}
	h.broadcast <- userMessage{UserID: userID, Payload: data}
}

// ServeWS handles GET /ws?token=<jwt>
func (h *WSHub) ServeWS(jwtSecret string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Authenticate via query token.
		tokenStr := r.URL.Query().Get("token")
		claims, err := auth.ValidateToken(jwtSecret, tokenStr)
		if err != nil {
			http.Error(w, `{"error":"invalid token"}`, http.StatusUnauthorized)
			return
		}

		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Printf("[ws] upgrade error: %v", err)
			return
		}

		client := &WSClient{
			UserID: claims.UserID,
			Conn:   conn,
			Send:   make(chan []byte, 64),
		}
		h.register <- client

		// Write pump: send messages from hub to this client.
		go func() {
			defer func() {
				conn.Close()
				h.unregister <- client
			}()
			for msg := range client.Send {
				if err := conn.WriteMessage(websocket.TextMessage, msg); err != nil {
					return
				}
			}
		}()

		// Read pump: keep connection alive, handle incoming pings.
		go func() {
			defer func() {
				conn.Close()
				h.unregister <- client
			}()
			conn.SetReadLimit(4096)
			for {
				_, _, err := conn.ReadMessage()
				if err != nil {
					break
				}
				// Incoming messages from client are ignored (sync via REST).
			}
		}()
	}
}
