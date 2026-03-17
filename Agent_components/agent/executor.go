package main

import (
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

type CommandExecutor struct {
	config *Config
	logger *Logger
}

type CommandRequest struct {
	ID      string   `json:"id"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
	Timeout int      `json:"timeout"` // seconds
}

type CommandResponse struct {
	ID       string `json:"id"`
	Success  bool   `json:"success"`
	Output   string `json:"output"`
	Error    string `json:"error,omitempty"`
	ExitCode int    `json:"exit_code"`
	Duration int64  `json:"duration"` // milliseconds
}

func NewCommandExecutor(config *Config, logger *Logger) *CommandExecutor {
	return &CommandExecutor{
		config: config,
		logger: logger,
	}
}

func (ce *CommandExecutor) Execute(req CommandRequest) CommandResponse {
	startTime := time.Now()

	response := CommandResponse{
		ID:      req.ID,
		Success: false,
	}

	// Check if execution is enabled
	if !ce.config.Execution.Enabled {
		response.Error = "Command execution is disabled"
		return response
	}

	// Check blacklist
	if ce.isBlacklisted(req.Command) {
		response.Error = "Command is blacklisted"
		ce.logger.Warn("Blocked blacklisted command: %s", req.Command)
		return response
	}

	// Check whitelist (if configured)
	if len(ce.config.Execution.Whitelist) > 0 && !ce.isWhitelisted(req.Command) {
		response.Error = "Command is not whitelisted"
		ce.logger.Warn("Blocked non-whitelisted command: %s", req.Command)
		return response
	}

	// Set timeout
	timeout := ce.config.Execution.Timeout
	if req.Timeout > 0 {
		timeout = time.Duration(req.Timeout) * time.Second
	}

	// Create context with timeout
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	// Execute command
	ce.logger.Info("Executing command: %s %v", req.Command, req.Args)

	cmd := exec.CommandContext(ctx, req.Command, req.Args...)
	output, err := cmd.CombinedOutput()

	// Calculate duration
	duration := time.Since(startTime)
	response.Duration = duration.Milliseconds()

	if ctx.Err() == context.DeadlineExceeded {
		response.Error = "Command execution timeout"
		response.Output = string(output)
		ce.logger.Error("Command timeout: %s", req.Command)
		return response
	}

	// Get exit code
	if exitError, ok := err.(*exec.ExitError); ok {
		response.ExitCode = exitError.ExitCode()
	}

	// Truncate output if too large
	if len(output) > ce.config.Execution.MaxOutputSize {
		output = output[:ce.config.Execution.MaxOutputSize]
		response.Output = string(output) + "\n... (output truncated)"
	} else {
		response.Output = string(output)
	}

	if err != nil {
		response.Error = err.Error()
		response.Success = false
		ce.logger.Error("Command failed: %s - %v", req.Command, err)
	} else {
		response.Success = true
		ce.logger.Info("Command completed successfully: %s (took %dms)", req.Command, response.Duration)
	}

	return response
}

func (ce *CommandExecutor) isBlacklisted(command string) bool {
	for _, blocked := range ce.config.Execution.Blacklist {
		if strings.Contains(command, blocked) || command == blocked {
			return true
		}
	}
	return false
}

func (ce *CommandExecutor) isWhitelisted(command string) bool {
	for _, allowed := range ce.config.Execution.Whitelist {
		if strings.HasPrefix(command, allowed) || command == allowed {
			return true
		}
	}
	return false
}

func (ce *CommandExecutor) GetAllowedCommands() []string {
	if len(ce.config.Execution.Whitelist) > 0 {
		return ce.config.Execution.Whitelist
	}
	return []string{"*"}
}

// QuickCommands provides some common system commands
func (ce *CommandExecutor) ExecuteQuickCommand(commandType string) (string, error) {
	var cmd *exec.Cmd

	switch commandType {
	case "uptime":
		cmd = exec.Command("uptime")
	case "df":
		cmd = exec.Command("df", "-h")
	case "free":
		cmd = exec.Command("free", "-h")
	case "top":
		cmd = exec.Command("top", "-b", "-n", "1")
	case "ps":
		cmd = exec.Command("ps", "aux", "--sort=-%cpu", "|", "head", "-20")
	case "netstat":
		cmd = exec.Command("netstat", "-tuln")
	case "docker-ps":
		cmd = exec.Command("docker", "ps", "-a")
	case "systemctl":
		cmd = exec.Command("systemctl", "list-units", "--state=failed")
	default:
		return "", fmt.Errorf("unknown quick command: %s", commandType)
	}

	output, err := cmd.CombinedOutput()
	return string(output), err
}

// ParseCommand parses a full command line into command and args
func ParseCommand(cmdLine string) (string, []string) {
	parts := strings.Fields(cmdLine)
	if len(parts) == 0 {
		return "", nil
	}
	return parts[0], parts[1:]
}

// ExecuteScript executes a multi-line script
func (ce *CommandExecutor) ExecuteScript(script string, interpreter string) CommandResponse {
	if interpreter == "" {
		interpreter = "bash"
	}

	req := CommandRequest{
		ID:      fmt.Sprintf("script-%d", time.Now().Unix()),
		Command: interpreter,
		Args:    []string{"-c", script},
	}

	return ce.Execute(req)
}
