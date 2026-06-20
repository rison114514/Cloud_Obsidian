package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"cloud-obsidian/auth"
	"cloud-obsidian/db"
	"cloud-obsidian/vault"
)

// SyncHandler handles push / pull / status endpoints.
type SyncHandler struct {
	Store   *db.Store
	Vaults  *vault.Manager
	Hub     *WSHub
}

// PushRequest is the body for POST /api/sync/push
type PushRequest struct {
	Changes    []db.ChangeRequest `json:"changes"`
	DeviceName string             `json:"device_name,omitempty"`
}

// PushResponse is returned after a push.
type PushResponse struct {
	Accepted []db.ChangeResponse `json:"accepted"`
	Conflicts []db.ChangeResponse `json:"conflicts"`
}

// PullRequest is the body for POST /api/sync/pull
type PullRequest struct {
	LastSync int64 `json:"last_sync"` // unix milliseconds
}

// PullResponse is returned after a pull.
type PullResponse struct {
	Changes      []db.PullChange `json:"changes"`
	ServerTime   int64           `json:"server_time"`
	LastCommit   string          `json:"last_commit"`
}

// StatusResponse is returned for GET /api/sync/status
type StatusResponse struct {
	LastCommit string `json:"last_commit"`
	ServerTime int64  `json:"server_time"`
}

// Push handles POST /api/sync/push
func (h *SyncHandler) Push(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req PushRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	deviceName := req.DeviceName
	if deviceName == "" {
		deviceName = "unknown-device"
	}

	var resp PushResponse

	for _, change := range req.Changes {
		commitHash, conflict, err := h.Vaults.ApplyChange(claims.UserID, claims.Username, change, deviceName)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, db.ChangeResponse{
				Path:     change.Path,
				Action:   change.Action,
				Accepted: false,
				Conflict: true,
				Message:  err.Error(),
			})
			continue
		}

		resp.Accepted = append(resp.Accepted, db.ChangeResponse{
			Path:       change.Path,
			Action:     change.Action,
			Accepted:   true,
			Conflict:   conflict,
			CommitHash: commitHash,
		})

		// Log to database.
		_ = h.Store.LogSync(claims.UserID, change.Path, change.Action, commitHash)
	}

	// Broadcast to other connected devices via WebSocket.
	if h.Hub != nil && len(resp.Accepted) > 0 {
		h.Hub.Broadcast(claims.UserID, map[string]interface{}{
			"type":    "file_changed",
			"changes": resp.Accepted,
		})
	}

	writeJSON(w, http.StatusOK, resp)
}

// Pull handles POST /api/sync/pull
func (h *SyncHandler) Pull(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	var req PullRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}

	changes, err := h.Vaults.PullChanges(claims.UserID, claims.Username, req.LastSync)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if changes == nil {
		changes = []db.PullChange{}
	}

	writeJSON(w, http.StatusOK, PullResponse{
		Changes:    changes,
		ServerTime: nowMillis(),
		LastCommit: h.Vaults.LastCommitHash(claims.UserID, claims.Username),
	})
}

// Status handles GET /api/sync/status
func (h *SyncHandler) Status(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	writeJSON(w, http.StatusOK, StatusResponse{
		LastCommit: h.Vaults.LastCommitHash(claims.UserID, claims.Username),
		ServerTime: nowMillis(),
	})
}

// nowMillis returns current unix time in milliseconds.
func nowMillis() int64 {
	return time.Now().UnixMilli()
}
