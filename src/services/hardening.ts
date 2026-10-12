// Security audit (see backend/src/services/hardening)
import { API_CONFIG } from './api-config';

export type Category = 'isolation' | 'network' | 'system' | 'access' | 'services' | 'monitoring' | 'backup' | 'host';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Status = 'pass' | 'warn' | 'fail' | 'unknown';

export interface Finding {
  id: string;
  category: Category;
  title: string;
  status: Status;
  severity: Severity;
  detail: string;
  fix?: string;
  commands?: string[];
}

export interface Profile {
  purpose?: string;
  exposure?: 'internal' | 'public' | 'lab';
  adminAccess?: string;
  expectedPorts?: string;
  sensitivity?: 'normal' | 'high';
  rto?: string;
  rpo?: string;
  owner?: string;
}

export interface AuditedGuest {
  key: string;
  vmid?: number;
  name: string;
  node?: string;
  type: 'qemu' | 'lxc' | 'external';
  status?: string;
  ips: string[];
  ostype?: string;
  system?: { id: string; name: string };
  os?: string;
  sshState: 'ok' | 'error' | 'no-access' | 'not-running' | 'windows';
  sshError?: string;
  profile?: Profile;
  score: number | null;
  findings: Finding[];
}

export interface AuditResult {
  startedAt: string;
  finishedAt?: string;
  host: { score: number | null; findings: Finding[] };
  guests: AuditedGuest[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/hardening${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const hardeningApi = {
  state: () => request<{ running: { progress: number; step: string; startedAt: string } | null; last: AuditResult | null }>('/audit'),
  start: (target?: string) => request<{ progress: number }>('/audit', { method: 'POST', body: JSON.stringify({ target }) }),
  saveProfile: (key: string, profile: Profile) => request<Profile>(`/profiles/${encodeURIComponent(key)}`, { method: 'PUT', body: JSON.stringify(profile) }),
  reach: (ip: string) => request<{ ip: string; open: Array<{ port: number; service: string }>; checkedPorts: number }>('/reach', { method: 'POST', body: JSON.stringify({ ip }) }),
};

/** Live facts of one SSH system (server overview) */
export interface SystemFacts {
  collectedAt: string;
  user: string;
  root: boolean;
  privilege: string;
  os: { id?: string; version?: string; codename?: string; pretty?: string };
  kernel?: string;
  virt?: string;
  upgradable: Array<{ name: string; security: boolean }>;
  aptListsAgeDays?: number;
  rebootRequired: boolean;
  unattended: { installed: boolean; enabled: boolean | null; timer?: string };
  sshd: Record<string, string> | null;
  uid0: string[];
  loginUsers: string[];
  groups: Record<string, string[]>;
  nopasswd: string[] | null;
  authorizedKeys: Array<{ file: string; count: number }>;
  listening: Array<{ proto: string; address: string; port: number; process?: string }>;
  failedUnits: string[];
  disks: Array<{ mount: string; usedPercent: number }>;
  inodes: Array<{ mount: string; usedPercent: number }>;
  services: Record<string, string>;
  timeSynced: boolean | null;
  apparmor: boolean | null;
  docker: Array<{ name: string; privileged: boolean; network: string; mounts: string[]; user: string }> | null;
  host: { hostname?: string; arch?: string; cpus?: number; memoryKb?: number; uptimeSeconds?: number };
  wazuh: { installed: boolean; version?: string; manager?: string; status?: string; lastKeepalive?: string };
}

export interface WazuhJob {
  id: string;
  connectionId: string;
  status: 'running' | 'success' | 'failed';
  output: string;
  exitCode: number | null;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export const systemApi = {
  facts: (connectionId: string) => request<SystemFacts>(`/system/${encodeURIComponent(connectionId)}`),
  installWazuh: (connectionId: string, input: { manager: string; version: string; agentName?: string }) =>
    request<WazuhJob>(`/wazuh/${encodeURIComponent(connectionId)}/install`, { method: 'POST', body: JSON.stringify(input) }),
  wazuhJob: (jobId: string) => request<WazuhJob>(`/wazuh/jobs/${encodeURIComponent(jobId)}`),
};
