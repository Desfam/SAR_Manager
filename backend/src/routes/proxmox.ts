import { Router, Request, Response } from 'express';
import { Agent } from 'undici';

const router = Router();
const insecureTlsDispatcher = new Agent({ connect: { rejectUnauthorized: false } });

function getRequiredEnv() {
  const tokenId = process.env.PROXMOX_TOKEN_ID;
  const tokenSecret = process.env.PROXMOX_TOKEN_SECRET;

  if (!tokenId || !tokenSecret) {
    return {
      ok: false as const,
      error: 'Missing Proxmox credentials. Set PROXMOX_TOKEN_ID and PROXMOX_TOKEN_SECRET in backend/.env',
    };
  }

  return {
    ok: true as const,
    apiUrl: process.env.PROXMOX_API_URL,
    tokenId,
    tokenSecret,
    insecureTls: process.env.PROXMOX_TLS_INSECURE === 'true',
  };
}

function normalizeProxmoxTarget(target?: string): string | null {
  if (!target) return null;
  const raw = target.trim();
  if (!raw) return null;

  const withScheme = raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;

  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('Invalid Proxmox target format. Use IP/host, optionally with :port');
  }

  if (!parsed.hostname) {
    throw new Error('Invalid Proxmox target host');
  }

  if (parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Invalid Proxmox target. Only host/IP and optional port are allowed');
  }

  const port = parsed.port || '8006';
  return `https://${parsed.hostname}:${port}`;
}

function buildApiBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (normalized.endsWith('/api2/json')) {
    return normalized;
  }
  return `${normalized}/api2/json`;
}

export async function proxmoxRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: Record<string, unknown>;
    target?: string;
    /** Abort after this many milliseconds (e.g. guest agent calls on VMs without an agent). */
    timeoutMs?: number;
  } = {}
): Promise<T> {
  const env = getRequiredEnv();
  if (!env.ok) {
    throw new Error(env.error);
  }

  const targetUrl = normalizeProxmoxTarget(options.target) || env.apiUrl;
  if (!targetUrl) {
    throw new Error('Missing Proxmox target. Provide target in request or set PROXMOX_API_URL in backend/.env');
  }

  const apiBaseUrl = buildApiBaseUrl(targetUrl);
  const url = `${apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Authorization: `PVEAPIToken=${env.tokenId}=${env.tokenSecret}`,
      // Proxmox rejects a JSON content type with an empty body ("malformed JSON string"),
      // which broke every body-less POST such as start/stop/shutdown/reboot
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.timeoutMs ? AbortSignal.timeout(options.timeoutMs) : undefined,
    dispatcher: env.insecureTls ? (insecureTlsDispatcher as any) : undefined,
  } as any);

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    // Proxmox puts the reason in the HTTP status line, not in the body
    const message = data?.errors
      ? JSON.stringify(data.errors)
      : data?.message || data?.error || response.statusText || `Proxmox API request failed (${response.status})`;
    throw new Error(message);
  }

  return data?.data as T;
}

router.get('/status', async (_req: Request, res: Response) => {
  try {
    const target = typeof _req.query.target === 'string' ? _req.query.target : undefined;
    const env = getRequiredEnv();
    if (!env.ok) {
      return res.status(400).json({ connected: false, error: env.error });
    }

    const requestedTarget = normalizeProxmoxTarget(target) || env.apiUrl;
    if (!requestedTarget) {
      return res.status(400).json({
        connected: false,
        error: 'No Proxmox target specified. Enter target in UI or set PROXMOX_API_URL in backend/.env',
      });
    }

    const version = await proxmoxRequest<{ version: string; release: string; repoid: string }>('/version', {
      target,
    });
    return res.json({
      connected: true,
      version,
      apiUrl: requestedTarget,
      insecureTls: env.insecureTls,
    });
  } catch (error: any) {
    return res.status(502).json({
      connected: false,
      error: error.message || 'Failed to connect to Proxmox API',
    });
  }
});

router.get('/nodes', async (_req: Request, res: Response) => {
  try {
    const target = typeof _req.query.target === 'string' ? _req.query.target : undefined;
    const nodes = await proxmoxRequest<Array<Record<string, any>>>('/nodes', { target });
    return res.json(nodes);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch Proxmox nodes' });
  }
});

router.get('/vms', async (req: Request, res: Response) => {
  try {
    const node = (req.query.node as string | undefined)?.trim();
    const target = typeof req.query.target === 'string' ? req.query.target : undefined;
    if (!node) {
      return res.status(400).json({ error: 'Query parameter "node" is required' });
    }

    const [qemu, lxc] = await Promise.all([
      proxmoxRequest<Array<Record<string, any>>>(`/nodes/${encodeURIComponent(node)}/qemu`, { target }),
      proxmoxRequest<Array<Record<string, any>>>(`/nodes/${encodeURIComponent(node)}/lxc`, { target }),
    ]);

    const vms = [
      ...qemu.map((vm) => ({ ...vm, type: 'qemu' } as Record<string, any> & { type: 'qemu' })),
      ...lxc.map((vm) => ({ ...vm, type: 'lxc' } as Record<string, any> & { type: 'lxc' })),
    ].sort((a: Record<string, any>, b: Record<string, any>) => (Number(a.vmid) || 0) - (Number(b.vmid) || 0));

    return res.json(vms);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch Proxmox VMs' });
  }
});

router.post('/vms/:node/:type/:vmid/start', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = typeof req.body?.target === 'string' ? req.body.target : undefined;
    const normalizedType = type === 'lxc' ? 'lxc' : 'qemu';
    const upid = await proxmoxRequest<string>(`/nodes/${encodeURIComponent(node)}/${normalizedType}/${encodeURIComponent(vmid)}/status/start`, {
      method: 'POST',
      target,
    });

    return res.json({ message: 'Start command sent', upid });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to start VM' });
  }
});

router.post('/vms/:node/:type/:vmid/stop', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = typeof req.body?.target === 'string' ? req.body.target : undefined;
    const normalizedType = type === 'lxc' ? 'lxc' : 'qemu';
    const upid = await proxmoxRequest<string>(`/nodes/${encodeURIComponent(node)}/${normalizedType}/${encodeURIComponent(vmid)}/status/stop`, {
      method: 'POST',
      target,
    });

    return res.json({ message: 'Stop command sent', upid });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to stop VM' });
  }
});

/* ---------- read-only detail endpoints ---------- */

const queryTarget = (req: Request) => (typeof req.query.target === 'string' ? req.query.target : undefined);
const guestType = (type: string) => (type === 'lxc' ? 'lxc' : 'qemu');
const TIMEFRAMES = new Set(['hour', 'day', 'week', 'month', 'year']);
const timeframe = (req: Request) => (typeof req.query.timeframe === 'string' && TIMEFRAMES.has(req.query.timeframe) ? req.query.timeframe : 'day');

// Status of a task started by a power action (UPID returned by start/stop/shutdown/reboot)
router.get('/tasks/:node/:upid', async (req: Request, res: Response) => {
  try {
    const { node, upid } = req.params;
    const status = await proxmoxRequest<Record<string, any>>(
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`,
      { target: queryTarget(req) },
    );
    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch task status' });
  }
});

router.get('/guests/:node/:type/:vmid/status', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const status = await proxmoxRequest<Record<string, any>>(
      `/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/status/current`,
      { target: queryTarget(req) },
    );
    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch guest status' });
  }
});

router.get('/guests/:node/:type/:vmid/rrd', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const data = await proxmoxRequest<Array<Record<string, any>>>(
      `/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/rrddata?timeframe=${timeframe(req)}&cf=AVERAGE`,
      { target: queryTarget(req) },
    );
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch guest history' });
  }
});

router.get('/nodes/:node/status', async (req: Request, res: Response) => {
  try {
    const status = await proxmoxRequest<Record<string, any>>(`/nodes/${encodeURIComponent(req.params.node)}/status`, { target: queryTarget(req) });
    return res.json(status);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch node status' });
  }
});

router.get('/nodes/:node/rrd', async (req: Request, res: Response) => {
  try {
    const data = await proxmoxRequest<Array<Record<string, any>>>(
      `/nodes/${encodeURIComponent(req.params.node)}/rrddata?timeframe=${timeframe(req)}&cf=AVERAGE`,
      { target: queryTarget(req) },
    );
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch node history' });
  }
});

// Pending package updates of a node (read-only: lists the cached apt state, does not refresh it)
router.get('/nodes/:node/updates', async (req: Request, res: Response) => {
  try {
    const list = await proxmoxRequest<Array<Record<string, any>>>(`/nodes/${encodeURIComponent(req.params.node)}/apt/update`, { target: queryTarget(req) });
    return res.json(
      (list ?? []).map((entry) => ({
        package: entry.Package,
        title: entry.Title,
        oldVersion: entry.OldVersion,
        version: entry.Version,
        priority: entry.Priority,
        origin: entry.Origin,
      })),
    );
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch node updates' });
  }
});

router.get('/storage', async (req: Request, res: Response) => {
  try {
    const data = await proxmoxRequest<Array<Record<string, any>>>('/cluster/resources?type=storage', { target: queryTarget(req) });
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch storage' });
  }
});

router.get('/cluster', async (req: Request, res: Response) => {
  try {
    const data = await proxmoxRequest<Array<Record<string, any>>>('/cluster/status', { target: queryTarget(req) });
    return res.json(data);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch cluster status' });
  }
});


/* ---------- network ---------- */

export interface GuestNetwork {
  vmid: number;
  name?: string;
  node: string;
  type: 'qemu' | 'lxc';
  status?: string;
  interfaces: Array<{ key: string; bridge?: string; firewall: boolean; mac?: string; tag?: string; ip?: string }>;
  ips: string[];
  ipSource: 'agent' | 'lxc' | 'config' | null;
  /** Proxmox ostype, e.g. l26, win10, win11 (LXC: debian, ubuntu, …) */
  ostype?: string;
}

function parseNetConfig(key: string, value: string) {
  const parts = Object.fromEntries(
    value.split(',').map((part) => {
      const [k, ...rest] = part.split('=');
      return [k, rest.join('=')];
    }),
  );
  const mac = Object.entries(parts).find(([k]) => ['virtio', 'e1000', 'e1000e', 'rtl8139', 'vmxnet3', 'hwaddr'].includes(k))?.[1];
  return { key, bridge: parts.bridge, firewall: parts.firewall === '1', mac, tag: parts.tag, ip: parts.ip };
}

export async function guestNetwork(guest: Record<string, any>, target?: string): Promise<GuestNetwork> {
  const type = guestType(guest.type);
  const base = `/nodes/${encodeURIComponent(guest.node)}/${type}/${encodeURIComponent(guest.vmid)}`;
  const config = await proxmoxRequest<Record<string, any>>(`${base}/config`, { target }).catch(() => ({} as Record<string, any>));
  const interfaces = Object.entries(config)
    .filter(([key]) => /^net\d+$/.test(key))
    .map(([key, value]) => parseNetConfig(key, String(value)));

  let ips: string[] = [];
  let ipSource: GuestNetwork['ipSource'] = null;
  const isIpv4 = (ip: string) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith('127.');

  if (guest.status === 'running' && type === 'lxc') {
    const list = await proxmoxRequest<Array<Record<string, any>>>(`${base}/interfaces`, { target, timeoutMs: 4000 }).catch(() => []);
    ips = (list || []).filter((iface) => iface.name !== 'lo' && iface.inet).map((iface) => String(iface.inet).split('/')[0]).filter(isIpv4);
    ipSource = ips.length ? 'lxc' : null;
  } else if (guest.status === 'running' && type === 'qemu') {
    const agent = await proxmoxRequest<Record<string, any>>(`${base}/agent/network-get-interfaces`, { target, timeoutMs: 4000 }).catch(() => null);
    const result = Array.isArray(agent?.result) ? agent!.result : [];
    ips = result.flatMap((iface: any) => (iface['ip-addresses'] || []).filter((a: any) => a['ip-address-type'] === 'ipv4').map((a: any) => String(a['ip-address']))).filter(isIpv4);
    ipSource = ips.length ? 'agent' : null;
  }
  if (!ips.length) {
    const fromConfig = interfaces.map((iface) => iface.ip?.split('/')[0]).filter((ip): ip is string => !!ip && isIpv4(ip));
    if (fromConfig.length) {
      ips = fromConfig;
      ipSource = 'config';
    }
  }
  return { vmid: Number(guest.vmid), name: guest.name, node: guest.node, type, status: guest.status, interfaces, ips, ipSource, ostype: typeof config.ostype === 'string' ? config.ostype : undefined };
}

// All guests with bridges, firewall flags and IPs (IPs from the LXC API or the QEMU guest agent)
router.get('/network/guests', async (req: Request, res: Response) => {
  try {
    const target = queryTarget(req);
    const resources = await proxmoxRequest<Array<Record<string, any>>>('/cluster/resources?type=vm', { target });
    const guests = await Promise.all(resources.filter((guest) => !guest.template).map((guest) => guestNetwork(guest, target)));
    return res.json(guests.sort((a, b) => a.vmid - b.vmid));
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch guest network' });
  }
});

/* ---------- monitoring ---------- */

const PSEUDO_FS = new Set(['tmpfs', 'devtmpfs', 'squashfs', 'overlay', 'efivarfs', 'proc', 'sysfs', 'cgroup', 'cgroup2', 'autofs', 'fuse.lxcfs', 'iso9660', 'udf']);

// CPU, RAM and storage of every guest. Storage: LXC from Proxmox, QEMU from the guest agent
// (filesystems as the guest sees them), otherwise only the disk size.
router.get('/monitoring', async (req: Request, res: Response) => {
  try {
    const target = queryTarget(req);
    const resources = await proxmoxRequest<Array<Record<string, any>>>('/cluster/resources?type=vm', { target });
    const guests = await Promise.all(
      resources
        .filter((guest) => !guest.template)
        .map(async (guest) => {
          const type = guestType(guest.type);
          let storage: Record<string, any> = { source: 'size', used: null, total: Number(guest.maxdisk) || null, filesystems: [] };
          if (type === 'lxc' && guest.status === 'running' && guest.maxdisk) {
            storage = { source: 'lxc', used: Number(guest.disk) || 0, total: Number(guest.maxdisk), filesystems: [] };
          } else if (type === 'qemu' && guest.status === 'running') {
            const info = await proxmoxRequest<Record<string, any>>(
              `/nodes/${encodeURIComponent(guest.node)}/qemu/${encodeURIComponent(guest.vmid)}/agent/get-fsinfo`,
              { target, timeoutMs: 4000 },
            ).catch(() => null);
            const list = Array.isArray(info?.result) ? info!.result : null;
            if (list) {
              const seen = new Set<string>();
              const filesystems = list
                .filter((fs: any) => fs['total-bytes'] && !PSEUDO_FS.has(String(fs.type).toLowerCase()))
                .filter((fs: any) => {
                  const key = String(fs.mountpoint);
                  if (seen.has(key)) return false;
                  seen.add(key);
                  return true;
                })
                .map((fs: any) => ({ mount: String(fs.mountpoint), type: String(fs.type), used: Number(fs['used-bytes']) || 0, total: Number(fs['total-bytes']) }));
              if (filesystems.length) {
                storage = {
                  source: 'agent',
                  used: filesystems.reduce((sum: number, fs: any) => sum + fs.used, 0),
                  total: filesystems.reduce((sum: number, fs: any) => sum + fs.total, 0),
                  filesystems,
                };
              }
            }
          }
          return {
            vmid: Number(guest.vmid),
            name: guest.name,
            node: guest.node,
            type,
            status: guest.status,
            cpu: Number(guest.cpu) || 0,
            maxcpu: Number(guest.maxcpu) || 0,
            mem: Number(guest.mem) || 0,
            maxmem: Number(guest.maxmem) || 0,
            netin: Number(guest.netin) || 0,
            netout: Number(guest.netout) || 0,
            uptime: Number(guest.uptime) || 0,
            tags: guest.tags,
            storage,
          };
        }),
    );
    return res.json(guests.sort((a, b) => a.vmid - b.vmid));
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch monitoring data' });
  }
});

/* ---------- firewall ---------- */

router.get('/firewall/status', async (req: Request, res: Response) => {
  try {
    const target = queryTarget(req);
    const [cluster, nodes] = await Promise.all([
      proxmoxRequest<Record<string, any>>('/cluster/firewall/options', { target }),
      proxmoxRequest<Array<Record<string, any>>>('/nodes', { target }),
    ]);
    const nodeOptions = await Promise.all(
      nodes.map(async (node) => ({
        node: node.node,
        enable: Number((await proxmoxRequest<Record<string, any>>(`/nodes/${encodeURIComponent(node.node)}/firewall/options`, { target }).catch(() => ({} as Record<string, any>)))?.enable ?? 0),
      })),
    );
    return res.json({ cluster: { enable: Number(cluster?.enable ?? 0), policy_in: cluster?.policy_in, policy_out: cluster?.policy_out }, nodes: nodeOptions });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch firewall status' });
  }
});

router.get('/firewall/macros', async (req: Request, res: Response) => {
  try {
    return res.json(await proxmoxRequest<Array<Record<string, any>>>('/cluster/firewall/macros', { target: queryTarget(req) }));
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch macros' });
  }
});

router.get('/guests/:node/:type/:vmid/firewall', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = queryTarget(req);
    const base = `/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/firewall`;
    const optional = <T,>(promise: Promise<T>, fallback: T) => promise.catch(() => fallback);
    const [options, rules, aliases, ipsetList] = await Promise.all([
      proxmoxRequest<Record<string, any>>(`${base}/options`, { target }),
      proxmoxRequest<Array<Record<string, any>>>(`${base}/rules`, { target }),
      optional(proxmoxRequest<Array<Record<string, any>>>(`${base}/aliases`, { target }), []),
      optional(proxmoxRequest<Array<Record<string, any>>>(`${base}/ipset`, { target }), []),
    ]);
    const ipsets = await Promise.all(
      ipsetList.map(async (set) => ({
        name: set.name,
        comment: set.comment,
        entries: await optional(proxmoxRequest<Array<Record<string, any>>>(`${base}/ipset/${encodeURIComponent(set.name)}`, { target }), []),
      })),
    );
    // Rules of type "group" reference a datacenter security group; expand them so the UI can show what they contain
    const groupNames = [...new Set(rules.filter((rule) => rule.type === 'group' && rule.action).map((rule) => String(rule.action)))];
    const groups = await Promise.all(
      groupNames.map(async (name) => ({
        name,
        rules: await optional(proxmoxRequest<Array<Record<string, any>>>(`/cluster/firewall/groups/${encodeURIComponent(name)}`, { target }), []),
      })),
    );
    return res.json({ options, rules, aliases, ipsets, groups });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch guest firewall' });
  }
});

// Firewall log of one guest (read-only)
router.get('/guests/:node/:type/:vmid/firewall/log', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    const lines = await proxmoxRequest<Array<{ n: number; t: string }>>(
      `/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/firewall/log?limit=${limit}`,
      { target: queryTarget(req) },
    );
    return res.json(lines ?? []);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to fetch firewall log' });
  }
});

// Strict whitelist for rule fields; everything else is dropped
function sanitizeRule(input: Record<string, any>): { rule?: Record<string, unknown>; error?: string } {
  const rule: Record<string, unknown> = {};
  if (!['in', 'out'].includes(input.type)) return { error: 'type must be "in" or "out"' };
  rule.type = input.type;
  if (!['ACCEPT', 'DROP', 'REJECT'].includes(input.action)) return { error: 'action must be ACCEPT, DROP or REJECT' };
  rule.action = input.action;
  if (input.macro !== undefined && input.macro !== '') {
    if (!/^[A-Za-z0-9]{1,40}$/.test(String(input.macro))) return { error: 'invalid macro' };
    rule.macro = String(input.macro);
  }
  if (input.proto !== undefined && input.proto !== '') {
    if (!/^(tcp|udp|icmp|ipv6-icmp)$/.test(String(input.proto))) return { error: 'proto must be tcp, udp or icmp' };
    rule.proto = String(input.proto);
  }
  for (const field of ['dport', 'sport'] as const) {
    if (input[field] !== undefined && input[field] !== '') {
      const value = String(input[field]);
      const ok = /^\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?)*$/.test(value) && value.split(/[,:]/).every((port) => Number(port) >= 1 && Number(port) <= 65535);
      if (!ok) return { error: `invalid ${field}` };
      if (!rule.proto && !rule.macro) return { error: 'ports need a protocol (tcp/udp)' };
      rule[field] = value;
    }
  }
  for (const field of ['source', 'dest'] as const) {
    if (input[field] !== undefined && input[field] !== '') {
      const value = String(input[field]);
      if (!/^[0-9a-fA-F.:/,]{2,200}$/.test(value)) return { error: `invalid ${field}: use IPs or CIDR ranges` };
      rule[field] = value;
    }
  }
  if (input.comment !== undefined && input.comment !== '') {
    const value = String(input.comment);
    if (value.length > 120 || /[\r\n]/.test(value)) return { error: 'comment too long or multi-line' };
    rule.comment = value;
  }
  if (!rule.macro && !rule.proto && rule.action !== undefined && input.allowAny !== true) {
    // A rule without service or protocol matches all traffic; require it to be explicit
    return { error: 'choose a service or protocol' };
  }
  rule.enable = input.enable === 0 ? 0 : 1;
  return { rule };
}

router.post('/guests/:node/:type/:vmid/firewall/rules', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = typeof req.body?.target === 'string' ? req.body.target : queryTarget(req);
    const { rule, error } = sanitizeRule(req.body?.rule ?? {});
    if (!rule) return res.status(400).json({ error });
    await proxmoxRequest(`/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/firewall/rules`, {
      method: 'POST',
      body: rule,
      target,
    });
    return res.json({ message: 'Rule created' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to create rule' });
  }
});

router.put('/guests/:node/:type/:vmid/firewall/rules/:pos', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid, pos } = req.params;
    if (!/^\d{1,4}$/.test(pos)) return res.status(400).json({ error: 'invalid position' });
    const target = typeof req.body?.target === 'string' ? req.body.target : queryTarget(req);
    // Only switching a rule on or off is supported here
    const enable = req.body?.enable === 1 || req.body?.enable === true ? 1 : 0;
    await proxmoxRequest(`/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/firewall/rules/${pos}`, {
      method: 'PUT',
      body: { enable, ...(typeof req.body?.digest === 'string' ? { digest: req.body.digest } : {}) },
      target,
    });
    return res.json({ message: enable ? 'Rule enabled' : 'Rule disabled' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to update rule' });
  }
});

router.delete('/guests/:node/:type/:vmid/firewall/rules/:pos', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid, pos } = req.params;
    if (!/^\d{1,4}$/.test(pos)) return res.status(400).json({ error: 'invalid position' });
    const digest = typeof req.query.digest === 'string' && /^[0-9a-f]{40}$/.test(req.query.digest) ? `?digest=${req.query.digest}` : '';
    await proxmoxRequest(`/nodes/${encodeURIComponent(node)}/${guestType(type)}/${encodeURIComponent(vmid)}/firewall/rules/${pos}${digest}`, {
      method: 'DELETE',
      target: queryTarget(req),
    });
    return res.json({ message: 'Rule deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to delete rule' });
  }
});

// Clean shutdown through the guest OS (ACPI for QEMU, init for LXC)
router.post('/vms/:node/:type/:vmid/shutdown', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = typeof req.body?.target === 'string' ? req.body.target : undefined;
    const normalizedType = type === 'lxc' ? 'lxc' : 'qemu';
    const upid = await proxmoxRequest<string>(`/nodes/${encodeURIComponent(node)}/${normalizedType}/${encodeURIComponent(vmid)}/status/shutdown`, {
      method: 'POST',
      target,
    });

    return res.json({ message: 'Shutdown command sent', upid });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to shut down VM' });
  }
});

router.post('/vms/:node/:type/:vmid/reboot', async (req: Request, res: Response) => {
  try {
    const { node, type, vmid } = req.params;
    const target = typeof req.body?.target === 'string' ? req.body.target : undefined;
    const normalizedType = type === 'lxc' ? 'lxc' : 'qemu';
    const upid = await proxmoxRequest<string>(`/nodes/${encodeURIComponent(node)}/${normalizedType}/${encodeURIComponent(vmid)}/status/reboot`, {
      method: 'POST',
      target,
    });

    return res.json({ message: 'Reboot command sent', upid });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to reboot VM' });
  }
});

export default router;
