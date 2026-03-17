# Agent-Based Architecture for Homelab Manager

A complete agent-based monitoring and management system for your homelab infrastructure. This replaces SSH-based polling with lightweight agents that provide real-time metrics and remote command execution capabilities.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     Central Server                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │   Backend    │  │   Database   │  │  Web UI      │     │
│  │   Node.js    │  │   SQLite     │  │  React       │     │
│  │  + WebSocket │  │              │  │              │     │
│  └──────┬───────┘  └──────────────┘  └──────────────┘     │
│         │                                                    │
└─────────┼────────────────────────────────────────────────────┘
          │ WebSocket (Secure, Token Auth)
          │
    ┌─────┴──────┬──────────┬──────────┐
    │            │          │          │
┌───▼───┐   ┌───▼───┐  ┌───▼───┐  ┌───▼───┐
│Agent 1│   │Agent 2│  │Agent 3│  │Agent N│
│Ubuntu │   │Debian │  │  LXC  │  │ Mint  │
│Server │   │ Pi    │  │   CT  │  │ VM    │
└───────┘   └───────┘  └───────┘  └───────┘
```

## Features

### Agent Capabilities
- **Real-time Metrics**: CPU, memory, disk, network, processes
- **Remote Command Execution**: Secure, whitelisted command execution
- **Auto-reconnect**: Resilient connection handling
- **Cross-platform**: Linux (amd64, arm64, arm), macOS, Windows
- **Lightweight**: Single binary, ~10MB, minimal resource usage
- **Secure**: Token-based auth, TLS support, command filtering

### Central Server
- **WebSocket Hub**: Manages all agent connections
- **Metrics Storage**: Time-series data in SQLite
- **RESTful API**: Full CRUD operations for agents
- **Real-time Dashboard**: Live metrics visualization
- **Command Dispatch**: Send commands to any online agent

### Web UI
- **Agent List**: View all registered agents
- **Live Metrics**: Real-time CPU, memory, disk, network
- **Command Execution**: Remote shell commands
- **Status Monitoring**: Online/offline status tracking
- **Tag Management**: Organize agents by tags

## Quick Start

### 1. Build the Agent

```bash
cd Agent_components/agent

# Install Go dependencies
go mod download

# Build for all platforms
chmod +x build.sh
./build.sh

# Binaries will be in dist/
```

### 2. Install Agent on Remote Server

```bash
# Copy installer to remote server
scp -r Agent_components/agent root@remote-server:/tmp/

# SSH to server and run installer
ssh root@remote-server
cd /tmp/agent
chmod +x install.sh
sudo ./install.sh
```

During installation:
- Enter your server WebSocket URL: `ws://your-server:3001/agent`
- Enter agent token (generate secure token first)
- Enter agent name (or use hostname)

### 3. Setup Backend

```bash
# Copy backend files to your backend directory
cp Agent_components/backend/agent-database.ts backend/src/services/
cp Agent_components/backend/routes-agents.ts backend/src/routes/

# Add to your Express app in server.ts:
import agentRoutes, { setupAgentWebSocket } from './routes/routes-agents.js';

// After creating HTTP server:
const agentWss = setupAgentWebSocket(server);

// Add routes:
app.use('/api/agents', agentRoutes);

# Rebuild backend
cd backend
npm run build
systemctl restart ssh-rdp-manager
```

### 4. Add UI Component

```bash
# Copy frontend component
cp Agent_components/frontend/Agents.tsx src/components/pages/

# Add route to your router (in MainLayout.tsx or similar):
import { Agents } from '@/components/pages/Agents';

// In route switch:
case 'agents':
  return <Agents />;

# Add to sidebar navigation
{ id: 'agents', label: 'Agents', icon: Server }

# Rebuild frontend
npm run build
```

## Configuration

### Agent Configuration

Location: `/etc/homelab-agent/config.yaml`

**Key Settings:**

```yaml
server:
  url: "ws://your-server:3001/agent"
  token: "your-secure-token-here"
  reconnect_delay: 5s

agent:
  name: "my-server"
  tags: ["production", "ubuntu", "webserver"]
  environment: "production"

metrics:
  interval: 30s  # Metric collection frequency

execution:
  enabled: true
  whitelist: []  # Empty = all allowed
  blacklist: ["rm -rf /", "mkfs", "dd"]
```

### Backend Environment Variables

Add to your `.env`:

```bash
# Agent authentication tokens (comma-separated)
AGENT_TOKENS=token1,token2,token3

# Agent database path
AGENT_DB_PATH=./data/agents.db

# Metrics retention (days)
AGENT_METRICS_RETENTION=30
```

## Security

### Token Generation

Generate secure tokens for agents:

```bash
# Linux/macOS
openssl rand -hex 32

# Or use this script
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Best Practices

1. **Unique Tokens**: Generate unique token per agent
2. **TLS in Production**: Use `wss://` instead of `ws://`
3. **Command Whitelist**: Restrict allowed commands
4. **Network Security**: Don't expose WebSocket port publicly
5. **Regular Updates**: Keep agent binaries updated
6. **Monitor Logs**: Watch for suspicious activity

## Management

### Agent Service

```bash
# Start/Stop/Restart
sudo systemctl start homelab-agent
sudo systemctl stop homelab-agent
sudo systemctl restart homelab-agent

# View status
sudo systemctl status homelab-agent

# View logs
sudo journalctl -u homelab-agent -f

# Enable on boot
sudo systemctl enable homelab-agent
```

### Server Management

```bash
# View active agents via API
curl http://localhost:3001/api/agents

# Get agent metrics
curl http://localhost:3001/api/agents/{agent-id}/metrics/latest

# Execute command
curl -X POST http://localhost:3001/api/agents/{agent-id}/execute \
  -H "Content-Type: application/json" \
  -d '{"command": "uptime", "args": []}'
```

## API Endpoints

### Agent Management

- `GET /api/agents` - List all agents
- `GET /api/agents/:id` - Get agent details
- `GET /api/agents/:id/status` - Check connection status
- `DELETE /api/agents/:id` - Delete agent
- `PUT /api/agents/:id/config` - Update configuration

### Metrics

- `GET /api/agents/:id/metrics` - Get historical metrics
- `GET /api/agents/:id/metrics/latest` - Get latest metrics

### Command Execution

- `POST /api/agents/:id/execute` - Execute command

## Monitoring

### Metrics Collected

**CPU:**
- Usage percentage (overall and per-core)
- Load average (1, 5, 15 min)

**Memory:**
- Total, used, free, available
- Swap usage
- Cache usage

**Disk:**
- Per-partition usage
- Total/used/free space
- Usage percentage

**Network:**
- Bytes/packets sent/received
- Error and drop counts
- Transfer rates

**Processes:**
- Total count
- Running/zombie counts
- Top processes by CPU/memory

**System Info:**
- OS, platform, kernel version
- Hostname, architecture
- Uptime

## Troubleshooting

### Agent Won't Connect

```bash
# Check config
cat /etc/homelab-agent/config.yaml

# Check logs
journalctl -u homelab-agent -n 50

# Test connectivity
nc -zv your-server 3001

# Verify token
grep token /etc/homelab-agent/config.yaml
```

### High Resource Usage

**Increase metrics interval:**
```yaml
metrics:
  interval: 60s  # Instead of 30s
```

**Disable collectors:**
```yaml
metrics:
  collectors:
    processes: false  # Disable expensive collectors
    docker: false
```

### Commands Not Working

1. Check execution is enabled in config
2. Verify command is not blacklisted
3. Check agent logs for errors
4. Ensure agent has permissions

## Comparison: SSH vs Agent

| Feature | SSH-based | Agent-based |
|---------|-----------|-------------|
| **Connection** | Opens new SSH connection per request | Single persistent WebSocket |
| **Latency** | High (connection overhead) | Low (instant) |
| **Real-time** | No (polling only) | Yes (push-based) |
| **Server Load** | High (many SSH processes) | Low (single connection) |
| **Authentication** | SSH keys/passwords | Secure tokens |
| **Data Format** | Command output parsing | Structured JSON |
| **Reliability** | Fails if SSH down | Auto-reconnects |
| **Resource Usage** | High | Minimal |
| **Setup Complexity** | Medium | Simple (one command) |

## Roadmap

- [ ] Docker container metrics
- [ ] File change monitoring
- [ ] Log streaming
- [ ] Auto-updates
- [ ] Plugin system
- [ ] Alert thresholds
- [ ] Metrics aggregation
- [ ] Multi-server clustering
- [ ] Historical charts
- [ ] Agent groups

## Directory Structure

```
Agent_components/
├── agent/                 # Go agent source
│   ├── main.go
│   ├── config.go
│   ├── metrics.go
│   ├── executor.go
│   ├── websocket.go
│   ├── logger.go
│   ├── config.yaml        # Default config
│   ├── build.sh           # Build script
│   ├── install.sh         # Installation script
│   └── README.md
├── backend/               # Backend API
│   ├── agent-database.ts  # Database service
│   └── routes-agents.ts   # API routes
├── frontend/              # React UI
│   └── Agents.tsx         # Agent management page
└── docs/
    └── ARCHITECTURE.md    # This file
```

## License

MIT License

## Support

For issues, questions, or contributions:
- GitHub Issues
- Documentation
- Community Forums
