# Homelab Agent

A lightweight, cross-platform agent for system monitoring and remote management in your homelab environment.

## Features

- **Real-time Metrics Collection**: CPU, Memory, Disk, Network, Processes
- **Remote Command Execution**: Execute commands securely with whitelisting/blacklisting
- **WebSocket Communication**: Efficient real-time data streaming
- **Cross-platform**: Supports Linux (amd64, arm64, arm), macOS, Windows
- **Lightweight**: Single binary, minimal resource usage
- **Secure**: Token-based authentication, TLS support
- **Auto-reconnect**: Resilient connection handling
- **Configurable**: YAML configuration with sensible defaults

## Architecture

```
┌─────────────────┐         WebSocket          ┌──────────────────┐
│  Remote Server  │ ◄────────────────────────► │  Central Server  │
│  ┌───────────┐  │    (Authenticated)         │                  │
│  │   Agent   │  │                            │   Backend API    │
│  └─────┬─────┘  │                            │                  │
│        │        │                            │   ┌──────────┐   │
│    ┌───▼────┐   │                            │   │ Database │   │
│    │Metrics │   │                            │   └──────────┘   │
│    │Collect │   │                            │                  │
│    └────────┘   │                            │   Web Dashboard  │
└─────────────────┘                            └──────────────────┘
```

## Quick Start

### Installation

```bash
# Download and run the installer
curl -fsSL https://raw.githubusercontent.com/Desfam/SAR_Manager/main/Agent_components/agent/install.sh | sudo bash

# Or manually:
sudo bash install.sh
```

Direct binary downloads are available under:

```text
https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/
```

During installation, you'll be prompted for:
- Server URL (e.g., `ws://192.168.1.100:3001/agent`)
- Authentication token
- Agent name (defaults to hostname)

### Building from Source

Requirements:
- Go 1.21 or later

```bash
# Clone repository
cd Agent_components/agent

# Install dependencies
go mod download

# Build for current platform
go build -o homelab-agent .

# Or build for all platforms
chmod +x build.sh
./build.sh
```

## Configuration

Configuration file: `/etc/homelab-agent/config.yaml`

### Basic Configuration

```yaml
server:
  url: "ws://your-server:3001/agent"
  token: "your-secure-token"

agent:
  name: "my-server"
  tags:
    - "production"
    - "ubuntu"
```

### Metrics Collection

```yaml
metrics:
  interval: 30s  # How often to collect metrics
  collectors:
    cpu: true
    memory: true
    disk: true
    network: true
    processes: true
    docker: true
    system_info: true
```

### Command Execution

```yaml
execution:
  enabled: true
  timeout: 300s
  
  # Only allow these commands (empty = all allowed)
  whitelist: []
  
  # Block dangerous commands
  blacklist:
    - "rm -rf /"
    - "mkfs"
    - "dd"
```

### Security

```yaml
security:
  tls_verify: true  # Verify TLS certificates
  ca_cert: "/path/to/ca.crt"  # Custom CA certificate
  client_cert: "/path/to/client.crt"  # mTLS support
  client_key: "/path/to/client.key"
```

## Usage

### Service Management

```bash
# Start agent
sudo systemctl start homelab-agent

# Stop agent
sudo systemctl stop homelab-agent

# Restart agent
sudo systemctl restart homelab-agent

# Check status
sudo systemctl status homelab-agent

# View logs
sudo journalctl -u homelab-agent -f

# Enable on boot
sudo systemctl enable homelab-agent
```

### Manual Execution

```bash
# Run with custom config
./homelab-agent -config /path/to/config.yaml

# Run with verbose logging
./homelab-agent -verbose

# Check version
./homelab-agent -version
```

## Metrics Collected

### CPU
- Overall usage percentage
- Per-core usage
- Load average (1, 5, 15 minutes)

### Memory
- Total, used, free, available
- Cached memory
- Swap usage

### Disk
- Per-partition usage
- Read/write statistics
- I/O performance

### Network
- Bytes sent/received
- Packet statistics
- Error and drop counts
- Transfer rates

### Processes
- Total count
- Running/zombie processes
- Top processes by CPU/memory
- Per-process details

### System Info
- Hostname, OS, platform
- Kernel version
- Architecture
- Uptime

## Remote Commands

The agent can execute commands remotely with full output capture:

### Message Format

```json
{
  "type": "execute_command",
  "payload": {
    "id": "cmd-123",
    "command": "systemctl",
    "args": ["status", "nginx"],
    "timeout": 30
  }
}
```

### Response Format

```json
{
  "id": "cmd-123",
  "success": true,
  "output": "● nginx.service - A high performance web server\n...",
  "error": "",
  "exit_code": 0,
  "duration": 145
}
```

## Security Considerations

1. **Authentication**: Always use strong, unique tokens for each agent
2. **TLS**: Enable TLS verification in production
3. **Command Whitelisting**: Restrict allowed commands for security
4. **Network**: Ensure WebSocket endpoint is not publicly exposed
5. **Updates**: Keep agent software up to date
6. **Logging**: Monitor agent logs for suspicious activity

## Troubleshooting

### Agent won't connect

```bash
# Check configuration
cat /etc/homelab-agent/config.yaml

# Check logs
journalctl -u homelab-agent -n 50

# Test connectivity
curl -v http://your-server:3001/health

# Verify token
echo "Token: $(grep token /etc/homelab-agent/config.yaml)"
```

### High resource usage

```bash
# Check metrics interval
grep interval /etc/homelab-agent/config.yaml

# Disable unused collectors
# Edit config.yaml and set collectors to false

# Restart agent
sudo systemctl restart homelab-agent
```

### Commands failing

```bash
# Check execution settings
grep -A 10 "execution:" /etc/homelab-agent/config.yaml

# Verify command is not blacklisted
# Check whitelist/blacklist in config

# Check logs for error details
journalctl -u homelab-agent | grep -i error
```

## Developer Guide

### Project Structure

```
agent/
├── main.go          # Entry point
├── config.go        # Configuration handling
├── logger.go        # Logging system
├── metrics.go       # Metrics collection
├── executor.go      # Command execution
├── websocket.go     # WebSocket client
├── build.sh         # Build script
├── install.sh       # Installation script
└── config.yaml      # Default configuration
```

### Adding New Metrics

1. Add metric type to `SystemMetrics` struct in `metrics.go`
2. Implement collector function
3. Call from `Collect()` method
4. Update configuration schema

### Testing

```bash
# Run agent in verbose mode
./homelab-agent -config config.yaml -verbose

# Test specific functionality
go test ./...
```

## Roadmap

- [ ] Docker metrics collection
- [ ] File monitoring and change detection
- [ ] Auto-update functionality
- [ ] Plugin system for custom collectors
- [ ] Encrypted configuration
- [ ] Web UI for agent configuration

## License

MIT License - see LICENSE file for details

## Support

- GitHub Issues: https://github.com/your-org/homelab-agent/issues
- Documentation: https://docs.your-domain.com/agent
