// One persistent SSH connection per system; commands run as separate exec channels on it.
// Before, every command opened its own SSH login (5 per host every 30 s for the metrics alone),
// which flooded auth logs and Wazuh with login events.
import { createHash } from 'crypto';
import { Client, type ConnectConfig } from 'ssh2';

/** OpenSSH allows 10 sessions per connection (MaxSessions); stay well below */
const MAX_CHANNELS = 4;
/** close a connection nobody used for this long */
const IDLE_MS = 5 * 60_000;
const COMMAND_TIMEOUT_MS = 120_000;

interface Entry {
  key: string;
  client: Client;
  ready: Promise<void>;
  active: number;
  queue: Array<() => void>;
  idleTimer?: NodeJS.Timeout;
  closed: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

const pool = new Map<string, Entry>();
let logins = 0;

/** Connections are shared only when host, user and credentials are identical */
const keyOf = (config: ConnectConfig) =>
  createHash('sha256')
    .update([config.host, config.port, config.username, config.password ?? '', config.privateKey ? createHash('sha256').update(config.privateKey as Buffer).digest('hex') : '', config.passphrase ?? ''].join('\u0000'))
    .digest('hex');

function drop(entry: Entry) {
  if (entry.closed) return;
  entry.closed = true;
  clearTimeout(entry.idleTimer);
  if (pool.get(entry.key) === entry) pool.delete(entry.key);
  entry.client.end();
  // anyone still waiting gets a slot and will fail fast on the closed client
  entry.queue.splice(0).forEach((start) => start());
}

function connect(config: ConnectConfig): Entry {
  const key = keyOf(config);
  const existing = pool.get(key);
  if (existing && !existing.closed) return existing;
  const client = new Client();
  const entry: Entry = { key, client, active: 0, queue: [], closed: false, ready: Promise.resolve() };
  entry.ready = new Promise<void>((resolve, reject) => {
    client.once('ready', () => {
      logins += 1;
      resolve();
    });
    client.once('error', (error) => {
      drop(entry);
      reject(error);
    });
  });
  client.on('error', () => drop(entry));
  client.on('close', () => drop(entry));
  client.on('end', () => drop(entry));
  // keepalive notices dead connections (host rebooted, network gone)
  client.connect({ ...config, keepaliveInterval: 15_000, keepaliveCountMax: 3 });
  pool.set(key, entry);
  return entry;
}

function acquire(entry: Entry) {
  clearTimeout(entry.idleTimer);
  if (entry.active < MAX_CHANNELS) {
    entry.active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => entry.queue.push(() => {
    entry.active += 1;
    resolve();
  }));
}

function release(entry: Entry) {
  entry.active -= 1;
  const next = entry.queue.shift();
  if (next) next();
  else if (entry.active === 0 && !entry.closed) entry.idleTimer = setTimeout(() => drop(entry), IDLE_MS);
}

function run(entry: Entry, command: string, timeoutMs: number) {
  return new Promise<ExecResult>((resolve, reject) => {
    entry.client.exec(command, (error, stream) => {
      if (error) return reject(error);
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`Zeitlimit überschritten (${Math.round(timeoutMs / 1000)} s)`));
      }, timeoutMs);
      stream.on('data', (data: Buffer) => (stdout += data.toString()));
      stream.stderr.on('data', (data: Buffer) => (stderr += data.toString()));
      stream.on('close', (code: number | null) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? null });
      });
    });
  });
}

/** Run a command over the shared connection; reconnects once if the connection went stale */
export async function pooledExec(config: ConnectConfig, command: string, timeoutMs = COMMAND_TIMEOUT_MS): Promise<ExecResult> {
  for (let attempt = 0; ; attempt += 1) {
    const entry = connect(config);
    await entry.ready;
    await acquire(entry);
    try {
      if (entry.closed) throw Object.assign(new Error('Verbindung geschlossen'), { stale: true });
      return await run(entry, command, timeoutMs);
    } catch (error: any) {
      // channel open failed on a connection that died in the meantime: one fresh try
      const stale = error?.stale || /not connected|No response from server|channel open failure|Unable to exec/i.test(String(error?.message));
      if (stale && attempt === 0) {
        drop(entry);
        continue;
      }
      throw error;
    } finally {
      release(entry);
    }
  }
}

/** For diagnostics: open connections and logins since start */
export const poolStats = () => ({ connections: pool.size, logins, channels: [...pool.values()].reduce((sum, entry) => sum + entry.active, 0) });

export function closeAll() {
  [...pool.values()].forEach(drop);
}
