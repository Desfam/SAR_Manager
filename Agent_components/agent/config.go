package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"time"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Server struct {
		URL                  string        `yaml:"url"`
		Token                string        `yaml:"token"`
		ReconnectDelay       time.Duration `yaml:"reconnect_delay"`
		MaxReconnectAttempts int           `yaml:"max_reconnect_attempts"`
	} `yaml:"server"`

	Agent struct {
		ID          string   `yaml:"id"`
		Name        string   `yaml:"name"`
		Tags        []string `yaml:"tags"`
		Environment string   `yaml:"environment"`
	} `yaml:"agent"`

	Metrics struct {
		Interval   time.Duration `yaml:"interval"`
		Collectors struct {
			CPU        bool `yaml:"cpu"`
			Memory     bool `yaml:"memory"`
			Disk       bool `yaml:"disk"`
			Network    bool `yaml:"network"`
			Connections bool `yaml:"connections"`
			Processes  bool `yaml:"processes"`
			Docker     bool `yaml:"docker"`
			SystemInfo bool `yaml:"system_info"`
		} `yaml:"collectors"`
	} `yaml:"metrics"`

	Execution struct {
		Enabled       bool          `yaml:"enabled"`
		Timeout       time.Duration `yaml:"timeout"`
		Whitelist     []string      `yaml:"whitelist"`
		Blacklist     []string      `yaml:"blacklist"`
		MaxOutputSize int           `yaml:"max_output_size"`
	} `yaml:"execution"`

	FileMonitoring struct {
		Enabled         bool     `yaml:"enabled"`
		WatchPaths      []string `yaml:"watch_paths"`
		ExcludePatterns []string `yaml:"exclude_patterns"`
	} `yaml:"file_monitoring"`

	Logging struct {
		Level      string `yaml:"level"`
		File       string `yaml:"file"`
		MaxSize    int    `yaml:"max_size"`
		MaxBackups int    `yaml:"max_backups"`
	} `yaml:"logging"`

	Security struct {
		TLSVerify  bool   `yaml:"tls_verify"`
		CACert     string `yaml:"ca_cert"`
		ClientCert string `yaml:"client_cert"`
		ClientKey  string `yaml:"client_key"`
	} `yaml:"security"`

	Updates struct {
		AutoUpdate    bool          `yaml:"auto_update"`
		CheckInterval time.Duration `yaml:"check_interval"`
		Channel       string        `yaml:"channel"`
	} `yaml:"updates"`

	// Offline queue and local state storage
	Queue struct {
		Dir        string `yaml:"dir"`        // directory for queued messages; default: /var/lib/homelab-agent/queue
		MaxSizeMB  int    `yaml:"max_size_mb"` // max total size before oldest entries are dropped
	} `yaml:"queue"`
}

func LoadConfig(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := yaml.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config file: %w", err)
	}

	// Validate required fields
	if config.Server.URL == "" {
		return nil, fmt.Errorf("server.url is required")
	}

	if config.Server.Token == "" || config.Server.Token == "CHANGE_ME_GENERATE_SECURE_TOKEN" {
		return nil, fmt.Errorf("server.token must be set to a secure value")
	}

	// Set defaults
	if config.Metrics.Interval == 0 {
		config.Metrics.Interval = 30 * time.Second
	}

	if config.Execution.Timeout == 0 {
		config.Execution.Timeout = 300 * time.Second
	}

	if config.Execution.MaxOutputSize == 0 {
		config.Execution.MaxOutputSize = 1048576 // 1MB
	}

	return &config, nil
}

func GenerateAgentID() string {
	bytes := make([]byte, 16)
	if _, err := rand.Read(bytes); err != nil {
		// Fallback to timestamp-based ID
		return fmt.Sprintf("agent-%d", time.Now().Unix())
	}
	return hex.EncodeToString(bytes)
}
