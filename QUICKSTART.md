# 🚀 QUICK START GUIDE

## What You Have

A complete SSH & RDP Manager web application with:
- **Frontend**: React + TypeScript (already exists in `src/`)
- **Backend**: Node.js + Express + TypeScript (newly created in `backend/`)
- **Deployment**: Automated scripts for Ubuntu VM/LXC

## Deploy to Ubuntu on Proxmox (3 Steps!)

### Step 1: Copy Files to Your Server

From your Windows machine (where the files are):

```powershell
# Using WSL path
cd \\wsl.localhost\Ubuntu\home\ckoellner\

# Copy to your Ubuntu VM/LXC
scp -r Server_for_homelab root@192.168.x.x:/opt/
```

Or use WinSCP, FileZilla, or any SFTP client to copy the folder to `/opt/` on your Ubuntu server.

### Step 2: Run Installation Script

SSH into your Ubuntu VM:

```bash
ssh root@192.168.x.x
cd /opt/Server_for_homelab
chmod +x deployment/install.sh
./deployment/install.sh
```

The script will:
- ✅ Install Node.js 20.x
- ✅ Install network tools (ping, traceroute, nmap, etc.)
- ✅ Install Docker (optional)
- ✅ Set up nginx reverse proxy
- ✅ Create systemd service
- ✅ Build frontend and backend
- ✅ Start the application

**Duration**: ~5-10 minutes

### Step 3: Access Your Application

Open browser: `http://YOUR-SERVER-IP`

Example: `http://192.168.1.100`

## First Time Setup

1. **Add Your First SSH Connection**
   - Click "Connections" in sidebar
   - Click "Add Connection"
   - Enter details:
     ```
     Name: My Ubuntu Server
     Host: 192.168.1.50
     Port: 22
     Username: admin
     Auth: SSH Key or Password
     ```
   - Click "Save" then "Test"

2. **Try Network Diagnostics**
   - Click "Diagnostics"
   - Select "Ping"
   - Enter: `google.com`
   - Click "Run"

3. **Check Docker** (if installed)
   - Click "Docker"
   - View running containers
   - Monitor resources

## Management Commands

```bash
# Check service status
sudo systemctl status ssh-rdp-manager

# View logs
sudo journalctl -u ssh-rdp-manager -f

# Restart service
sudo systemctl restart ssh-rdp-manager

# Stop service
sudo systemctl stop ssh-rdp-manager

# Check backend directly
curl http://localhost:3001/health
```

## Configuration

Edit configuration file:
```bash
sudo nano /opt/Server_for_homelab/backend/.env
```

Important settings:
- `PORT=3001` - Backend port
- `CORS_ORIGIN=http://localhost` - Frontend origin
- `JWT_SECRET=...` - Change this!
- `MAX_SSH_CONNECTIONS=50` - Max concurrent connections

After changes:
```bash
sudo systemctl restart ssh-rdp-manager
```

## Enable SSL (Optional)

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate (replace with your domain)
sudo certbot --nginx -d your-domain.com

# Auto-renewal is configured automatically
```

## Troubleshooting

### Backend not starting?

```bash
# Check logs
sudo journalctl -u ssh-rdp-manager -n 100 --no-pager

# Try running manually to see errors
cd /opt/Server_for_homelab/backend
npm run dev
```

### Can't access web interface?

```bash
# Check nginx
sudo systemctl status nginx
sudo nginx -t

# Check port 80 is open
sudo ufw status
sudo ufw allow 80/tcp
```

### Docker not working?

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Check Docker is running
sudo systemctl status docker
```

## Testing Backend API

```bash
# Health check
curl http://localhost:3001/health

# List connections
curl http://localhost:3001/api/connections

# Docker status
curl http://localhost:3001/api/docker/status

# System info
curl http://localhost:3001/api/system/info
```

## What Each Component Does

### Frontend (Port 80)
- Web interface you see in browser
- Built with React + TypeScript
- Served by nginx

### Backend (Port 3001)
- REST API for all operations
- WebSocket for terminal sessions
- Handles SSH, Docker, diagnostics
- Usually accessed through nginx proxy

### Nginx
- Reverse proxy
- Serves frontend from `/opt/Server_for_homelab/dist`
- Proxies API calls to backend
- Handles WebSocket upgrades

## File Locations

```
/opt/Server_for_homelab/          # Main directory
├── backend/                       # Backend server
│   ├── dist/                     # Compiled JavaScript
│   ├── data/                     # SQLite database
│   ├── logs/                     # Log files
│   └── .env                      # Configuration
├── dist/                         # Frontend build (static files)
└── deployment/                   # Setup scripts

/etc/nginx/sites-available/ssh-rdp-manager   # Nginx config
/etc/systemd/system/ssh-rdp-manager.service  # Service file
/var/log/nginx/                              # Nginx logs
```

## Updating the Application

```bash
cd /opt/Server_for_homelab

# Pull changes (if using git)
git pull

# Rebuild backend
cd backend
npm install
npm run build

# Rebuild frontend
cd ..
npm install
npm run build

# Restart
sudo systemctl restart ssh-rdp-manager
sudo systemctl reload nginx
```

## Backup

```bash
# Backup database
sudo cp /opt/Server_for_homelab/backend/data/ssh-manager.db ~/backup/

# Backup config
sudo cp /opt/Server_for_homelab/backend/.env ~/backup/
```

## Uninstall

```bash
# Stop and disable service
sudo systemctl stop ssh-rdp-manager
sudo systemctl disable ssh-rdp-manager
sudo rm /etc/systemd/system/ssh-rdp-manager.service

# Remove nginx config
sudo rm /etc/nginx/sites-enabled/ssh-rdp-manager
sudo rm /etc/nginx/sites-available/ssh-rdp-manager
sudo systemctl reload nginx

# Remove files
sudo rm -rf /opt/Server_for_homelab

# Reload systemd
sudo systemctl daemon-reload
```

## Need Help?

1. Check logs: `sudo journalctl -u ssh-rdp-manager -f`
2. Read full guide: `deployment/INSTALLATION.md`
3. Check backend docs: `backend/README.md`
4. Review what was built: `BACKEND_COMPLETE.md`

---

**Ready to go!** 🎉

Your SSH & RDP Manager is now running and ready to manage your homelab!
