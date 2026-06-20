package vault

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cloud-obsidian/db"
	gitpkg "cloud-obsidian/git"
)

// Manager handles file operations for all user vaults.
type Manager struct {
	vaultsDir string
	mu        sync.RWMutex
	repos     map[int]*gitpkg.Repo // userID → repo, lazy-init
}

// NewManager creates a vault manager rooted at the given directory.
func NewManager(vaultsDir string) *Manager {
	os.MkdirAll(vaultsDir, 0755)
	return &Manager{
		vaultsDir: vaultsDir,
		repos:     make(map[int]*gitpkg.Repo),
	}
}

// getRepo returns (or initializes) the git repo for a user.
func (m *Manager) getRepo(userID int, username string) (*gitpkg.Repo, error) {
	m.mu.RLock()
	repo, ok := m.repos[userID]
	m.mu.RUnlock()
	if ok {
		return repo, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Double-check after acquiring write lock.
	if repo, ok = m.repos[userID]; ok {
		return repo, nil
	}

	vaultPath := filepath.Join(m.vaultsDir, username)
	repo, err := gitpkg.InitRepo(vaultPath)
	if err != nil {
		return nil, fmt.Errorf("init repo for %s: %w", username, err)
	}
	m.repos[userID] = repo
	return repo, nil
}

// ApplyChange writes a single file change and returns the commit hash.
func (m *Manager) ApplyChange(userID int, username string, change db.ChangeRequest, deviceName string) (string, bool, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return "", false, err
	}

	// Normalise path: remove leading / or ./, prevent directory traversal.
	relPath := sanitizePath(change.Path)

	switch change.Action {
	case "create", "update":
		hash, err := repo.WriteFile(relPath, change.Content, deviceName)
		return hash, false, err
	case "delete":
		hash, err := repo.DeleteFile(relPath, deviceName)
		return hash, false, err
	default:
		return "", false, fmt.Errorf("unknown action: %s", change.Action)
	}
}

// PullChanges returns all changes since a given timestamp (unix milliseconds).
func (m *Manager) PullChanges(userID int, username string, sinceMillis int64) ([]db.PullChange, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return nil, err
	}

	since := time.UnixMilli(sinceMillis)

	var changes []db.PullChange
	err = filepath.Walk(repo.Path(), func(absPath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil // skip inaccessible files
		}
		// Skip .git directory.
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil
		}
		if info.ModTime().After(since) {
			relPath, _ := filepath.Rel(repo.Path(), absPath)
			content, _ := os.ReadFile(absPath)
			changes = append(changes, db.PullChange{
				Path:        filepath.ToSlash(relPath),
				Action:      "update",
				Content:     string(content),
				ServerMtime: info.ModTime().UnixMilli(),
				CommitHash:  repo.LastCommitHash(),
			})
		}
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk vault: %w", err)
	}
	return changes, nil
}

// ListFiles returns all files in a user's vault under the given prefix.
func (m *Manager) ListFiles(userID int, username, prefix string) ([]db.FileEntry, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return nil, err
	}

	var entries []db.FileEntry
	err = filepath.Walk(repo.Path(), func(absPath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil // skip directory entries for simplicity
		}
		relPath, _ := filepath.Rel(repo.Path(), absPath)
		relPath = filepath.ToSlash(relPath)
		if prefix != "" && !strings.HasPrefix(relPath, prefix) {
			return nil
		}
		entries = append(entries, db.FileEntry{
			Path:    relPath,
			Size:    info.Size(),
			ModTime: info.ModTime(),
			IsDir:   false,
		})
		return nil
	})
	if err != nil {
		return nil, fmt.Errorf("walk vault: %w", err)
	}
	return entries, nil
}

// ReadFile returns the content of a single file.
func (m *Manager) ReadFile(userID int, username, relPath string) (string, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return "", err
	}
	relPath = sanitizePath(relPath)
	absPath := filepath.Join(repo.Path(), relPath)
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return string(data), nil
}

// FileHistory returns commit history for a specific file.
func (m *Manager) FileHistory(userID int, username, relPath string, maxCount int) ([]gitpkg.CommitInfo, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return nil, err
	}
	return repo.FileHistory(sanitizePath(relPath), maxCount)
}

// FileContentAtCommit retrieves a historical version of a file.
func (m *Manager) FileContentAtCommit(userID int, username, commitHash, relPath string) (string, error) {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return "", err
	}
	return repo.FileContentAtCommit(commitHash, sanitizePath(relPath))
}

// LastCommitHash returns the HEAD commit hash for the user's vault.
func (m *Manager) LastCommitHash(userID int, username string) string {
	repo, err := m.getRepo(userID, username)
	if err != nil {
		return ""
	}
	return repo.LastCommitHash()
}

// sanitizePath prevents directory traversal and normalises path separators.
func sanitizePath(p string) string {
	// Convert to slash form, remove leading slash/dots.
	p = filepath.ToSlash(p)
	p = strings.TrimLeft(p, "/")
	// Remove .. components.
	parts := strings.Split(p, "/")
	var clean []string
	for _, part := range parts {
		if part == ".." || part == "" {
			continue
		}
		clean = append(clean, part)
	}
	return filepath.FromSlash(strings.Join(clean, "/"))
}
