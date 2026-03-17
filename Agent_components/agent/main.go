package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"
	"time"
)

const (
	Version = "1.0.0"
)

var (
	configPath = flag.String("config", "/etc/homelab-agent/config.yaml", "Path to configuration file")
	version    = flag.Bool("version", false, "Print version and exit")
	verbose    = flag.Bool("verbose", false, "Enable verbose logging")
)

func main() {
	flag.Parse()

	if *version {
		fmt.Printf("Homelab Agent v%s\n", Version)
		os.Exit(0)
	}

	// Print banner
	printBanner()

	// Load configuration
	config, err := LoadConfig(*configPath)
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	// Override log level if verbose
	if *verbose {
		config.Logging.Level = "debug"
	}

	// Initialize logger
	logger := NewLogger(config.Logging)
	logger.Info("Starting Homelab Agent v%s", Version)
	logger.Info("Configuration loaded from: %s", *configPath)

	// Generate agent ID if not set
	if config.Agent.ID == "" {
		config.Agent.ID = GenerateAgentID()
		logger.Info("Generated agent ID: %s", config.Agent.ID)
	}

	// ── Offline queue ──────────────────────────────────────────────
	queueDir := config.Queue.Dir
	if queueDir == "" {
		queueDir = filepath.Join(filepath.Dir(*configPath), "queue")
	}
	queue, err := NewOfflineQueue(queueDir, logger)
	if err != nil {
		logger.Warn("Offline queue unavailable (%v) — messages won't be buffered", err)
		queue = nil
	} else {
		logger.Info("Offline queue ready: %s (%d item(s) pending)", queueDir, queue.Size())
	}

	// ── Policy ─────────────────────────────────────────────────────
	policyPath := filepath.Join(queueDir, "policy.json")
	policy := LoadPolicy(policyPath)
	logger.Info("Agent policy: profile=%s, metrics=%v, audits=%v, exec=%v",
		policy.ProfileID, policy.Features.Metrics,
		policy.Features.SecurityAudits, policy.Features.CommandExecution)

	// ── Core components ────────────────────────────────────────────
	collector := NewMetricsCollector(config, logger)
	executor := NewCommandExecutor(config, logger)
	auditEngine := NewAuditEngine(logger)
	jobHandler := NewJobHandler(config, logger, auditEngine, executor, queue, policy)

	// Initialize WebSocket client
	client := NewWebSocketClient(config, logger, collector, executor, jobHandler, policy, queue)
	jobHandler.SetClient(client)

	// Start metrics collection
	go collector.Start()

	// Connect to server
	go client.Connect()

	// Setup signal handling for graceful shutdown
	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	logger.Info("Agent started successfully")
	logger.Info("Agent ID: %s", config.Agent.ID)
	logger.Info("Agent Name: %s", config.Agent.Name)
	logger.Info("Server URL: %s", config.Server.URL)

	// Wait for shutdown signal
	sig := <-sigChan
	logger.Info("Received signal: %v", sig)
	logger.Info("Shutting down gracefully...")

	// Cleanup
	collector.Stop()
	client.Disconnect()

	logger.Info("Agent stopped")
	time.Sleep(100 * time.Millisecond)
}

func printBanner() {
	fmt.Println(`
╔═══════════════════════════════════════╗
║   Homelab Agent v` + Version + `                ║
║   System Monitoring & Management      ║
╚═══════════════════════════════════════╝
`)
}
