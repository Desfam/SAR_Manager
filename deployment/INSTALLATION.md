# SSH & RDP Manager - Deployment on Ubuntu VM/LXC

Complete guide for deploying the SSH & RDP Manager on Ubuntu 22.04/24.04 VM or LXC on Proxmox.

## Prerequisites

- Ubuntu 22.04 or 24.04 LTS
- At least 2GB RAM
- 10GB disk space
- Root or sudo access

## Quick Installation

```bash
# Clone or upload the project
cd /opt
git clone <your-repo> ssh-rdp-manager
cd ssh-rdp-manager

# Run automated setup
chmod +x deployment/install.sh
sudo ./deployment/install.sh
```

## Manual Installation

### 1. Install System Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Node.js 20.x
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install build tools
sudo apt install -y build-essential python3 git curl wget

# Install network diagnostic tools
sudo apt install -y iputils-ping traceroute whois dnsutils nmap net-tools

# Install Docker (optional)
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER

# Install nginx for reverse proxy
sudo apt install -y nginx

# Install PM2 for process management
sudo npm install -g pm2
```

### 2. Setup Backend

```bash
cd backend

# Copy environment file
cp .env.example .env

# Edit .env file with your settings
nano .env

# Install dependencies
npm install

# Build TypeScript
npm run build

# Start with PM2
pm2 start dist/server.js --name ssh-rdp-backend
pm2 save
pm2 startup
```

### 3. Setup Frontend

```bash
cd ../

# Install dependencies
npm install

# Build for production
npm run build

# Frontend will be in dist/ folder
```

### 4. Configure Nginx

```bash
sudo cp deployment/nginx.conf /etc/nginx/sites-available/ssh-rdp-manager
sudo ln -s /etc/nginx/sites-available/ssh-rdp-manager /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### 5. Configure Firewall

```bash
# Allow HTTP/HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Allow SSH (if not already allowed)
sudo ufw allow 22/tcp

# Enable firewall
sudo ufw enable
```

## Systemd Service Setup

Instead of PM2, you can use systemd:

```bash
sudo cp deployment/ssh-rdp-manager.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable ssh-rdp-manager
sudo systemctl start ssh-rdp-manager
sudo systemctl status ssh-rdp-manager
```

## SSL/TLS Configuration

### Using Let's Encrypt (Certbot)

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
sudo certbot renew --dry-run
```

## Post-Installation

### 1. Create Admin User

```bash
cd backend
npm run create-admin
```

### 2. Test Installation

```bash
# Check backend
curl http://localhost:3001/health

# Check frontend
curl http://localhost
```

### 3. Monitor Logs

```bash
# PM2 logs
pm2 logs ssh-rdp-backend

# Systemd logs
sudo journalctl -u ssh-rdp-manager -f

# Nginx logs
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

## Backup and Restore

### Backup

```bash
# Backup database
sudo cp /opt/ssh-rdp-manager/backend/data/ssh-manager.db /backup/

# Backup configuration
sudo cp /opt/ssh-rdp-manager/backend/.env /backup/
```

### Restore

```bash
sudo cp /backup/ssh-manager.db /opt/ssh-rdp-manager/backend/data/
sudo cp /backup/.env /opt/ssh-rdp-manager/backend/
sudo systemctl restart ssh-rdp-manager
```

## Updating

```bash
cd /opt/ssh-rdp-manager
git pull
cd backend
npm install
npm run build
pm2 restart ssh-rdp-backend
# or
sudo systemctl restart ssh-rdp-manager
```

## Troubleshooting

### Backend won't start

```bash
# Check logs
pm2 logs ssh-rdp-backend --lines 100

# Check ports
sudo netstat -tlnp | grep 3001

# Test manually
cd backend
npm run dev
```

### Frontend shows errors

```bash
# Check nginx configuration
sudo nginx -t

# Check nginx is running
sudo systemctl status nginx

# Rebuild frontend
npm run build
```

### Database errors

```bash
# Check database file permissions
ls -l backend/data/ssh-manager.db

# Fix permissions
sudo chown -R $USER:$USER backend/data/
```

### Docker not accessible

```bash
# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Check Docker socket
ls -l /var/run/docker.sock
```

## Security Recommendations

1. **Change default credentials**
2. **Use strong JWT secrets in .env**
3. **Enable SSL/TLS**
4. **Configure firewall properly**
5. **Regular updates**
6. **Restrict SSH access**
7. **Use fail2ban**

```bash
sudo apt install -y fail2ban
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
```

## Performance Tuning

### For Low Memory Systems (< 2GB RAM)

Edit .env:
```
NODE_ENV=production
MAX_SSH_CONNECTIONS=10
```

### For High Load Systems

```bash
# Increase PM2 instances
pm2 start dist/server.js --name ssh-rdp-backend -i 2

# Configure nginx worker processes
sudo nano /etc/nginx/nginx.conf
# Set: worker_processes auto;
```

## Monitoring

### Setup monitoring

```bash
# PM2 monitoring
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7

# System monitoring
sudo apt install -y htop iotop nethogs
```

## Support

For issues, check:
1. Backend logs: `pm2 logs ssh-rdp-backend`
2. Nginx logs: `/var/log/nginx/error.log`
3. System logs: `journalctl -xe`
