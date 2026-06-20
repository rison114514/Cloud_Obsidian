package handler

import (
	"net/http"
	"strconv"

	"cloud-obsidian/auth"
	"cloud-obsidian/db"
	gitpkg "cloud-obsidian/git"
	"cloud-obsidian/vault"
)

// FileHandler handles file listing / content / history endpoints.
type FileHandler struct {
	Store  *db.Store
	Vaults *vault.Manager
}

// List handles GET /api/files — list files under an optional prefix.
func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	prefix := r.URL.Query().Get("prefix")
	files, err := h.Vaults.ListFiles(claims.UserID, claims.Username, prefix)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if files == nil {
		files = []db.FileEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"files": files})
}

// GetContent handles GET /api/files/content?path=...
func (h *FileHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path query parameter is required"})
		return
	}

	content, err := h.Vaults.ReadFile(claims.UserID, claims.Username, path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"path":    path,
		"content": content,
	})
}

// GetHistory handles GET /api/files/history?path=...&limit=50
func (h *FileHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path query parameter is required"})
		return
	}

	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}

	commits, err := h.Vaults.FileHistory(claims.UserID, claims.Username, path, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if commits == nil {
		commits = []gitpkg.CommitInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"commits": commits})
}

// GetFileAtCommit handles GET /api/files/version?path=...&commit=...
func (h *FileHandler) GetFileAtCommit(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	path := r.URL.Query().Get("path")
	commitHash := r.URL.Query().Get("commit")
	if path == "" || commitHash == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path and commit query parameters are required"})
		return
	}

	content, err := h.Vaults.FileContentAtCommit(claims.UserID, claims.Username, commitHash, path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"path":    path,
		"commit":  commitHash,
		"content": content,
	})
}
