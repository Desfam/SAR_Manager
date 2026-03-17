#!/bin/bash

# SSH & RDP Manager - Automated Installation Script for Ubuntu
# Supports Ubuntu 22.04 and 24.04 LTS

set -e

echo "╔════════════════════════════════════════════════════════════╗"
echo "║      SSH & RDP Manager - Installation Script              ║"
echo "║      For Ubuntu 22.04/24.04 VM/LXC on Proxmox             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then 
   echo "Please run as root or with sudo"
   exit 1
fi

# Detect user
INSTALL_USER=${SUDO_USER:-$USER}
INSTALL_DIR="/opt/Server_for_homelab"

echo "Installation directory: $INSTALL_DIR"
echo "Running as user: $INSTALL_USER"
echo ""

# Update system
echo "📦 Updating system packages..."
apt update && apt upgrade -y

# Install Node.js 20.x
echo "📦 Installing Node.js 20.x..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

# Install build tools
echo "📦 Installing build tools..."
apt install -y build-essential python3 git curl wget

# Install network diagnostic tools
echo "📦 Installing network diagnostic tools..."
apt install -y iputils-ping traceroute whois dnsutils nmap net-tools iproute2

# Install Docker
read -p "Install Docker? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "📦 Installing Docker..."
    curl -fsSL https://get.docker.com | sh
    usermod -aG docker $INSTALL_USER
    echo "✓ Docker installed. User $INSTALL_USER added to docker group."
fi

# Install nginx
echo "📦 Installing nginx..."
apt install -y nginx

# Install PM2
echo "📦 Installing PM2..."
npm install -g pm2

# Create installation directory
echo "📁 Creating installation directory..."
mkdir -p $INSTALL_DIR
cd $INSTALL_DIR

# Check if we're in a git repo or need to initialize
if [ ! -d "$INSTALL_DIR/backend" ]; then
    echo "⚠️  Backend directory not found."
    echo "Please copy your project files to $INSTALL_DIR and run this script again."
    echo "Or run: git clone <your-repo> $INSTALL_DIR"
    exit 1
fi

# Setup backend
echo "🔧 Setting up backend..."
cd $INSTALL_DIR/backend

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    echo "📝 Creating .env file..."
    cat > .env << EOF
# Server Configuration
PORT=3001
NODE_ENV=production
HOST=0.0.0.0

# Security - CHANGE THESE!
JWT_SECRET=$(openssl rand -base64 32)
SESSION_SECRET=$(openssl rand -base64 32)

# Database
DATABASE_PATH=./data/ssh-manager.db

# SSH Configuration
SSH_KEY_PATH=/home/$INSTALL_USER/.ssh/
MAX_SSH_CONNECTIONS=50

# Docker Configuration
DOCKER_SOCKET=/var/run/docker.sock

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100

# CORS
CORS_ORIGIN=http://localhost

# Logging
LOG_LEVEL=info
LOG_DIR=./logs
EOF
    echo "✓ Created .env file with random secrets"
fi

# Install backend dependencies
echo "📦 Installing backend dependencies..."
npm install

# Build backend
echo "🔨 Building backend..."
npm run build

# Create data directory
mkdir -p data logs
chown -R $INSTALL_USER:$INSTALL_USER $INSTALL_DIR/backend

# Setup frontend
echo "🔧 Setting up frontend..."
cd $INSTALL_DIR

# Install frontend dependencies
echo "📦 Installing frontend dependencies..."
npm install

# Build frontend
echo "🔨 Building frontend..."
npm run build

# Configure nginx
echo "🔧 Configuring nginx..."
cat > /etc/nginx/sites-available/ssh-rdp-manager << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Frontend
    location / {
        root /opt/Server_for_homelab/dist;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket for terminals
    location /terminal {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }

    # Health check
    location /health {
        proxy_pass http://localhost:3001/health;
    }
}
EOF

# Enable site
ln -sf /etc/nginx/sites-available/ssh-rdp-manager /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

# Create systemd service
echo "🔧 Creating systemd service..."
cat > /etc/systemd/system/ssh-rdp-manager.service << EOF
[Unit]
Description=SSH & RDP Manager Backend
After=network.target

[Service]
Type=simple
User=$INSTALL_USER
WorkingDirectory=$INSTALL_DIR/backend
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/server.js
Restart=always
RestartSec=10
StandardOutput=syslog
StandardError=syslog
SyslogIdentifier=ssh-rdp-manager

[Install]
WantedBy=multi-user.target
EOF

# Reload systemd
systemctl daemon-reload

# Enable and start service
echo "🚀 Starting services..."
systemctl enable ssh-rdp-manager
systemctl start ssh-rdp-manager

# Reload nginx
systemctl reload nginx

# Configure firewall
read -p "Configure firewall (UFW)? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "🔒 Configuring firewall..."
    ufw allow 22/tcp comment 'SSH'
    ufw allow 80/tcp comment 'HTTP'
    ufw allow 443/tcp comment 'HTTPS'
    ufw --force enable
    echo "✓ Firewall configured"
fi

# Get IP address
IP_ADDR=$(hostname -I | awk '{print $1}')

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║              Installation Complete! 🎉                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "✓ Backend running on: http://localhost:3001"
echo "✓ Frontend available at: http://$IP_ADDR"
echo ""
echo "📋 Next steps:"
echo "  1. Access the application: http://$IP_ADDR"
echo "  2. Configure SSL with certbot (optional)"
echo "  3. Change secrets in: $INSTALL_DIR/backend/.env"
echo ""
echo "📊 Service management:"
echo "  • Status:  sudo systemctl status ssh-rdp-manager"
echo "  • Stop:    sudo systemctl stop ssh-rdp-manager"
echo "  • Restart: sudo systemctl restart ssh-rdp-manager"
echo "  • Logs:    sudo journalctl -u ssh-rdp-manager -f"
echo ""
echo "🔧 Nginx:"
echo "  • Status:  sudo systemctl status nginx"
echo "  • Logs:    sudo tail -f /var/log/nginx/error.log"
echo ""
echo "📝 Configuration file: $INSTALL_DIR/backend/.env"
echo ""
echo "For SSL setup, run:"
echo "  sudo apt install certbot python3-certbot-nginx"
echo "  sudo certbot --nginx -d your-domain.com"
echo ""
