// Wazuh SOC workspace API (see backend/src/services/wazuh/soc.ts)
import { API_CONFIG } from './api-config';
import type { WazuhEvent } from './wazuh';

export type Verdict = 'informational' | 'likely_benign' | 'review' | 'suspicious' | 'critical';
export type Risk = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Assessment {
  verdict: Verdict;
  risk: Risk;
  confidence: 'low' | 'medium' | 'high';
  source: 'regelbasiert';
  category: string;
  why: string;
  evidence: string[];
  nextSteps: string[];
}

export interface SocEvent extends WazuhEvent {
  user?: string;
  eventId?: string;
  program?: string;
  logonType?: string;
  platform: 'windows' | 'linux' | 'other';
  assessment: Assessment;
}

export interface Fleet {
  version?: string;
  hostname?: string;
  connection?: { active: number; disconnected: number; never_connected: number; total: number };
}

export interface Dashboard {
  total: number;
  severity: { low: number; medium: number; high: number; critical: number };
  activeHosts: number;
  lastEvent?: string;
  timeline: Array<{ time: number; total: number; serious: number }>;
  verdicts: Partial<Record<Verdict, number>>;
  stream: SocEvent[];
  fleet: {
    manager: { version?: string; active: number; disconnected: number; neverConnected: number; total: number } | null;
    riskyHosts: Array<{ name: string; count: number; maxLevel: number; serious: number }>;
  };
}

export interface SearchResult {
  total: number;
  totalExact: boolean;
  events: SocEvent[];
  next: unknown[] | null;
  facets: { hosts: Array<{ name: string; count: number }>; rules: Array<{ id: string; description?: string; count: number }>; maxLevel: number | null; first?: string; last?: string };
}

export interface EventContext {
  event: SocEvent;
  raw: Record<string, unknown>;
  related: {
    sameHost: Array<WazuhEvent & { offsetSeconds: number }>;
    sameUser: WazuhEvent[];
    sameRule: { total: number; hosts: Array<{ name: string; count: number }> };
  };
}

export interface SocHost {
  name: string;
  id?: string;
  ip?: string;
  status?: string;
  os?: string;
  osVersion?: string;
  platform?: string;
  hostname?: string;
  architecture?: string;
  version?: string;
  groups?: string[];
  lastKeepAlive?: string;
  events?: number;
  serious?: number;
  maxLevel?: number;
  lastEvent?: string;
  vulnerabilities?: number;
  critical?: number;
  high?: number;
  risk: number;
}

export interface HostContext {
  host: SocHost;
  hardware: { cpu?: { name?: string; cores?: number }; memory?: { total?: number; usage?: number } } | null;
  rules: Array<{ id: string; description?: string; count: number; maxLevel: number }>;
  users: Array<{ name: string; count: number }>;
  timeline: Array<{ time: number; total: number }>;
  ports: Array<{ protocol?: string; port: number; address?: string; process?: string }>;
  recent: SocEvent[];
}

export interface UserContext {
  user: string;
  total: number;
  failed: number;
  success: number;
  first?: string;
  last?: string;
  hosts: Array<{ name: string; count: number }>;
  rules: Array<{ id: string; description?: string; count: number; maxLevel: number }>;
  sources: Array<{ ip: string; count: number }>;
  recent: SocEvent[];
}

export interface LinuxOverview {
  agents: string[];
  total: number;
  categories: Record<string, number>;
  failedLogins: { total: number; sources: Array<{ ip: string; count: number }>; users: Array<{ name: string; count: number }> };
  hosts: Array<{ name: string; count: number; maxLevel: number; categories: Record<string, number> }>;
  programs: Array<{ name: string; count: number }>;
  events: SocEvent[];
  timeline: Array<{ time: number; total: number; failed: number; privilege: number }>;
  successLogins?: { total: number; sources: Array<{ ip: string; count: number }>; users: Array<{ name: string; count: number }> };
  sudo?: { total: number; users: Array<{ name: string; count: number }>; commands: Array<{ name: string; count: number }> };
  fim?: { total: number; hosts: number; paths: Array<{ path: string; count: number }> };
  os: Array<{ name: string; count: number }>;
  status: { active: number; disconnected: number; total: number } | null;
}

export interface MitreOverview {
  total: number;
  hosts: number;
  tactics: Array<{ name: string; count: number; techniques: Array<{ name: string; id?: string; count: number; hostCount: number; hosts: string[]; maxLevel: number; rules: string[] }> }>;
}

export interface Vulnerabilities {
  total: number;
  hostCount: number;
  severity: Record<string, number>;
  hosts: Array<{ name: string; count: number; critical: number; high: number }>;
  cves: Array<{ id: string; count: number; score?: number; severity?: string; hosts: number; package?: string }>;
  packages: Array<{ name: string; count: number; hosts: number; critical: number }>;
  items: Array<{ id: string; host?: string; os?: string; package?: string; version?: string; cve?: string; severity?: string; score?: number; detectedAt?: string; publishedAt?: string; reference?: string; description?: string }>;
}

export interface IocResult {
  value: string;
  type: 'ip' | 'hash' | 'url' | 'domain' | 'text';
  publicIp?: boolean;
  total: number;
  first?: string;
  last?: string;
  hosts: Array<{ name: string; count: number }>;
  rules: Array<{ id: string; description?: string; count: number; maxLevel: number }>;
  timeline: Array<{ time: number; total: number }>;
  threatIntel: { connected: boolean };
  events: SocEvent[];
}

export interface TrustCenter {
  checks: Array<{ id: string; label: string; status: 'ok' | 'warn' | 'fail' | 'off'; detail: string; ms?: number }>;
  config: Record<string, string | null>;
}

async function get<T>(path: string): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/wazuh/soc${path}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => value !== undefined && value !== null && value !== '' && search.set(key, String(value)));
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const socApi = {
  dashboard: (hours: number, minLevel?: number) => get<Dashboard>(`/dashboard${qs({ hours, minLevel })}`),
  search: (q: string, hours: number, order: 'asc' | 'desc', limit = 100, after?: unknown[] | null, minLevel?: number, window?: { from: string; to: string }) =>
    get<SearchResult>(`/search${qs({ q, hours, order, limit, after: after ? JSON.stringify(after) : undefined, minLevel, from: window?.from, to: window?.to })}`),
  context: (index: string, id: string) => get<EventContext>(`/events/${encodeURIComponent(index)}/${encodeURIComponent(id)}/context`),
  hosts: (hours: number) => get<SocHost[]>(`/hosts${qs({ hours })}`),
  host: (name: string, hours: number) => get<HostContext>(`/hosts/${encodeURIComponent(name)}${qs({ hours })}`),
  user: (user: string, hours: number) => get<UserContext>(`/users/${encodeURIComponent(user)}${qs({ hours })}`),
  linux: (hours: number, category?: string) => get<LinuxOverview>(`/linux${qs({ hours, category })}`),
  mitre: (hours: number) => get<MitreOverview>(`/mitre${qs({ hours })}`),
  vulnerabilities: (filters: { severity?: string; host?: string; q?: string }) => get<Vulnerabilities>(`/vulnerabilities${qs({ ...filters, limit: 150 })}`),
  ioc: (value: string, hours: number) => get<IocResult>(`/ioc${qs({ value, hours })}`),
  trust: () => get<TrustCenter>('/trust'),
  fleet: () => get<Fleet | null>('/fleet'),
};

/* ---------- round 2 ---------- */

export type Severity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface Finding {
  id: string;
  key: string;
  host: string;
  category: string;
  title: string;
  severity: Severity;
  reason: string;
  evidence: string[];
  checks: string[];
  eventCount: number;
  firstSeen?: string;
  lastSeen?: string;
  source: 'full_scan' | 'baseline';
  query?: string;
  status: 'open' | 'in_progress' | 'resolved' | 'false_positive';
  createdAt: string;
  updatedAt: string;
}

export interface ScanResult {
  id: string;
  host: string;
  hours: number;
  scannedAt: string;
  summary: {
    worst: Severity;
    events: number;
    levels: { low: number; medium: number; high: number };
    firstSeen?: string;
    lastSeen?: string;
    findings: { total: number; bySeverity: Record<string, number> };
  };
  modules: {
    system: { os?: string; version?: string; hostname?: string; architecture?: string } | null;
    auth: { failed: number; success: number; failedUsers: Array<{ name: string; count: number }> };
    fim: { changes: number; paths: Array<{ path: string; count: number; sensitive: boolean }> };
    sca: Array<{ policy: string; score: number; passed: number; failed: number; total: number; at: string }>;
    vulnerabilities: { bySeverity: Record<string, number>; critical: Array<{ cve: string; package?: string; score?: number }>; packages?: Array<{ name: string; count: number }> };
    mitre: Array<{ technique: string; id?: string; count: number; maxLevel: number }>;
    threatIntel: { connected: boolean; publicSources: Array<{ ip: string; count: number; maxLevel: number }> };
    network: { listening: Array<{ protocol?: string; port: number; process?: string }>; outbound: Array<{ ip: string; port: number; process?: string; state?: string }> };
  };
  live?: LiveReport | { error: string; connection?: { id: string; name: string; host: string } } | null;
  /** Claude's evaluation, stored with the scan after confirmation */
  ai?: Explanation;
  findings: Array<Omit<Finding, 'id' | 'status' | 'createdAt' | 'updatedAt'>>;
  stored?: { created: number; updated: number };
}

export interface LiveCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'bad' | 'info';
  value: string;
  detail?: string;
}

export interface LiveReport {
  connection: { id: string; name: string; host: string; user: string };
  privilege: string;
  collectedAt: string;
  hours: number;
  facts: {
    os?: string;
    kernel?: string;
    uptimeDays?: number;
    updates: number;
    securityUpdates: number;
    rebootRequired: boolean;
    failedUnits: string[];
    disks: Array<{ mount: string; usedPercent: number }>;
    listening: Array<{ proto: string; address: string; port: number; process?: string }>;
    loginUsers: string[];
    uid0: string[];
    authorizedKeys: Array<{ file: string; count: number }>;
    sshd: Record<string, string> | null;
    services: Record<string, string>;
  };
  logs: {
    canRead: boolean;
    truncated: boolean;
    sshFailed: { total: number; sources: Array<{ ip: string; count: number; public: boolean }>; users: Array<{ name: string; count: number }>; invalidUsers: number };
    sshAccepted: { total: number; sources: Array<{ ip: string; count: number; public: boolean }>; users: Array<{ name: string; count: number }>; methods: Record<string, number> };
    sudo: Array<{ time?: string; user: string; runAs?: string; command: string }>;
    lastLogins: string[];
    lastFailed: string[];
    sessions: string[];
    etcChanges: string[];
    cron: string[];
    errors: Array<{ time?: string; unit: string; message: string }>;
    kernel: string[];
    packages: Array<{ time: string; action: string; name: string; version?: string }>;
    processes: Array<{ user: string; pid: number; cpu: number; memory: number; command: string }>;
    tmpExecutables: string[];
  };
  checks: LiveCheck[];
}

export interface ScanSummary {
  id: string;
  host: string;
  hours: number;
  createdAt: string;
  findings: number;
  worst: Severity;
}

export interface Baseline {
  host: string;
  deviations: {
    rules: Array<{ key: string; count: number; description?: string; maxLevel?: number }>;
    users: Array<{ key: string; count: number }>;
    sources: Array<{ key: string; count: number; external: boolean }>;
    processes: Array<{ key: string; count: number }>;
    eventIds: Array<{ key: string; count: number }>;
  };
  volume: { recent: number; average: number; ratio: number | null; baselineDays: number };
  findings: Array<Omit<Finding, 'id' | 'status' | 'createdAt' | 'updatedAt'>>;
}

export interface Incident {
  id: string;
  number: number;
  title: string;
  host: string | null;
  severity: Severity;
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  description: string;
  eventRefs: Array<{ index: string; id: string; description?: string; timestamp?: string }>;
  ruleIds: string[];
  eventIds: string[];
  checks: string[];
  findingIds: string[];
  createdAt: string;
  updatedAt: string;
  notes?: number;
  timeline?: Array<{ id: number; text: string; kind: 'note' | 'system'; createdAt: string }>;
}

export interface EventMapData {
  hours: number;
  minLevel: number;
  nodes: Array<{ id: string; kind: 'host' | 'rule' | 'mitre'; label: string; count: number; maxLevel: number; ruleId?: string; mitreId?: string; tactic?: string }>;
  links: Array<{ source: string; target: string; count: number }>;
}

export interface ExposureData {
  hours: number;
  inbound: Array<{ ip: string; count: number; hosts: string[]; maxLevel: number; rule?: string; last?: string }>;
  outbound: Array<{ ip: string; ports: number[]; hosts: string[]; processes: string[]; connections: number }>;
  listening: Array<{ host: string; ports: Array<{ port: number; protocol: string; process?: string }> }>;
  note: string;
}

export interface HealthData {
  indexer: {
    status: string;
    error?: string;
    nodes?: number;
    activeShards?: number;
    unassigned: number;
    unassignedReplicas: number;
    explanation?: string;
    nodeStats: Array<{ name: string; heapPercent?: number; cpuPercent?: number; load?: number; memPercent?: number; diskTotal?: number; diskFree?: number }>;
    indexGroups: Array<{ name: string; count: number; docs: number; bytes: number }>;
  };
  ingest: Array<{ time: number; count: number }>;
  manager: { version?: string; connection?: Fleet['connection']; daemons: Array<{ name: string; state: string }>; logs: Array<{ component: string; error: number; warning: number; info: number }> } | null;
  containers: Array<{ name: string; status: string; image: string }> | null;
}

async function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/wazuh/soc${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const socOps = {
  scan: (host: string, hours: number) => send<ScanResult>('/scan', 'POST', { host, hours }),
  scans: (host?: string) => get<ScanSummary[]>(`/scans${qs({ host })}`),
  getScan: (id: string) => get<ScanResult>(`/scans/${encodeURIComponent(id)}`),
  baseline: (host: string, days: number) => get<Baseline>(`/baseline/${encodeURIComponent(host)}${qs({ days })}`),
  storeBaseline: (host: string, days: number) => send<{ created: number; updated: number }>(`/baseline/${encodeURIComponent(host)}/findings`, 'POST', { days }),
  findings: (filters: { host?: string; status?: string; severity?: string; category?: string }) => get<Finding[]>(`/findings${qs(filters)}`),
  setFindingStatus: (id: string, status: Finding['status']) => send<{ id: string; status: string }>(`/findings/${encodeURIComponent(id)}`, 'PUT', { status }),
  incidents: (filters: { status?: string; host?: string }) => get<Incident[]>(`/incidents${qs(filters)}`),
  incident: (id: string) => get<Incident>(`/incidents/${encodeURIComponent(id)}`),
  createIncident: (input: Partial<Incident>) => send<Incident>('/incidents', 'POST', input),
  updateIncident: (id: string, input: Partial<Incident>) => send<Incident>(`/incidents/${encodeURIComponent(id)}`, 'PUT', input),
  addNote: (id: string, text: string) => send<Incident>(`/incidents/${encodeURIComponent(id)}/notes`, 'POST', { text }),
  deleteIncident: (id: string) => send<{ deleted: boolean }>(`/incidents/${encodeURIComponent(id)}`, 'DELETE'),
  eventMap: (hours: number, minLevel: number) => get<EventMapData>(`/event-map${qs({ hours, minLevel })}`),
  exposure: (hours: number) => get<ExposureData>(`/exposure${qs({ hours })}`),
  health: () => get<HealthData>('/health'),
  analyzeScan: (id: string, web: boolean) => send<Explanation>(`/scans/${encodeURIComponent(id)}/analyze`, 'POST', { web }),
};

/* ---------- investigation ---------- */

export interface InvestigationFilter {
  q: string;
  hours: number;
  from?: string;
  to?: string;
  minLevel?: number;
  maxLevel?: number;
}

export interface EventHost {
  name: string;
  count: number;
  serious: number;
  maxLevel: number;
  last?: string;
  status?: string;
  ip?: string;
  os?: string;
  platform?: string;
}

export interface ClaudeStatus {
  available: boolean;
  loggedIn: boolean;
  cli?: string;
  version?: string;
  hint?: string;
}

export interface Explanation {
  text: string;
  model?: string;
  costUsd?: number;
  durationMs?: number;
  createdAt: string;
  cached?: boolean;
  web?: boolean;
}

export const investigationApi = {
  events: (filter: InvestigationFilter, limit: number, after?: unknown[] | null) =>
    get<SearchResult>(`/search${qs({ q: filter.q, hours: filter.hours, from: filter.from, to: filter.to, minLevel: filter.minLevel, maxLevel: filter.maxLevel, order: 'desc', limit, after: after ? JSON.stringify(after) : undefined })}`),
  hosts: (filter: InvestigationFilter) => get<{ total: number; hosts: EventHost[] }>(`/event-hosts${qs({ q: filter.q, hours: filter.hours, from: filter.from, to: filter.to, minLevel: filter.minLevel, maxLevel: filter.maxLevel })}`),
  raw: (index: string, id: string) => fetch(`${API_CONFIG.baseURL}/wazuh/events/${encodeURIComponent(index)}/${encodeURIComponent(id)}`).then(async (response) => {
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
    return data as { raw: Record<string, any> };
  }),
  claudeStatus: () => get<ClaudeStatus>('/explain/status'),
  explain: (index: string, id: string, refresh = false, web = false) => send<Explanation>('/explain', 'POST', { index, id, refresh, web }),
  ask: (index: string, id: string, history: Array<{ role: 'user' | 'assistant'; text: string }>, question: string, web = false) => send<Explanation>('/explain/ask', 'POST', { index, id, history, question, web }),
};
