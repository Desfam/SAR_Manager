// SAR agent per system (backend/src/routes/sar-agent.ts)
import { API_CONFIG } from './api-config';

export interface SarAgentStatus {
  installed: boolean;
  online: boolean;
  version: string | null;
  latestVersion: string;
  lastSeen: string | null;
  lastMetricsAt: string | null;
  factsAt: string | null;
  logsReadable: boolean | null;
  serverUrl: string | null;
  last24h: { events: number; failed: number; accepted: number; sudo: number; errors: number };
}

export interface SarAgentEvent {
  time: string;
  kind: 'ssh_failed' | 'ssh_invalid_user' | 'ssh_accepted' | 'sudo' | 'error' | 'kernel';
  source?: string;
  user?: string;
  ip?: string;
  method?: string;
  command?: string;
  message?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/sar-agent${path}`, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const sarAgentApi = {
  status: (connectionId: string) => request<SarAgentStatus>(`/${encodeURIComponent(connectionId)}`),
  events: (connectionId: string, hours = 24) => request<SarAgentEvent[]>(`/${encodeURIComponent(connectionId)}/events?hours=${hours}&limit=200`),
  install: (connectionId: string, serverUrl?: string) => request<{ installed: boolean; serverUrl: string; version: string; steps: string[] }>(`/${encodeURIComponent(connectionId)}/install`, { method: 'POST', body: JSON.stringify({ serverUrl }) }),
  uninstall: (connectionId: string) => request<{ removed: boolean }>(`/${encodeURIComponent(connectionId)}/uninstall`, { method: 'POST' }),
};
