// Network map and firewall data (see backend/src/routes/proxmox.ts and connections.ts)
import { API_CONFIG } from './api-config';

export interface GuestNetwork {
  vmid: number;
  name?: string;
  node: string;
  type: 'qemu' | 'lxc';
  status?: string;
  interfaces: Array<{ key: string; bridge?: string; firewall: boolean; mac?: string; tag?: string; ip?: string }>;
  ips: string[];
  ipSource: 'agent' | 'lxc' | 'config' | null;
  ostype?: string;
}

export interface SocketAddress {
  ip: string;
  port: number | null;
}

export interface Netstat {
  host: string;
  collectedAt: string;
  established: Array<{ proto: string; local: SocketAddress; peer: SocketAddress }>;
  listening: Array<{ proto: string; local: SocketAddress }>;
}

export interface FirewallRule {
  pos: number;
  type: 'in' | 'out' | 'group';
  action: string;
  macro?: string;
  proto?: string;
  dport?: string;
  sport?: string;
  source?: string;
  dest?: string;
  enable?: number;
  comment?: string;
  iface?: string;
}

export interface GuestFirewall {
  options: { enable?: number; policy_in?: string; policy_out?: string; digest?: string; [key: string]: unknown };
  rules: FirewallRule[];
  aliases?: Array<{ name: string; cidr: string; comment?: string }>;
  ipsets?: Array<{ name: string; comment?: string; entries: Array<{ cidr: string; nomatch?: number; comment?: string }> }>;
  /** Datacenter security groups referenced by rules of type "group", with their rules */
  groups?: Array<{ name: string; rules: FirewallRule[] }>;
}

/* Firewall inside the guest OS, read over SSH (see backend/src/services/guest-firewall.ts) */

export interface OsChain {
  name: string;
  type?: string;
  hook?: string;
  policy?: string;
  rules: string[];
}

export interface OsRuleTable {
  family?: string;
  name: string;
  chains: OsChain[];
}

export interface GuestOsFirewall {
  host: string;
  collectedAt: string;
  user: string;
  root: boolean;
  privilege: string;
  os?: string;
  services: Record<string, string>;
  ufw?: { status: string; defaults?: { incoming?: string; outgoing?: string; routed?: string }; logging?: string; rules: Array<{ to: string; action: string; from: string; comment?: string }>; error?: string };
  firewalld?: { state: string; zones: Array<{ name: string; active: boolean; target?: string; interfaces: string[]; sources: string[]; services: string[]; ports: string[]; richRules: string[] }>; error?: string };
  nftables?: { tables: OsRuleTable[]; error?: string };
  iptables?: { tables: OsRuleTable[]; error?: string };
  raw: Record<string, string>;
}

export interface FirewallStatus {
  cluster: { enable: number; policy_in?: string; policy_out?: string };
  nodes: Array<{ node: string; enable: number }>;
}

export interface NewRule {
  type: 'in' | 'out';
  action: 'ACCEPT' | 'DROP' | 'REJECT';
  macro?: string;
  proto?: string;
  dport?: string;
  source?: string;
  dest?: string;
  comment?: string;
  allowAny?: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}${path}`, init);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

const withTarget = (path: string, target?: string) =>
  target ? `${path}${path.includes('?') ? '&' : '?'}target=${encodeURIComponent(target)}` : path;

const guestBase = (guest: { node: string; type: string; vmid: number }) =>
  `/proxmox/guests/${encodeURIComponent(guest.node)}/${guest.type}/${guest.vmid}`;

export const networkApi = {
  guests: (target?: string) => request<GuestNetwork[]>(withTarget('/proxmox/network/guests', target)),
  netstat: (connectionId: string) => request<Netstat>(`/connections/${encodeURIComponent(connectionId)}/netstat`),
  guestOsFirewall: (connectionId: string) => request<GuestOsFirewall>(`/connections/${encodeURIComponent(connectionId)}/guest-firewall`),
  firewallLog: (guest: { node: string; type: string; vmid: number }, limit = 100, target?: string) =>
    request<Array<{ n: number; t: string }>>(withTarget(`${guestBase(guest)}/firewall/log?limit=${limit}`, target)),
  firewallStatus: (target?: string) => request<FirewallStatus>(withTarget('/proxmox/firewall/status', target)),
  macros: (target?: string) => request<Array<{ macro: string; descr: string }>>(withTarget('/proxmox/firewall/macros', target)),
  guestFirewall: (guest: { node: string; type: string; vmid: number }, target?: string) =>
    request<GuestFirewall>(withTarget(`${guestBase(guest)}/firewall`, target)),
  createRule: (guest: { node: string; type: string; vmid: number }, rule: NewRule, target?: string) =>
    request<{ message: string }>(`${guestBase(guest)}/firewall/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rule, target }),
    }),
  setRuleEnabled: (guest: { node: string; type: string; vmid: number }, pos: number, enable: boolean, digest?: string, target?: string) =>
    request<{ message: string }>(`${guestBase(guest)}/firewall/rules/${pos}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enable: enable ? 1 : 0, digest, target }),
    }),
  deleteRule: (guest: { node: string; type: string; vmid: number }, pos: number, digest?: string, target?: string) =>
    request<{ message: string }>(withTarget(`${guestBase(guest)}/firewall/rules/${pos}${digest ? `?digest=${digest}` : ''}`, target), { method: 'DELETE' }),
};

/* LAN scan with nmap (see backend/src/services/network-scan.ts) */

export type DeviceKind = 'router' | 'network' | 'hypervisor' | 'server' | 'pc' | 'printer' | 'nas' | 'camera' | 'phone' | 'mobile' | 'vm' | 'iot' | 'self' | 'unknown';

export interface ScanDevice {
  ip: string;
  hostname?: string;
  mac?: string;
  vendor?: string;
  randomMac?: boolean;
  ports?: Array<{ port: number; proto: string; service?: string; product?: string; version?: string; ostype?: string; title?: string }>;
  kind: DeviceKind;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  os?: string;
}

export interface ScanJob {
  id: string;
  subnet: string;
  mode: 'discover' | 'quick';
  phase: 'discover' | 'ports' | 'done' | 'failed' | 'cancelled';
  progress: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  devices: ScanDevice[];
}

export const scanApi = {
  interfaces: () => request<Array<{ iface: string; address: string; cidr: string }>>('/network/interfaces'),
  state: () => request<{ running: ScanJob | null; last: ScanJob | null }>('/network/scan'),
  start: (subnet: string, mode: 'discover' | 'quick') =>
    request<ScanJob>('/network/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subnet, mode }) }),
  cancel: () => request<{ cancelled: boolean }>('/network/scan', { method: 'DELETE' }),
};
