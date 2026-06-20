package db

import "time"

// User represents a registered sync user.
type User struct {
	ID           int       `json:"id"`
	Username     string    `json:"username"`
	PasswordHash string    `json:"-"`
	CreatedAt    time.Time `json:"created_at"`
}

// SyncLog records each sync operation for audit trail.
type SyncLog struct {
	ID         int       `json:"id"`
	UserID     int       `json:"user_id"`
	FilePath   string    `json:"file_path"`
	Action     string    `json:"action"` // create / update / delete
	CommitHash string    `json:"commit_hash"`
	SyncedAt   time.Time `json:"synced_at"`
}

// FileEntry describes a single file in the vault for API responses.
type FileEntry struct {
	Path    string    `json:"path"`
	Size    int64     `json:"size"`
	ModTime time.Time `json:"mod_time"`
	IsDir   bool      `json:"is_dir"`
}

// ChangeRequest is a single file change in a push/pull payload.
type ChangeRequest struct {
	Path        string `json:"path"`
	Action      string `json:"action"` // create / update / delete
	Content     string `json:"content,omitempty"`
	ClientMtime int64  `json:"client_mtime"` // unix milliseconds
}

// ChangeResponse describes the server's handling of a pushed change.
type ChangeResponse struct {
	Path       string `json:"path"`
	Action     string `json:"action"`
	Accepted   bool   `json:"accepted"`
	Conflict   bool   `json:"conflict"`
	CommitHash string `json:"commit_hash,omitempty"`
	Message    string `json:"message,omitempty"`
}

// PullChange is a server-side change sent to the client during pull.
type PullChange struct {
	Path        string `json:"path"`
	Action      string `json:"action"`
	Content     string `json:"content,omitempty"`
	ServerMtime int64  `json:"server_mtime"`
	CommitHash  string `json:"commit_hash"`
}
