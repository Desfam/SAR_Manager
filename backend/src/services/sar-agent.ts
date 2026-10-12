// SAR agent: a small service on each Linux system that pushes metrics, journal events and a state report
// to SAR Manager over WebSocket, so the app no longer has to log in via SSH for monitoring.
// The agent id is "sar-<connection id>", which ties it to the saved system without guessing.
import crypto from 'crypto';
import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectionDb, getDatabase, metricsDb } from './database.js';
import { SSHService } from './ssh.js';
import { agentDb, agentTokensDb } from './agent-database.js';
import { evaluateMetrics } from './alerting.js';
import type { LiveCheck, LiveReport } from './wazuh/live-scan.js';

export const AGENT_VERSION = '1.1.0';
const DOWNLOADS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../downloads/agent', `v${AGENT_VERSION}`);
const EVENT_RETENTION_DAYS = 14;

export const agentIdFor = (connectionId: string) => `sar-${connectionId}`;
export const connectionIdFor = (agentId: string) => (agentId?.startsWith('sar-') ? agentId.slice(4) : null);

/* ---------- storage ---------- */

let ready = false;
function db() {
  const database = getDatabase();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS sar_agent_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        connection_id TEXT NOT NULL,
        time TEXT NOT NULL,
        kind TEXT NOT NULL,
        source TEXT,
        user TEXT,
        ip TEXT,
        method TEXT,
        command TEXT,
        message TEXT,
        priority INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_sar_agent_events ON sar_agent_events(connection_id, time);
      CREATE TABLE IF NOT EXISTS sar_agent_state (
        connection_id TEXT PRIMARY KEY,
        facts TEXT,
        facts_at TEXT,
        readable INTEGER,
        last_metrics_at TEXT
      );
    `);
    ready = true;
  }
  return database;
}

/** Agents currently connected (fed by routes/agents.ts) */
const online = new Set<string>();
export function setAgentOnline(agentId: string, isOnline: boolean) {
  const connectionId = connectionIdFor(agentId);
  if (!connectionId) return;
  if (isOnline) online.add(connectionId);
  else online.delete(connectionId);
}
export const hasOnlineAgent = (connectionId: string) => online.has(connectionId);

export function handleAgentMetrics(payload: any) {
  const connectionId = connectionIdFor(payload?.agent_id);
  const connection: any = connectionId ? connectionDb.getById(connectionId) : null;
  if (!connection) return;
  const disks: any[] = Array.isArray(payload.disk) ? payload.disk : [];
  const root = disks.find((entry) => entry.mountpoint === '/') ?? disks[0];
  const metrics = {
    cpu: Number(payload.cpu?.usage_percent),
    memory: Number(payload.memory?.used_percent),
    disk: Number(root?.used_percent),
    loadAvg1: payload.cpu?.load_avg?.[0] ?? 0,
    loadAvg5: payload.cpu?.load_avg?.[1] ?? 0,
    loadAvg15: payload.cpu?.load_avg?.[2] ?? 0,
    netRxRate: payload.network?.rate_recv,
    netTxRate: payload.network?.rate_sent,
  };
  metricsDb.save(connection.id, metrics);
  evaluateMetrics(connection, metrics);
  db().prepare('INSERT INTO sar_agent_state (connection_id, last_metrics_at) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(connection_id) DO UPDATE SET last_metrics_at = CURRENT_TIMESTAMP').run(connection.id);
}

export function handleAgentEvents(payload: any) {
  const connectionId = connectionIdFor(payload?.agent_id);
  if (!connectionId || !Array.isArray(payload.events)) return;
  const insert = db().prepare('INSERT INTO sar_agent_events (connection_id, time, kind, source, user, ip, method, command, message, priority) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const text = (value: unknown, max: number) => (typeof value === 'string' ? value.slice(0, max) : null);
  db().transaction(() => {
    for (const event of payload.events.slice(0, 5000)) {
      insert.run(connectionId, text(event.time, 40) ?? new Date().toISOString(), text(event.kind, 30) ?? 'error', text(event.source, 80), text(event.user, 120), text(event.ip, 64), text(event.method, 40), text(event.command, 400), text(event.message, 600), Number(event.priority) || 0);
    }
  })();
  db().prepare('INSERT INTO sar_agent_state (connection_id, readable) VALUES (?, ?) ON CONFLICT(connection_id) DO UPDATE SET readable = excluded.readable').run(connectionId, payload.readable ? 1 : 0);
  db().prepare(`DELETE FROM sar_agent_events WHERE time < datetime('now', '-${EVENT_RETENTION_DAYS} days')`).run();
}

export function handleAgentFacts(payload: any) {
  const connectionId = connectionIdFor(payload?.agent_id);
  if (!connectionId) return;
  db().prepare('INSERT INTO sar_agent_state (connection_id, facts, facts_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(connection_id) DO UPDATE SET facts = excluded.facts, facts_at = CURRENT_TIMESTAMP').run(connectionId, JSON.stringify(payload).slice(0, 200_000));
}

const utc = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value ?? null);

export function agentStatus(connectionId: string) {
  const agent: any = agentDb.getAgent(agentIdFor(connectionId));
  const state: any = db().prepare('SELECT * FROM sar_agent_state WHERE connection_id = ?').get(connectionId);
  const counts: any = db().prepare("SELECT COUNT(*) AS total, SUM(kind = 'ssh_failed' OR kind = 'ssh_invalid_user') AS failed, SUM(kind = 'ssh_accepted') AS accepted, SUM(kind = 'sudo') AS sudo, SUM(kind IN ('error', 'kernel')) AS errors FROM sar_agent_events WHERE connection_id = ? AND time >= ?").get(connectionId, new Date(Date.now() - 86_400_000).toISOString());
  return {
    installed: !!agent,
    online: hasOnlineAgent(connectionId),
    version: agent?.version ?? null,
    lastSeen: utc(agent?.last_seen) ?? null,
    lastMetricsAt: utc(state?.last_metrics_at),
    factsAt: utc(state?.facts_at),
    logsReadable: state?.readable == null ? null : !!state.readable,
    last24h: { events: counts?.total ?? 0, failed: counts?.failed ?? 0, accepted: counts?.accepted ?? 0, sudo: counts?.sudo ?? 0, errors: counts?.errors ?? 0 },
  };
}

export function agentEvents(connectionId: string, hours = 24, limit = 300) {
  return (db().prepare('SELECT * FROM sar_agent_events WHERE connection_id = ? AND time >= ? ORDER BY time DESC LIMIT ?').all(connectionId, new Date(Date.now() - hours * 3600_000).toISOString(), limit) as any[]).map((row) => ({
    time: row.time, kind: row.kind, source: row.source, user: row.user, ip: row.ip, method: row.method, command: row.command, message: row.message, priority: row.priority,
  }));
}

/* ---------- live data for the full scan ---------- */

const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fc|fd)/i.test(ip);

/** The full scan's live part from agent data instead of SSH (null when no usable agent data) */
export function liveFromAgent(connectionId: string, hours: number): LiveReport | null {
  const connection: any = connectionDb.getById(connectionId);
  const state: any = db().prepare('SELECT * FROM sar_agent_state WHERE connection_id = ?').get(connectionId);
  if (!connection || !state?.facts || !hasOnlineAgent(connectionId)) return null;
  const facts = JSON.parse(state.facts);
  const events = agentEvents(connectionId, hours, 5000);
  const count = (values: string[]) => {
    const map = new Map<string, number>();
    values.forEach((value) => map.set(value, (map.get(value) ?? 0) + 1));
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  const failed = events.filter((event) => event.kind === 'ssh_failed' || event.kind === 'ssh_invalid_user');
  const accepted = events.filter((event) => event.kind === 'ssh_accepted');
  const sources = (list: any[]) => count(list.map((event) => event.ip).filter(Boolean)).slice(0, 8).map(([ip, total]) => ({ ip, count: total, public: !isPrivate(ip) }));
  const users = (list: any[]) => count(list.map((event) => event.user).filter(Boolean)).slice(0, 8).map(([name, total]) => ({ name, count: total }));
  const readable = state.readable == null ? true : !!state.readable;
  const disks = (facts.disks ?? []).map((entry: any) => ({ mount: entry.mount, usedPercent: Math.round(entry.used_percent) }));
  const listening = (facts.listening ?? []).map((line: string) => {
    const [proto, local] = line.split(' ');
    const port = Number(local?.split(':').pop());
    return { proto, address: local?.slice(0, local.lastIndexOf(':')) ?? '', port };
  }).filter((entry: any) => entry.port);

  const checks: LiveCheck[] = [];
  const push = (check: LiveCheck) => checks.push(check);
  push({ id: 'updates', label: 'Updates', status: facts.security_updates ? 'bad' : facts.updates > 20 ? 'warn' : facts.updates ? 'info' : 'ok', value: facts.updates ? `${facts.updates} ausstehend, ${facts.security_updates} Sicherheit` : 'aktuell', detail: (facts.update_names ?? []).slice(0, 8).join(', ') || undefined });
  push({ id: 'reboot', label: 'Neustart', status: facts.reboot_required ? 'warn' : 'ok', value: facts.reboot_required ? 'erforderlich' : 'nicht nötig' });
  if (facts.sshd?.permitrootlogin) push({ id: 'ssh-root', label: 'SSH Root-Login', status: facts.sshd.permitrootlogin === 'yes' ? 'bad' : 'ok', value: facts.sshd.permitrootlogin });
  if (facts.sshd?.passwordauthentication) push({ id: 'ssh-password', label: 'SSH Passwort-Login', status: facts.sshd.passwordauthentication === 'yes' ? (failed.length ? 'warn' : 'info') : 'ok', value: facts.sshd.passwordauthentication });
  const full = disks.filter((entry: any) => entry.usedPercent >= 80);
  push({ id: 'disk', label: 'Speicherplatz', status: full.some((entry: any) => entry.usedPercent >= 90) ? 'bad' : full.length ? 'warn' : 'ok', value: disks.slice(0, 4).map((entry: any) => `${entry.mount} ${entry.usedPercent}%`).join(' · ') || '–' });
  push({ id: 'units', label: 'Fehlgeschlagene Dienste', status: facts.failed_units?.length ? 'warn' : 'ok', value: facts.failed_units?.length ? facts.failed_units.join(', ') : 'keine' });
  if (!readable) push({ id: 'log-access', label: 'System-Logs', status: 'info', value: 'nicht vollständig lesbar', detail: 'Der Agent-Benutzer ist nicht in der Gruppe adm/systemd-journal.' });
  const publicFailed = sources(failed).filter((source) => source.public);
  push({ id: 'ssh-failed', label: 'SSH-Fehlversuche', status: publicFailed.length ? 'bad' : failed.length > 20 ? 'warn' : failed.length ? 'info' : 'ok', value: `${failed.length}`, detail: sources(failed).slice(0, 4).map((source) => `${source.ip} (${source.count})`).join(', ') || undefined });
  const publicAccepted = sources(accepted).filter((source) => source.public);
  push({ id: 'ssh-accepted', label: 'SSH-Anmeldungen', status: publicAccepted.length ? 'warn' : 'info', value: `${accepted.length} erfolgreich`, detail: publicAccepted.length ? `aus dem Internet: ${publicAccepted.map((source) => source.ip).join(', ')}` : sources(accepted).slice(0, 4).map((source) => `${source.ip} (${source.count})`).join(', ') || undefined });
  const kernel = events.filter((event) => event.kind === 'kernel');
  push({ id: 'kernel', label: 'Kernel-Meldungen', status: kernel.length ? 'warn' : 'ok', value: kernel.length ? `${kernel.length}` : 'keine' });

  const errors = new Map<string, { time?: string; unit: string; message: string; count: number }>();
  events.filter((event) => event.kind === 'error').forEach((event) => {
    const key = `${event.source}|${String(event.message).replace(/\d+/g, '#')}`;
    const existing = errors.get(key);
    errors.set(key, { time: existing?.time ?? event.time, unit: event.source ?? '?', message: event.message ?? '', count: (existing?.count ?? 0) + 1 });
  });

  return {
    connection: { id: connection.id, name: connection.name, host: connection.host, user: facts.user ? `${facts.user} (Agent)` : 'Agent' },
    privilege: 'agent',
    collectedAt: utc(state.facts_at) ?? new Date().toISOString(),
    hours,
    facts: {
      os: facts.os,
      kernel: facts.kernel,
      uptimeDays: facts.uptime_seconds ? Math.round(facts.uptime_seconds / 86_400) : undefined,
      updates: facts.updates ?? 0,
      securityUpdates: facts.security_updates ?? 0,
      rebootRequired: !!facts.reboot_required,
      failedUnits: facts.failed_units ?? [],
      disks,
      listening,
      loginUsers: [],
      uid0: [],
      authorizedKeys: [],
      sshd: facts.sshd ?? null,
      services: {},
    },
    logs: {
      canRead: readable,
      truncated: false,
      sshFailed: { total: failed.length, sources: sources(failed), users: users(failed), invalidUsers: failed.filter((event) => event.kind === 'ssh_invalid_user').length },
      sshAccepted: { total: accepted.length, sources: sources(accepted), users: users(accepted), methods: Object.fromEntries(count(accepted.map((event) => event.method ?? '?'))) },
      sudo: events.filter((event) => event.kind === 'sudo').slice(0, 40).map((event) => ({ time: event.time, user: event.user ?? '?', command: event.command ?? '' })),
      lastLogins: [],
      lastFailed: [],
      sessions: [],
      etcChanges: [],
      cron: [],
      errors: [...errors.values()].slice(0, 25).map((entry) => ({ time: entry.time, unit: entry.unit, message: entry.count > 1 ? `${entry.message} (${entry.count}×)` : entry.message })),
      kernel: kernel.slice(0, 20).map((event) => `${event.time} ${event.message}`),
      packages: [],
      processes: [],
      tmpExecutables: [],
    },
    checks,
  };
}

/* ---------- install / uninstall over one SSH session ---------- */

const toConfig = (connection: any) => ({
  id: connection.id, name: connection.name, host: connection.host, port: connection.port, username: connection.username,
  authType: connection.auth_type || 'password', password: connection.password, privateKeyPath: connection.private_key_path, passphrase: connection.passphrase,
});

/** This machine's address as seen from the target (the agent connects back to it) */
export function backendUrlFor(host: string) {
  const port = Number(process.env.PORT) || 3001;
  try {
    const route = execFileSync('ip', ['-o', 'route', 'get', host], { encoding: 'utf8', timeout: 3000 });
    const source = /\bsrc (\S+)/.exec(route)?.[1];
    if (source) return `ws://${source}:${port}/agent`;
  } catch {
    // fall through
  }
  return `ws://127.0.0.1:${port}/agent`;
}

const shellQuote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

async function run(connection: any, command: string) {
  const result = await SSHService.executeCommand(toConfig(connection) as any, command);
  return { ok: !!result.success, out: String(result.data?.stdout ?? '').trim(), err: String(result.data?.stderr ?? result.error ?? '').trim() };
}

/** "" for root, "sudo -n " if passwordless sudo works, null otherwise */
async function privilege(connection: any) {
  const probe = await run(connection, 'if [ "$(id -u)" = 0 ]; then echo root; elif sudo -n true 2>/dev/null; then echo sudo; else echo none; fi');
  if (!probe.ok && !probe.out) throw Object.assign(new Error(`SSH-Verbindung fehlgeschlagen: ${probe.err}`), { status: 502 });
  return probe.out === 'root' ? '' : probe.out === 'sudo' ? 'sudo -n ' : null;
}

export async function installAgent(connectionId: string, options: { serverUrl?: string; user?: string } = {}) {
  const connection: any = connectionDb.getById(connectionId);
  if (!connection) throw Object.assign(new Error('System nicht gefunden'), { status: 404 });
  if (connection.type === 'rdp') throw Object.assign(new Error('Der Agent ist für Linux-Systeme (SSH)'), { status: 400 });
  const steps: string[] = [];
  const sudo = await privilege(connection);
  if (sudo === null) throw Object.assign(new Error('Für die Installation braucht der SSH-Benutzer Root-Rechte oder sudo ohne Passwort.'), { status: 400 });
  steps.push(sudo ? 'Rechte: sudo' : 'Rechte: root');

  const arch = (await run(connection, 'uname -m')).out;
  const goArch = /x86_64|amd64/.test(arch) ? 'amd64' : /aarch64|arm64/.test(arch) ? 'arm64' : null;
  if (!goArch) throw Object.assign(new Error(`Architektur ${arch || '?'} wird nicht unterstützt`), { status: 400 });
  const binary = path.join(DOWNLOADS, `homelab-agent-linux-${goArch}`);
  if (!existsSync(binary)) throw Object.assign(new Error(`Agent-Datei fehlt: ${binary}`), { status: 500 });
  if (!(await run(connection, 'command -v systemctl')).out) throw Object.assign(new Error('systemd fehlt auf dem System'), { status: 400 });
  steps.push(`Architektur: ${goArch}`);

  // fresh token for this system; the old one (if any) is revoked
  const token = crypto.randomBytes(32).toString('hex');
  const tokenId = crypto.randomUUID();
  const serverUrl = options.serverUrl && /^wss?:\/\//.test(options.serverUrl) ? options.serverUrl : backendUrlFor(connection.host);
  const agentId = agentIdFor(connection.id);
  const config = [
    'server:',
    `  url: "${serverUrl}"`,
    `  token: "${token}"`,
    '  reconnect_delay: 10s',
    '  max_reconnect_attempts: 0',
    'agent:',
    `  id: "${agentId}"`,
    `  name: ${JSON.stringify(connection.name)}`,
    '  tags: ["sar"]',
    '  environment: "production"',
    'metrics:',
    '  interval: 30s',
    '  collectors: { cpu: true, memory: true, disk: true, network: true, connections: false, processes: true, docker: false, system_info: true }',
    'execution:',
    '  enabled: false',
    'logging:',
    '  level: "info"',
    'queue:',
    '  dir: "/var/lib/sar-agent"',
    '  max_size_mb: 20',
    '',
  ].join('\n');
  const unit = [
    '[Unit]',
    'Description=SAR Manager Agent',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'User=sar-agent',
    'Group=sar-agent',
    'ExecStart=/usr/local/bin/sar-agent -config /etc/sar-agent/config.yaml',
    'Restart=always',
    'RestartSec=10',
    'NoNewPrivileges=true',
    'ProtectSystem=strict',
    'ProtectHome=true',
    'PrivateTmp=true',
    'ReadWritePaths=/var/lib/sar-agent /etc/sar-agent',
    '',
    '[Install]',
    'WantedBy=multi-user.target',
    '',
  ].join('\n');

  const upload = await SSHService.uploadFile(toConfig(connection) as any, binary, '/tmp/sar-agent.bin');
  if (!upload.success) throw Object.assign(new Error(`Hochladen fehlgeschlagen: ${upload.error ?? upload.message}`), { status: 502 });
  steps.push('Agent hochgeladen');

  const s = sudo ?? '';
  const script = [
    'set -e',
    `id sar-agent >/dev/null 2>&1 || ${s}useradd --system --no-create-home --shell /usr/sbin/nologin sar-agent`,
    // read access to the journal and auth logs, nothing more
    `for g in adm systemd-journal; do getent group $g >/dev/null && ${s}usermod -aG $g sar-agent || true; done`,
    `${s}install -d -o sar-agent -g sar-agent -m 700 /etc/sar-agent /var/lib/sar-agent`,
    `${s}install -m 755 /tmp/sar-agent.bin /usr/local/bin/sar-agent`,
    'rm -f /tmp/sar-agent.bin',
    `printf %s ${shellQuote(config)} | ${s}tee /etc/sar-agent/config.yaml >/dev/null`,
    `${s}chown sar-agent:sar-agent /etc/sar-agent/config.yaml && ${s}chmod 600 /etc/sar-agent/config.yaml`,
    `printf %s ${shellQuote(unit)} | ${s}tee /etc/systemd/system/sar-agent.service >/dev/null`,
    `${s}systemctl daemon-reload`,
    `${s}systemctl enable sar-agent >/dev/null 2>&1`,
    `${s}systemctl restart sar-agent`,
    'sleep 2',
    `${s}systemctl is-active sar-agent`,
  ].join('\n');
  // token is valid before the agent starts
  agentTokensDb.revokeByLabel(`sar-agent ${connection.id}`);
  agentTokensDb.create(tokenId, `sar-agent ${connection.id}`, crypto.createHash('sha256').update(token).digest('hex'), 'sar');
  const result = await run(connection, script);
  if (!result.ok || !/^active$/m.test(result.out)) {
    agentTokensDb.revoke(tokenId);
    throw Object.assign(new Error(`Installation fehlgeschlagen: ${(result.err || result.out).slice(-400)}`), { status: 502 });
  }
  steps.push('Dienst sar-agent läuft', `verbindet sich zu ${serverUrl}`);
  return { installed: true, agentId, serverUrl, version: AGENT_VERSION, steps };
}

export async function uninstallAgent(connectionId: string) {
  const connection: any = connectionDb.getById(connectionId);
  if (!connection) throw Object.assign(new Error('System nicht gefunden'), { status: 404 });
  const sudo = await privilege(connection);
  if (sudo === null) throw Object.assign(new Error('Zum Entfernen braucht der SSH-Benutzer Root-Rechte oder sudo ohne Passwort.'), { status: 400 });
  const s = sudo;
  const result = await run(connection, [
    `${s}systemctl disable --now sar-agent >/dev/null 2>&1 || true`,
    `${s}rm -f /etc/systemd/system/sar-agent.service /usr/local/bin/sar-agent`,
    `${s}rm -rf /etc/sar-agent /var/lib/sar-agent`,
    `${s}systemctl daemon-reload`,
    `id sar-agent >/dev/null 2>&1 && ${s}userdel sar-agent || true`,
    'echo removed',
  ].join('\n'));
  agentTokensDb.revokeByLabel(`sar-agent ${connection.id}`);
  agentDb.deleteAgent(agentIdFor(connection.id));
  setAgentOnline(agentIdFor(connection.id), false);
  if (!/removed/.test(result.out)) throw Object.assign(new Error(`Entfernen fehlgeschlagen: ${result.err.slice(-300)}`), { status: 502 });
  return { removed: true };
}
