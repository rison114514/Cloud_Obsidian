package config

import (
	"os"
	"path/filepath"
)

// Config holds all server configuration.
type Config struct {
	Port     string
	DataDir  string
	JWTSecret string
}

// Load reads configuration from environment variables with sensible defaults.
func Load() *Config {
	return &Config{
		Port:      getEnv("CLOUD_OBSIDIAN_PORT", "8080"),
		DataDir:   getEnv("CLOUD_OBSIDIAN_DATA_DIR", "./data"),
		JWTSecret: getEnv("CLOUD_OBSIDIAN_JWT_SECRET", "cloud-obsidian-dev-secret-change-in-production"),
	}
}

// VaultsDir returns the directory where user vault working trees live.
func (c *Config) VaultsDir() string {
	return filepath.Join(c.DataDir, "vaults")
}

// DBPath returns the path to the SQLite database file.
func (c *Config) DBPath() string {
	return filepath.Join(c.DataDir, "cloud-obsidian.db")
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
