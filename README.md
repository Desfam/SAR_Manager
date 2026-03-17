# SSH & RDP Manager for Homelab

A comprehensive web-based management solution for SSH/RDP connections, Docker containers, and network diagnostics. Built with React + TypeScript frontend and Node.js backend, designed for Ubuntu VM/LXC deployment on Proxmox.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-20.x-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.x-blue.svg)

## 🚀 Quick Start for Proxmox Ubuntu VM/LXC

```bash
# 1. Copy to your server
scp -r Server_for_homelab root@your-server:/opt/

# 2. Run automated installer
ssh root@your-server
cd /opt/Server_for_homelab
chmod +x deployment/install.sh
./deployment/install.sh

# 3. Access: http://your-server-ip
```

## 📖 Full Documentation

- **[Installation Guide](deployment/INSTALLATION.md)** - Complete setup instructions
- **[Backend Documentation](backend/README.md)** - API reference
- **[What Was Built](BACKEND_COMPLETE.md)** - Feature overview

## Agent Download

Install the hybrid agent directly from GitHub:

```bash
curl -fsSL https://raw.githubusercontent.com/Desfam/SAR_Manager/main/Agent_components/agent/install.sh | sudo bash
```

Direct binary downloads:

- Linux amd64: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-linux-amd64`
- Linux arm64: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-linux-arm64`
- Linux arm: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-linux-arm`
- macOS amd64: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-darwin-amd64`
- macOS arm64: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-darwin-arm64`
- Windows amd64: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/homelab-agent-windows-amd64.exe`
- Checksums: `https://raw.githubusercontent.com/Desfam/SAR_Manager/main/downloads/agent/v1.0.0/SHA256SUMS`

## 🌟 Features

- ✅ SSH & RDP Connection Management
- ✅ Web-based Terminal (xterm.js)
- ✅ Docker Container Management
- ✅ Network Diagnostics (ping, traceroute, port scan, DNS, WHOIS)
- ✅ System Monitoring (CPU, RAM, disk, network)
- ✅ Script Automation
- ✅ Audit Logging
- ✅ Security Scanning

## 🔐 Public Deployment Baseline

Before publishing this server for others, configure backend auth:

1. Copy and edit backend env:
	 - `cp backend/.env.example backend/.env`
	 - set `ENABLE_AUTH=true`
	 - set strong `JWT_SECRET`
2. Bootstrap first admin user:

```bash
curl -X POST http://localhost:3001/api/auth/bootstrap-admin \
	-H "Content-Type: application/json" \
	-d '{"username":"admin","email":"admin@example.com","password":"ChangeMeToAStrongPassword123!"}'
```

3. Login to receive token:

```bash
curl -X POST http://localhost:3001/api/auth/login \
	-H "Content-Type: application/json" \
	-d '{"username":"admin","password":"ChangeMeToAStrongPassword123!"}'
```

See [SECURITY.md](SECURITY.md) for hardening guidance.

## 💻 Development

There are several ways of editing your application.

**Use Lovable**

Simply visit the [Lovable Project](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and start prompting.

Changes made via Lovable will be committed automatically to this repo.

**Use your preferred IDE**

If you want to work locally using your own IDE, you can clone this repo and push changes. Pushed changes will also be reflected in Lovable.

The only requirement is having Node.js & npm installed - [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating)

Follow these steps:

```sh
# Step 1: Clone the repository using the project's Git URL.
git clone <YOUR_GIT_URL>

# Step 2: Navigate to the project directory.
cd <YOUR_PROJECT_NAME>

# Step 3: Install the necessary dependencies.
npm i

# Step 4: Start the development server with auto-reloading and an instant preview.
npm run dev
```

**Edit a file directly in GitHub**

- Navigate to the desired file(s).
- Click the "Edit" button (pencil icon) at the top right of the file view.
- Make your changes and commit the changes.

**Use GitHub Codespaces**

- Navigate to the main page of your repository.
- Click on the "Code" button (green button) near the top right.
- Select the "Codespaces" tab.
- Click on "New codespace" to launch a new Codespace environment.
- Edit files directly within the Codespace and commit and push your changes once you're done.

## What technologies are used for this project?

This project is built with:

- Vite
- TypeScript
- React
- shadcn-ui
- Tailwind CSS

## How can I deploy this project?

Simply open [Lovable](https://lovable.dev/projects/REPLACE_WITH_PROJECT_ID) and click on Share -> Publish.

## Can I connect a custom domain to my Lovable project?

Yes, you can!

To connect a domain, navigate to Project > Settings > Domains and click Connect Domain.

Read more here: [Setting up a custom domain](https://docs.lovable.dev/features/custom-domain#custom-domain)
