package main

import (
	"crypto/tls"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type WebSocketClient struct {
	config     *Config
	logger     *Logger
	collector  *MetricsCollector
	executor   *CommandExecutor
	jobHandler *JobHandler
	policy     *AgentPolicy
	queue      *OfflineQueue
	conn       *websocket.Conn
	mu         sync.Mutex
	connected  bool
	stopChan   chan struct{}
}

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type AgentCapabilities struct {
	Metrics           bool `json:"metrics"`
	SecurityAudits    bool `json:"security_audits"`
	CommandExecution  bool `json:"command_execution"`
	FileCollection    bool `json:"file_collection"`
	ServiceInspection bool `json:"service_inspection"`
	ArtifactUpload    bool `json:"artifact_upload"`
	OfflineQueue      bool `json:"offline_queue"`
}

type RegisterPayload struct {
	AgentID      string             `json:"agent_id"`
	AgentName    string             `json:"agent_name"`
	Version      string             `json:"version"`
	Tags         []string           `json:"tags"`
	Environment  string             `json:"environment"`
	Hostname     string             `json:"hostname"`
	OS           string             `json:"os"`
	Platform     string             `json:"platform"`
	IPAddress    string             `json:"ip_address,omitempty"`
	Capabilities AgentCapabilities  `json:"capabilities"`
}

func NewWebSocketClient(
	config *Config, logger *Logger,
	collector *MetricsCollector, executor *CommandExecutor,
	jobHandler *JobHandler, policy *AgentPolicy, queue *OfflineQueue,
) *WebSocketClient {
	return &WebSocketClient{
		config:     config,
		logger:     logger,
		collector:  collector,
		executor:   executor,
		jobHandler: jobHandler,
		policy:     policy,
		queue:      queue,
		stopChan:   make(chan struct{}),
	}
}

// getLocalIP returns the first non-loopback IPv4 address.
func getLocalIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagLoopback != 0 || iface.Flags&net.FlagUp == 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			if ip != nil && ip.To4() != nil {
				return ip.String()
			}
		}
	}
	return ""
}

func (wsc *WebSocketClient) Connect() {
	attempt := 0

	for {
		select {
		case <-wsc.stopChan:
			return
		default:
		}

		attempt++
		wsc.logger.Info("Connecting to server... (attempt %d)", attempt)

		// Parse URL and add token as query parameter
		u, err := url.Parse(wsc.config.Server.URL)
		if err != nil {
			wsc.logger.Error("Invalid server URL: %v", err)
			time.Sleep(wsc.config.Server.ReconnectDelay)
			continue
		}

		q := u.Query()
		q.Set("token", wsc.config.Server.Token)
		q.Set("agent_id", wsc.config.Agent.ID)
		u.RawQuery = q.Encode()

		// Setup TLS config
		tlsConfig := &tls.Config{
			InsecureSkipVerify: !wsc.config.Security.TLSVerify,
		}

		dialer := websocket.Dialer{
			TLSClientConfig:  tlsConfig,
			HandshakeTimeout: 10 * time.Second,
		}

		// Connect
		conn, _, err := dialer.Dial(u.String(), http.Header{
			"User-Agent": []string{fmt.Sprintf("homelab-agent/%s", Version)},
		})

		if err != nil {
			wsc.logger.Error("Connection failed: %v", err)
			
			// Check reconnect limit
			if wsc.config.Server.MaxReconnectAttempts > 0 && 
			   attempt >= wsc.config.Server.MaxReconnectAttempts {
				wsc.logger.Error("Max reconnect attempts reached. Giving up.")
				return
			}

			time.Sleep(wsc.config.Server.ReconnectDelay)
			continue
		}

		wsc.mu.Lock()
		wsc.conn = conn
		wsc.connected = true
		wsc.mu.Unlock()

		wsc.logger.Info("Connected to server successfully")
		attempt = 0 // Reset attempt counter on successful connection

		// Register agent
		if err := wsc.register(); err != nil {
			wsc.logger.Error("Failed to register agent: %v", err)
			conn.Close()
			time.Sleep(wsc.config.Server.ReconnectDelay)
			continue
		}

		// Drain offline queue after successful registration
		if wsc.queue != nil && wsc.queue.Size() > 0 {
			go func() {
				time.Sleep(2 * time.Second)
				wsc.queue.Drain(func(msgType string, payload json.RawMessage) error {
					return wsc.sendRaw(msgType, payload)
				})
			}()
		}

		// Start message handlers
		errChan := make(chan error, 2)
		go wsc.readMessages(errChan)
		go wsc.sendMetrics(errChan)

		// Wait for error
		err = <-errChan
		wsc.logger.Warn("Connection error: %v", err)

		wsc.mu.Lock()
		wsc.connected = false
		if wsc.conn != nil {
			wsc.conn.Close()
			wsc.conn = nil
		}
		wsc.mu.Unlock()

		// Reconnect
		wsc.logger.Info("Reconnecting in %v...", wsc.config.Server.ReconnectDelay)
		time.Sleep(wsc.config.Server.ReconnectDelay)
	}
}

func (wsc *WebSocketClient) register() error {
	sysInfo := wsc.collector.GetMetrics().SystemInfo

	caps := AgentCapabilities{
		Metrics:           wsc.config.Metrics.Collectors.CPU,
		SecurityAudits:    true,
		CommandExecution:  wsc.config.Execution.Enabled,
		FileCollection:    true,
		ServiceInspection: true,
		ArtifactUpload:    false,
		OfflineQueue:      wsc.queue != nil,
	}

	payload := RegisterPayload{
		AgentID:      wsc.config.Agent.ID,
		AgentName:    wsc.config.Agent.Name,
		Version:      Version,
		Tags:         wsc.config.Agent.Tags,
		Environment:  wsc.config.Agent.Environment,
		Hostname:     sysInfo.Hostname,
		OS:           sysInfo.OS,
		Platform:     sysInfo.Platform,
		IPAddress:    getLocalIP(),
		Capabilities: caps,
	}

	return wsc.sendMessage("register", payload)
}

func (wsc *WebSocketClient) readMessages(errChan chan error) {
	defer func() {
		errChan <- fmt.Errorf("read loop ended")
	}()

	for {
		wsc.mu.Lock()
		conn := wsc.conn
		wsc.mu.Unlock()

		if conn == nil {
			return
		}

		var msg Message
		err := conn.ReadJSON(&msg)
		if err != nil {
			errChan <- fmt.Errorf("read error: %w", err)
			return
		}

		wsc.handleMessage(msg)
	}
}

func (wsc *WebSocketClient) handleMessage(msg Message) {
	wsc.logger.Debug("Received message: type=%s", msg.Type)

	switch msg.Type {
	case "ping":
		wsc.sendMessage("pong", map[string]string{"timestamp": time.Now().Format(time.RFC3339)})

	case "execute_command":
		var cmdReq CommandRequest
		if err := json.Unmarshal(msg.Payload, &cmdReq); err != nil {
			wsc.logger.Error("Failed to parse command request: %v", err)
			return
		}
		response := wsc.executor.Execute(cmdReq)
		wsc.sendMessage("command_response", response)

	case "job_dispatch":
		var dispatch JobDispatch
		if err := json.Unmarshal(msg.Payload, &dispatch); err != nil {
			wsc.logger.Error("Failed to parse job dispatch: %v", err)
			return
		}
		if wsc.jobHandler != nil {
			wsc.jobHandler.HandleJob(dispatch)
		} else {
			wsc.logger.Warn("Received job_dispatch but no job handler registered")
		}

	case "policy_update":
		if wsc.policy != nil {
			wsc.policy.Update(msg.Payload)
			wsc.logger.Info("Policy updated from server (profile: %s)", wsc.policy.ProfileID)
			// Persist to disk
			if wsc.config.Queue.Dir != "" {
				_ = wsc.policy.Save(wsc.config.Queue.Dir + "/policy.json")
			}
		}

	case "request_metrics":
		metrics := wsc.collector.GetMetrics()
		wsc.sendMessage("metrics", metrics)

	case "config_update":
		wsc.logger.Info("Received config update from server")

	case "registered":
		wsc.logger.Info("Agent registration acknowledged by server")

	default:
		wsc.logger.Warn("Unknown message type: %s", msg.Type)
	}
}

func (wsc *WebSocketClient) sendMetrics(errChan chan error) {
	ticker := time.NewTicker(wsc.config.Metrics.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-wsc.stopChan:
			return
		case <-ticker.C:
			if !wsc.isConnected() {
				continue
			}

			metrics := wsc.collector.GetMetrics()
			if err := wsc.sendMessage("metrics", metrics); err != nil {
				wsc.logger.Error("Failed to send metrics: %v", err)
				errChan <- err
				return
			}

			wsc.logger.Debug("Metrics sent successfully")
		}
	}
}

func (wsc *WebSocketClient) sendMessage(msgType string, payload interface{}) error {
	wsc.mu.Lock()
	defer wsc.mu.Unlock()

	if wsc.conn == nil {
		return fmt.Errorf("not connected")
	}

	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("failed to marshal payload: %w", err)
	}

	msg := Message{
		Type:    msgType,
		Payload: payloadBytes,
	}

	if err := wsc.conn.WriteJSON(msg); err != nil {
		return fmt.Errorf("failed to send message: %w", err)
	}

	return nil
}

// sendRaw sends a pre-serialised payload — used when draining the offline queue.
func (wsc *WebSocketClient) sendRaw(msgType string, payload json.RawMessage) error {
	wsc.mu.Lock()
	defer wsc.mu.Unlock()

	if wsc.conn == nil {
		return fmt.Errorf("not connected")
	}

	return wsc.conn.WriteJSON(Message{Type: msgType, Payload: payload})
}

func (wsc *WebSocketClient) isConnected() bool {
	wsc.mu.Lock()
	defer wsc.mu.Unlock()
	return wsc.connected
}

func (wsc *WebSocketClient) Disconnect() {
	close(wsc.stopChan)

	wsc.mu.Lock()
	defer wsc.mu.Unlock()

	if wsc.conn != nil {
		wsc.conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, ""))
		wsc.conn.Close()
		wsc.conn = nil
	}

	wsc.connected = false
	wsc.logger.Info("Disconnected from server")
}
