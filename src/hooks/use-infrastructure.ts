import { useQueries, useQuery } from '@tanstack/react-query';
import {
  agentsAPI,
  alertsAPI,
  auditAPI,
  connectionAPI,
  dockerAPI,
  healthCheck,
  proxmoxAPI,
  scriptsAPI,
  type AgentSecurityAlert,
  type AgentSummary,
  type InfrastructureAlert,
  type ProxmoxNode,
  type ProxmoxVm,
} from '@/services/api';
import { API_CONFIG } from '@/services/api-config';
import type { AuditLog, DockerContainer, RDPConnection, SSHConnection } from '@/types/connection';

export type Connection = (SSHConnection | RDPConnection) & { type?: 'ssh' | 'rdp' };

export const infraKeys = {
  connections: ['infra', 'connections'] as const,
  health: ['infra', 'health'] as const,
  agents: ['infra', 'agents'] as const,
  hostAlerts: ['infra', 'host-alerts'] as const,
  agentAlerts: ['infra', 'agent-alerts'] as const,
  proxmox: ['infra', 'proxmox'] as const,
  docker: ['infra', 'docker'] as const,
  audit: (limit: number) => ['infra', 'audit', limit] as const,
  jobs: ['infra', 'jobs'] as const,
  metrics: (id: string, hours: number) => ['infra', 'metrics', id, hours] as const,
};

export function useConnections() {
  return useQuery({
    queryKey: infraKeys.connections,
    queryFn: () => connectionAPI.getAll() as Promise<Connection[]>,
    refetchInterval: 30_000,
  });
}

/** Health plus round-trip latency of the backend. */
export function useBackendHealth() {
  return useQuery({
    queryKey: infraKeys.health,
    queryFn: async () => {
      const started = performance.now();
      const health = await healthCheck();
      return { ok: health.status === 'ok', latencyMs: Math.round(performance.now() - started) };
    },
    refetchInterval: 30_000,
    retry: false,
  });
}

export function useAgents() {
  return useQuery<AgentSummary[]>({
    queryKey: infraKeys.agents,
    queryFn: () => agentsAPI.getAll(),
    refetchInterval: 30_000,
  });
}

export type HostAlert = InfrastructureAlert & { message?: string };

export type RawHostAlert = Partial<InfrastructureAlert> & {
  alert_type?: string;
  actual_value?: number;
  threshold_value?: number;
  is_resolved?: number;
  message?: string;
};

/** The backend answers with alert_type/actual_value/threshold_value; older code expects metric_type/metric_value/threshold. */
export function normalizeHostAlert(raw: RawHostAlert): HostAlert {
  return {
    id: raw.id ?? 0,
    connection_id: raw.connection_id ?? '',
    metric_type: raw.metric_type ?? raw.alert_type ?? 'unknown',
    metric_value: Number(raw.metric_value ?? raw.actual_value ?? Number.NaN),
    threshold: Number(raw.threshold ?? raw.threshold_value ?? Number.NaN),
    severity: raw.severity ?? 'warning',
    resolved: Number(raw.resolved ?? raw.is_resolved ?? 0),
    created_at: raw.created_at ?? '',
    resolved_at: raw.resolved_at ?? null,
    message: raw.message,
  };
}

export function useHostAlerts() {
  return useQuery<HostAlert[]>({
    queryKey: infraKeys.hostAlerts,
    queryFn: async () => ((await alertsAPI.getActive()) as RawHostAlert[]).map(normalizeHostAlert),
    refetchInterval: 30_000,
  });
}

export function useAgentAlerts() {
  return useQuery<AgentSecurityAlert[]>({
    queryKey: infraKeys.agentAlerts,
    queryFn: () => agentsAPI.getActiveAlerts(),
    refetchInterval: 30_000,
  });
}

export interface ProxmoxSummary {
  connected: boolean;
  error?: string;
  nodes: Array<ProxmoxNode & { vms: ProxmoxVm[] }>;
}

const PROXMOX_TARGET_KEY = 'sar.proxmoxTarget';

/** host:port of the Proxmox API; app setting first, then VITE_PROXMOX_TARGET, else the backend's own PROXMOX_API_URL. */
export function getProxmoxTarget(): string | undefined {
  try {
    const stored = localStorage.getItem(PROXMOX_TARGET_KEY)?.trim();
    if (stored) return stored;
  } catch {
    // storage unavailable
  }
  return (import.meta.env.VITE_PROXMOX_TARGET as string | undefined)?.trim() || undefined;
}

export function setProxmoxTarget(target: string) {
  try {
    if (target.trim()) localStorage.setItem(PROXMOX_TARGET_KEY, target.trim());
    else localStorage.removeItem(PROXMOX_TARGET_KEY);
  } catch {
    // storage unavailable
  }
}

export function useProxmoxSummary(options: { refetchInterval?: number } = {}) {
  return useQuery<ProxmoxSummary>({
    queryKey: infraKeys.proxmox,
    queryFn: async () => {
      // An unconfigured backend answers with HTTP 400 and the reason in the body; keep that reason
      const target = getProxmoxTarget();
      const status = await proxmoxAPI.getStatusForTarget(target).catch((error: Error) => ({ connected: false as const, error: error.message }));
      if (!status.connected) return { connected: false, error: status.error, nodes: [] };
      const nodes = await proxmoxAPI.getNodes(target);
      const withVms = await Promise.all(
        nodes.map(async (node) => ({
          ...node,
          vms: node.status === 'online' ? await proxmoxAPI.getVms(node.node, target).catch(() => [] as ProxmoxVm[]) : [],
        })),
      );
      return { connected: true, nodes: withVms };
    },
    refetchInterval: options.refetchInterval ?? 60_000,
    staleTime: 30_000,
    retry: false,
  });
}

/** Containers across all Docker hosts. The scan reaches every host, so it refreshes slowly. */
export function useDockerContainers() {
  return useQuery<DockerContainer[]>({
    queryKey: infraKeys.docker,
    queryFn: () => dockerAPI.scanAll(),
    refetchInterval: 120_000,
    staleTime: 60_000,
    retry: false,
  });
}

export function useAuditLogs(limit = 12) {
  return useQuery<AuditLog[]>({
    queryKey: infraKeys.audit(limit),
    queryFn: () => auditAPI.getAll({ limit }),
    refetchInterval: 30_000,
  });
}

export function useScripts() {
  return useQuery({
    queryKey: ['infra', 'scripts'] as const,
    queryFn: () => scriptsAPI.getAll(),
    staleTime: 60_000,
  });
}

export type JobStatus = 'success' | 'running' | 'failed';

export interface RecentJob {
  id: string;
  title: string;
  target: string;
  status: JobStatus;
  startedAt: string;
}

function toJobStatus(status?: string): JobStatus {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'success';
}

/** Script executions, newest first; the same source as the Jobs page. */
export function useRecentJobs(limit = 6) {
  const connections = useConnections();
  return useQuery<RecentJob[]>({
    queryKey: [...infraKeys.jobs, limit, connections.data?.length ?? 0],
    queryFn: async () => {
      const scripts = await scriptsAPI.getAll();
      const nameById = new Map((connections.data ?? []).map((connection) => [connection.id, connection.name]));
      const executions = await Promise.all(
        scripts.map(async (script) => {
          const runs = await scriptsAPI.getExecutions(script.id).catch(() => []);
          return runs.map((run) => ({
            id: `script-${run.id}`,
            title: script.name,
            target: nameById.get(run.connection_id) ?? run.connection_id,
            status: toJobStatus(run.status),
            startedAt: run.started_at,
          }));
        }),
      );
      return executions
        .flat()
        .sort((left, right) => new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime())
        .slice(0, limit);
    },
    refetchInterval: 30_000,
  });
}

export interface MetricPoint {
  time: number;
  cpu: number | null;
  memory: number | null;
  disk: number | null;
  net: number | null;
}

interface RawMetricRow {
  recorded_at?: string;
  timestamp?: string;
  cpu_usage?: number | string | null;
  memory_usage?: number | string | null;
  disk_usage?: number | string | null;
  net_rx_rate?: number | string | null;
  net_tx_rate?: number | string | null;
}

function num(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

/** A utilisation value is only trusted inside 0–100 %; anything else is a collection error. */
export function percentOrNull(value: unknown): number | null {
  const parsed = num(value);
  return parsed !== null && parsed >= 0 && parsed <= 100.5 ? Math.min(parsed, 100) : null;
}

function parseTimestamp(value?: string): number {
  if (!value) return Number.NaN;
  // SQLite CURRENT_TIMESTAMP is UTC without a zone marker
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  return new Date(normalized).getTime();
}

async function fetchMetricsHistory(connectionId: string, hours: number): Promise<MetricPoint[]> {
  const response = await fetch(`${API_CONFIG.baseURL}/connections/${connectionId}/metrics-history?hours=${hours}&points=300`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = (await response.json()) as { data?: RawMetricRow[] };
  return (result.data ?? [])
    .map((row) => {
      const rx = num(row.net_rx_rate);
      const tx = num(row.net_tx_rate);
      return {
        time: parseTimestamp(row.recorded_at ?? row.timestamp),
        cpu: percentOrNull(row.cpu_usage),
        memory: percentOrNull(row.memory_usage),
        disk: percentOrNull(row.disk_usage),
        net: rx === null && tx === null ? null : (rx ?? 0) + (tx ?? 0),
      };
    })
    .filter((point) => Number.isFinite(point.time));
}

export interface ActivityBucket {
  time: number;
  cpu: number | null;
  memory: number | null;
  /** Network throughput as % of the window's peak, for plotting next to CPU/RAM. */
  net: number | null;
  /** Summed rx+tx across hosts, bytes per second. */
  netRate: number | null;
}

export interface FleetMetrics {
  buckets: ActivityBucket[];
  latest: { cpu: number | null; memory: number | null; disk: number | null; net: number | null; netRate: number | null };
  perHost: Record<string, MetricPoint | undefined>;
  hostsWithData: number;
}

function average(values: Array<number | null | undefined>): number | null {
  const present = values.filter((value): value is number => typeof value === 'number');
  if (present.length === 0) return null;
  return present.reduce((sum, value) => sum + value, 0) / present.length;
}

/** Aggregates the stored metrics history of every host into one time series. */
export function useFleetMetrics(hours: number) {
  const connections = useConnections();
  const hosts = connections.data ?? [];

  const results = useQueries({
    queries: hosts.map((host) => ({
      queryKey: infraKeys.metrics(host.id, hours),
      queryFn: () => fetchMetricsHistory(host.id, hours),
      refetchInterval: 60_000,
      staleTime: 30_000,
      retry: false,
    })),
  });

  const loading = connections.isLoading || results.some((result) => result.isLoading);
  const error = connections.error ?? (results.length > 0 && results.every((result) => result.isError) ? results[0].error : null);

  const bucketMs =
    hours <= 1 ? 2 * 60_000 : hours <= 24 ? 30 * 60_000 : hours <= 24 * 7 ? 6 * 3_600_000 : hours <= 24 * 31 ? 24 * 3_600_000 : 7 * 24 * 3_600_000;
  const end = Date.now();
  const start = end - hours * 3_600_000;
  const bucketCount = Math.ceil((end - start) / bucketMs);
  const raw = Array.from({ length: bucketCount }, (_, index) => ({
    time: start + index * bucketMs,
    cpu: [] as number[],
    memory: [] as number[],
    net: new Map<string, number[]>(),
  }));

  const perHost: Record<string, MetricPoint | undefined> = {};
  let hostsWithData = 0;

  results.forEach((result, hostIndex) => {
    const points = result.data ?? [];
    if (points.length > 0) hostsWithData += 1;
    const host = hosts[hostIndex];
    if (host) perHost[host.id] = points[points.length - 1];
    points.forEach((point) => {
      const index = Math.floor((point.time - start) / bucketMs);
      const bucket = raw[index];
      if (!bucket) return;
      if (point.cpu !== null) bucket.cpu.push(point.cpu);
      if (point.memory !== null) bucket.memory.push(point.memory);
      if (point.net !== null && host) {
        const list = bucket.net.get(host.id) ?? [];
        list.push(point.net);
        bucket.net.set(host.id, list);
      }
    });
  });

  const withRates = raw.map((bucket) => {
    const perHostRates = [...bucket.net.values()].map((values) => average(values) ?? 0);
    return {
      time: bucket.time,
      cpu: average(bucket.cpu),
      memory: average(bucket.memory),
      netRate: perHostRates.length > 0 ? perHostRates.reduce((sum, value) => sum + value, 0) : null,
    };
  });
  const peakRate = Math.max(0, ...withRates.map((bucket) => bucket.netRate ?? 0));
  const buckets: ActivityBucket[] = withRates.map((bucket) => ({
    ...bucket,
    net: bucket.netRate === null || peakRate === 0 ? (bucket.netRate === null ? null : 0) : (bucket.netRate / peakRate) * 100,
  }));

  const latestHostPoints = Object.values(perHost).filter((point): point is MetricPoint => !!point);
  const latestRates = latestHostPoints.map((point) => point.net).filter((value): value is number => value !== null);
  const latestRate = latestRates.length > 0 ? latestRates.reduce((sum, value) => sum + value, 0) : null;

  const metrics: FleetMetrics = {
    buckets,
    latest: {
      cpu: average(latestHostPoints.map((point) => point.cpu)),
      memory: average(latestHostPoints.map((point) => point.memory)),
      disk: average(latestHostPoints.map((point) => point.disk)),
      netRate: latestRate,
      net: latestRate === null || peakRate === 0 ? null : Math.min(100, (latestRate / peakRate) * 100),
    },
    perHost,
    hostsWithData,
  };

  return { data: metrics, loading, error: error as Error | null, bucketMs };
}
