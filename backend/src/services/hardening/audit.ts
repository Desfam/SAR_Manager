// Runs the security audit: Proxmox host + every guest (+ SSH systems outside Proxmox). Read-only.
import { execFile } from 'child_process';
import { mkdir, readFile, writeFile } from 'fs/promises';
import * as path from 'path';
import { connectionDb, getDatabase } from '../database.js';
import { SSHService } from '../ssh.js';
import { proxmoxRequest, guestNetwork, type GuestNetwork } from '../../routes/proxmox.js';
import { GUEST_FIREWALL_COMMAND, parseGuestFirewall, type GuestFirewallReport } from '../guest-firewall.js';
import { GUEST_AUDIT_COMMAND, parseGuestFacts, type GuestFacts } from './guest-facts.js';
import { guestFindings, hostFindings, score, type Finding, type Profile } from './checks.js';

export interface AuditedGuest {
  key: string; // vm:<vmid> or conn:<id>
  vmid?: number;
  name: string;
  node?: string;
  type: 'qemu' | 'lxc' | 'external';
  status?: string;
  ips: string[];
  ostype?: string;
  system?: { id: string; name: string };
  os?: string;
  sshState: 'ok' | 'error' | 'no-access' | 'not-running' | 'windows';
  sshError?: string;
  profile?: Profile;
  score: number | null;
  findings: Finding[];
}

export interface AuditResult {
  startedAt: string;
  finishedAt?: string;
  host: { score: number | null; findings: Finding[] };
  guests: AuditedGuest[];
}

interface Job {
  progress: number;
  step: string;
  startedAt: string;
}

const DATA_FILE = path.join(process.cwd(), 'data', 'hardening-audit.json');
let running: Job | null = null;
let last: AuditResult | null = null;

/* ---------- profiles (Sollprofil) ---------- */

let profileTable = false;
function profilesDb() {
  const db = getDatabase();
  if (!profileTable) {
    db.exec('CREATE TABLE IF NOT EXISTS security_profiles (guest_key TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)');
    profileTable = true;
  }
  return db;
}

export function getProfiles(): Record<string, Profile> {
  const rows = profilesDb().prepare('SELECT guest_key, data FROM security_profiles').all() as Array<{ guest_key: string; data: string }>;
  return Object.fromEntries(rows.map((row) => [row.guest_key, JSON.parse(row.data)]));
}

export function saveProfile(key: string, input: Record<string, unknown>): Profile {
  const text = (value: unknown, max = 300) => (typeof value === 'string' ? value.trim().slice(0, max) : undefined);
  const profile: Profile = {
    purpose: text(input.purpose),
    exposure: ['internal', 'public', 'lab'].includes(String(input.exposure)) ? (input.exposure as Profile['exposure']) : undefined,
    adminAccess: text(input.adminAccess),
    expectedPorts: text(input.expectedPorts, 200)?.replace(/[^\d,\s]/g, ''),
    sensitivity: ['normal', 'high'].includes(String(input.sensitivity)) ? (input.sensitivity as Profile['sensitivity']) : undefined,
    rto: text(input.rto, 60),
    rpo: text(input.rpo, 60),
    owner: text(input.owner, 120),
  };
  profilesDb().prepare('INSERT INTO security_profiles (guest_key, data, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(guest_key) DO UPDATE SET data = excluded.data, updated_at = CURRENT_TIMESTAMP').run(key, JSON.stringify(profile));
  // keep the stored audit in sync so the UI shows the new profile right away
  if (last) {
    const guest = last.guests.find((entry) => entry.key === key);
    if (guest) guest.profile = profile;
  }
  return profile;
}

/* ---------- helpers ---------- */

const toConfig = (connection: any) => ({
  id: connection.id,
  name: connection.name,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  authType: connection.auth_type || 'password',
  password: connection.password,
  privateKeyPath: connection.private_key_path,
});

async function sshFacts(connection: any): Promise<{ facts?: GuestFacts; firewall?: GuestFirewallReport; error?: string }> {
  const audit = await SSHService.executeCommand(toConfig(connection) as any, GUEST_AUDIT_COMMAND);
  const stdout = audit.data?.stdout ?? '';
  if (!stdout.includes('@@ID')) return { error: audit.error || audit.message || 'SSH-Abfrage fehlgeschlagen' };
  const firewall = await SSHService.executeCommand(toConfig(connection) as any, GUEST_FIREWALL_COMMAND);
  return { facts: parseGuestFacts(stdout), firewall: firewall.data?.stdout?.includes('@@ID') ? parseGuestFirewall(firewall.data.stdout) : undefined };
}

async function pool<T>(items: T[], size: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift()!);
  }));
}

const isWindows = (ostype?: string) => !!ostype && /^(win|w2k|wxp|wvista)/.test(ostype);

/* ---------- run ---------- */

async function execute(target: string | undefined, job: Job) {
  const result: AuditResult = { startedAt: job.startedAt, host: { score: null, findings: [] }, guests: [] };
  const optional = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
  const step = (text: string, progress: number) => {
    job.step = text;
    job.progress = progress;
  };

  // Host
  step('Proxmox-Host', 3);
  const [version, nodes, clusterOptions, tfa, backupJobs, resources] = await Promise.all([
    optional(proxmoxRequest<Record<string, any>>('/version', { target }), {} as Record<string, any>),
    proxmoxRequest<Array<Record<string, any>>>('/nodes', { target }),
    optional(proxmoxRequest<Record<string, any>>('/cluster/firewall/options', { target }), {} as Record<string, any>),
    optional(proxmoxRequest<Array<Record<string, any>>>('/access/tfa', { target }), []),
    optional(proxmoxRequest<Array<Record<string, any>>>('/cluster/backup', { target }), []),
    proxmoxRequest<Array<Record<string, any>>>('/cluster/resources?type=vm', { target }),
  ]);
  const tokenId = process.env.PROXMOX_TOKEN_ID ?? '';
  const [tokenUser, tokenName] = tokenId.split('!');
  const token = await optional(proxmoxRequest<Record<string, any>>(`/access/users/${encodeURIComponent(tokenUser)}/token/${encodeURIComponent(tokenName ?? '')}`, { target }), null);
  const nodeInfo = await Promise.all(
    nodes.map(async (node) => ({
      node: String(node.node),
      status: node.status,
      updates: node.status === 'online' ? await optional(proxmoxRequest<unknown[]>(`/nodes/${encodeURIComponent(node.node)}/apt/update`, { target }).then((list) => list.length), null) : null,
      firewall: Number((await optional(proxmoxRequest<Record<string, any>>(`/nodes/${encodeURIComponent(node.node)}/firewall/options`, { target }), {} as Record<string, any>)).enable ?? 0) === 1,
    })),
  );

  // Backups: newest archive per guest across all backup storages (shared storages listed once)
  step('Backups', 10);
  const lastBackup = new Map<number, number>();
  const offline: string[] = [];
  const seenStorages = new Set<string>();
  for (const node of nodes.filter((entry) => entry.status === 'online')) {
    const storages = await optional(proxmoxRequest<Array<Record<string, any>>>(`/nodes/${encodeURIComponent(node.node)}/storage?content=backup`, { target }), []);
    for (const storage of storages) {
      const key = storage.shared ? String(storage.storage) : `${node.node}/${storage.storage}`;
      if (seenStorages.has(key)) continue;
      seenStorages.add(key);
      if (storage.active === 0 || storage.enabled === 0) {
        offline.push(String(storage.storage));
        continue;
      }
      const items = await proxmoxRequest<Array<Record<string, any>>>(`/nodes/${encodeURIComponent(node.node)}/storage/${encodeURIComponent(storage.storage)}/content?content=backup`, { target, timeoutMs: 20_000 }).catch(() => {
        offline.push(String(storage.storage));
        return [];
      });
      items.forEach((item) => {
        const vmid = Number(item.vmid);
        if (vmid && (lastBackup.get(vmid) ?? 0) < Number(item.ctime)) lastBackup.set(vmid, Number(item.ctime));
      });
    }
  }
  const jobVmids = new Set<number>();
  let allInJob = false;
  backupJobs.filter((jobEntry) => jobEntry.enabled !== 0).forEach((jobEntry) => {
    if (jobEntry.all) allInJob = true;
    String(jobEntry.vmid ?? '').split(',').filter(Boolean).forEach((vmid) => jobVmids.add(Number(vmid)));
  });

  result.host.findings = hostFindings({
    version: version.version,
    nodes: nodeInfo,
    clusterFirewall: Number(clusterOptions.enable ?? 0) === 1,
    tfaUsers: tfa.filter((entry) => Array.isArray(entry.entries) && entry.entries.length).length,
    token: { id: tokenId, privsep: token ? Number(token.privsep) === 1 : null, expire: token ? Number(token.expire ?? 0) : null },
    backupJobs: backupJobs.length,
    offlineBackupStorages: [...new Set(offline)],
  });
  result.host.score = score(result.host.findings);

  // Guests: config, firewall options, network
  step('Gäste in Proxmox', 15);
  const guests = resources.filter((guest) => !guest.template);
  const connections = (connectionDb.getAll() as any[]).filter((connection) => connection.type !== 'rdp');
  const profiles = getProfiles();
  const contexts: Array<{ network: GuestNetwork; config: Record<string, any>; firewall: Record<string, any> | null; connection?: any }> = [];
  await pool(guests, 6, async (guest) => {
    const type = guest.type === 'lxc' ? 'lxc' : 'qemu';
    const base = `/nodes/${encodeURIComponent(guest.node)}/${type}/${encodeURIComponent(guest.vmid)}`;
    const [network, config, firewall] = await Promise.all([
      guestNetwork(guest, target),
      optional(proxmoxRequest<Record<string, any>>(`${base}/config`, { target }), {} as Record<string, any>),
      optional(proxmoxRequest<Record<string, any>>(`${base}/firewall/options`, { target }), null),
    ]);
    const connection =
      connections.find((entry) => network.ips.includes(entry.host)) ??
      connections.find((entry) => !!network.name && String(entry.name).toLowerCase() === network.name.toLowerCase());
    contexts.push({ network, config, firewall, connection });
  });

  // SSH facts for running guests with access, plus SSH systems outside Proxmox
  const usedConnections = new Set(contexts.map((context) => context.connection?.id).filter(Boolean));
  const external = connections.filter((connection) => !usedConnections.has(connection.id));
  const sshTargets = [
    ...contexts.filter((context) => context.connection && context.network.status === 'running' && !isWindows(context.network.ostype)).map((context) => context.connection),
    ...external,
  ];
  const facts = new Map<string, Awaited<ReturnType<typeof sshFacts>>>();
  let done = 0;
  step(`Systeme per SSH (0/${sshTargets.length})`, 25);
  await pool(sshTargets, 6, async (connection) => {
    facts.set(connection.id, await sshFacts(connection).catch((error) => ({ error: error.message })));
    done += 1;
    step(`Systeme per SSH (${done}/${sshTargets.length})`, 25 + Math.round((done / Math.max(sshTargets.length, 1)) * 72));
  });

  for (const context of contexts) {
    const { network, config, firewall, connection } = context;
    const key = `vm:${network.vmid}`;
    const sshResult = connection ? facts.get(connection.id) : undefined;
    const windows = isWindows(network.ostype ?? config.ostype);
    const findings = guestFindings({
      vmid: network.vmid,
      name: network.name ?? String(network.vmid),
      node: network.node,
      type: network.type,
      status: network.status,
      config,
      firewallOptions: firewall,
      clusterFirewall: Number(clusterOptions.enable ?? 0) === 1,
      lastBackup: lastBackup.get(network.vmid) ?? null,
      inBackupJob: allInJob || jobVmids.has(network.vmid),
      system: connection ? { id: connection.id, name: connection.name, username: connection.username, authType: connection.auth_type || 'password' } : undefined,
      facts: sshResult?.facts,
      factsError: sshResult?.error,
      osFirewall: sshResult?.firewall,
      profile: profiles[key],
    });
    result.guests.push({
      key,
      vmid: network.vmid,
      name: network.name ?? String(network.vmid),
      node: network.node,
      type: network.type,
      status: network.status,
      ips: network.ips,
      ostype: network.ostype,
      system: connection ? { id: connection.id, name: connection.name } : undefined,
      os: sshResult?.facts?.os.pretty,
      sshState: windows ? 'windows' : network.status !== 'running' ? 'not-running' : !connection ? 'no-access' : sshResult?.facts ? 'ok' : 'error',
      sshError: sshResult?.error,
      profile: profiles[key],
      score: score(findings),
      findings,
    });
  }

  for (const connection of external) {
    const key = `conn:${connection.id}`;
    const sshResult = facts.get(connection.id);
    // Systems outside Proxmox: only the checks from inside the OS apply
    const findings = guestFindings({
      vmid: 0,
      name: connection.name,
      node: '',
      type: 'qemu',
      config: {},
      firewallOptions: null,
      clusterFirewall: false,
      lastBackup: null,
      inBackupJob: false,
      system: { id: connection.id, name: connection.name, username: connection.username, authType: connection.auth_type || 'password' },
      facts: sshResult?.facts,
      osFirewall: sshResult?.firewall,
      profile: profiles[key],
    }).filter((finding) => !['vm-passthrough', 'vm-media', 'vm-agent', 'pve-firewall', 'backup', 'secrets-in-notes'].includes(finding.id));
    result.guests.push({
      key,
      name: connection.name,
      type: 'external',
      ips: [connection.host],
      system: { id: connection.id, name: connection.name },
      os: sshResult?.facts?.os.pretty,
      sshState: sshResult?.facts ? 'ok' : 'error',
      sshError: sshResult?.error,
      profile: profiles[key],
      score: sshResult?.facts ? score(findings) : null,
      findings: sshResult?.facts ? findings : [],
    });
  }

  result.guests.sort((a, b) => (a.vmid ?? 1e9) - (b.vmid ?? 1e9) || a.name.localeCompare(b.name));
  result.finishedAt = new Date().toISOString();
  return result;
}

export function startAudit(target?: string) {
  if (running) throw new Error('Es läuft bereits eine Prüfung');
  const job: Job = { progress: 0, step: 'Start', startedAt: new Date().toISOString() };
  running = job;
  void execute(target, job)
    .then(async (result) => {
      last = result;
      await mkdir(path.dirname(DATA_FILE), { recursive: true }).catch(() => undefined);
      await writeFile(DATA_FILE, JSON.stringify(result)).catch(() => undefined);
    })
    .catch((error) => {
      job.step = `Fehler: ${error.message}`;
    })
    .finally(() => {
      running = null;
    });
  return job;
}

export async function auditState() {
  if (!last) {
    try {
      last = JSON.parse(await readFile(DATA_FILE, 'utf8')) as AuditResult;
    } catch {
      last = null;
    }
  }
  if (last) {
    // profiles may have changed since the audit
    const profiles = getProfiles();
    last.guests.forEach((guest) => (guest.profile = profiles[guest.key]));
  }
  return { running, last };
}

/* ---------- reachability from this machine (section 21 of the guide) ---------- */

const REACH_PORTS = '21,22,23,25,53,80,110,111,135,139,143,389,443,445,465,587,631,993,995,1433,1514,1515,2049,2375,2376,3000,3306,3389,5000,5432,5601,5900,5984,6379,6556,8000,8006,8080,8443,8888,9000,9090,9100,9200,9300,10050,11211,27017,55000';

export function checkReachability(ip: string): Promise<{ ip: string; open: Array<{ port: number; service: string }>; checkedPorts: number }> {
  return new Promise((resolve, reject) => {
    if (!/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d{1,3}\.\d{1,3}(\.\d{1,3})?$/.test(ip) || ip.split('.').length !== 4) return reject(new Error('Nur private IPv4-Adressen'));
    execFile('nmap', ['-sT', '-Pn', '-T4', '--open', '-p', REACH_PORTS, '-oG', '-', ip], { timeout: 90_000 }, (error, stdout) => {
      if (error && !stdout) return reject(new Error(error.message));
      const line = stdout.split('\n').find((entry) => entry.includes('Ports:')) ?? '';
      const open = (line.split('Ports:')[1] ?? '')
        .split(',')
        .map((entry) => entry.trim().split('/'))
        .filter((parts) => parts[1] === 'open')
        .map((parts) => ({ port: Number(parts[0]), service: parts[4] || '' }));
      resolve({ ip, open, checkedPorts: REACH_PORTS.split(',').length });
    });
  });
}
