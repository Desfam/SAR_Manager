#!/bin/bash
# Installation script for Homelab Agent

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${BLUE}"
cat << "EOF"
╔═══════════════════════════════════════╗
║   Homelab Agent Installer             ║
║   System Monitoring & Management      ║
╚═══════════════════════════════════════╝
EOF
echo -e "${NC}"

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
    echo -e "${RED}Please run as root (use sudo)${NC}"
    exit 1
fi

# Configuration
INSTALL_DIR="/opt/homelab-agent"
CONFIG_DIR="/etc/homelab-agent"
LOG_DIR="/var/log/homelab-agent"
SERVICE_FILE="/etc/systemd/system/homelab-agent.service"
BINARY_NAME="homelab-agent"
AGENT_VERSION="${AGENT_VERSION:-1.0.0}"
AGENT_DOWNLOAD_BASE_URL="${AGENT_DOWNLOAD_BASE_URL:-https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v${AGENT_VERSION}}"

# Detect architecture
ARCH=$(uname -m)
case $ARCH in
    x86_64)
        ARCH="amd64"
        ;;
    aarch64|arm64)
        ARCH="arm64"
        ;;
    armv7l)
        ARCH="arm"
        ;;
    *)
        echo -e "${RED}Unsupported architecture: $ARCH${NC}"
        exit 1
        ;;
esac

OS=$(uname -s | tr '[:upper:]' '[:lower:]')

echo -e "${BLUE}Detected: ${OS}/${ARCH}${NC}"

# Prompt for server URL and token
read -p "Enter server URL (e.g., ws://192.168.1.100:3001/agent): " SERVER_URL
read -p "Enter agent token: " AGENT_TOKEN
read -p "Enter agent name (default: $(hostname)): " AGENT_NAME
AGENT_NAME=${AGENT_NAME:-$(hostname)}

# Create directories
echo -e "${GREEN}Creating directories...${NC}"
mkdir -p "$INSTALL_DIR"
mkdir -p "$CONFIG_DIR"
mkdir -p "$LOG_DIR"

# Download binary (or copy if running locally)
echo -e "${GREEN}Installing agent binary...${NC}"
BINARY_PATH="dist/${BINARY_NAME}-${OS}-${ARCH}"

if [ -f "$BINARY_PATH" ]; then
    cp "$BINARY_PATH" "$INSTALL_DIR/$BINARY_NAME"
elif [ -n "$AGENT_DOWNLOAD_BASE_URL" ]; then
  DOWNLOAD_URL="${AGENT_DOWNLOAD_BASE_URL}/${BINARY_NAME}-${OS}-${ARCH}"
  echo -e "${GREEN}Downloading binary from ${DOWNLOAD_URL}${NC}"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$DOWNLOAD_URL" -o "$INSTALL_DIR/$BINARY_NAME"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$INSTALL_DIR/$BINARY_NAME" "$DOWNLOAD_URL"
  else
    echo -e "${RED}Neither curl nor wget is installed.${NC}"
    exit 1
  fi
else
  echo -e "${YELLOW}Binary not found locally.${NC}"
  echo "Either run from agent source directory with dist/ present"
  echo "or override AGENT_DOWNLOAD_BASE_URL manually, e.g.:"
  echo "  export AGENT_DOWNLOAD_BASE_URL=https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v${AGENT_VERSION}"
    exit 1
fi

chmod +x "$INSTALL_DIR/$BINARY_NAME"

# Create configuration file
echo -e "${GREEN}Creating configuration...${NC}"
cat > "$CONFIG_DIR/config.yaml" << EOF
# Homelab Agent Configuration

server:
  url: "$SERVER_URL"
  token: "$AGENT_TOKEN"
  reconnect_delay: 5s
  max_reconnect_attempts: 0

agent:
  id: ""
  name: "$AGENT_NAME"
  tags:
    - "$(lsb_release -si 2>/dev/null || echo 'linux')"
    - "production"
  environment: "production"

metrics:
  interval: 30s
  collectors:
    cpu: true
    memory: true
    disk: true
    network: true
    connections: true
    processes: true
    docker: true
    system_info: true

execution:
  enabled: true
  timeout: 300s
  whitelist: []
  blacklist: ["rm -rf /", "mkfs", "dd"]
  max_output_size: 1048576

file_monitoring:
  enabled: false
  watch_paths: []
  exclude_patterns: []

logging:
  level: "info"
  file: "$LOG_DIR/agent.log"
  max_size: 10
  max_backups: 3

security:
  tls_verify: true
  ca_cert: ""
  client_cert: ""
  client_key: ""

updates:
  auto_update: false
  check_interval: 24h
  channel: "stable"

queue:
  dir: "/var/lib/homelab-agent/queue"
  max_size_mb: 50
EOF

# Create systemd service
echo -e "${GREEN}Creating systemd service...${NC}"
cat > "$SERVICE_FILE" << EOF
[Unit]
Description=Homelab Agent - System Monitoring and Management
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BINARY_NAME -config $CONFIG_DIR/config.yaml
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=homelab-agent

# Security settings
NoNewPrivileges=false
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
ReadWritePaths=$LOG_DIR

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
echo -e "${GREEN}Reloading systemd...${NC}"
systemctl daemon-reload

# Enable and start service
echo -e "${GREEN}Enabling and starting service...${NC}"
systemctl enable homelab-agent
systemctl start homelab-agent

# Wait a moment for service to start
sleep 2

# Check status
if systemctl is-active --quiet homelab-agent; then
    echo -e "${GREEN}✓ Installation complete!${NC}"
    echo -e "${BLUE}Agent is running successfully${NC}"
    echo ""
    echo "Configuration: $CONFIG_DIR/config.yaml"
    echo "Logs: $LOG_DIR/agent.log"
    echo ""
    echo "Useful commands:"
    echo "  systemctl status homelab-agent  - Check status"
    echo "  systemctl stop homelab-agent    - Stop agent"
    echo "  systemctl restart homelab-agent - Restart agent"
    echo "  journalctl -u homelab-agent -f  - View logs"
else
    echo -e "${RED}✗ Service failed to start${NC}"
    echo "Check logs with: journalctl -u homelab-agent -n 50"
    exit 1
fi
