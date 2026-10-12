// Installs the Wazuh agent on a Debian/Ubuntu system over SSH (the command from the Wazuh "Deploy new agent" page)
// and keeps the output for polling.
import { randomUUID } from 'crypto';
import { auditLogDb, connectionDb } from '../database.js';
import { SSHService } from '../ssh.js';

export interface WazuhJob {
  id: string;
  connectionId: string;
  status: 'running' | 'success' | 'failed';
  output: string;
  exitCode: number | null;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

const jobs = new Map<string, WazuhJob>();
const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function validateWazuhInput(input: { manager?: unknown; version?: unknown; agentName?: unknown }) {
  const manager = String(input.manager ?? '').trim();
  const version = String(input.version ?? '').trim();
  const agentName = String(input.agentName ?? '').trim();
  if (!/^[A-Za-z0-9.-]{1,253}$/.test(manager)) return { error: 'Manager als IP-Adresse oder Hostname angeben' };
  if (!/^\d+\.\d+\.\d+$/.test(version)) return { error: 'Version wie 4.14.5 angeben' };
  if (agentName && !/^[A-Za-z0-9._-]{1,64}$/.test(agentName)) return { error: 'Agent-Name: nur Buchstaben, Ziffern, Punkt, Bindestrich, Unterstrich' };
  return { manager, version, agentName: agentName || undefined };
}

function installCommand(manager: string, version: string, agentName?: string) {
  const major = version.split('.')[0];
  const env = [`WAZUH_MANAGER=${quote(manager)}`, ...(agentName ? [`WAZUH_AGENT_NAME=${quote(agentName)}`] : [])].join(' ');
  return [
    'set -e',
    'export PATH="$PATH:/usr/sbin:/sbin"',
    'S=""; if [ "$(id -u)" != 0 ]; then if sudo -n true 2>/dev/null; then S="sudo -n"; else echo "Root-Rechte fehlen: sudo verlangt ein Passwort"; exit 10; fi; fi',
    'command -v dpkg >/dev/null || { echo "Kein dpkg: nur Debian/Ubuntu werden unterstützt"; exit 11; }',
    'ARCH=$(dpkg --print-architecture)',
    'case "$ARCH" in amd64|arm64) ;; *) echo "Architektur $ARCH wird nicht unterstützt"; exit 12;; esac',
    `F="wazuh-agent_${version}-1_$ARCH.deb"`,
    `URL="https://packages.wazuh.com/${major}.x/apt/pool/main/w/wazuh-agent/$F"`,
    'cd /tmp',
    'echo "Lade $URL"',
    'if command -v wget >/dev/null; then wget -q -O "$F" "$URL"; elif command -v curl >/dev/null; then curl -fsSL -o "$F" "$URL"; else echo "Weder wget noch curl vorhanden"; exit 13; fi',
    `echo "Installiere (Manager ${manager})"`,
    `$S env ${env} dpkg -i "./$F"`,
    'rm -f "$F"',
    '$S systemctl daemon-reload',
    '$S systemctl enable wazuh-agent',
    '$S systemctl start wazuh-agent',
    'echo "Warte auf Verbindung zum Manager …"',
    'for i in 1 2 3 4 5 6 7 8 9 10; do sleep 2; st=$($S grep -E "^status=" /var/ossec/var/run/wazuh-agentd.state 2>/dev/null || true); [ "$st" = "status=\'connected\'" ] && break; done',
    'echo "${st:-status unbekannt}"',
    '$S systemctl is-active wazuh-agent',
  ].join('\n');
}

export function startWazuhInstall(connectionId: string, input: { manager: string; version: string; agentName?: string }, requestedBy?: string): WazuhJob {
  const connection: any = connectionDb.getById(connectionId);
  if (!connection) throw Object.assign(new Error('Connection not found'), { status: 404 });
  if (connection.type === 'rdp') throw Object.assign(new Error('Nur für SSH-Systeme (Linux)'), { status: 400 });
  if ([...jobs.values()].some((job) => job.connectionId === connectionId && job.status === 'running')) throw Object.assign(new Error('Installation läuft bereits'), { status: 409 });

  const job: WazuhJob = { id: randomUUID(), connectionId, status: 'running', output: '', exitCode: null, startedAt: new Date().toISOString() };
  jobs.set(job.id, job);

  const handle = SSHService.execStreaming(
    {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type || 'password',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    } as any,
    'bash -s',
    { stdin: installCommand(input.manager, input.version, input.agentName), timeoutMs: 5 * 60_000, onData: (text) => (job.output = (job.output + text).slice(-200_000)) },
  );
  void handle.done.then((result) => {
    job.exitCode = result.exitCode;
    job.error = result.error ?? (result.exitCode ? `Exit-Code ${result.exitCode}` : undefined);
    job.status = result.exitCode === 0 ? 'success' : 'failed';
    job.finishedAt = new Date().toISOString();
    auditLogDb.create({
      user: requestedBy ?? 'app',
      action: 'WAZUH_AGENT_INSTALL',
      target: connection.name,
      details: `Manager ${input.manager}, Version ${input.version}: ${job.status}${job.error ? ` (${job.error})` : ''}`,
      status: job.status === 'success' ? 'success' : 'failed',
      ipAddress: requestedBy ?? '',
    });
    setTimeout(() => jobs.delete(job.id), 30 * 60_000);
  });
  return job;
}

export const getWazuhJob = (id: string) => jobs.get(id) ?? null;
