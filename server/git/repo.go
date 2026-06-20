package git

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	gogit "github.com/go-git/go-git/v5"
	"github.com/go-git/go-git/v5/plumbing"
	"github.com/go-git/go-git/v5/plumbing/object"
)

// Repo wraps a go-git repository for a single user's vault.
type Repo struct {
	path string
	repo *gogit.Repository
}

// InitRepo creates or opens a git repository at the given directory.
// If the directory doesn't exist, it is created and initialized.
func InitRepo(vaultPath string) (*Repo, error) {
	if err := os.MkdirAll(vaultPath, 0755); err != nil {
		return nil, fmt.Errorf("mkdir vault: %w", err)
	}

	repo, err := gogit.PlainInit(vaultPath, false)
	if err == gogit.ErrRepositoryAlreadyExists {
		repo, err = gogit.PlainOpen(vaultPath)
	}
	if err != nil {
		return nil, fmt.Errorf("open repo: %w", err)
	}

	return &Repo{path: vaultPath, repo: repo}, nil
}

// Path returns the absolute vault directory path.
func (r *Repo) Path() string {
	return r.path
}

// WriteFile creates or updates a file in the vault and commits the change.
func (r *Repo) WriteFile(relPath, content, deviceName string) (string, error) {
	absPath := filepath.Join(r.path, relPath)

	// Ensure parent directories exist.
	if err := os.MkdirAll(filepath.Dir(absPath), 0755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}

	// Write the file.
	if err := os.WriteFile(absPath, []byte(content), 0644); err != nil {
		return "", fmt.Errorf("write file: %w", err)
	}

	// Stage and commit.
	return r.commit(relPath, "update", deviceName)
}

// DeleteFile removes a file from the vault and commits the deletion.
func (r *Repo) DeleteFile(relPath, deviceName string) (string, error) {
	absPath := filepath.Join(r.path, relPath)
	if err := os.Remove(absPath); err != nil && !os.IsNotExist(err) {
		return "", fmt.Errorf("remove file: %w", err)
	}
	return r.commit(relPath, "delete", deviceName)
}

// RenameFile handles a move/rename with a single commit.
func (r *Repo) RenameFile(oldPath, newPath, deviceName string) (string, error) {
	absOld := filepath.Join(r.path, oldPath)
	absNew := filepath.Join(r.path, newPath)

	if err := os.MkdirAll(filepath.Dir(absNew), 0755); err != nil {
		return "", fmt.Errorf("mkdir: %w", err)
	}
	if err := os.Rename(absOld, absNew); err != nil {
		return "", fmt.Errorf("rename: %w", err)
	}
	return r.commit(newPath, "rename", deviceName)
}

// LastCommitTime returns the time of the most recent commit (zero if none).
func (r *Repo) LastCommitHash() string {
	ref, err := r.repo.Head()
	if err != nil {
		return ""
	}
	return ref.Hash().String()
}

// Log returns recent commits.
func (r *Repo) Log(maxCount int) ([]CommitInfo, error) {
	ref, err := r.repo.Head()
	if err != nil {
		return nil, nil // no commits yet
	}
	iter, err := r.repo.Log(&gogit.LogOptions{From: ref.Hash()})
	if err != nil {
		return nil, fmt.Errorf("log: %w", err)
	}
	defer iter.Close()

	var commits []CommitInfo
	count := 0
	err = iter.ForEach(func(c *object.Commit) error {
		if count >= maxCount {
			return fmt.Errorf("stop")
		}
		commits = append(commits, CommitInfo{
			Hash:    c.Hash.String(),
			Message: c.Message,
			Time:    c.Author.When,
		})
		count++
		return nil
	})
	if err != nil && err.Error() != "stop" {
		return nil, err
	}
	return commits, nil
}

// FileHistory returns the commit history for a specific file.
func (r *Repo) FileHistory(relPath string, maxCount int) ([]CommitInfo, error) {
	ref, err := r.repo.Head()
	if err != nil {
		return nil, nil
	}
	iter, err := r.repo.Log(&gogit.LogOptions{
		From:  ref.Hash(),
		PathFilter: func(p string) bool { return p == relPath },
	})
	if err != nil {
		return nil, fmt.Errorf("log file: %w", err)
	}
	defer iter.Close()

	var commits []CommitInfo
	count := 0
	iter.ForEach(func(c *object.Commit) error {
		if count >= maxCount {
			return fmt.Errorf("stop")
		}
		commits = append(commits, CommitInfo{
			Hash:    c.Hash.String(),
			Message: c.Message,
			Time:    c.Author.When,
		})
		count++
		return nil
	})
	return commits, nil
}

// FileContentAtCommit returns the content of a file at a specific commit.
func (r *Repo) FileContentAtCommit(commitHash, relPath string) (string, error) {
	hash := plumbing.NewHash(commitHash)
	commit, err := r.repo.CommitObject(hash)
	if err != nil {
		return "", fmt.Errorf("commit object: %w", err)
	}
	tree, err := commit.Tree()
	if err != nil {
		return "", fmt.Errorf("tree: %w", err)
	}
	file, err := tree.File(relPath)
	if err != nil {
		return "", fmt.Errorf("file in tree: %w", err)
	}
	content, err := file.Contents()
	if err != nil {
		return "", fmt.Errorf("contents: %w", err)
	}
	return content, nil
}

// commit stages all changes and creates a commit with a descriptive message.
func (r *Repo) commit(relPath, action, deviceName string) (string, error) {
	wt, err := r.repo.Worktree()
	if err != nil {
		return "", fmt.Errorf("worktree: %w", err)
	}

	if _, err := wt.Add("."); err != nil {
		return "", fmt.Errorf("add: %w", err)
	}

	msg := fmt.Sprintf("sync: %s %s [device: %s]", action, relPath, deviceName)
	hash, err := wt.Commit(msg, &gogit.CommitOptions{
		Author: &object.Signature{
			Name:  "Cloud-Obsidian",
			Email: "sync@cloud-obsidian.local",
			When:  time.Now(),
		},
	})
	if err != nil {
		return "", fmt.Errorf("commit: %w", err)
	}
	return hash.String(), nil
}

// CommitInfo is a lightweight view of a commit for API responses.
type CommitInfo struct {
	Hash    string    `json:"hash"`
	Message string    `json:"message"`
	Time    time.Time `json:"time"`
}
