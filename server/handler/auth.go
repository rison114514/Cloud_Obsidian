package handler

import (
	"encoding/json"
	"net/http"

	"cloud-obsidian/auth"
	"cloud-obsidian/db"

	"golang.org/x/crypto/bcrypt"
)

// AuthHandler handles user registration and login.
type AuthHandler struct {
	Store     *db.Store
	JWTSecret string
}

// RegisterRequest is the expected JSON body for registration.
type RegisterRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// LoginRequest is the expected JSON body for login.
type LoginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

// AuthResponse is returned after successful authentication.
type AuthResponse struct {
	Token    string `json:"token"`
	UserID   int    `json:"user_id"`
	Username string `json:"username"`
}

// Register handles POST /api/auth/register
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req RegisterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password are required"})
		return
	}
	if len(req.Password) < 4 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "password must be at least 4 characters"})
		return
	}

	// Check if user already exists.
	existing, err := h.Store.GetUserByUsername(req.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if existing != nil {
		writeJSON(w, http.StatusConflict, map[string]string{"error": "username already taken"})
		return
	}

	// Hash password.
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "internal error"})
		return
	}

	user, err := h.Store.CreateUser(req.Username, string(hash))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create user"})
		return
	}

	// Generate JWT.
	token, err := auth.GenerateToken(h.JWTSecret, user.ID, user.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusCreated, AuthResponse{
		Token:    token,
		UserID:   user.ID,
		Username: user.Username,
	})
}

// Login handles POST /api/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid request body"})
		return
	}
	if req.Username == "" || req.Password == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "username and password are required"})
		return
	}

	user, err := h.Store.GetUserByUsername(req.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database error"})
		return
	}
	if user == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid username or password"})
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid username or password"})
		return
	}

	token, err := auth.GenerateToken(h.JWTSecret, user.ID, user.Username)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate token"})
		return
	}

	writeJSON(w, http.StatusOK, AuthResponse{
		Token:    token,
		UserID:   user.ID,
		Username: user.Username,
	})
}

// writeJSON is a small helper to write JSON responses.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}
