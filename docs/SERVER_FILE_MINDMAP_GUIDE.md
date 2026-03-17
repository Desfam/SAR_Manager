# Server File Mind-Map Guide (Backend, Agent, Deployment)

This document explains every server-side file in this workspace, how files connect, what each one uses, what uses it, which external systems it depends on, and why those dependencies are required.

Scope included:
- `backend/` runtime server
- `deployment/` ops/runtime deployment files
- `Agent_components/agent/` Go agent runtime
- `Agent_components/backend/` legacy integration copy
- root-level server/deployment helper docs/scripts

Scope excluded:
- frontend UI files under `src/` (except where referenced by deployment docs)
- generated binaries or build artifacts (`dist/`, compiled outputs)
- package lockfiles (implementation-independent dependency snapshots)

---

## 1) High-Level Runtime Graph

### 1.1 Request/Data Flow
1. Browser hits nginx (`deployment/nginx.conf`).
2. nginx serves frontend static files and reverse-proxies API/WS traffic to backend (`backend/src/server.ts`).
3. Backend routes requests to route modules (`backend/src/routes/*.ts`).
4. Routes call services (`backend/src/services/*.ts`).
5. Services talk to external systems:
   - SQLite (`backend/src/services/database.ts`, `backend/src/services/agent-database.ts`)
   - SSH hosts (`backend/src/services/ssh.ts`)
   - Docker daemon (`backend/src/services/docker.ts`)
   - OS network tools (`backend/src/services/diagnostics.ts`)
   - WebSocket terminal and agent sessions (`backend/src/services/websocket.ts`, `backend/src/routes/agents.ts`)

### 1.2 Agent Flow
1. Go agent starts from systemd (`Agent_components/agent/install.sh` creates `homelab-agent.service`).
2. Agent loads YAML config (`Agent_components/agent/config.go`, `config.yaml`).
3. Agent collects metrics/logs/services (`metrics.go`, `services.go`).
4. Agent opens WS connection to backend `/agent` (`websocket.go` -> `backend/src/routes/agents.ts`).
5. Backend persists agent metadata/metrics/services/logs in `data/agents.db` via `backend/src/services/agent-database.ts`.

### 1.3 Database Topology
- Main DB: `backend/data/ssh-manager.db` (connections, scripts, audits, security scans, vulnerabilities, metrics history, alerts, users, port forwards).
- Agent DB: `backend/data/agents.db` (agents, agent metrics, services, logs, command history).

---

## 2) Backend Runtime Files (`backend/`)

## 2.1 Entry, Config, Packaging

### `backend/src/server.ts`
- Purpose: Main backend bootstrap (Express app, middleware, REST route mount, WS upgrade routing, metrics scheduler, graceful shutdown).
- Used by: Node runtime (`node dist/server.js`), systemd service, Docker container.
- Uses:
  - Routes: `connections.ts`, `docker.ts`, `diagnostics.ts`, `security.ts`, `scripts.ts`, `system.ts`, `ssh-keys.ts`, `ssh-key-deploy.ts`, `files.ts`, `agents.ts`, `auth.ts`, `port-forwards.ts`
  - Services: `database.ts`, `agent-database.ts`, `websocket.ts`, `ssh.ts`
  - Middleware: `middleware/auth.ts`
  - Node/Express libs and WS server (`ws`)
- External connections:
  - HTTP API listener (default `:3001`)
  - WebSocket endpoints: `/terminal` and `/agent`
  - SQLite files via services
  - SSH targets during scheduled metrics collection
- Why connections exist:
  - Central orchestration point to guarantee a single lifecycle for REST + WS + DB initialization.

### `backend/package.json`
- Purpose: Backend dependency and script manifest.
- Used by: npm (`npm install`, `npm run build`, `npm run dev`, `npm start`).
- Uses: declares runtime packages (`express`, `ssh2`, `dockerode`, `better-sqlite3`, `ws`, etc.).
- External connections: package registries during install.
- Why needed: reproducible runtime and build toolchain.

### `backend/tsconfig.json`
- Purpose: TypeScript compiler settings (`src` -> `dist`, strict mode).
- Used by: `tsc`, editor tooling, CI builds.
- Why needed: stable typed compilation contract.

### `backend/Dockerfile`
- Purpose: Multi-stage container build for backend.
- Used by: Docker/Compose.
- Uses: Node 20 Alpine, build deps, runtime deps (ssh client, network tools), health check `/health`.
- External connections: Docker daemon.
- Why needed: immutable runtime deployment artifact.

### `backend/.env.example`
- Purpose: safe template of runtime configuration variables.
- Used by: operators to create `.env`.
- Why needed: documents required env contract without real secrets.

### `backend/.env`
- Purpose: local runtime environment values.
- Used by: backend runtime in production/dev.
- External connections controlled by it: DB path, CORS origin, auth enablement, JWT secret, Docker socket path.
- Why needed: environment-specific behavior and secrets separation from code.

### `backend/README.md`
- Purpose: backend/solution operational docs.
- Used by: operators/developers.
- Why needed: explains deployment and feature behavior.

## 2.2 Middleware and Types

### `backend/src/middleware/auth.ts`
- Purpose: optional JWT auth gate and token signing.
- Used by: `server.ts`, `routes/auth.ts`.
- Uses: `jsonwebtoken`, env (`ENABLE_AUTH`, `JWT_SECRET`).
- External connections: none.
- Why needed: centralized auth policy so all protected routes share one implementation.

### `backend/src/types/ping.d.ts`
- Purpose: ambient TypeScript type declaration for the `ping` package.
- Used by: `services/diagnostics.ts` compile-time typing.
- Why needed: type-safe diagnostics service without custom wrappers.

## 2.3 Core Services

### `backend/src/services/database.ts`
- Purpose: main SQLite schema initialization and CRUD access layer.
- Used by: many routes (`connections`, `scripts`, `system`, `auth`, `port-forwards`, `security`, etc.) and scheduler in `server.ts`.
- Defines/uses tables:
  - `connections`, `scripts`, `script_executions`, `audit_logs`, `port_forwards`, `security_scans`, `vulnerabilities`, `metrics_history`, `alerts`, `alert_thresholds`, `users`
- External connections: local SQLite file, filesystem mkdir for DB directory.
- Why needed: single source of truth and consistent DB access API across modules.

### `backend/src/services/agent-database.ts`
- Purpose: separate SQLite schema/service for agent subsystem.
- Used by: `routes/agents.ts`, startup in `server.ts`.
- Defines/uses tables: `agents`, `agent_metrics`, `agent_commands`, `agent_services`, `agent_logs`.
- External connections: local SQLite file (`agents.db`).
- Why needed: isolates high-frequency agent telemetry from core management DB.

### `backend/src/services/ssh.ts`
- Purpose: SSH operations and remote file management.
- Used by: routes `connections.ts`, `files.ts`, `docker.ts`, `security.ts`, and scheduler in `server.ts`.
- Uses:
  - SSH connectivity/test
  - command execution
  - key generation and key deployment helpers
  - SFTP list/read/upload/download/delete/mkdir
  - tunnel creation and scans
- External connections: remote hosts over SSH, local OS commands (`ssh-keygen`, `nmap`, `xfreerdp`, etc.).
- Why needed: core remote-control primitive for non-agent hosts.

### `backend/src/services/websocket.ts`
- Purpose: terminal WebSocket session lifecycle manager.
- Used by: `server.ts` for `/terminal` WSS.
- Uses: `node-pty` for local terminal mode; `ssh2` shell streams for remote mode; `connectionDb` for lookup.
- External connections: browser WS clients, local PTY shell, remote SSH shells.
- Why needed: full-duplex low-latency terminal interaction.

### `backend/src/services/diagnostics.ts`
- Purpose: network diagnostic command wrappers.
- Used by: `routes/diagnostics.ts`.
- Uses external tools/APIs:
  - ping library
  - `traceroute`, `dig`, `whois`, `ip`, `ss`
  - direct TCP socket tests via Node `net`
- Why needed: structured API for diagnostic outputs (instead of ad-hoc shell in routes).

### `backend/src/services/security.ts`
- Purpose: NIS2-style compliance/security checks over SSH.
- Used by: `routes/security.ts`.
- Uses: `SSHService.executeCommand` for remote policy checks.
- External connections: remote host over SSH.
- Why needed: repeatable compliance scoring and remediation metadata.

### `backend/src/services/docker.ts`
- Purpose: local Docker daemon service wrapper.
- Used by: `routes/docker.ts` local Docker endpoints.
- Uses: `dockerode`, Docker socket path from env.
- External connections: Docker daemon (`/var/run/docker.sock`).
- Why needed: typed abstraction over Docker API and easier route handling.

## 2.4 API Route Modules

### `backend/src/routes/auth.ts`
- Purpose: auth status, bootstrap admin, login, current user.
- Used by: mounted as `/api/auth` in `server.ts`.
- Uses: `userDb`, bcrypt hashing, JWT middleware helpers.
- DB: `users` table.
- Why needed: entry point for optional auth lifecycle.

### `backend/src/routes/connections.ts`
- Purpose: largest domain route for connection CRUD + metrics + vulnerabilities + alerts + SSH key workflows.
- Used by: mounted as `/api/connections`.
- Uses:
  - DB accessors from `database.ts`
  - `SSHService` for tests/system metrics/remote commands
  - external CVE API (`services.nvd.nist.gov`) for vulnerability enrichment
- DB tables touched: `connections`, `vulnerabilities`, `metrics_history`, `alerts`, `alert_thresholds`, `audit_logs`, and cleanup of related tables.
- Why needed: central host lifecycle and observability API.

### `backend/src/routes/docker.ts`
- Purpose: Docker management locally and on remote hosts (via SSH).
- Used by: `/api/docker`.
- Uses:
  - `DockerService` (local daemon)
  - `SSHService` + `connectionDb` (remote host docker commands)
- External systems: local docker socket + remote SSH hosts running docker CLI.
- Why needed: unified container operations across local/remote infrastructures.

### `backend/src/routes/diagnostics.ts`
- Purpose: expose diagnostic service endpoints.
- Used by: `/api/diagnostics`.
- Uses: `NetworkDiagnosticsService` only.
- Why needed: thin API layer with validation around diagnostics service.

### `backend/src/routes/files.ts`
- Purpose: remote file explorer operations over SFTP.
- Used by: `/api/files`.
- Uses: `connectionDb`, `SSHService` SFTP methods, `multer` temp uploads.
- External systems: remote SSH file systems, local temp directory.
- Why needed: browser-accessible remote file management.

### `backend/src/routes/scripts.ts`
- Purpose: script library CRUD and remote script execution.
- Used by: `/api/scripts`.
- Uses: `getDatabase`, `connectionDb`, `SSHService`.
- DB tables: `scripts`, `script_executions`, `audit_logs`.
- Why needed: controlled automation and execution history.

### `backend/src/routes/security.ts`
- Purpose: run/retrieve/delete security audits.
- Used by: `/api/security`.
- Uses: `SecurityService`, DB via `connectionDb.getDb()`.
- DB table: `security_scans` (+ reads `connections`).
- Why needed: scheduled/ad-hoc security posture tracking.

### `backend/src/routes/system.ts`
- Purpose: host-local system telemetry and audit-log retrieval.
- Used by: `/api/system`.
- Uses: `systeminformation` package and `auditLogDb`.
- External systems: local machine sensors/kernel interfaces.
- Why needed: health and ops visibility for the backend host itself.

### `backend/src/routes/ssh-keys.ts`
- Purpose: manage local SSH keypairs for manager host.
- Used by: `/api/ssh-keys`.
- Uses: fs + `ssh-keygen`.
- External systems: local filesystem and openssh toolchain.
- Why needed: lifecycle of reusable SSH identities for remote auth.

### `backend/src/routes/ssh-key-deploy.ts`
- Purpose: deploy selected public key to remote host authorized_keys.
- Used by: `/api/ssh-key-deploy`.
- Uses: `ssh2` direct client + `connectionDb` lookup.
- External systems: remote SSH hosts.
- Why needed: simplify key-based auth migration from password auth.

### `backend/src/routes/agents.ts`
- Purpose: agent WebSocket protocol handling + REST API for agent data/control.
- Used by: `/api/agents` and WS `/agent` via `setupAgentWebSocket` in `server.ts`.
- Uses: `agentDb`, `agentMetricsDb`, `agentServicesDb`, `agentLogsDb`.
- External systems: connected Go agents over WebSocket.
- Why needed: scalable push-based monitoring/control channel.

### `backend/src/routes/port-forwards.ts`
- Purpose: CRUD + status toggle for stored port-forward definitions.
- Used by: `/api/port-forwards`.
- Uses: `getDatabase`, `auditLogDb`.
- DB table: `port_forwards`.
- Why needed: persist tunnel definitions for UI/automation even if runtime tunnel process is external.

## 2.5 Empty Utility Folder

### `backend/src/utils/` (empty)
- Purpose: reserved for future shared helpers.
- Why noted: currently no runtime dependency.

---

## 3) Deployment & Operations Files (`deployment/`)

### `deployment/install.sh`
- Purpose: end-to-end host installer (packages, build, nginx, service, firewall).
- Uses: apt, Node setup, nginx, systemd, optional Docker installation.
- Produces/edits:
  - backend `.env`
  - nginx site config
  - systemd service (`ssh-rdp-manager.service`)
- Why needed: fast repeatable provisioning on Ubuntu VM/LXC.

### `deployment/nginx.conf`
- Purpose: reverse proxy and static hosting config.
- Routes:
  - `/` -> frontend static files
  - `/api` -> backend HTTP API
  - `/terminal` and `/agent` -> backend WebSocket upgrades
  - `/health` -> backend health endpoint
- Why needed: single external entry point, WS compatibility, headers, caching.

### `deployment/ssh-rdp-manager.service`
- Purpose: systemd unit for backend process management.
- Uses: `node dist/server.js`, restart policy, hardening options, writable paths for DB/logs.
- Why needed: autostart/restart and OS-native lifecycle control.

### `deployment/docker-compose.yml`
- Purpose: containerized deployment topology.
- Services:
  - `backend` (builds from `backend/Dockerfile`)
  - `frontend` (expects `Dockerfile.frontend`)
- Shared dependencies: docker socket bind, backend data/log volumes, nginx config mount.
- Why needed: single command multi-container deployment model.

### `deployment/INSTALLATION.md`
- Purpose: manual deployment runbook and troubleshooting.
- Why needed: operator knowledge transfer and recovery procedures.

---

## 4) Root-Level Server/Deployment Support Files

### `BACKEND_COMPLETE.md`
- Purpose: completion summary and capability checklist for backend/deployment.
- Why needed: milestone documentation for delivered server features.

### `BUILD_AND_DEPLOY.sh`
- Purpose: convenience script for frontend build and service/nginx restart.
- Uses: npm build, ownership fixes, systemctl restart/reload.
- Why needed: quick post-change rollout path.

### `WEBSOCKET_TERMINAL_SETUP.md`
- Purpose: implementation/deployment notes for xterm.js + terminal WS.
- Why needed: operational and troubleshooting guide for terminal subsystem.

---

## 5) Agent Stack Files (`Agent_components/agent/`)

### `Agent_components/agent/main.go`
- Purpose: Go agent entrypoint and lifecycle coordinator.
- Uses: config loader, logger, metrics collector, command executor, WS client.
- Why needed: orchestrates concurrent agent subsystems and graceful shutdown.

### `Agent_components/agent/config.go`
- Purpose: YAML config schema + loader + defaults + validation + agent ID generation.
- Uses: `config.yaml` structure and token validation.
- Why needed: deterministic runtime configuration and safety checks.

### `Agent_components/agent/logger.go`
- Purpose: simple leveled logger supporting file/stdout.
- Used by: all agent components.
- Why needed: consistent diagnostics and ops visibility.

### `Agent_components/agent/metrics.go`
- Purpose: periodic metrics collection from host.
- Uses: gopsutil (CPU/mem/disk/network/process/host), plus service/log collectors.
- Output consumed by: `websocket.go` metrics sender.
- Why needed: rich telemetry payload for backend storage and dashboards.

### `Agent_components/agent/services.go`
- Purpose: collect systemd service states and recent logs.
- Used by: `metrics.go`.
- External systems: `systemctl`, `tail`, `journalctl`.
- Why needed: operational context beyond raw hardware metrics.

### `Agent_components/agent/executor.go`
- Purpose: controlled command execution with timeout, whitelist, blacklist, output limit.
- Used by: `websocket.go` on `execute_command` messages.
- Why needed: remote remediation/inspection while reducing arbitrary command risk.

### `Agent_components/agent/websocket.go`
- Purpose: WS client transport (connect/register/read loop/metrics send/reconnect).
- Connects to: backend `/agent` endpoint with token and agent id query params.
- Handles message types: `ping`, `execute_command`, `request_metrics`, `config_update`, `registered`.
- Why needed: persistent low-latency bidirectional control channel.

### `Agent_components/agent/config.yaml`
- Purpose: default config template for installed agents.
- Includes: server URL/token, collectors, execution policy, logging, TLS settings, updates.
- Why needed: operator-editable runtime policy file.

### `Agent_components/agent/go.mod`
- Purpose: Go module dependencies (`gorilla/websocket`, `gopsutil`, `yaml`).
- Why needed: reproducible Go builds.

### `Agent_components/agent/build.sh`
- Purpose: cross-platform build matrix script.
- Outputs: binaries in `dist/` for linux/darwin/windows and multiple architectures.
- Why needed: easy release artifact generation.

### `Agent_components/agent/install.sh`
- Purpose: interactive installer for remote hosts.
- Creates:
  - `/opt/homelab-agent/homelab-agent` binary
  - `/etc/homelab-agent/config.yaml`
  - `/etc/systemd/system/homelab-agent.service`
- Why needed: standardized and fast agent rollout.

### `Agent_components/agent/README.md`
- Purpose: agent feature, install, config, troubleshooting docs.
- Why needed: standalone operational documentation for agent-only deployment.

---

## 6) Agent Integration Copy Files (`Agent_components/backend/`)

These are an older integration copy of backend agent modules and largely duplicated in active backend under `backend/src/services/agent-database.ts` and `backend/src/routes/agents.ts`.

### `Agent_components/backend/agent-database.ts`
- Purpose: earlier simplified agent DB service (no services/logs tables).
- Why it exists: migration/bootstrap reference for integrating agent subsystem.

### `Agent_components/backend/routes-agents.ts`
- Purpose: earlier WS + REST routing for agents with `/agents/*` path style.
- Why it exists: integration template/reference; active code is in backend `src/routes/agents.ts`.

---

## 7) Agent Components Top-Level Doc

### `Agent_components/README.md`
- Purpose: implementation summary and integration instructions for agent stack.
- Why needed: quick onboarding for enabling agent subsystem in main backend/frontend.

---

## 8) File-to-File Dependency Map (Mind-Map Friendly)

Use these as graph edges:

- `backend/src/server.ts` -> all route modules
- `backend/src/server.ts` -> `backend/src/services/database.ts`
- `backend/src/server.ts` -> `backend/src/services/agent-database.ts`
- `backend/src/server.ts` -> `backend/src/services/websocket.ts`
- `backend/src/server.ts` -> `backend/src/routes/agents.ts` (WS setup)

- `backend/src/routes/auth.ts` -> `database.ts.userDb`, `middleware/auth.ts`
- `backend/src/routes/connections.ts` -> `database.ts`, `ssh.ts`, NIST NVD API
- `backend/src/routes/docker.ts` -> `services/docker.ts`, `services/ssh.ts`, `database.ts.connectionDb`
- `backend/src/routes/diagnostics.ts` -> `services/diagnostics.ts`
- `backend/src/routes/files.ts` -> `database.ts.connectionDb`, `services/ssh.ts`
- `backend/src/routes/scripts.ts` -> `database.ts`, `services/ssh.ts`
- `backend/src/routes/security.ts` -> `services/security.ts`, `database.ts`
- `backend/src/routes/system.ts` -> `systeminformation`, `database.ts.auditLogDb`
- `backend/src/routes/ssh-keys.ts` -> fs + `ssh-keygen`
- `backend/src/routes/ssh-key-deploy.ts` -> `database.ts.connectionDb`, `ssh2`
- `backend/src/routes/agents.ts` -> `services/agent-database.ts`, `ws`
- `backend/src/routes/port-forwards.ts` -> `database.ts`

- `backend/src/services/security.ts` -> `backend/src/services/ssh.ts`
- `backend/src/services/websocket.ts` -> `backend/src/services/database.ts`

- `Agent_components/agent/main.go` -> `config.go`, `logger.go`, `metrics.go`, `executor.go`, `websocket.go`
- `Agent_components/agent/metrics.go` -> `services.go`
- `Agent_components/agent/websocket.go` -> `executor.go`, `metrics.go`
- Agent WS (`websocket.go`) -> backend WS handler (`backend/src/routes/agents.ts`)

- `deployment/nginx.conf` -> backend API + WS (`server.ts`)
- `deployment/ssh-rdp-manager.service` -> backend runtime (`dist/server.js`)
- `deployment/docker-compose.yml` -> backend container + nginx frontend container

---

## 9) External Systems Matrix

- SQLite (`ssh-manager.db`): core app state, security, scripts, alerts, users.
- SQLite (`agents.db`): agent telemetry/control state.
- SSH endpoints: remote host commands, files, security checks, metrics.
- Docker daemon socket: local docker control and stats.
- OS network tools: diagnostics/troubleshooting endpoints.
- WebSocket clients:
  - Browser terminals (`/terminal`)
  - Go agents (`/agent`)
- NIST NVD API: vulnerability metadata enrichment.
- systemd/nginx: service supervision and ingress routing.

Why each is needed:
- Without SQLite: no durable inventory/history/config state.
- Without SSH: cannot manage non-agent remote Linux hosts.
- Without WS: no real-time terminal and no push telemetry.
- Without nginx/systemd: no production-grade hosting/restarts/proxying.
- Without Docker socket integration: no container lifecycle management.

---

## 10) Important Notes for Your Mind Map

- There are two monitoring paradigms in the codebase:
  1. SSH-pull model (backend executes remote commands).
  2. Agent-push model (agent streams metrics and receives commands).

- Agent integration files under `Agent_components/backend` are mostly reference copies; active production path is under `backend/src/...`.

- Secrets exist in `.env`; treat them as sensitive and rotate if exposed.

- `backend/src/routes/connections.ts` is the densest module and should be split into subdomains over time (CRUD, vulnerability, metrics, alerts).

- The terminal path and agent path are separate WS channels (`/terminal` vs `/agent`) but share the same HTTP server in `server.ts`.
