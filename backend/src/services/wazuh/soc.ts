// SOC views on top of the Wazuh indexer (+ manager API when configured). Read-only.
import * as tls from 'tls';
import { config as indexerConfig, indexer, normalize, interval, SEVERITY_RANGES, type WazuhEvent } from '../wazuh-indexer.js';
import { assessEvent, type Assessment } from './assess.js';
import { managerAgents, managerConfigured, managerInfo, type ManagerAgent } from './manager.js';

const ALERTS = () => indexerConfig().indexPattern;
const VULNS = 'wazuh-states-vulnerabilities-*';
const INVENTORY = (kind: string) => `wazuh-states-inventory-${kind}-*`;

const timeRange = (hours: number, field = 'timestamp') => ({ range: { [field]: { gte: `now-${hours}h`, lte: 'now' } } });
const USER_FIELDS = ['data.win.eventdata.targetUserName', 'data.win.eventdata.subjectUserName', 'data.dstuser', 'data.srcuser', 'data.user'];
const IP_FIELDS = ['data.srcip', 'data.dstip', 'agent.ip', 'data.win.eventdata.ipAddress'];
const anyTerm = (fields: string[], value: string) => ({ bool: { should: fields.map((field) => ({ term: { [field]: value } })), minimum_should_match: 1 } });

/* ---------- query language: host:dc02 user:Administrator eid:4625 rule:60122 ip:1.2.3.4 level:>=7 … ---------- */

export function parseQuery(input: string) {
  const filter: unknown[] = [];
  const free: string[] = [];
  const tokens = input.match(/(\w+):("[^"]*"|\S+)|"[^"]*"|\S+/g) ?? [];
  for (const token of tokens) {
    const match = /^(\w+):(.+)$/.exec(token);
    if (!match) {
      free.push(token);
      continue;
    }
    const key = match[1].toLowerCase();
    const value = match[2].replace(/^"|"$/g, '');
    switch (key) {
      case 'host':
      case 'agent':
        filter.push(value.includes('*') ? { wildcard: { 'agent.name': { value, case_insensitive: true } } } : { term: { 'agent.name': value } });
        break;
      case 'user':
        filter.push(anyTerm(USER_FIELDS, value));
        break;
      case 'eid':
      case 'event':
        filter.push({ term: { 'data.win.system.eventID': value } });
        break;
      case 'rule':
        filter.push({ term: { 'rule.id': value } });
        break;
      case 'ip':
        filter.push(anyTerm(IP_FIELDS, value));
        break;
      case 'level': {
        const level = /^(>=|<=|>|<)?(\d+)$/.exec(value);
        if (level) {
          const op = level[1] ?? '';
          const n = Number(level[2]);
          filter.push({ range: { 'rule.level': op === '>=' ? { gte: n } : op === '>' ? { gt: n } : op === '<=' ? { lte: n } : op === '<' ? { lt: n } : { gte: n, lte: n } } });
        }
        break;
      }
      case 'group':
        filter.push({ term: { 'rule.groups': value } });
        break;
      case 'decoder':
        filter.push({ term: { 'decoder.name': value } });
        break;
      case 'location':
        filter.push({ wildcard: { location: { value: `*${value}*`, case_insensitive: true } } });
        break;
      case 'process':
      case 'program':
        filter.push({ bool: { should: ['data.win.eventdata.newProcessName', 'data.win.eventdata.imagePath', 'predecoder.program_name'].map((field) => ({ wildcard: { [field]: { value: `*${value}*`, case_insensitive: true } } })), minimum_should_match: 1 } });
        break;
      case 'mitre':
        filter.push({ bool: { should: [{ term: { 'rule.mitre.id': value } }, { term: { 'rule.mitre.tactic': value } }, { term: { 'rule.mitre.technique': value } }], minimum_should_match: 1 } });
        break;
      case 'cve':
        filter.push({ term: { 'data.vulnerability.cve': value } });
        break;
      default:
        free.push(token);
    }
  }
  const must = free.length
    ? [{ simple_query_string: { query: free.join(' '), fields: ['rule.description', 'full_log', 'agent.name', 'data.srcip', ...USER_FIELDS, 'data.win.eventdata.commandLine'], default_operator: 'and', lenient: true } }]
    : [];
  return { filter, must };
}

/* ---------- assessments with frequency context ---------- */

export interface AssessedEvent extends WazuhEvent {
  assessment: Assessment;
}

async function assessAll(events: WazuhEvent[], hours: number): Promise<AssessedEvent[]> {
  if (!events.length) return [];
  const hosts = [...new Set(events.map((event) => event.agent.name).filter(Boolean))] as string[];
  const rules = [...new Set(events.map((event) => event.rule.id).filter(Boolean))] as string[];
  const data = await indexer<any>(`/${ALERTS()}/_search`, {
    size: 0,
    query: { bool: { filter: [timeRange(hours), { terms: { 'agent.name': hosts } }, { terms: { 'rule.id': rules } }] } },
    aggs: { hosts: { terms: { field: 'agent.name', size: hosts.length }, aggs: { rules: { terms: { field: 'rule.id', size: rules.length } } } } },
  }).catch(() => null);
  const counts = new Map<string, number>();
  data?.aggregations?.hosts?.buckets?.forEach((host: any) => host.rules.buckets.forEach((rule: any) => counts.set(`${host.key}|${rule.key}`, rule.doc_count)));
  return events.map((event) => ({ ...event, assessment: assessEvent(event, { ruleCountOnHost: counts.get(`${event.agent.name}|${event.rule.id}`) }) }));
}

/* ---------- search (Investigation, Timeline) ---------- */

export async function searchEvents(options: { q: string; hours: number; limit: number; after?: unknown[]; order: 'asc' | 'desc'; minLevel?: number; maxLevel?: number; from?: string; to?: string }) {
  const parsed = parseQuery(options.q);
  // an explicit window (Timeline) wins over "last N hours"
  const window = options.from && options.to ? { range: { timestamp: { gte: options.from, lte: options.to } } } : timeRange(options.hours);
  const filter = [window, ...parsed.filter];
  if (options.minLevel || options.maxLevel != null) filter.push({ range: { 'rule.level': { ...(options.minLevel ? { gte: options.minLevel } : {}), ...(options.maxLevel != null ? { lte: options.maxLevel } : {}) } } });
  const data = await indexer<any>(`/${ALERTS()}/_search`, {
    size: options.limit,
    track_total_hits: 100_000,
    sort: [{ timestamp: { order: options.order, unmapped_type: 'boolean' } }, { _id: { order: options.order } }],
    ...(options.after ? { search_after: options.after } : {}),
    query: { bool: { filter, must: parsed.must } },
    aggs: {
      hosts: { terms: { field: 'agent.name', size: 8 } },
      rules: { terms: { field: 'rule.id', size: 8 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } } } },
      maxLevel: { max: { field: 'rule.level' } },
      first: { min: { field: 'timestamp' } },
      last: { max: { field: 'timestamp' } },
    },
  });
  const hits: any[] = data.hits?.hits ?? [];
  const aggs = data.aggregations ?? {};
  return {
    total: data.hits?.total?.value ?? 0,
    totalExact: data.hits?.total?.relation !== 'gte',
    events: await assessAll(hits.map(normalize), options.hours),
    next: hits.length === options.limit ? hits[hits.length - 1].sort : null,
    facets: {
      hosts: (aggs.hosts?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
      rules: (aggs.rules?.buckets ?? []).map((bucket: any) => ({ id: bucket.key, description: bucket.description?.buckets?.[0]?.key, count: bucket.doc_count })),
      maxLevel: aggs.maxLevel?.value ?? null,
      first: aggs.first?.value_as_string,
      last: aggs.last?.value_as_string,
    },
  };
}

/** Hosts that have events in a window / level range, merged with the agent status from the manager */
export async function eventHosts(options: { q: string; hours: number; minLevel?: number; maxLevel?: number; from?: string; to?: string }) {
  const parsed = parseQuery(options.q);
  const window = options.from && options.to ? { range: { timestamp: { gte: options.from, lte: options.to } } } : timeRange(options.hours);
  const filter = [window, ...parsed.filter];
  if (options.minLevel || options.maxLevel != null) filter.push({ range: { 'rule.level': { ...(options.minLevel ? { gte: options.minLevel } : {}), ...(options.maxLevel != null ? { lte: options.maxLevel } : {}) } } });
  const [data, agents] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter, must: parsed.must } },
      aggs: { hosts: { terms: { field: 'agent.name', size: 1000 }, aggs: { maxLevel: { max: { field: 'rule.level' } }, serious: { filter: { range: { 'rule.level': { gte: 7 } } } }, last: { max: { field: 'timestamp' } } } } },
    }),
    managerConfigured() ? managerAgents().catch(() => [] as ManagerAgent[]) : Promise.resolve([] as ManagerAgent[]),
  ]);
  const byName = new Map(agents.map((agent) => [agent.name, agent]));
  return {
    total: data.hits?.total?.value ?? 0,
    hosts: (data.aggregations?.hosts?.buckets ?? []).map((bucket: any) => {
      const agent = byName.get(bucket.key);
      return { name: bucket.key, count: bucket.doc_count, serious: bucket.serious?.doc_count ?? 0, maxLevel: bucket.maxLevel?.value ?? 0, last: bucket.last?.value_as_string, status: agent?.status, ip: agent?.ip, os: agent?.os?.name, platform: agent?.os?.platform };
    }),
  };
}

/* ---------- dashboard ---------- */

export async function dashboard(hours: number, minLevel?: number) {
  const [overview, stream, fleet] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [timeRange(hours)] } },
      aggs: {
        severity: { range: { field: 'rule.level', keyed: true, ranges: SEVERITY_RANGES } },
        hosts: { cardinality: { field: 'agent.name' } },
        last: { max: { field: 'timestamp' } },
        timeline: { date_histogram: { field: 'timestamp', fixed_interval: interval(hours), min_doc_count: 0, extended_bounds: { min: `now-${hours}h`, max: 'now' } }, aggs: { serious: { filter: { range: { 'rule.level': { gte: 7 } } } } } },
        risky: {
          terms: { field: 'agent.name', size: 8, order: [{ maxLevel: 'desc' }, { serious: 'desc' }] },
          aggs: { maxLevel: { max: { field: 'rule.level' } }, serious: { filter: { range: { 'rule.level': { gte: 7 } } } } },
        },
      },
    }),
    searchEvents({ q: '', hours, limit: 150, order: 'desc', minLevel }),
    managerConfigured() ? managerInfo().catch(() => null) : Promise.resolve(null),
  ]);
  const aggs = overview.aggregations ?? {};
  const verdicts: Record<string, number> = {};
  stream.events.forEach((event) => (verdicts[event.assessment.verdict] = (verdicts[event.assessment.verdict] ?? 0) + 1));
  return {
    total: overview.hits?.total?.value ?? 0,
    severity: {
      low: aggs.severity?.buckets?.low?.doc_count ?? 0,
      medium: aggs.severity?.buckets?.medium?.doc_count ?? 0,
      high: aggs.severity?.buckets?.high?.doc_count ?? 0,
      critical: aggs.severity?.buckets?.critical?.doc_count ?? 0,
    },
    activeHosts: aggs.hosts?.value ?? 0,
    lastEvent: aggs.last?.value_as_string,
    timeline: (aggs.timeline?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), total: bucket.doc_count, serious: bucket.serious?.doc_count ?? 0 })),
    verdicts,
    stream: stream.events,
    fleet: {
      manager: fleet ? { version: fleet.version, active: fleet.connection?.active ?? 0, disconnected: fleet.connection?.disconnected ?? 0, neverConnected: fleet.connection?.never_connected ?? 0, total: fleet.connection?.total ?? 0 } : null,
      riskyHosts: (aggs.risky?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0, serious: bucket.serious?.doc_count ?? 0 })),
    },
  };
}

/* ---------- event context ---------- */

export async function eventContext(index: string, id: string) {
  if (!/^[\w.-]+$/.test(index) || !index.startsWith('wazuh-alerts')) throw Object.assign(new Error('invalid index'), { status: 400 });
  const doc = await indexer<any>(`/${encodeURIComponent(index)}/_doc/${encodeURIComponent(id)}`);
  const event = normalize(doc);
  const at = new Date(event.timestamp).getTime();
  const window = (minutes: number) => ({ range: { timestamp: { gte: new Date(at - minutes * 60_000).toISOString(), lte: new Date(at + minutes * 60_000).toISOString() } } });
  const query = (filter: unknown[], size: number, sort: 'asc' | 'desc' = 'desc') =>
    indexer<any>(`/${ALERTS()}/_search`, { size, sort: [{ timestamp: { order: sort } }], query: { bool: { filter, must_not: [{ ids: { values: [id] } }] } } }).then((data) => (data.hits?.hits ?? []).map(normalize) as WazuhEvent[]);

  const [sameHost, sameUser, sameRule] = await Promise.all([
    event.agent.name ? query([window(30), { term: { 'agent.name': event.agent.name } }], 40, 'asc') : Promise.resolve([]),
    event.user ? query([timeRange(24), anyTerm(USER_FIELDS, event.user)], 20) : Promise.resolve([]),
    event.rule.id
      ? indexer<any>(`/${ALERTS()}/_search`, { size: 0, track_total_hits: true, query: { bool: { filter: [timeRange(24), { term: { 'rule.id': event.rule.id } }] } }, aggs: { hosts: { terms: { field: 'agent.name', size: 10 } } } })
      : Promise.resolve(null),
  ]);
  const ruleOnHost = sameRule?.aggregations?.hosts?.buckets?.find((bucket: any) => bucket.key === event.agent.name)?.doc_count;
  return {
    event: { ...event, assessment: assessEvent(event, { ruleCountOnHost: ruleOnHost, ruleCountTotal: sameRule?.hits?.total?.value }) },
    raw: doc._source,
    related: {
      sameHost: sameHost.map((entry) => ({ ...entry, offsetSeconds: Math.round((new Date(entry.timestamp).getTime() - at) / 1000) })),
      sameUser,
      sameRule: { total: sameRule?.hits?.total?.value ?? 0, hosts: (sameRule?.aggregations?.hosts?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })) },
    },
  };
}

/* ---------- inventory (system info per agent) ---------- */

let inventoryCache: { at: number; byName: Map<string, any> } | null = null;
async function inventorySystems() {
  if (inventoryCache && Date.now() - inventoryCache.at < 5 * 60_000) return inventoryCache.byName;
  const data = await indexer<any>(`/${INVENTORY('system')}/_search`, { size: 1000, _source: ['agent', 'host'] }).catch(() => null);
  const byName = new Map<string, any>();
  (data?.hits?.hits ?? []).forEach((hit: any) => hit._source?.agent?.name && byName.set(hit._source.agent.name, hit._source));
  inventoryCache = { at: Date.now(), byName };
  return byName;
}

/* ---------- hosts ---------- */

export async function hosts(hours: number) {
  const [agents, events, vulns, inventory] = await Promise.all([
    managerConfigured() ? managerAgents().catch(() => [] as ManagerAgent[]) : Promise.resolve([] as ManagerAgent[]),
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      query: { bool: { filter: [timeRange(hours)] } },
      aggs: { hosts: { terms: { field: 'agent.name', size: 1000 }, aggs: { maxLevel: { max: { field: 'rule.level' } }, serious: { filter: { range: { 'rule.level': { gte: 7 } } } }, last: { max: { field: 'timestamp' } }, ip: { terms: { field: 'agent.ip', size: 1 } }, id: { terms: { field: 'agent.id', size: 1 } } } } },
    }),
    indexer<any>(`/${VULNS}/_search`, {
      size: 0,
      aggs: { hosts: { terms: { field: 'agent.name', size: 1000 }, aggs: { critical: { filter: { term: { 'vulnerability.severity': 'Critical' } } }, high: { filter: { term: { 'vulnerability.severity': 'High' } } } } } },
    }).catch(() => null),
    inventorySystems(),
  ]);
  const map = new Map<string, any>();
  agents.forEach((agent) => map.set(agent.name, { name: agent.name, id: agent.id, ip: agent.ip, status: agent.status, os: agent.os?.name, platform: agent.os?.platform, version: agent.version, groups: agent.group ?? [], lastKeepAlive: agent.lastKeepAlive }));
  (events.aggregations?.hosts?.buckets ?? []).forEach((bucket: any) => {
    const entry = map.get(bucket.key) ?? { name: bucket.key, id: bucket.id?.buckets?.[0]?.key, ip: bucket.ip?.buckets?.[0]?.key, status: managerConfigured() ? 'unknown' : 'active' };
    Object.assign(entry, { events: bucket.doc_count, serious: bucket.serious?.doc_count ?? 0, maxLevel: bucket.maxLevel?.value ?? 0, lastEvent: bucket.last?.value_as_string });
    map.set(bucket.key, entry);
  });
  (vulns?.aggregations?.hosts?.buckets ?? []).forEach((bucket: any) => {
    const entry = map.get(bucket.key);
    if (entry) Object.assign(entry, { vulnerabilities: bucket.doc_count, critical: bucket.critical?.doc_count ?? 0, high: bucket.high?.doc_count ?? 0 });
  });
  map.forEach((entry, name) => {
    const system = inventory.get(name);
    if (system) {
      entry.os = entry.os ?? system.host?.os?.name;
      entry.osVersion = system.host?.os?.version;
      entry.platform = entry.platform ?? system.host?.os?.platform;
      entry.hostname = system.host?.hostname;
      entry.architecture = system.host?.architecture;
    }
    // simple risk score: severity of events, critical CVEs, offline
    entry.risk = Math.min(100, Math.round((entry.maxLevel ?? 0) * 4 + Math.min(entry.serious ?? 0, 50) * 0.6 + Math.min(entry.critical ?? 0, 100) * 0.25 + (entry.status === 'disconnected' ? 5 : 0)));
  });
  return [...map.values()].filter((entry) => entry.name !== 'wazuh.manager' || entry.events).sort((a, b) => b.risk - a.risk);
}

export async function hostContext(name: string, hours: number) {
  const [list, summary, ports, hardware, recent] = await Promise.all([
    hosts(hours),
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      query: { bool: { filter: [timeRange(hours), { term: { 'agent.name': name } }] } },
      aggs: {
        rules: { terms: { field: 'rule.id', size: 10, order: { maxLevel: 'desc' } }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } } },
        users: { terms: { field: 'data.win.eventdata.targetUserName', size: 8 } },
        linuxUsers: { terms: { field: 'data.dstuser', size: 8 } },
        timeline: { date_histogram: { field: 'timestamp', fixed_interval: interval(hours), min_doc_count: 0, extended_bounds: { min: `now-${hours}h`, max: 'now' } } },
      },
    }),
    indexer<any>(`/${INVENTORY('ports')}/_search`, { size: 50, query: { bool: { filter: [{ term: { 'agent.name': name } }, { term: { 'interface.state': 'listening' } }] } } }).catch(() => null),
    indexer<any>(`/${INVENTORY('hardware')}/_search`, { size: 1, query: { term: { 'agent.name': name } } }).catch(() => null),
    searchEvents({ q: `host:"${name}"`, hours, limit: 25, order: 'desc' }),
  ]);
  const aggs = summary.aggregations ?? {};
  const host = list.find((entry) => entry.name === name) ?? { name };
  return {
    host,
    hardware: hardware?.hits?.hits?.[0]?._source?.host ?? null,
    rules: (aggs.rules?.buckets ?? []).map((bucket: any) => ({ id: bucket.key, description: bucket.description?.buckets?.[0]?.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })),
    users: [...(aggs.users?.buckets ?? []), ...(aggs.linuxUsers?.buckets ?? [])].map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })).sort((a, b) => b.count - a.count).slice(0, 10),
    timeline: (aggs.timeline?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), total: bucket.doc_count })),
    ports: (ports?.hits?.hits ?? []).map((hit: any) => {
      const source = hit._source ?? {};
      return { protocol: source.network?.transport ?? source.network?.protocol, port: source.source?.port ?? source.local?.port, address: source.source?.ip ?? source.local?.ip, process: source.process?.name };
    }).filter((entry: any) => entry.port),
    recent: recent.events,
  };
}

/* ---------- user context ---------- */

export async function userContext(user: string, hours: number) {
  const filter = [timeRange(hours), anyTerm(USER_FIELDS, user)];
  const [data, recent] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter } },
      aggs: {
        hosts: { terms: { field: 'agent.name', size: 15 } },
        rules: { terms: { field: 'rule.id', size: 10 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } } },
        failed: { filter: { bool: { should: [{ terms: { 'rule.groups': ['authentication_failed', 'authentication_failures', 'invalid_login'] } }, { terms: { 'data.win.system.eventID': ['4625', '4771'] } }], minimum_should_match: 1 } } },
        success: { filter: { bool: { should: [{ term: { 'rule.groups': 'authentication_success' } }, { term: { 'data.win.system.eventID': '4624' } }], minimum_should_match: 1 } } },
        sources: { terms: { field: 'data.win.eventdata.ipAddress', size: 8 } },
        linuxSources: { terms: { field: 'data.srcip', size: 8 } },
        first: { min: { field: 'timestamp' } },
        last: { max: { field: 'timestamp' } },
      },
    }),
    searchEvents({ q: `user:"${user}"`, hours, limit: 20, order: 'desc' }),
  ]);
  const aggs = data.aggregations ?? {};
  return {
    user,
    total: data.hits?.total?.value ?? 0,
    failed: aggs.failed?.doc_count ?? 0,
    success: aggs.success?.doc_count ?? 0,
    first: aggs.first?.value_as_string,
    last: aggs.last?.value_as_string,
    hosts: (aggs.hosts?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
    rules: (aggs.rules?.buckets ?? []).map((bucket: any) => ({ id: bucket.key, description: bucket.description?.buckets?.[0]?.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })),
    sources: [...(aggs.sources?.buckets ?? []), ...(aggs.linuxSources?.buckets ?? [])].filter((bucket: any) => bucket.key && bucket.key !== '-').map((bucket: any) => ({ ip: bucket.key, count: bucket.doc_count })),
    recent: recent.events,
  };
}

/* ---------- Linux ---------- */

const LINUX_CATEGORIES: Record<string, unknown> = {
  authentication: { terms: { 'rule.groups': ['authentication_success', 'authentication_failed', 'authentication_failures', 'sshd', 'pam', 'invalid_login'] } },
  privilege: { terms: { 'rule.groups': ['sudo', 'su'] } },
  fim: { term: { 'rule.groups': 'syscheck' } },
  service: { terms: { 'rule.groups': ['systemd', 'service'] } },
  kernel: { term: { 'rule.groups': 'kernel' } },
  package: { terms: { 'rule.groups': ['dpkg', 'apt', 'yum', 'package', 'config_changed'] } },
  network: { terms: { 'rule.groups': ['firewall', 'iptables', 'ufw', 'connection_attempt'] } },
};

export async function linuxOverview(hours: number, category?: string) {
  const inventory = await inventorySystems();
  const linuxAgents = [...inventory.values()].filter((entry) => entry.host?.os?.platform && entry.host.os.platform !== 'windows').map((entry) => entry.agent.name as string);
  if (!linuxAgents.length) return { agents: [], categories: {}, total: 0, events: [], hosts: [], timeline: [], os: [], status: null };
  const filter: unknown[] = [timeRange(hours), { terms: { 'agent.name': linuxAgents } }];
  if (category && LINUX_CATEGORIES[category]) filter.push(LINUX_CATEGORIES[category]);
  const [data, recent] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [timeRange(hours), { terms: { 'agent.name': linuxAgents } }] } },
      aggs: {
        categories: { filters: { filters: LINUX_CATEGORIES, other_bucket_key: 'other' } },
        failedLogins: { filter: { terms: { 'rule.groups': ['authentication_failed', 'authentication_failures', 'invalid_login'] } }, aggs: { sources: { terms: { field: 'data.srcip', size: 8 } }, users: { terms: { field: 'data.dstuser', size: 8 } } } },
        hosts: { terms: { field: 'agent.name', size: 100 }, aggs: { maxLevel: { max: { field: 'rule.level' } }, categories: { filters: { filters: LINUX_CATEGORIES } } } },
        programs: { terms: { field: 'predecoder.program_name', size: 12 } },
        timeline: {
          date_histogram: { field: 'timestamp', fixed_interval: interval(hours), min_doc_count: 0, extended_bounds: { min: `now-${hours}h`, max: 'now' } },
          aggs: { failed: { filter: { terms: { 'rule.groups': ['authentication_failed', 'authentication_failures', 'invalid_login'] } } }, privilege: { filter: { terms: { 'rule.groups': ['sudo', 'su'] } } } },
        },
        success: { filter: { term: { 'rule.groups': 'authentication_success' } }, aggs: { sources: { terms: { field: 'data.srcip', size: 6 } }, users: { terms: { field: 'data.dstuser', size: 6 } } } },
        sudo: { filter: { terms: { 'rule.groups': ['sudo', 'su'] } }, aggs: { users: { terms: { field: 'data.srcuser', size: 6 } }, commands: { terms: { field: 'data.command', size: 6 } } } },
        fim: { filter: { term: { 'rule.groups': 'syscheck' } }, aggs: { paths: { terms: { field: 'syscheck.path', size: 6 } }, hosts: { cardinality: { field: 'agent.name' } } } },
      },
    }),
    indexer<any>(`/${ALERTS()}/_search`, { size: 60, sort: [{ timestamp: { order: 'desc' } }], query: { bool: { filter } } }).then((result) => (result.hits?.hits ?? []).map(normalize)),
  ]);
  const aggs = data.aggregations ?? {};
  const categories: Record<string, number> = {};
  Object.entries(aggs.categories?.buckets ?? {}).forEach(([key, bucket]: [string, any]) => (categories[key] = bucket.doc_count));
  const terms = (agg: any, key = 'name') => (agg?.buckets ?? []).map((bucket: any) => ({ [key]: bucket.key, count: bucket.doc_count }));
  // distribution mix and online state of the Linux agents
  const os = new Map<string, number>();
  [...inventory.values()].filter((entry) => linuxAgents.includes(entry.agent?.name)).forEach((entry) => {
    const name = String(entry.host?.os?.name ?? 'unbekannt');
    os.set(name, (os.get(name) ?? 0) + 1);
  });
  const agents = managerConfigured() ? await managerAgents().catch(() => [] as ManagerAgent[]) : [];
  const linuxStatus = agents.filter((agent) => linuxAgents.includes(agent.name));
  return {
    timeline: (aggs.timeline?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), total: bucket.doc_count, failed: bucket.failed?.doc_count ?? 0, privilege: bucket.privilege?.doc_count ?? 0 })),
    successLogins: { total: aggs.success?.doc_count ?? 0, sources: terms(aggs.success?.sources, 'ip'), users: terms(aggs.success?.users) },
    sudo: { total: aggs.sudo?.doc_count ?? 0, users: terms(aggs.sudo?.users), commands: terms(aggs.sudo?.commands) },
    fim: { total: aggs.fim?.doc_count ?? 0, hosts: aggs.fim?.hosts?.value ?? 0, paths: terms(aggs.fim?.paths, 'path') },
    os: [...os.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    status: linuxStatus.length ? { active: linuxStatus.filter((agent) => agent.status === 'active').length, disconnected: linuxStatus.filter((agent) => agent.status === 'disconnected').length, total: linuxStatus.length } : null,
    agents: linuxAgents,
    total: data.hits?.total?.value ?? 0,
    categories,
    failedLogins: {
      total: aggs.failedLogins?.doc_count ?? 0,
      sources: (aggs.failedLogins?.sources?.buckets ?? []).map((bucket: any) => ({ ip: bucket.key, count: bucket.doc_count })),
      users: (aggs.failedLogins?.users?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
    },
    hosts: (aggs.hosts?.buckets ?? []).map((bucket: any) => {
      const perCategory: Record<string, number> = {};
      Object.entries(bucket.categories?.buckets ?? {}).forEach(([key, value]: [string, any]) => (perCategory[key] = value.doc_count));
      return { name: bucket.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0, categories: perCategory };
    }),
    programs: (aggs.programs?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
    events: await assessAll(recent, hours),
  };
}

/* ---------- MITRE ---------- */

export async function mitre(hours: number) {
  const data = await indexer<any>(`/${ALERTS()}/_search`, {
    size: 0,
    track_total_hits: true,
    query: { bool: { filter: [timeRange(hours), { exists: { field: 'rule.mitre.id' } }] } },
    aggs: {
      tactics: {
        terms: { field: 'rule.mitre.tactic', size: 20 },
        aggs: {
          techniques: {
            terms: { field: 'rule.mitre.technique', size: 20 },
            aggs: { id: { terms: { field: 'rule.mitre.id', size: 1 } }, hosts: { terms: { field: 'agent.name', size: 5 } }, hostCount: { cardinality: { field: 'agent.name' } }, maxLevel: { max: { field: 'rule.level' } }, rules: { terms: { field: 'rule.description', size: 3 } } },
          },
        },
      },
      hosts: { cardinality: { field: 'agent.name' } },
    },
  });
  const aggs = data.aggregations ?? {};
  return {
    total: data.hits?.total?.value ?? 0,
    hosts: aggs.hosts?.value ?? 0,
    tactics: (aggs.tactics?.buckets ?? []).map((tactic: any) => ({
      name: tactic.key,
      count: tactic.doc_count,
      techniques: (tactic.techniques?.buckets ?? []).map((technique: any) => ({
        name: technique.key,
        id: technique.id?.buckets?.[0]?.key,
        count: technique.doc_count,
        hostCount: technique.hostCount?.value ?? 0,
        hosts: (technique.hosts?.buckets ?? []).map((bucket: any) => bucket.key),
        maxLevel: technique.maxLevel?.value ?? 0,
        rules: (technique.rules?.buckets ?? []).map((bucket: any) => bucket.key),
      })),
    })),
  };
}

/* ---------- vulnerabilities ---------- */

export async function vulnerabilities(options: { severity?: string; host?: string; q?: string; limit: number }) {
  const filter: unknown[] = [];
  if (options.severity) filter.push({ term: { 'vulnerability.severity': options.severity } });
  if (options.host) filter.push({ term: { 'agent.name': options.host } });
  const must = options.q ? [{ simple_query_string: { query: options.q, fields: ['vulnerability.id', 'package.name', 'vulnerability.description', 'agent.name'], default_operator: 'and', lenient: true } }] : [];
  const data = await indexer<any>(`/${VULNS}/_search`, {
    size: options.limit,
    track_total_hits: true,
    sort: [{ 'vulnerability.score.base': { order: 'desc', unmapped_type: 'float' } }],
    _source: ['agent.name', 'package.name', 'package.version', 'vulnerability.id', 'vulnerability.severity', 'vulnerability.score.base', 'vulnerability.detected_at', 'vulnerability.published_at', 'vulnerability.reference', 'vulnerability.description', 'host.os.full', 'host.os.name'],
    query: { bool: { filter, must } },
    aggs: {
      severity: { terms: { field: 'vulnerability.severity', size: 8 } },
      hosts: { terms: { field: 'agent.name', size: 30 }, aggs: { critical: { filter: { term: { 'vulnerability.severity': 'Critical' } } }, high: { filter: { term: { 'vulnerability.severity': 'High' } } } } },
      cves: { terms: { field: 'vulnerability.id', size: 15 }, aggs: { score: { max: { field: 'vulnerability.score.base' } }, severity: { terms: { field: 'vulnerability.severity', size: 1 } }, hosts: { cardinality: { field: 'agent.name' } }, package: { terms: { field: 'package.name', size: 1 } } } },
      packages: { terms: { field: 'package.name', size: 15 }, aggs: { hosts: { cardinality: { field: 'agent.name' } }, critical: { filter: { term: { 'vulnerability.severity': 'Critical' } } } } },
      hostCount: { cardinality: { field: 'agent.name' } },
    },
  });
  const aggs = data.aggregations ?? {};
  return {
    total: data.hits?.total?.value ?? 0,
    hostCount: aggs.hostCount?.value ?? 0,
    severity: Object.fromEntries((aggs.severity?.buckets ?? []).map((bucket: any) => [bucket.key || '–', bucket.doc_count])),
    hosts: (aggs.hosts?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count, critical: bucket.critical?.doc_count ?? 0, high: bucket.high?.doc_count ?? 0 })),
    cves: (aggs.cves?.buckets ?? []).map((bucket: any) => ({ id: bucket.key, count: bucket.doc_count, score: bucket.score?.value, severity: bucket.severity?.buckets?.[0]?.key, hosts: bucket.hosts?.value ?? 0, package: bucket.package?.buckets?.[0]?.key })),
    packages: (aggs.packages?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count, hosts: bucket.hosts?.value ?? 0, critical: bucket.critical?.doc_count ?? 0 })),
    items: (data.hits?.hits ?? []).map((hit: any) => {
      const source = hit._source ?? {};
      return {
        id: hit._id,
        host: source.agent?.name,
        os: source.host?.os?.full ?? source.host?.os?.name,
        package: source.package?.name,
        version: source.package?.version,
        cve: source.vulnerability?.id,
        severity: source.vulnerability?.severity,
        score: source.vulnerability?.score?.base,
        detectedAt: source.vulnerability?.detected_at,
        publishedAt: source.vulnerability?.published_at,
        reference: source.vulnerability?.reference,
        description: typeof source.vulnerability?.description === 'string' ? source.vulnerability.description.slice(0, 600) : undefined,
      };
    }),
  };
}

/* ---------- IOC lookup ---------- */

export function iocType(value: string) {
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return 'ip';
  if (/^[a-f0-9]{32}$|^[a-f0-9]{40}$|^[a-f0-9]{64}$/i.test(value)) return 'hash';
  if (/^https?:\/\//i.test(value)) return 'url';
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(value)) return 'domain';
  return 'text';
}

export async function iocLookup(value: string, hours: number) {
  const type = iocType(value);
  const quoted = `"${value.replace(/"/g, '')}"`;
  const query =
    type === 'ip'
      ? { bool: { should: [...IP_FIELDS.map((field) => ({ term: { [field]: value } })), { multi_match: { query: value, fields: ['full_log'], type: 'phrase' } }], minimum_should_match: 1 } }
      : { query_string: { query: quoted, fields: ['full_log', 'rule.description', 'agent.name', 'data.*', 'syscheck.*'], lenient: true } };
  const [data, recent] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: [timeRange(hours), query] } },
      aggs: { hosts: { terms: { field: 'agent.name', size: 15 } }, rules: { terms: { field: 'rule.id', size: 10 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } } }, first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } }, timeline: { date_histogram: { field: 'timestamp', fixed_interval: interval(hours), min_doc_count: 0, extended_bounds: { min: `now-${hours}h`, max: 'now' } } } },
    }),
    indexer<any>(`/${ALERTS()}/_search`, { size: 25, sort: [{ timestamp: { order: 'desc' } }], query: { bool: { filter: [timeRange(hours), query] } } }).then((result) => (result.hits?.hits ?? []).map(normalize)),
  ]);
  const aggs = data.aggregations ?? {};
  const isPublic = type === 'ip' && !/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(value);
  return {
    value,
    type,
    publicIp: type === 'ip' ? isPublic : undefined,
    total: data.hits?.total?.value ?? 0,
    first: aggs.first?.value_as_string,
    last: aggs.last?.value_as_string,
    hosts: (aggs.hosts?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
    rules: (aggs.rules?.buckets ?? []).map((bucket: any) => ({ id: bucket.key, description: bucket.description?.buckets?.[0]?.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })),
    timeline: (aggs.timeline?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), total: bucket.doc_count })),
    // no external threat-intel feed is connected; say so instead of guessing
    threatIntel: { connected: false },
    events: await assessAll(recent, hours),
  };
}

/* ---------- trust center ---------- */

type Check = { id: string; label: string; status: 'ok' | 'warn' | 'fail' | 'off'; detail: string; ms?: number };

function managerCertificate(): Promise<{ validTo?: string; subject?: string } | null> {
  const url = process.env.WAZUH_MANAGER_URL;
  if (!url) return Promise.resolve(null);
  const { hostname, port } = new URL(url);
  return new Promise((resolve) => {
    const socket = tls.connect({ host: hostname, port: Number(port) || 55000, rejectUnauthorized: false, timeout: 5000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve({ validTo: cert?.valid_to, subject: Array.isArray(cert?.subject?.CN) ? cert.subject.CN[0] : cert?.subject?.CN });
    });
    socket.on('error', () => resolve(null));
    socket.on('timeout', () => {
      socket.destroy();
      resolve(null);
    });
  });
}

export async function trustCenter() {
  const checks: Check[] = [];
  const timed = async <T,>(fn: () => Promise<T>) => {
    const started = Date.now();
    const value = await fn();
    return { value, ms: Date.now() - started };
  };
  checks.push({ id: 'backend', label: 'Backend-API', status: 'ok', detail: 'antwortet' });

  const cfg = indexerConfig();
  if (!cfg.configured) {
    checks.push({ id: 'indexer', label: 'Wazuh-Indexer', status: 'fail', detail: 'nicht konfiguriert' });
  } else {
    try {
      const info = await timed(() => indexer<any>('/', undefined, 10_000));
      checks.push({ id: 'indexer', label: 'Wazuh-Indexer', status: 'ok', detail: `OpenSearch ${info.value?.version?.number} · ${cfg.url} · TLS geprüft gegen Wazuh-CA`, ms: info.ms });
      const health = await indexer<any>('/_cluster/health', undefined, 10_000).catch(() => null);
      if (health) {
        checks.push({
          id: 'cluster',
          label: 'Cluster-Zustand',
          status: health.status === 'green' ? 'ok' : health.status === 'yellow' ? 'warn' : 'fail',
          detail: `${health.status} · ${health.active_shards} aktive Shards${health.unassigned_shards ? `, ${health.unassigned_shards} nicht zugewiesen` : ''} · ${health.number_of_nodes} Node(s)`,
        });
      }
      const indices = await indexer<any[]>(`/_cat/indices/${cfg.indexPattern}?format=json&h=index,docs.count`, undefined, 10_000).catch(() => []);
      checks.push({ id: 'pattern', label: `Index-Muster ${cfg.indexPattern}`, status: indices.length ? 'ok' : 'fail', detail: indices.length ? `${indices.length} Indizes` : 'keine passenden Indizes' });
      const last = await indexer<any>(`/${cfg.indexPattern}/_search`, { size: 0, aggs: { last: { max: { field: 'timestamp' } } } }, 10_000).catch(() => null);
      const lastAt = last?.aggregations?.last?.value;
      const age = lastAt ? (Date.now() - lastAt) / 60_000 : null;
      checks.push({ id: 'recent', label: 'Aktuelle Alerts', status: age === null ? 'fail' : age < 15 ? 'ok' : age < 120 ? 'warn' : 'fail', detail: age === null ? 'keine Alerts gefunden' : `letztes Event vor ${Math.round(age)} min` });
      const vulns = await indexer<any[]>(`/_cat/indices/${VULNS}?format=json&h=index,docs.count`, undefined, 10_000).catch(() => []);
      checks.push({ id: 'vulns', label: 'Schwachstellen-Index', status: vulns.length ? 'ok' : 'warn', detail: vulns.length ? `${vulns.reduce((sum, entry) => sum + Number(entry['docs.count'] ?? 0), 0).toLocaleString('de-DE')} Einträge` : 'nicht vorhanden' });
      const inventory = await indexer<any[]>(`/_cat/indices/wazuh-states-inventory-*?format=json&h=index`, undefined, 10_000).catch(() => []);
      checks.push({ id: 'inventory', label: 'Inventar-Indizes', status: inventory.length ? 'ok' : 'warn', detail: inventory.length ? `${inventory.length} (System, Pakete, Ports, Prozesse …)` : 'nicht vorhanden' });
    } catch (error: any) {
      checks.push({ id: 'indexer', label: 'Wazuh-Indexer', status: 'fail', detail: error.message });
    }
  }

  if (!managerConfigured()) {
    checks.push({ id: 'manager', label: 'Wazuh-Manager-API', status: 'off', detail: 'nicht konfiguriert (optional)' });
  } else {
    try {
      const info = await timed(() => managerInfo());
      checks.push({ id: 'manager', label: 'Wazuh-Manager-API', status: 'ok', detail: `Version ${info.value.version} · Zertifikat per Fingerabdruck gepinnt`, ms: info.ms });
      const connection = info.value.connection ?? {};
      checks.push({
        id: 'agents',
        label: 'Agents',
        status: connection.disconnected ? 'warn' : 'ok',
        detail: `${connection.active ?? 0} aktiv · ${connection.disconnected ?? 0} getrennt · ${connection.never_connected ?? 0} nie verbunden · ${connection.total ?? 0} gesamt`,
      });
    } catch (error: any) {
      checks.push({ id: 'manager', label: 'Wazuh-Manager-API', status: 'fail', detail: error.message });
    }
    const cert = await managerCertificate();
    if (cert?.validTo) {
      const days = Math.round((new Date(cert.validTo).getTime() - Date.now()) / 86_400_000);
      checks.push({ id: 'manager-cert', label: 'Zertifikat Manager-API', status: days < 0 ? 'fail' : days < 30 ? 'warn' : 'ok', detail: days < 0 ? `abgelaufen seit ${-days} Tagen (${cert.validTo})` : `gültig bis ${cert.validTo}` });
    }
  }

  checks.push({ id: 'ai', label: 'Bewertung', status: 'ok', detail: 'regelbasiert (Level, Windows-Event-ID, Gruppen, MITRE, Häufung, Quell-IP); KI-Erklärung per Claude-CLI nur auf Klick in der Investigation' });
  return {
    checks,
    config: {
      indexerUrl: cfg.url || null,
      indexerUser: process.env.WAZUH_INDEXER_USERNAME || null,
      indexPattern: cfg.indexPattern,
      managerUrl: process.env.WAZUH_MANAGER_URL || null,
      managerUser: process.env.WAZUH_MANAGER_USERNAME || null,
      passwords: 'in backend/.env (nicht angezeigt)',
    },
  };
}
