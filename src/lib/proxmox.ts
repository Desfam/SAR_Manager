import type { ProxmoxNode, ProxmoxVm } from '@/services/api';
import type { ProxmoxSummary } from '@/hooks/use-infrastructure';

export interface ProxmoxGuest extends ProxmoxVm {
  node: string;
}

export interface ProxmoxStats {
  nodesTotal: number;
  nodesOnline: number;
  healthy: boolean;
  guests: ProxmoxGuest[];
  running: number;
  stopped: number;
  qemu: number;
  lxc: number;
  /** Cluster utilisation in %, weighted by node capacity; null when the API reports no capacity. */
  cpu: number | null;
  memory: number | null;
  storage: number | null;
  memoryUsed: number;
  memoryTotal: number;
  storageUsed: number;
  storageTotal: number;
  nodes: Array<ProxmoxNode & { cpuPercent: number | null; memoryPercent: number | null }>;
}

const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const percent = (used: number, total: number) => (total > 0 ? (used / total) * 100 : null);

/** One reading of the cluster for every card, so no two cards count differently. */
export function proxmoxStats(summary: ProxmoxSummary | undefined): ProxmoxStats | null {
  if (!summary?.connected) return null;
  const nodes = summary.nodes;
  // Templates are blueprints, not systems
  const guests: ProxmoxGuest[] = nodes.flatMap((node) =>
    node.vms.filter((vm) => !vm.template).map((vm) => ({ ...vm, node: node.node })),
  );
  const online = nodes.filter((node) => node.status === 'online');

  const cpuWeight = online.reduce((sum, node) => sum + num(node.maxcpu), 0);
  const cpuUsed = online.reduce((sum, node) => sum + num(node.cpu) * num(node.maxcpu), 0);
  const memoryUsed = online.reduce((sum, node) => sum + num(node.mem), 0);
  const memoryTotal = online.reduce((sum, node) => sum + num(node.maxmem), 0);
  const storageUsed = online.reduce((sum, node) => sum + num(node.disk), 0);
  const storageTotal = online.reduce((sum, node) => sum + num(node.maxdisk), 0);

  return {
    nodesTotal: nodes.length,
    nodesOnline: online.length,
    healthy: nodes.length > 0 && online.length === nodes.length,
    guests,
    running: guests.filter((guest) => guest.status === 'running').length,
    stopped: guests.filter((guest) => guest.status !== 'running').length,
    qemu: guests.filter((guest) => guest.type === 'qemu').length,
    lxc: guests.filter((guest) => guest.type === 'lxc').length,
    cpu: percent(cpuUsed, cpuWeight),
    memory: percent(memoryUsed, memoryTotal),
    storage: percent(storageUsed, storageTotal),
    memoryUsed,
    memoryTotal,
    storageUsed,
    storageTotal,
    nodes: nodes.map((node) => ({
      ...node,
      cpuPercent: node.status === 'online' && typeof node.cpu === 'number' ? node.cpu * 100 : null,
      memoryPercent: node.status === 'online' ? percent(num(node.mem), num(node.maxmem)) : null,
    })),
  };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** exponent;
  return `${value.toLocaleString('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 })} ${units[exponent]}`;
}
