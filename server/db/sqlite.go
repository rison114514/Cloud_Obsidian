package db

import (
	"database/sql"
	"fmt"
	"time"

	_ "github.com/mattn/go-sqlite3"
)

// Store wraps the SQLite connection and provides data access methods.
type Store struct {
	DB *sql.DB
}

// NewStore opens (or creates) the SQLite database and runs migrations.
func NewStore(dbPath string) (*Store, error) {
	database, err := sql.Open("sqlite3", dbPath+"?_journal_mode=WAL&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Connection pool — SQLite is single-writer, keep it small.
	database.SetMaxOpenConns(1)
	database.SetMaxIdleConns(1)

	if err := database.Ping(); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	s := &Store{DB: database}
	if err := s.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}

	return s, nil
}

func (s *Store) migrate() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			created_at DATETIME DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS sync_log (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			user_id INTEGER NOT NULL,
			file_path TEXT NOT NULL,
			action TEXT NOT NULL,
			commit_hash TEXT,
			synced_at DATETIME DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id)
		)`,
		`CREATE INDEX IF NOT EXISTS idx_sync_log_user ON sync_log(user_id, synced_at)`,
	}
	for _, q := range queries {
		if _, err := s.DB.Exec(q); err != nil {
			return fmt.Errorf("exec %q: %w", q, err)
		}
	}
	return nil
}

// CreateUser inserts a new user with bcrypt-hashed password.
func (s *Store) CreateUser(username, passwordHash string) (*User, error) {
	res, err := s.DB.Exec(
		"INSERT INTO users (username, password_hash) VALUES (?, ?)",
		username, passwordHash,
	)
	if err != nil {
		return nil, fmt.Errorf("insert user: %w", err)
	}
	id, _ := res.LastInsertId()
	return &User{ID: int(id), Username: username, PasswordHash: passwordHash, CreatedAt: time.Now()}, nil
}

// GetUserByUsername returns a user by username, or nil if not found.
func (s *Store) GetUserByUsername(username string) (*User, error) {
	u := &User{}
	err := s.DB.QueryRow(
		"SELECT id, username, password_hash, created_at FROM users WHERE username = ?",
		username,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}
	return u, nil
}

// GetUserByID returns a user by id.
func (s *Store) GetUserByID(id int) (*User, error) {
	u := &User{}
	err := s.DB.QueryRow(
		"SELECT id, username, password_hash, created_at FROM users WHERE id = ?",
		id,
	).Scan(&u.ID, &u.Username, &u.PasswordHash, &u.CreatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query user: %w", err)
	}
	return u, nil
}

// LogSync records a sync operation.
func (s *Store) LogSync(userID int, filePath, action, commitHash string) error {
	_, err := s.DB.Exec(
		"INSERT INTO sync_log (user_id, file_path, action, commit_hash) VALUES (?, ?, ?, ?)",
		userID, filePath, action, commitHash,
	)
	return err
}

// Close cleanly shuts down the database.
func (s *Store) Close() error {
	return s.DB.Close()
}
