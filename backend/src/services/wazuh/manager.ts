// Wazuh manager API (agents, status). Read-only use: only GET requests after authentication.
// The manager certificate is self-signed (and may be expired), so it is pinned by its SHA-256 fingerprint.
import * as tls from 'tls';
import { Agent, fetch } from 'undici';

function config() {
  return {
    url: (process.env.WAZUH_MANAGER_URL ?? '').replace(/\/$/, ''),
    username: process.env.WAZUH_MANAGER_USERNAME ?? '',
    password: process.env.WAZUH_MANAGER_PASSWORD ?? '',
    pin: (process.env.WAZUH_MANAGER_CERT_SHA256 ?? '').toUpperCase(),
  };
}

export const managerConfigured = () => {
  const { url, username, password } = config();
  return !!(url && username && password);
};

let dispatcher: Agent | null = null;
function pinnedDispatcher() {
  if (dispatcher) return dispatcher;
  const { pin } = config();
  // Chain and expiry are not checked (self-signed); instead the exact certificate must match the pin.
  // The check runs after the TLS handshake (secureConnect), when the peer certificate is known.
  dispatcher = new Agent({
    connect: (options, callback) => {
      const socket = tls.connect({
        host: options.hostname,
        port: Number(options.port) || 55000,
        servername: options.servername || undefined,
        rejectUnauthorized: false,
        ALPNProtocols: ['http/1.1'],
      });
      let done = false;
      const finish = (error: Error | null) => {
        if (done) return;
        done = true;
        if (error) {
          socket.destroy();
          callback(error, null);
        } else callback(null, socket);
      };
      socket.once('secureConnect', () => {
        const fingerprint = socket.getPeerCertificate()?.fingerprint256?.toUpperCase();
        if (!pin) return finish(new Error('WAZUH_MANAGER_CERT_SHA256 fehlt: Zertifikat des Managers ist nicht gepinnt'));
        if (fingerprint !== pin) return finish(new Error(`Manager-Zertifikat passt nicht zum Pin (${fingerprint ?? 'unbekannt'})`));
        return finish(null);
      });
      socket.once('error', (error) => finish(error));
      socket.setTimeout(10_000, () => finish(new Error('Zeitüberschreitung beim Verbinden mit dem Manager')));
    },
  });
  return dispatcher;
}

let token: { value: string; expires: number } | null = null;

async function authenticate() {
  if (token && token.expires > Date.now()) return token.value;
  const { url, username, password } = config();
  const response = await fetch(`${url}/security/user/authenticate?raw=true`, {
    method: 'POST',
    headers: { Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}` },
    dispatcher: pinnedDispatcher(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 ? 'Wazuh-Manager: Benutzername oder Passwort falsch' : `Wazuh-Manager ${response.status}`), { status: 502 });
  // tokens live 900 s by default; renew a bit earlier
  token = { value: (await response.text()).trim(), expires: Date.now() + 12 * 60_000 };
  return token.value;
}

export async function manager<T>(path: string): Promise<T> {
  if (!managerConfigured()) throw Object.assign(new Error('Wazuh-Manager nicht konfiguriert'), { status: 503 });
  const { url } = config();
  const send = async () =>
    fetch(`${url}${path}`, { headers: { Authorization: `Bearer ${await authenticate()}` }, dispatcher: pinnedDispatcher(), signal: AbortSignal.timeout(20_000) });
  let response = await send();
  if (response.status === 401) {
    token = null;
    response = await send();
  }
  const data: any = await response.json().catch(() => null);
  if (!response.ok) throw Object.assign(new Error(`Wazuh-Manager ${response.status}: ${data?.detail ?? data?.title ?? response.statusText}`), { status: 502 });
  return data?.data as T;
}

export interface ManagerAgent {
  id: string;
  name: string;
  ip?: string;
  status: string;
  os?: { name?: string; platform?: string; version?: string };
  version?: string;
  group?: string[];
  lastKeepAlive?: string;
  dateAdd?: string;
}

let agentCache: { at: number; agents: ManagerAgent[] } | null = null;

/** All agents with status; cached for 30 s */
export async function managerAgents(): Promise<ManagerAgent[]> {
  if (agentCache && Date.now() - agentCache.at < 30_000) return agentCache.agents;
  const data = await manager<{ affected_items: ManagerAgent[] }>('/agents?limit=1000&select=id,name,ip,status,os.name,os.platform,os.version,version,group,lastKeepAlive,dateAdd');
  agentCache = { at: Date.now(), agents: data.affected_items ?? [] };
  return agentCache.agents;
}

export async function managerInfo() {
  const [info, status] = await Promise.all([manager<any>('/'), manager<any>('/agents/summary/status')]);
  return { version: info?.api_version, hostname: info?.hostname, connection: status?.connection, configuration: status?.configuration };
}
