package main

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"
)

// JobDispatch is sent from server → agent to request a job execution.
type JobDispatch struct {
	JobID       string                 `json:"job_id"`
	JobType     string                 `json:"job_type"`
	AuditType   string                 `json:"audit_type,omitempty"`
	RequestedBy string                 `json:"requested_by"`
	Options     map[string]interface{} `json:"options,omitempty"`
}

// JobResult is sent from agent → server when a job completes.
type JobResult struct {
	JobID       string          `json:"job_id"`
	AgentID     string          `json:"agent_id"`
	JobType     string          `json:"job_type"`
	Status      string          `json:"status"` // running, completed, failed
	Result      json.RawMessage `json:"result,omitempty"`
	Error       string          `json:"error,omitempty"`
	CompletedAt string          `json:"completed_at"`
}

// JobHandler receives job dispatches and routes them to the right handler.
type JobHandler struct {
	config *Config
	logger *Logger
	audit  *AuditEngine
	exec   *CommandExecutor
	queue  *OfflineQueue
	policy *AgentPolicy
	client *WebSocketClient
}

func NewJobHandler(
	config *Config, logger *Logger,
	audit *AuditEngine, exec *CommandExecutor,
	queue *OfflineQueue, policy *AgentPolicy,
) *JobHandler {
	return &JobHandler{
		config: config,
		logger: logger,
		audit:  audit,
		exec:   exec,
		queue:  queue,
		policy: policy,
	}
}

// SetClient wires in the WebSocket client reference (after construction to avoid circularity).
func (jh *JobHandler) SetClient(client *WebSocketClient) {
	jh.client = client
}

// HandleJob receives a dispatch and processes it in the background.
func (jh *JobHandler) HandleJob(dispatch JobDispatch) {
	go jh.processJob(dispatch)
}

func (jh *JobHandler) processJob(dispatch JobDispatch) {
	jh.logger.Info("Processing job %s (type: %s)", dispatch.JobID, dispatch.JobType)

	// Notify server: job is running
	jh.sendStatus(dispatch, "running", nil, "")

	var result interface{}
	var jobErr string

	switch dispatch.JobType {
	case "security_audit":
		if !jh.policy.IsFeatureEnabled("security_audits") {
			jobErr = "security audits are disabled by policy"
			break
		}
		auditResult := jh.audit.Run(
			dispatch.JobID, jh.config.Agent.ID,
			dispatch.AuditType, dispatch.Options,
		)
		result = auditResult
		// Send dedicated audit_result message so backend can store it separately
		jh.send("audit_result", auditResult)

	case "command":
		if !jh.policy.IsFeatureEnabled("command_execution") {
			jobErr = "command execution is disabled by policy"
			break
		}
		if dispatch.Options != nil {
			cmd, _ := dispatch.Options["command"].(string)
			timeout, _ := dispatch.Options["timeout"].(float64)
			var args []string
			if raw, ok := dispatch.Options["args"].([]interface{}); ok {
				for _, a := range raw {
					if s, ok := a.(string); ok {
						args = append(args, s)
					}
				}
			}
			cmdResult := jh.exec.Execute(CommandRequest{
				ID:      dispatch.JobID,
				Command: cmd,
				Args:    args,
				Timeout: int(timeout),
			})
			result = cmdResult
			if !cmdResult.Success {
				jobErr = cmdResult.Error
			}
		}

	case "file_collection":
		if !jh.policy.IsFeatureEnabled("file_collection") {
			jobErr = "file collection is disabled by policy"
			break
		}
		result = jh.collectFiles(dispatch.Options)

	default:
		jobErr = fmt.Sprintf("unknown job type: %s", dispatch.JobType)
	}

	jh.sendResult(dispatch, result, jobErr)
}

func (jh *JobHandler) sendStatus(dispatch JobDispatch, status string, result interface{}, errMsg string) {
	rb, _ := json.Marshal(result)
	jr := JobResult{
		JobID: dispatch.JobID, AgentID: jh.config.Agent.ID,
		JobType: dispatch.JobType, Status: status,
		Result: rb, Error: errMsg,
		CompletedAt: time.Now().Format(time.RFC3339),
	}
	jh.send("job_status", jr)
}

func (jh *JobHandler) sendResult(dispatch JobDispatch, result interface{}, errMsg string) {
	status := "completed"
	if errMsg != "" {
		status = "failed"
	}

	rb, _ := json.Marshal(result)
	jr := JobResult{
		JobID: dispatch.JobID, AgentID: jh.config.Agent.ID,
		JobType: dispatch.JobType, Status: status,
		Result: rb, Error: errMsg,
		CompletedAt: time.Now().Format(time.RFC3339),
	}

	if err := jh.send("job_result", jr); err != nil {
		jh.logger.Error("Failed to send job result, queuing: %v", err)
		if jh.queue != nil {
			jh.queue.Enqueue("job_result", jr)
		}
	}
	jh.logger.Info("Job %s → %s", dispatch.JobID, status)
}

func (jh *JobHandler) send(msgType string, payload interface{}) error {
	if jh.client != nil && jh.client.isConnected() {
		return jh.client.sendMessage(msgType, payload)
	}
	if jh.queue != nil {
		return jh.queue.Enqueue(msgType, payload)
	}
	return fmt.Errorf("no active connection and no queue available")
}

// collectFiles gathers config/log files within safe path prefixes.
func (jh *JobHandler) collectFiles(options map[string]interface{}) map[string]interface{} {
	defaults := []string{
		"/etc/ssh/sshd_config",
		"/etc/fstab",
		"/etc/hosts",
		"/etc/hostname",
		"/etc/os-release",
	}

	paths := defaults
	if raw, ok := options["paths"].([]interface{}); ok {
		paths = nil
		for _, p := range raw {
			if s, ok := p.(string); ok {
				paths = append(paths, s)
			}
		}
	}

	out := make(map[string]interface{})
	for _, p := range paths {
		if !jh.isSafePath(p) {
			out[p] = map[string]string{"error": "path not in allowed collection directories"}
			continue
		}
		data, err := os.ReadFile(p)
		if err != nil {
			out[p] = map[string]string{"error": err.Error()}
		} else {
			out[p] = string(data)
		}
	}
	return out
}

func (jh *JobHandler) isSafePath(p string) bool {
	// Prevent path traversal
	if strings.Contains(p, "..") {
		return false
	}
	for _, prefix := range []string{"/etc/", "/var/log/", "/proc/version", "/proc/cpuinfo"} {
		if strings.HasPrefix(p, prefix) {
			return true
		}
	}
	return false
}
