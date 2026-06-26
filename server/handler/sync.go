package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"cloud-obsidian/auth"
	"cloud-obsidian/db"
	"cloud-obsidian/vault"
)

type SyncHandler struct {
	Store  *db.Store
	Vaults *vault.Manager
	Hub    *WSHub
}

type PushRequest struct {
	Vault      string             `json:"vault"`
	Changes    []db.ChangeRequest `json:"changes"`
	DeviceName string             `json:"device_name,omitempty"`
}

type PushResponse struct {
	Accepted []db.ChangeResponse `json:"accepted"`
	Conflicts []db.ChangeResponse `json:"conflicts"`
}

type PullRequest struct {
	Vault    string `json:"vault"`
	LastSync int64  `json:"last_sync"`
}

type PullResponse struct {
	Changes    []db.PullChange `json:"changes"`
	ServerTime int64           `json:"server_time"`
	LastCommit string          `json:"last_commit"`
}

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

	vaultName := req.Vault
	if vaultName == "" {
		vaultName = "default"
	}

	deviceName := req.DeviceName
	if deviceName == "" {
		deviceName = "unknown-device"
	}

	var resp PushResponse
	for _, change := range req.Changes {
		commitHash, conflict, err := h.Vaults.ApplyChange(claims.UserID, claims.Username, vaultName, change, deviceName)
		if err != nil {
			resp.Conflicts = append(resp.Conflicts, db.ChangeResponse{
				Path: change.Path, Action: change.Action, Accepted: false, Conflict: true, Message: err.Error(),
			})
			continue
		}
		resp.Accepted = append(resp.Accepted, db.ChangeResponse{
			Path: change.Path, Action: change.Action, Accepted: true, Conflict: conflict, CommitHash: commitHash,
		})
		_ = h.Store.LogSync(claims.UserID, change.Path, change.Action, commitHash)
	}

	if h.Hub != nil && len(resp.Accepted) > 0 {
		h.Hub.Broadcast(claims.UserID, map[string]interface{}{
			"type":    "file_changed",
			"vault":   vaultName,
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

	vaultName := req.Vault
	if vaultName == "" {
		vaultName = "default"
	}

	changes, err := h.Vaults.PullChanges(claims.UserID, claims.Username, vaultName, req.LastSync)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if changes == nil {
		changes = []db.PullChange{}
	}

	writeJSON(w, http.StatusOK, PullResponse{
		Changes:    changes,
		ServerTime: time.Now().UnixMilli(),
		LastCommit: h.Vaults.LastCommitHash(claims.UserID, claims.Username, vaultName),
	})
}

// ---- Sync Ignore ----

type IgnoreRequest struct {
	Vault    string   `json:"vault"`
	Patterns []string `json:"patterns"`
}

// ListIgnores handles GET /api/sync/ignores
func (h *SyncHandler) ListIgnores(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	vaultName := r.URL.Query().Get("vault")
	if vaultName == "" {
		vaultName = "default"
	}
	patterns, err := h.Vaults.GetIgnorePatterns(claims.UserID, claims.Username, vaultName)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if patterns == nil {
		patterns = []string{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"patterns": patterns})
}

// SetIgnores handles POST /api/sync/ignores
func (h *SyncHandler) SetIgnores(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	var req IgnoreRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	vaultName := req.Vault
	if vaultName == "" {
		vaultName = "default"
	}
	if err := h.Vaults.SetIgnorePatterns(claims.UserID, claims.Username, vaultName, req.Patterns); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	// Delete files that now match ignore patterns (async, don't block response).
	go h.Vaults.CleanIgnoredFiles(claims.UserID, claims.Username, vaultName)
	writeJSON(w, http.StatusOK, map[string]interface{}{"patterns": req.Patterns})
}

// Status handles GET /api/sync/status
func (h *SyncHandler) Status(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	vaultName := r.URL.Query().Get("vault")
	if vaultName == "" {
		vaultName = "default"
	}
	writeJSON(w, http.StatusOK, StatusResponse{
		LastCommit: h.Vaults.LastCommitHash(claims.UserID, claims.Username, vaultName),
		ServerTime: time.Now().UnixMilli(),
	})
}
