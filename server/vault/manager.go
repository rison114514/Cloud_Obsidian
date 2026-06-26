package vault

import (
	"bufio"
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
// Vault layout: <vaultsDir>/<username>/<vaultName>/
type Manager struct {
	vaultsDir string
	mu        sync.RWMutex
	// key: "userID:vaultName"
	repos map[string]*gitpkg.Repo
}

func NewManager(vaultsDir string) *Manager {
	os.MkdirAll(vaultsDir, 0755)
	return &Manager{
		vaultsDir: vaultsDir,
		repos:     make(map[string]*gitpkg.Repo),
	}
}

func (m *Manager) repoKey(userID int, vaultName string) string {
	return fmt.Sprintf("%d:%s", userID, sanitizeVaultName(vaultName))
}

func (m *Manager) vaultPath(username, vaultName string) string {
	return filepath.Join(m.vaultsDir, username, sanitizeVaultName(vaultName))
}

func (m *Manager) getRepo(userID int, username, vaultName string) (*gitpkg.Repo, error) {
	key := m.repoKey(userID, vaultName)

	m.mu.RLock()
	repo, ok := m.repos[key]
	m.mu.RUnlock()
	if ok {
		return repo, nil
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	if repo, ok = m.repos[key]; ok {
		return repo, nil
	}

	vp := m.vaultPath(username, vaultName)
	repo, err := gitpkg.InitRepo(vp)
	if err != nil {
		return nil, fmt.Errorf("init repo %s: %w", key, err)
	}
	m.repos[key] = repo
	return repo, nil
}

// ApplyChange writes a single file change and returns commit hash.
// Creates the vault directory on first use.
func (m *Manager) ApplyChange(userID int, username, vaultName string, change db.ChangeRequest, deviceName string) (string, bool, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return "", false, err
	}
	relPath := sanitizePath(change.Path)

	// Reject changes to paths under ignored directories.
	ignored, _ := m.GetIgnorePatterns(userID, username, vaultName)
	if isPathIgnored(relPath, ignored) {
		return "", false, fmt.Errorf("path %q is ignored for this vault", relPath)
	}

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

// PullChanges returns all changes since a given timestamp (unix ms) for a vault.
func (m *Manager) PullChanges(userID int, username, vaultName string, sinceMillis int64) ([]db.PullChange, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return nil, err
	}
	since := time.UnixMilli(sinceMillis)
	ignored, _ := m.GetIgnorePatterns(userID, username, vaultName)
	var changes []db.PullChange
	_ = filepath.Walk(repo.Path(), func(absPath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil
		}
		relPath, _ := filepath.Rel(repo.Path(), absPath)
		relPath = filepath.ToSlash(relPath)
		// Skip .syncignore itself and any ignored paths.
		if relPath == ".syncignore" || isPathIgnored(relPath, ignored) {
			return nil
		}
		if info.ModTime().After(since) {
			content, _ := os.ReadFile(absPath)
			changes = append(changes, db.PullChange{
				Path:        relPath,
				Action:      "update",
				Content:     string(content),
				ServerMtime: info.ModTime().UnixMilli(),
				CommitHash:  repo.LastCommitHash(),
			})
		}
		return nil
	})
	return changes, nil
}

func (m *Manager) ListFiles(userID int, username, vaultName, prefix string) ([]db.FileEntry, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return nil, err
	}
	var entries []db.FileEntry
	ignored, _ := m.GetIgnorePatterns(userID, username, vaultName)
	_ = filepath.Walk(repo.Path(), func(absPath string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if info.IsDir() && info.Name() == ".git" {
			return filepath.SkipDir
		}
		if info.IsDir() {
			return nil
		}
		relPath, _ := filepath.Rel(repo.Path(), absPath)
		relPath = filepath.ToSlash(relPath)
		if prefix != "" && !strings.HasPrefix(relPath, prefix) {
			return nil
		}
		// Skip .syncignore itself and any ignored paths.
		if relPath == ".syncignore" || isPathIgnored(relPath, ignored) {
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
	return entries, nil
}

func (m *Manager) ReadFile(userID int, username, vaultName, relPath string) (string, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return "", err
	}
	absPath := filepath.Join(repo.Path(), sanitizePath(relPath))
	data, err := os.ReadFile(absPath)
	if err != nil {
		return "", fmt.Errorf("read file: %w", err)
	}
	return string(data), nil
}

func (m *Manager) FileHistory(userID int, username, vaultName, relPath string, maxCount int) ([]gitpkg.CommitInfo, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return nil, err
	}
	return repo.FileHistory(sanitizePath(relPath), maxCount)
}

func (m *Manager) FileContentAtCommit(userID int, username, vaultName, commitHash, relPath string) (string, error) {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return "", err
	}
	return repo.FileContentAtCommit(commitHash, sanitizePath(relPath))
}

func (m *Manager) LastCommitHash(userID int, username, vaultName string) string {
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return ""
	}
	return repo.LastCommitHash()
}

// ---- sync ignore (.syncignore file per vault) ----

// syncIgnoreFile returns the path to the .syncignore file for a vault.
func (m *Manager) syncIgnoreFile(username, vaultName string) string {
	return filepath.Join(m.vaultPath(username, vaultName), ".syncignore")
}

// GetIgnorePatterns reads the .syncignore file and returns non-empty, non-comment lines.
func (m *Manager) GetIgnorePatterns(userID int, username, vaultName string) ([]string, error) {
	// Ensure the vault exists (but don't init git just for reading ignores).
	vp := m.vaultPath(username, vaultName)
	_ = os.MkdirAll(vp, 0755)

	f, err := os.Open(m.syncIgnoreFile(username, vaultName))
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	defer f.Close()

	var patterns []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		patterns = append(patterns, line)
	}
	return patterns, sc.Err()
}

// SetIgnorePatterns writes patterns to .syncignore (replaces entire file).
func (m *Manager) SetIgnorePatterns(userID int, username, vaultName string, patterns []string) error {
	vp := m.vaultPath(username, vaultName)
	if err := os.MkdirAll(vp, 0755); err != nil {
		return err
	}
	f, err := os.Create(m.syncIgnoreFile(username, vaultName))
	if err != nil {
		return err
	}
	defer f.Close()
	for _, p := range patterns {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		fmt.Fprintln(f, p)
	}
	return nil
}

// CleanIgnoredFiles removes all files from disk (and git) that match current ignore patterns.
// Call after SetIgnorePatterns to keep the server vault consistent.
func (m *Manager) CleanIgnoredFiles(userID int, username, vaultName string) error {
	patterns, err := m.GetIgnorePatterns(userID, username, vaultName)
	if err != nil {
		return err
	}
	repo, err := m.getRepo(userID, username, vaultName)
	if err != nil {
		return err
	}

	var toDelete []string
	_ = filepath.Walk(repo.Path(), func(absPath string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			if info != nil && info.IsDir() && info.Name() == ".git" {
				return filepath.SkipDir
			}
			return nil
		}
		relPath, _ := filepath.Rel(repo.Path(), absPath)
		relPath = filepath.ToSlash(relPath)
		if relPath == ".syncignore" {
			return nil
		}
		if isPathIgnored(relPath, patterns) {
			toDelete = append(toDelete, relPath)
		}
		return nil
	})

	for _, p := range toDelete {
		if _, err := repo.DeleteFile(p, "server-cleanup"); err != nil {
			fmt.Printf("[vault] cleanup delete %s: %v\n", p, err)
		}
	}

	if len(toDelete) > 0 {
		fmt.Printf("[vault] cleanup: removed %d ignored files from %s/%s\n", len(toDelete), username, vaultName)
	}
	return nil
}

// isPathIgnored returns true if the given path matches any ignore pattern.
// Patterns are directory prefixes: "private/" matches "private/note.md" but not "private.md".
func isPathIgnored(path string, patterns []string) bool {
	path = filepath.ToSlash(path)
	for _, p := range patterns {
		p = filepath.ToSlash(strings.TrimSpace(p))
		if p == "" {
			continue
		}
		// Suffix "/" means directory prefix match.
		if strings.HasSuffix(p, "/") {
			if strings.HasPrefix(path, p) {
				return true
			}
		} else {
			// Without "/", exact prefix match on path component.
			if strings.HasPrefix(path, p) {
				return true
			}
		}
	}
	return false
}

// ---- helpers ----

func sanitizePath(p string) string {
	p = filepath.ToSlash(p)
	p = strings.TrimLeft(p, "/")
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

func sanitizeVaultName(name string) string {
	// Allow alphanumeric, dash, underscore; replace others
	name = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
			return r
		}
		return '_'
	}, name)
	if name == "" {
		return "default"
	}
	return name
}
