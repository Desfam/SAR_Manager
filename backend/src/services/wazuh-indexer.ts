// Read-only access to Wazuh alerts in the Wazuh indexer (OpenSearch): POST /wazuh-alerts-*/_search.
// Credentials stay in the backend (.env); the UI only sees normalized events and aggregations.
import { existsSync, readFileSync } from 'fs';
import * as path from 'path';
import { Agent, fetch } from 'undici';

const CA_FILE = path.resolve(process.cwd(), '..', 'certs', 'wazuh-root-ca.pem');

export function config() {
  const url = (process.env.WAZUH_INDEXER_URL ?? '').replace(/\/$/, '');
  const username = process.env.WAZUH_INDEXER_USERNAME ?? '';
  const password = process.env.WAZUH_INDEXER_PASSWORD ?? '';
  const indexPattern = process.env.WAZUH_INDEX_PATTERN || 'wazuh-alerts-*';
  return { url, username, password, indexPattern, configured: !!(url && username && password) };
}

// The indexer certificate is issued by Wazuh's own CA for "wazuh.indexer": verify against that CA
// and that name instead of switching verification off.
let dispatcher: Agent | null = null;
function tlsDispatcher() {
  if (dispatcher) return dispatcher;
  const ca = existsSync(CA_FILE) ? readFileSync(CA_FILE) : undefined;
  dispatcher = new Agent({
    connect: ca
      ? { ca, servername: process.env.WAZUH_INDEXER_TLS_NAME || 'wazuh.indexer' }
      : { rejectUnauthorized: process.env.WAZUH_INDEXER_VERIFY_TLS !== 'false' },
  });
  return dispatcher;
}

export async function indexer<T>(pathName: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const { url, username, password, configured } = config();
  if (!configured) throw Object.assign(new Error('Wazuh-Indexer nicht konfiguriert (WAZUH_INDEXER_URL/USERNAME/PASSWORD in backend/.env)'), { status: 503 });
  const response = await fetch(`${url}${pathName}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      Authorization: `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    dispatcher: tlsDispatcher(),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data: any = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = data?.error?.root_cause?.[0]?.reason ?? data?.error?.reason ?? response.statusText;
    throw Object.assign(new Error(response.status === 401 ? 'Wazuh-Indexer: Benutzername oder Passwort falsch' : `Wazuh-Indexer ${response.status}: ${reason}`), { status: 502 });
  }
  return data as T;
}

/* ---------- normalization ---------- */

const get = (object: any, key: string) => key.split('.').reduce((current, part) => (current && typeof current === 'object' ? current[part] : undefined), object);
const list = (value: unknown) => (Array.isArray(value) ? value.map(String) : value ? [String(value)] : []);

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
  /** The account the event is about (Windows target/subject user, Linux dstuser/srcuser/user) */
  user?: string;
  /** Windows event ID or empty */
  eventId?: string;
  /** Linux program (predecoder) or Windows process image */
  program?: string;
  logonType?: string;
  platform: 'windows' | 'linux' | 'other';
}

export function normalize(hit: any): WazuhEvent {
  const source = hit._source ?? {};
  return {
    id: hit._id,
    index: hit._index,
    timestamp: get(source, 'timestamp') ?? get(source, '@timestamp'),
    agent: { id: get(source, 'agent.id'), name: get(source, 'agent.name'), ip: get(source, 'agent.ip'), group: get(source, 'agent.labels.agent_group') },
    rule: {
      id: get(source, 'rule.id'),
      level: Number(get(source, 'rule.level') ?? 0),
      description: get(source, 'rule.description'),
      groups: list(get(source, 'rule.groups')),
      mitre: { ids: list(get(source, 'rule.mitre.id')), tactics: list(get(source, 'rule.mitre.tactic')), techniques: list(get(source, 'rule.mitre.technique')) },
      firedtimes: get(source, 'rule.firedtimes'),
    },
    decoder: get(source, 'decoder.name'),
    location: get(source, 'location'),
    fullLog: typeof get(source, 'full_log') === 'string' ? String(get(source, 'full_log')).slice(0, 4000) : undefined,
    windows: get(source, 'data.win.system.eventID')
      ? {
          eventId: String(get(source, 'data.win.system.eventID')),
          user: get(source, 'data.win.eventdata.targetUserName') ?? get(source, 'data.win.eventdata.subjectUserName'),
          channel: get(source, 'data.win.system.channel'),
        }
      : undefined,
    sourceIp: get(source, 'data.srcip') ?? get(source, 'data.src_ip') ?? get(source, 'data.win.eventdata.ipAddress'),
    sourceUser: get(source, 'data.srcuser') ?? get(source, 'data.win.eventdata.subjectUserName'),
    destinationUser: get(source, 'data.dstuser') ?? get(source, 'data.win.eventdata.targetUserName'),
    user:
      get(source, 'data.win.eventdata.targetUserName') ??
      get(source, 'data.win.eventdata.subjectUserName') ??
      get(source, 'data.dstuser') ??
      get(source, 'data.srcuser') ??
      get(source, 'data.user') ??
      undefined,
    eventId: get(source, 'data.win.system.eventID') ? String(get(source, 'data.win.system.eventID')) : undefined,
    program: get(source, 'predecoder.program_name') ?? get(source, 'data.win.eventdata.newProcessName') ?? get(source, 'data.win.eventdata.imagePath') ?? undefined,
    logonType: get(source, 'data.win.eventdata.logonType') ?? undefined,
    platform: get(source, 'data.win.system') || get(source, 'location') === 'EventChannel' ? 'windows' : get(source, 'predecoder') || /^\/var\/log|journald|^\/\w/.test(String(get(source, 'location') ?? '')) ? 'linux' : 'other',
    vulnerability: get(source, 'data.vulnerability.cve')
      ? {
          cve: get(source, 'data.vulnerability.cve'),
          severity: get(source, 'data.vulnerability.severity'),
          package: get(source, 'data.vulnerability.package.name'),
          version: get(source, 'data.vulnerability.package.version'),
          condition: get(source, 'data.vulnerability.package.condition'),
        }
      : undefined,
  };
}

/* ---------- queries ---------- */

export interface EventFilters {
  hours: number;
  agent?: string;
  agentIp?: string;
  minLevel?: number;
  maxLevel?: number;
  group?: string;
  ruleId?: string;
  srcip?: string;
  q?: string;
}

export function buildQuery(filters: EventFilters) {
  const filter: unknown[] = [{ range: { timestamp: { gte: `now-${filters.hours}h`, lte: 'now' } } }];
  if (filters.agent) filter.push({ term: { 'agent.name': filters.agent } });
  if (filters.agentIp) filter.push({ term: { 'agent.ip': filters.agentIp } });
  if (filters.minLevel !== undefined || filters.maxLevel !== undefined) filter.push({ range: { 'rule.level': { ...(filters.minLevel !== undefined ? { gte: filters.minLevel } : {}), ...(filters.maxLevel !== undefined ? { lte: filters.maxLevel } : {}) } } });
  if (filters.group) filter.push({ term: { 'rule.groups': filters.group } });
  if (filters.ruleId) filter.push({ term: { 'rule.id': filters.ruleId } });
  if (filters.srcip) filter.push({ term: { 'data.srcip': filters.srcip } });
  const must = filters.q
    ? [{ simple_query_string: { query: filters.q, fields: ['rule.description', 'full_log', 'agent.name', 'data.srcip', 'data.srcuser', 'data.dstuser', 'data.win.eventdata.targetUserName'], default_operator: 'and', lenient: true } }]
    : [];
  return { bool: { filter, must } };
}

/** Bucket size for the timeline: about 48–120 bars for any range */
export function interval(hours: number) {
  if (hours <= 1) return '1m';
  if (hours <= 6) return '5m';
  if (hours <= 24) return '30m';
  if (hours <= 24 * 7) return '3h';
  if (hours <= 24 * 31) return '12h';
  return '7d';
}

export const SEVERITY_RANGES = [
  { key: 'low', to: 7 },
  { key: 'medium', from: 7, to: 12 },
  { key: 'high', from: 12, to: 15 },
  { key: 'critical', from: 15 },
];

export async function wazuhStatus() {
  const { url, indexPattern, configured } = config();
  if (!configured) return { configured: false };
  const started = Date.now();
  const info = await indexer<any>('/', undefined, 10_000);
  const indices = await indexer<any[]>(`/_cat/indices/${indexPattern}?format=json&h=index,docs.count,store.size`, undefined, 10_000).catch(() => []);
  return {
    configured: true,
    url,
    cluster: info?.cluster_name,
    version: info?.version?.number,
    latencyMs: Date.now() - started,
    tls: existsSync(CA_FILE) ? 'verified (Wazuh-CA)' : 'unverified',
    indices: indices.length,
    documents: indices.reduce((sum, entry) => sum + Number(entry['docs.count'] ?? 0), 0),
  };
}

export async function wazuhSummary(filters: EventFilters) {
  const { indexPattern } = config();
  const data = await indexer<any>(`/${indexPattern}/_search`, {
    size: 0,
    track_total_hits: true,
    query: buildQuery(filters),
    aggs: {
      severity: { range: { field: 'rule.level', keyed: true, ranges: SEVERITY_RANGES } },
      timeline: {
        date_histogram: { field: 'timestamp', fixed_interval: interval(filters.hours), min_doc_count: 0, extended_bounds: { min: `now-${filters.hours}h`, max: 'now' } },
        aggs: { severity: { range: { field: 'rule.level', keyed: true, ranges: SEVERITY_RANGES } } },
      },
      agents: {
        terms: { field: 'agent.name', size: 200 },
        aggs: {
          ip: { terms: { field: 'agent.ip', size: 1 } },
          id: { terms: { field: 'agent.id', size: 1 } },
          maxLevel: { max: { field: 'rule.level' } },
          serious: { filter: { range: { 'rule.level': { gte: 7 } } } },
          last: { max: { field: 'timestamp' } },
        },
      },
      rules: {
        terms: { field: 'rule.id', size: 12, order: { maxLevel: 'desc' } },
        aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } }, agents: { cardinality: { field: 'agent.name' } } },
      },
      frequentRules: {
        terms: { field: 'rule.id', size: 10 },
        aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } },
      },
      groups: { terms: { field: 'rule.groups', size: 16 } },
      tactics: { terms: { field: 'rule.mitre.tactic', size: 12 } },
      sources: { terms: { field: 'data.srcip', size: 10 }, aggs: { maxLevel: { max: { field: 'rule.level' } } } },
    },
  }, 60_000);

  const aggs = data.aggregations ?? {};
  const severity = (buckets: any) => ({
    low: buckets?.low?.doc_count ?? 0,
    medium: buckets?.medium?.doc_count ?? 0,
    high: buckets?.high?.doc_count ?? 0,
    critical: buckets?.critical?.doc_count ?? 0,
  });
  const rule = (bucket: any) => ({ id: String(bucket.key), description: bucket.description?.buckets?.[0]?.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0, agents: bucket.agents?.value });
  return {
    total: data.hits?.total?.value ?? 0,
    interval: interval(filters.hours),
    severity: severity(aggs.severity?.buckets),
    timeline: (aggs.timeline?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), total: bucket.doc_count, ...severity(bucket.severity?.buckets) })),
    agents: (aggs.agents?.buckets ?? []).map((bucket: any) => ({
      name: String(bucket.key),
      id: bucket.id?.buckets?.[0]?.key,
      ip: bucket.ip?.buckets?.[0]?.key,
      count: bucket.doc_count,
      serious: bucket.serious?.doc_count ?? 0,
      maxLevel: bucket.maxLevel?.value ?? 0,
      lastSeen: bucket.last?.value_as_string,
    })),
    topRules: (aggs.rules?.buckets ?? []).map(rule),
    frequentRules: (aggs.frequentRules?.buckets ?? []).map(rule),
    groups: (aggs.groups?.buckets ?? []).map((bucket: any) => ({ name: String(bucket.key), count: bucket.doc_count })),
    tactics: (aggs.tactics?.buckets ?? []).map((bucket: any) => ({ name: String(bucket.key), count: bucket.doc_count })),
    sources: (aggs.sources?.buckets ?? []).map((bucket: any) => ({ ip: String(bucket.key), count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })),
  };
}

export async function wazuhEvents(filters: EventFilters, limit: number, searchAfter?: unknown[]) {
  const { indexPattern } = config();
  const data = await indexer<any>(`/${indexPattern}/_search`, {
    size: limit,
    track_total_hits: 100_000,
    sort: [{ timestamp: { order: 'desc', unmapped_type: 'boolean' } }, { _id: { order: 'desc' } }],
    ...(searchAfter ? { search_after: searchAfter } : {}),
    query: buildQuery(filters),
  });
  const hits: any[] = data.hits?.hits ?? [];
  return {
    total: data.hits?.total?.value ?? 0,
    totalExact: data.hits?.total?.relation !== 'gte',
    events: hits.map(normalize),
    next: hits.length === limit ? hits[hits.length - 1].sort : null,
  };
}

/** One event with its raw document (for the detail view) */
export async function wazuhEvent(index: string, id: string) {
  if (!/^[\w.-]+$/.test(index) || !index.startsWith('wazuh-alerts')) throw Object.assign(new Error('invalid index'), { status: 400 });
  const data = await indexer<any>(`/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`);
  return { event: normalize(data), raw: data._source };
}
