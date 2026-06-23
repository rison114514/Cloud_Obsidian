package handler

import (
	"net/http"
	"strconv"

	"cloud-obsidian/auth"
	"cloud-obsidian/db"
	gitpkg "cloud-obsidian/git"
	"cloud-obsidian/vault"
)

type FileHandler struct {
	Store  *db.Store
	Vaults *vault.Manager
}

func vaultParam(r *http.Request) string {
	v := r.URL.Query().Get("vault")
	if v == "" {
		return "default"
	}
	return v
}

func (h *FileHandler) List(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	files, err := h.Vaults.ListFiles(claims.UserID, claims.Username, vaultParam(r), r.URL.Query().Get("prefix"))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if files == nil {
		files = []db.FileEntry{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"files": files})
}

func (h *FileHandler) GetContent(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path required"})
		return
	}
	content, err := h.Vaults.ReadFile(claims.UserID, claims.Username, vaultParam(r), path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path, "content": content})
}

func (h *FileHandler) GetHistory(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	path := r.URL.Query().Get("path")
	if path == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path required"})
		return
	}
	limit := 50
	if l := r.URL.Query().Get("limit"); l != "" {
		if n, err := strconv.Atoi(l); err == nil && n > 0 && n <= 200 {
			limit = n
		}
	}
	commits, err := h.Vaults.FileHistory(claims.UserID, claims.Username, vaultParam(r), path, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	if commits == nil {
		commits = []gitpkg.CommitInfo{}
	}
	writeJSON(w, http.StatusOK, map[string]interface{}{"commits": commits})
}

func (h *FileHandler) GetFileAtCommit(w http.ResponseWriter, r *http.Request) {
	claims := auth.GetClaims(r)
	if claims == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}
	path := r.URL.Query().Get("path")
	commitHash := r.URL.Query().Get("commit")
	if path == "" || commitHash == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "path and commit required"})
		return
	}
	content, err := h.Vaults.FileContentAtCommit(claims.UserID, claims.Username, vaultParam(r), commitHash, path)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"path": path, "commit": commitHash, "content": content})
}
