# SSH & RDP Manager for Homelab

A comprehensive web-based management solution for SSH/RDP connections, Docker containers, and network diagnostics. Designed for Ubuntu VM/LXC deployment on Proxmox.

![Dashboard Preview](https://via.placeholder.com/800x400?text=SSH+%26+RDP+Manager+Dashboard)

## 🌟 Features

### Connection Management
- **SSH & RDP Connections**: Manage multiple server connections
- **Web-based Terminal**: Built-in SSH terminal in browser
- **Connection Testing**: Quick connectivity checks
- **System Information**: Real-time server stats (CPU, RAM, disk, uptime)
- **Port Forwarding**: SSH tunnel management

### Docker Integration
- **Container Management**: Start, stop, restart, remove containers
- **Real-time Monitoring**: CPU, memory, network I/O stats
- **Container Logs**: View and tail container logs
- **Image Management**: Pull, list, and manage Docker images
- **Quick Actions**: Bulk operations across containers

### Network Diagnostics
Based on Windows Network Diagnostic tools, adapted for Linux:

- **Ping**: ICMP echo requests with packet loss stats
- **Traceroute**: Network path tracing
- **Port Scanner**: Test single or multiple ports
- **DNS Lookup**: Forward and reverse DNS queries
- **WHOIS**: Domain and IP information
- **Network Interfaces**: View active interfaces and IPs
- **Active Connections**: Monitor open sockets
- **Routing Table**: View system routes

### Security & Auditing
- **Security Scans**: Automated vulnerability checks
- **Audit Logs**: Complete activity history
- **Connection Tracking**: Monitor all access attempts
- **Security Score**: Overall security posture

### Automation
- **Script Library**: Store and execute bash/PowerShell/Python scripts
- **Scheduled Execution**: Cron-based script scheduling
- **Bulk Operations**: Run scripts across multiple servers
- **Execution History**: Track script runs and outputs

### Personal Dashboard API (Planner)
- **Dashboard Summary**: Unified overview for today, tasks, events, alerts, and server status
- **Task Management**: CRUD for to-dos with priority, deadline, status, and links
- **Calendar Events**: CRUD for events with checklist, attachments, and linked entities
- **Notes**: CRUD for markdown-ready notes with tags/folder organization
- **Quick Links**: Manage homelab/service shortcuts (Proxmox, Nextcloud, Jellyfin, etc.)
- **Global Search & Quick Add**: Search tasks/events/notes/servers and create items quickly

## 🚀 Quick Start

### Prerequisites
- Ubuntu 22.04 or 24.04 LTS
- 2GB RAM minimum
- 10GB disk space
- Root or sudo access

### Automated Installation

```bash
cd /opt
git clone <your-repo> ssh-rdp-manager
cd ssh-rdp-manager
sudo chmod +x deployment/install.sh
sudo ./deployment/install.sh
```

The installation script will:
- Install Node.js 20.x
- Install system dependencies
- Configure nginx reverse proxy
- Create systemd service
- Build and deploy the application

### Manual Installation

See [deployment/INSTALLATION.md](deployment/INSTALLATION.md) for detailed manual installation instructions.

### Docker Deployment

```bash
cd ssh-rdp-manager
cp deployment/.env.example backend/.env
# Edit backend/.env with your settings
docker-compose -f deployment/docker-compose.yml up -d
```

## 📖 Usage

### Access the Application

After installation, access the web interface:
```
http://your-server-ip
```

### Add SSH Connection

1. Navigate to **Connections**
2. Click **Add Connection**
3. Fill in server details:
   - Name: `Production Web Server`
   - Host: `192.168.1.100`
   - Port: `22`
   - Username: `admin`
   - Auth Type: Key or Password
4. Click **Save**
5. Click **Test** to verify connection

### Run Network Diagnostics

1. Navigate to **Diagnostics**
2. Select diagnostic tool (Ping, Traceroute, Port Scan, etc.)
3. Enter target host/IP
4. Click **Run**
5. View real-time results

### Manage Docker Containers

1. Navigate to **Docker**
2. View all containers with stats
3. Use action buttons:
   - ▶️ Start
   - ⏸️ Stop
   - 🔄 Restart
   - 📋 View Logs
   - 🗑️ Remove

### Create and Run Scripts

1. Navigate to **Scripts**
2. Click **New Script**
3. Select script type (Bash, PowerShell, Python)
4. Write or paste your script
5. Save and execute on target servers

## 🔧 Configuration

### Backend Configuration

Edit `backend/.env`:

```bash
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=production

# Security - CHANGE THESE!
JWT_SECRET=your-strong-random-secret
SESSION_SECRET=another-strong-secret

# Database
DATABASE_PATH=./data/ssh-manager.db

# SSH
SSH_KEY_PATH=/home/user/.ssh/
MAX_SSH_CONNECTIONS=50

# Docker
DOCKER_SOCKET=/var/run/docker.sock

# CORS
CORS_ORIGIN=http://localhost
```

### Frontend Configuration

Frontend automatically connects to backend API. If backend runs on different host, update `src/config.ts`.

## 🧭 Planner API Endpoints

All endpoints below are under `/api/planner`:

- `GET /dashboard`
- `GET /tasks`, `POST /tasks`, `PATCH /tasks/:id`, `DELETE /tasks/:id`
- `GET /events`, `POST /events`, `PATCH /events/:id`, `DELETE /events/:id`
- `GET /notes`, `POST /notes`, `PATCH /notes/:id`, `DELETE /notes/:id`
- `GET /quick-links`, `POST /quick-links`, `DELETE /quick-links/:id`
- `GET /search?q=...`
- `POST /quick-add` with `type: task | event | note`

## 🏗️ Architecture

```
┌─────────────────────────────────────────┐
│         Frontend (React + Vite)         │
│   - Dashboard                           │
│   - Connection Manager                  │
│   - Docker Manager                      │
│   - Network Diagnostics                 │
│   - Terminal (xterm.js)                 │
└────────────────┬────────────────────────┘
                 │ HTTP/WebSocket
┌────────────────┴────────────────────────┐
│      Backend (Node.js + Express)        │
│   - REST API                            │
│   - WebSocket Server (Terminals)        │
│   - SSH Client (ssh2)                   │
│   - Docker API (dockerode)              │
│   - Network Tools (native)              │
└────────────────┬────────────────────────┘
                 │
      ┌──────────┴──────────┐
      │                     │
┌─────┴─────┐       ┌───────┴───────┐
│  SQLite   │       │   Docker      │
│  Database │       │   Daemon      │
└───────────┘       └───────────────┘
```

## 🔒 Security

### Best Practices

1. **Change default credentials** immediately
2. **Use strong secrets** in `.env` file
3. **Enable SSL/TLS** for production:
   ```bash
   sudo certbot --nginx -d your-domain.com
   ```
4. **Configure firewall**:
   ```bash
   sudo ufw allow 22,80,443/tcp
   sudo ufw enable
   ```
5. **Regular updates**:
   ```bash
   cd /opt/ssh-rdp-manager
   git pull
   sudo systemctl restart ssh-rdp-manager
   ```
6. **Use SSH keys** instead of passwords
7. **Restrict network access** to trusted IPs

### fail2ban Protection

```bash
sudo apt install fail2ban
sudo systemctl enable fail2ban
```

## 📊 Monitoring

### Service Status

```bash
# Check backend
sudo systemctl status ssh-rdp-manager

# View logs
sudo journalctl -u ssh-rdp-manager -f

# Check nginx
sudo systemctl status nginx
```

### Performance Monitoring

```bash
# View processes
htop

# Monitor network
sudo nethogs

# Check disk I/O
sudo iotop
```

## 🛠️ Development

### Setup Development Environment

```bash
# Backend
cd backend
npm install
npm run dev

# Frontend
cd ..
npm install
npm run dev
```

### Project Structure

```
ssh-rdp-manager/
├── backend/
│   ├── src/
│   │   ├── server.ts              # Main server
│   │   ├── routes/                # API routes
│   │   ├── services/              # Business logic
│   │   └── utils/                 # Helpers
│   ├── package.json
│   └── tsconfig.json
├── src/                           # Frontend React app
│   ├── components/
│   ├── pages/
│   └── services/
├── deployment/                    # Deployment files
│   ├── install.sh                # Automated installer
│   ├── nginx.conf                # Nginx configuration
│   ├── docker-compose.yml        # Docker setup
│   └── INSTALLATION.md           # Manual guide
└── README.md
```

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

## 🆘 Troubleshooting

### Backend won't start

```bash
# Check logs
sudo journalctl -u ssh-rdp-manager -n 100 --no-pager

# Test manually
cd /opt/ssh-rdp-manager/backend
npm run dev
```

### Cannot connect to Docker

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Check Docker is running
sudo systemctl status docker
```

### Nginx errors

```bash
# Test configuration
sudo nginx -t

# View error logs
sudo tail -f /var/log/nginx/error.log
```

### Database locked

```bash
# Stop service
sudo systemctl stop ssh-rdp-manager

# Check database
cd /opt/ssh-rdp-manager/backend/data
sqlite3 ssh-manager.db "PRAGMA integrity_check;"

# Restart
sudo systemctl start ssh-rdp-manager
```

## 📧 Support

For issues and questions:
- Open an issue on GitHub
- Check [deployment/INSTALLATION.md](deployment/INSTALLATION.md)
- Review system logs

## 🙏 Credits

Inspired by:
- Windows Network & AD Diagnostic Tools
- Traditional SSH/RDP management solutions
- Modern web-based system administration tools

Built with:
- React + Vite
- Node.js + Express
- TypeScript
- shadcn/ui
- xterm.js
- ssh2
- dockerode
- systeminformation

---

**Made for homelabs and system administrators** 🖥️ 🔧
