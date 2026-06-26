package main

import (
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"cloud-obsidian/auth"
	"cloud-obsidian/config"
	"cloud-obsidian/db"
	"cloud-obsidian/handler"
	"cloud-obsidian/vault"

	"github.com/gorilla/mux"
)

func main() {
	cfg := config.Load()

	// Ensure data directories exist.
	if err := os.MkdirAll(cfg.DataDir, 0755); err != nil {
		log.Fatalf("Failed to create data dir: %v", err)
	}
	if err := os.MkdirAll(cfg.VaultsDir(), 0755); err != nil {
		log.Fatalf("Failed to create vaults dir: %v", err)
	}

	// Initialize database.
	store, err := db.NewStore(cfg.DBPath())
	if err != nil {
		log.Fatalf("Failed to init database: %v", err)
	}
	defer store.Close()
	log.Println("[db] SQLite initialized")

	// Initialize vault manager.
	vaults := vault.NewManager(cfg.VaultsDir())

	// Initialize WebSocket hub.
	wsHub := handler.NewWSHub()

	// Initialize handlers.
	authH := &handler.AuthHandler{Store: store, JWTSecret: cfg.JWTSecret}
	syncH := &handler.SyncHandler{Store: store, Vaults: vaults, Hub: wsHub}
	fileH := &handler.FileHandler{Store: store, Vaults: vaults}

	// Build router.
	r := mux.NewRouter()

	// Global middleware.
	r.Use(auth.CORS)

	// Public routes.
	r.HandleFunc("/api/auth/register", authH.Register).Methods("POST", "OPTIONS")
	r.HandleFunc("/api/auth/login", authH.Login).Methods("POST", "OPTIONS")

	// Health check.
	r.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"status":"ok"}`))
	}).Methods("GET")

	// Protected routes.
	protected := r.PathPrefix("/api").Subrouter()
	protected.Use(auth.Middleware(cfg.JWTSecret))

	protected.HandleFunc("/sync/push", syncH.Push).Methods("POST", "OPTIONS")
	protected.HandleFunc("/sync/pull", syncH.Pull).Methods("POST", "OPTIONS")
	protected.HandleFunc("/sync/status", syncH.Status).Methods("GET", "OPTIONS")
	protected.HandleFunc("/sync/ignores", syncH.ListIgnores).Methods("GET", "OPTIONS")
	protected.HandleFunc("/sync/ignores", syncH.SetIgnores).Methods("POST", "OPTIONS")

	protected.HandleFunc("/files", fileH.List).Methods("GET", "OPTIONS")
	protected.HandleFunc("/files/content", fileH.GetContent).Methods("GET", "OPTIONS")
	protected.HandleFunc("/files/history", fileH.GetHistory).Methods("GET", "OPTIONS")
	protected.HandleFunc("/files/version", fileH.GetFileAtCommit).Methods("GET", "OPTIONS")

	// WebSocket (auth via query token, not header).
	r.HandleFunc("/ws", wsHub.ServeWS(cfg.JWTSecret))

	// Graceful shutdown.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		log.Println("[server] Shutting down...")
		store.Close()
		os.Exit(0)
	}()

	addr := fmt.Sprintf(":%s", cfg.Port)
	log.Printf("[server] Cloud-Obsidian listening on %s", addr)
	log.Printf("[server] Data directory: %s", cfg.DataDir)
	if err := http.ListenAndServe(addr, r); err != nil {
		log.Fatalf("[server] Failed to start: %v", err)
	}
}
