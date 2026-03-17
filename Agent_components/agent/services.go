package main

import (
	"bytes"
	"encoding/json"
	"os/exec"
	"strings"
	"time"
)

// ServiceInfo represents a systemd service
type ServiceInfo struct {
	Name        string `json:"name"`
	LoadState   string `json:"load_state"`
	ActiveState string `json:"active_state"`
	SubState    string `json:"sub_state"`
	Description string `json:"description"`
	PID         int    `json:"pid,omitempty"`
	Memory      uint64 `json:"memory,omitempty"`
}

// ServiceCollector collects systemd service information
type ServiceCollector struct {
	logger *Logger
	config *Config
}

// NewServiceCollector creates a new service collector
func NewServiceCollector(config *Config, logger *Logger) *ServiceCollector {
	return &ServiceCollector{
		logger: logger,
		config: config,
	}
}

// CollectServices gets all systemd services
func (sc *ServiceCollector) CollectServices() []ServiceInfo {
	var services []ServiceInfo

	// Run systemctl list-units --type=service --all --output=json
	cmd := exec.Command("systemctl", "list-units", "--type=service", "--all", "--output=json")
	var out bytes.Buffer
	cmd.Stdout = &out
	
	if err := cmd.Run(); err != nil {
		sc.logger.Error("Failed to list services: %v", err)
		// Fallback to simple list
		return sc.collectServicesSimple()
	}

	var rawServices []map[string]interface{}
	if err := json.Unmarshal(out.Bytes(), &rawServices); err != nil {
		sc.logger.Error("Failed to parse service list: %v", err)
		return sc.collectServicesSimple()
	}

	for _, svc := range rawServices {
		name := ""
		if unit, ok := svc["unit"].(string); ok {
			name = strings.TrimSuffix(unit, ".service")
		}
		
		service := ServiceInfo{
			Name:        name,
			LoadState:   getString(svc, "load"),
			ActiveState: getString(svc, "active"),
			SubState:    getString(svc, "sub"),
			Description: getString(svc, "description"),
		}
		
		services = append(services, service)
	}

	sc.logger.Debug("Collected %d services", len(services))
	return services
}

// collectServicesSimple is a fallback for systems without JSON support
func (sc *ServiceCollector) collectServicesSimple() []ServiceInfo {
	var services []ServiceInfo
	
	cmd := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-pager")
	var out bytes.Buffer
	cmd.Stdout = &out
	
	if err := cmd.Run(); err != nil {
		sc.logger.Error("Failed to list services (simple): %v", err)
		return services
	}

	lines := strings.Split(out.String(), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "UNIT") || strings.HasPrefix(line, "●") {
			continue
		}
		
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		
		name := strings.TrimSuffix(fields[0], ".service")
		description := ""
		if len(fields) > 4 {
			description = strings.Join(fields[4:], " ")
		}
		
		service := ServiceInfo{
			Name:        name,
			LoadState:   fields[1],
			ActiveState: fields[2],
			SubState:    fields[3],
			Description: description,
		}
		
		services = append(services, service)
	}

	return services
}

func getString(m map[string]interface{}, key string) string {
	if v, ok := m[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

// LogEntry represents a log file entry
type LogEntry struct {
	Timestamp time.Time `json:"timestamp"`
	Level     string    `json:"level"`
	Source    string    `json:"source"`
	Message   string    `json:"message"`
}

// LogCollector collects important system logs
type LogCollector struct {
	logger   *Logger
	config   *Config
	logFiles []string
}

// NewLogCollector creates a new log collector
func NewLogCollector(config *Config, logger *Logger) *LogCollector {
	logFiles := []string{
		"/var/log/syslog",
		"/var/log/auth.log",
		"/var/log/kern.log",
	}
	
	return &LogCollector{
		logger:   logger,
		config:   config,
		logFiles: logFiles,
	}
}

// CollectLogs gets recent log entries
func (lc *LogCollector) CollectLogs(lines int) map[string][]string {
	logs := make(map[string][]string)

	for _, logFile := range lc.logFiles {
		entries := lc.readLogFile(logFile, lines)
		if len(entries) > 0 {
			logs[logFile] = entries
		}
	}

	// Also get journalctl logs
	journalLogs := lc.collectJournalLogs(lines)
	if len(journalLogs) > 0 {
		logs["journalctl"] = journalLogs
	}

	return logs
}

// readLogFile reads last N lines from a log file
func (lc *LogCollector) readLogFile(path string, lines int) []string {
	cmd := exec.Command("tail", "-n", string(rune(lines)), path)
	var out bytes.Buffer
	cmd.Stdout = &out
	
	if err := cmd.Run(); err != nil {
		return nil
	}

	result := strings.Split(strings.TrimSpace(out.String()), "\n")
	if len(result) > lines {
		return result[len(result)-lines:]
	}
	return result
}

// collectJournalLogs gets recent journal entries
func (lc *LogCollector) collectJournalLogs(lines int) []string {
	cmd := exec.Command("journalctl", "-n", string(rune(lines)), "--no-pager", "-p", "err")
	var out bytes.Buffer
	cmd.Stdout = &out
	
	if err := cmd.Run(); err != nil {
		lc.logger.Debug("Failed to collect journal logs: %v", err)
		return nil
	}

	return strings.Split(strings.TrimSpace(out.String()), "\n")
}
