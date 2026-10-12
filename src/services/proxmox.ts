// Read-only Proxmox detail endpoints of the backend (see backend/src/routes/proxmox.ts)
import { API_CONFIG } from './api-config';

export type Timeframe = 'hour' | 'day' | 'week' | 'month' | 'year';

export interface TaskStatus {
  status: 'running' | 'stopped';
  exitstatus?: string;
  type?: string;
  upid?: string;
}

export interface GuestStatus {
  status: string;
  name?: string;
  cpu?: number;
  cpus?: number;
  mem?: number;
  maxmem?: number;
  disk?: number;
  maxdisk?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  uptime?: number;
  lock?: string;
  qmpstatus?: string;
}

export interface RrdPoint {
  time: number;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  memused?: number;
  memtotal?: number;
  netin?: number;
  netout?: number;
  diskread?: number;
  diskwrite?: number;
  loadavg?: number;
  iowait?: number;
}

export interface NodeStatus {
  uptime: number;
  loadavg: [string, string, string];
  cpu: number;
  cpuinfo: { model: string; cpus: number; sockets: number; cores: number };
  memory: { used: number; total: number; free: number };
  swap: { used: number; total: number };
  rootfs: { used: number; total: number };
  pveversion: string;
  kversion: string;
  wait?: number;
}

export interface StorageEntry {
  id: string;
  storage: string;
  node: string;
  plugintype?: string;
  content?: string;
  shared?: number;
  status?: string;
  disk?: number;
  maxdisk?: number;
}

export interface ClusterEntry {
  type: 'cluster' | 'node';
  name: string;
  quorate?: number;
  nodes?: number;
  online?: number;
  ip?: string;
}

async function get<T>(path: string, target?: string): Promise<T> {
  const separator = path.includes('?') ? '&' : '?';
  const url = `${API_CONFIG.baseURL}/proxmox${path}${target ? `${separator}target=${encodeURIComponent(target)}` : ''}`;
  const response = await fetch(url);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export interface NodeUpdate {
  package: string;
  title?: string;
  oldVersion?: string;
  version?: string;
  priority?: string;
  origin?: string;
}

const seg = encodeURIComponent;

export const proxmoxDetails = {
  task: (node: string, upid: string, target?: string) => get<TaskStatus>(`/tasks/${seg(node)}/${seg(upid)}`, target),
  guestStatus: (node: string, type: 'qemu' | 'lxc', vmid: number, target?: string) =>
    get<GuestStatus>(`/guests/${seg(node)}/${type}/${vmid}/status`, target),
  guestRrd: (node: string, type: 'qemu' | 'lxc', vmid: number, timeframe: Timeframe, target?: string) =>
    get<RrdPoint[]>(`/guests/${seg(node)}/${type}/${vmid}/rrd?timeframe=${timeframe}`, target),
  nodeStatus: (node: string, target?: string) => get<NodeStatus>(`/nodes/${seg(node)}/status`, target),
  nodeRrd: (node: string, timeframe: Timeframe, target?: string) => get<RrdPoint[]>(`/nodes/${seg(node)}/rrd?timeframe=${timeframe}`, target),
  storage: (target?: string) => get<StorageEntry[]>('/storage', target),
  nodeUpdates: (node: string, target?: string) => get<NodeUpdate[]>(`/nodes/${seg(node)}/updates`, target),
  cluster: (target?: string) => get<ClusterEntry[]>('/cluster', target),
};
