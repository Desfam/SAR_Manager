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

async function proxmoxRequest<T>(
  path: string,
  options: {
    method?: 'GET' | 'POST';
    body?: Record<string, unknown>;
    target?: string;
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
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
    dispatcher: env.insecureTls ? (insecureTlsDispatcher as any) : undefined,
  } as any);

  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data?.errors
      ? JSON.stringify(data.errors)
      : data?.message || data?.error || `Proxmox API request failed (${response.status})`;
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

export default router;
