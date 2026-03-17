#!/bin/bash

# Build and deploy script for SSH/RDP manager with xterm.js terminal support

set -e

echo "🔨 Building frontend with xterm.js support..."
cd /opt/Server_for_homelab
npm run build

echo "📦 Setting permissions..."
chmod -R 755 /opt/Server_for_homelab/dist
chown -R www-data:www-data /opt/Server_for_homelab/dist

echo "🔄 Restarting services..."
systemctl restart ssh-rdp-manager.service
systemctl reload nginx

echo "✅ Build and deployment complete!"
echo ""
echo "Application is available at: http://192.168.178.111"
echo ""
echo "Testing terminal:"
echo "1. Navigate to Terminal tab"
echo "2. Select a connection from Quick Connect"
echo "3. Click 'New Terminal'"
echo "4. You should see a functional xterm.js terminal"
