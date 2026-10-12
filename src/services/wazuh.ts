// Wazuh alerts from the Wazuh indexer, through our backend (see backend/src/services/wazuh-indexer.ts)
import { API_CONFIG } from './api-config';

export interface WazuhEvent {
  id: string;
  index: string;
  timestamp: string;
  agent: { id?: string; name?: string; ip?: string; group?: string };
  rule: { id?: string; level: number; description?: string; groups: string[]; mitre: { ids: string[]; tactics: string[]; techniques: string[] }; firedtimes?: number };
  decoder?: string;
  location?: string;
  fullLog?: string;
  windows?: { eventId?: string; user?: string; channel?: string };
  sourceIp?: string;
  sourceUser?: string;
  destinationUser?: string;
  vulnerability?: { cve?: string; severity?: string; package?: string; version?: string; condition?: string };
}

export interface Severity {
  low: number;
  medium: number;
  high: number;
  critical: number;
}

export interface WazuhAgentStat {
  name: string;
  id?: string;
  ip?: string;
  count: number;
  serious: number;
  maxLevel: number;
  lastSeen?: string;
}

export interface WazuhRuleStat {
  id: string;
  description?: string;
  count: number;
  maxLevel: number;
  agents?: number;
}

export interface WazuhSummary {
  total: number;
  interval: string;
  severity: Severity;
  timeline: Array<{ time: number; total: number } & Severity>;
  agents: WazuhAgentStat[];
  topRules: WazuhRuleStat[];
  frequentRules: WazuhRuleStat[];
  groups: Array<{ name: string; count: number }>;
  tactics: Array<{ name: string; count: number }>;
  sources: Array<{ ip: string; count: number; maxLevel: number }>;
}

export interface WazuhStatus {
  configured: boolean;
  url?: string;
  cluster?: string;
  version?: string;
  latencyMs?: number;
  tls?: string;
  indices?: number;
  documents?: number;
}

export interface WazuhFilters {
  hours: number;
  agent?: string;
  agentIp?: string;
  minLevel?: number;
  group?: string;
  ruleId?: string;
  srcip?: string;
  q?: string;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/wazuh${path}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

const query = (filters: WazuhFilters, extra: Record<string, string | number | undefined> = {}) => {
  const params = new URLSearchParams();
  Object.entries({ ...filters, ...extra }).forEach(([key, value]) => {
    if (value !== undefined && value !== '') params.set(key, String(value));
  });
  return params.toString();
};

export const wazuhApi = {
  status: () => request<WazuhStatus>('/status'),
  summary: (filters: WazuhFilters) => request<WazuhSummary>(`/summary?${query(filters)}`),
  events: (filters: WazuhFilters, limit = 100, after?: unknown[] | null) =>
    request<{ total: number; totalExact: boolean; events: WazuhEvent[]; next: unknown[] | null }>(`/events?${query(filters, { limit, after: after ? JSON.stringify(after) : undefined })}`),
  event: (index: string, id: string) => request<{ event: WazuhEvent; raw: Record<string, unknown> }>(`/events/${encodeURIComponent(index)}/${encodeURIComponent(id)}`),
};
