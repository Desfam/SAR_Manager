// Round 2 of the Wazuh workspace: full scan per host, baseline, event map, exposure map, system health.
// Read-only towards Wazuh; results of a full scan are stored as findings in the app database.
import { createHash } from 'crypto';
import { config as indexerConfig, indexer } from '../wazuh-indexer.js';
import { manager, managerAgents, managerConfigured, managerInfo } from './manager.js';
import { saveScan, upsertFindings, type FindingInput } from './store.js';
import { connectionDb } from '../database.js';
import { SSHService } from '../ssh.js';
import { connectionForAgent, liveFindings, liveScan } from './live-scan.js';
import { liveFromAgent } from '../sar-agent.js';

const ALERTS = () => indexerConfig().indexPattern;
const VULNS = 'wazuh-states-vulnerabilities-*';
const PORTS = 'wazuh-states-inventory-ports-*';

const range = (gte: string, lte = 'now') => ({ range: { timestamp: { gte, lte } } });
const hostFilter = (host: string) => ({ term: { 'agent.name': host } });
const key = (...parts: string[]) => createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 16);
const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0|::1?$|fe80:|fc|fd|::ffff:(10|127|192\.168|172\.(1[6-9]|2\d|3[01]))\.)/i.test(ip);
const cleanIp = (ip: string) => ip.replace(/^\[AF_INET6?\]/, '');

const SENSITIVE_PATHS = /(\/etc\/(passwd|shadow|sudoers|ssh\/|cron|systemd\/system)|authorized_keys|\\system32\\(drivers|config)|\\currentversion\\run|\\services\\)/i;
const PERSISTENCE_IDS = ['4697', '7045', '4698', '4720', '4732', '4728', '4756'];

type Severity = FindingInput['severity'];
const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };

/* ---------- full scan ---------- */

export async function fullScan(host: string, hours = 24 * 7) {
  const since = `now-${hours}h`;
  const base = [range(since), hostFilter(host)];
  const search = (body: unknown) => indexer<any>(`/${ALERTS()}/_search`, body, 60_000);

  const [overview, auth, fim, sca, persistence, publicSources, vulns, ports, inventory] = await Promise.all([
    search({
      size: 0,
      track_total_hits: true,
      query: { bool: { filter: base } },
      aggs: {
        first: { min: { field: 'timestamp' } },
        last: { max: { field: 'timestamp' } },
        levels: { range: { field: 'rule.level', keyed: true, ranges: [{ key: 'low', to: 7 }, { key: 'medium', from: 7, to: 12 }, { key: 'high', from: 12 }] } },
        serious: {
          filter: { range: { 'rule.level': { gte: 7 } } },
          aggs: { rules: { terms: { field: 'rule.id', size: 15 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } }, first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } }, mitre: { terms: { field: 'rule.mitre.id', size: 3 } } } } },
        },
        mitre: { terms: { field: 'rule.mitre.technique', size: 12 }, aggs: { id: { terms: { field: 'rule.mitre.id', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } } },
      },
    }),
    search({
      size: 0,
      query: { bool: { filter: base } },
      aggs: {
        failed: {
          filter: { bool: { should: [{ terms: { 'rule.groups': ['authentication_failed', 'authentication_failures', 'invalid_login'] } }, { terms: { 'data.win.system.eventID': ['4625', '4771'] } }], minimum_should_match: 1 } },
          aggs: {
            users: { terms: { field: 'data.win.eventdata.targetUserName', size: 10 }, aggs: { first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } } } },
            linuxUsers: { terms: { field: 'data.dstuser', size: 10 }, aggs: { first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } } } },
            sources: { terms: { field: 'data.srcip', size: 10 } },
            winSources: { terms: { field: 'data.win.eventdata.ipAddress', size: 10 } },
          },
        },
        success: {
          filter: { bool: { should: [{ term: { 'rule.groups': 'authentication_success' } }, { term: { 'data.win.system.eventID': '4624' } }], minimum_should_match: 1 } },
          aggs: { users: { terms: { field: 'data.win.eventdata.targetUserName', size: 50 }, aggs: { last: { max: { field: 'timestamp' } } } }, linuxUsers: { terms: { field: 'data.dstuser', size: 50 }, aggs: { last: { max: { field: 'timestamp' } } } } },
        },
        cleared: { filter: { term: { 'data.win.system.eventID': '1102' } }, aggs: { last: { max: { field: 'timestamp' } } } },
      },
    }),
    search({
      size: 0,
      query: { bool: { filter: [...base, { exists: { field: 'syscheck.path' } }] } },
      aggs: { paths: { terms: { field: 'syscheck.path', size: 40 }, aggs: { events: { terms: { field: 'syscheck.event', size: 3 } }, first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } } } } },
    }),
    search({ size: 5, sort: [{ timestamp: { order: 'desc' } }], query: { bool: { filter: [hostFilter(host), { term: { 'rule.groups': 'sca' } }, { term: { 'data.sca.type': 'summary' } }] } }, _source: ['timestamp', 'data.sca'] }),
    search({
      size: 0,
      query: { bool: { filter: [...base, { terms: { 'data.win.system.eventID': PERSISTENCE_IDS } }] } },
      aggs: { ids: { terms: { field: 'data.win.system.eventID', size: 10 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } } } } },
    }),
    search({
      size: 0,
      query: { bool: { filter: [...base, { exists: { field: 'data.srcip' } }] } },
      aggs: { sources: { terms: { field: 'data.srcip', size: 50 }, aggs: { maxLevel: { max: { field: 'rule.level' } }, rule: { terms: { field: 'rule.description', size: 1 } }, first: { min: { field: 'timestamp' } }, last: { max: { field: 'timestamp' } } } } },
    }),
    indexer<any>(`/${VULNS}/_search`, {
      size: 0,
      query: { bool: { filter: [hostFilter(host)] } },
      aggs: {
        severity: { terms: { field: 'vulnerability.severity', size: 8 } },
        critical: { filter: { term: { 'vulnerability.severity': 'Critical' } }, aggs: { cves: { terms: { field: 'vulnerability.id', size: 10 }, aggs: { package: { terms: { field: 'package.name', size: 1 } }, score: { max: { field: 'vulnerability.score.base' } } } } } },
        packages: { terms: { field: 'package.name', size: 8 } },
      },
    }).catch(() => null),
    indexer<any>(`/${PORTS}/_search`, { size: 200, query: { bool: { filter: [hostFilter(host)] } } }).catch(() => null),
    indexer<any>('/wazuh-states-inventory-system-*/_search', { size: 1, query: { bool: { filter: [hostFilter(host)] } } }).catch(() => null),
  ]);

  const findings: FindingInput[] = [];
  const add = (finding: Omit<FindingInput, 'host' | 'source' | 'key'> & { key: string[] }) =>
    findings.push({ ...finding, key: key(host, ...finding.key), host, source: 'full_scan' });

  // Events with level >= 7 per rule
  for (const bucket of overview.aggregations?.serious?.rules?.buckets ?? []) {
    const level = bucket.maxLevel?.value ?? 0;
    const severity: Severity = level >= 15 ? 'critical' : level >= 12 ? 'high' : level >= 10 ? 'medium' : 'low';
    add({
      key: ['rule', String(bucket.key)],
      category: 'Events',
      title: bucket.description?.buckets?.[0]?.key ?? `Regel ${bucket.key}`,
      severity,
      reason: `Regel ${bucket.key} mit Level ${level} hat ${bucket.doc_count}× ausgelöst.`,
      evidence: [`Level ${level}`, `${bucket.doc_count} Events`, ...(bucket.mitre?.buckets ?? []).map((entry: any) => `MITRE ${entry.key}`)],
      checks: ['Events in der Investigation ansehen', 'Erwartetes Verhalten (Wartung, Software) oder unbekannt?'],
      eventCount: bucket.doc_count,
      firstSeen: bucket.first?.value_as_string,
      lastSeen: bucket.last?.value_as_string,
      query: `host:"${host}" rule:${bucket.key}`,
    });
  }

  // Failed logins per account, and success after failures
  const authAggs = auth.aggregations ?? {};
  const successUsers = new Map<string, string>();
  [...(authAggs.success?.users?.buckets ?? []), ...(authAggs.success?.linuxUsers?.buckets ?? [])].forEach((bucket: any) => successUsers.set(String(bucket.key).toLowerCase(), bucket.last?.value_as_string));
  for (const bucket of [...(authAggs.failed?.users?.buckets ?? []), ...(authAggs.failed?.linuxUsers?.buckets ?? [])]) {
    if (bucket.doc_count < 10) continue;
    const user = String(bucket.key);
    const succeeded = successUsers.get(user.toLowerCase());
    const afterwards = succeeded && bucket.first?.value_as_string && succeeded > bucket.first.value_as_string;
    add({
      key: ['failed-login', user.toLowerCase()],
      category: 'Anmeldung',
      title: `Gehäufte Fehlanmeldungen für ${user}`,
      severity: bucket.doc_count >= 100 || afterwards ? 'high' : 'medium',
      reason: `${bucket.doc_count} fehlgeschlagene Anmeldungen für ${user}${afterwards ? ', danach auch erfolgreiche Anmeldungen' : ''}. Typisch für Passwort-Raten oder ein veraltetes gespeichertes Passwort.`,
      evidence: [
        `${bucket.doc_count} Fehlanmeldungen`,
        ...(afterwards ? [`Erfolgreiche Anmeldung zuletzt ${succeeded}`] : []),
        ...[...(authAggs.failed?.sources?.buckets ?? []), ...(authAggs.failed?.winSources?.buckets ?? [])].filter((entry: any) => entry.key && entry.key !== '-').slice(0, 4).map((entry: any) => `Quelle ${cleanIp(String(entry.key))} (${entry.doc_count}×)`),
      ],
      checks: ['Quelle der Versuche ermitteln (Gerät, Dienst mit altem Passwort?)', 'Konto sperren oder Passwort ändern, falls fremd', 'Folge-Events nach erfolgreicher Anmeldung prüfen (Timeline)'],
      eventCount: bucket.doc_count,
      firstSeen: bucket.first?.value_as_string,
      lastSeen: bucket.last?.value_as_string,
      query: `host:"${host}" user:"${user}" eid:4625`,
    });
  }
  if (authAggs.cleared?.doc_count) {
    add({
      key: ['log-cleared'],
      category: 'Spuren verwischen',
      title: 'Sicherheitsprotokoll wurde gelöscht',
      severity: 'high',
      reason: 'Event 1102: das Windows-Sicherheitsprotokoll wurde geleert, ein klassisches Zeichen für verwischte Spuren.',
      evidence: [`${authAggs.cleared.doc_count}× Event 1102`],
      checks: ['Wer hat gelöscht?', 'Was geschah unmittelbar davor (Timeline)?'],
      eventCount: authAggs.cleared.doc_count,
      lastSeen: authAggs.cleared.last?.value_as_string,
      query: `host:"${host}" eid:1102`,
    });
  }

  // Persistence
  for (const bucket of persistence.aggregations?.ids?.buckets ?? []) {
    add({
      key: ['persistence', String(bucket.key)],
      category: 'Persistenz',
      title: `${bucket.description?.buckets?.[0]?.key ?? `Event ${bucket.key}`}`,
      severity: 'medium',
      reason: `Windows-Event ${bucket.key} (${bucket.doc_count}×): neue Dienste, Aufgaben, Konten oder Gruppenmitglieder sind typische Wege, sich dauerhaft einzunisten.`,
      evidence: [`${bucket.doc_count}× Event ${bucket.key}`],
      checks: ['War die Änderung geplant?', 'Wer hat sie durchgeführt?'],
      eventCount: bucket.doc_count,
      firstSeen: bucket.first?.value_as_string,
      lastSeen: bucket.last?.value_as_string,
      query: `host:"${host}" eid:${bucket.key}`,
    });
  }

  // File integrity on sensitive paths
  const fimPaths = fim.aggregations?.paths?.buckets ?? [];
  const sensitive = fimPaths.filter((bucket: any) => SENSITIVE_PATHS.test(String(bucket.key)));
  if (sensitive.length) {
    add({
      key: ['fim-sensitive'],
      category: 'Dateiintegrität',
      title: `Änderungen an ${sensitive.length} sensiblen Pfaden`,
      severity: 'medium',
      reason: 'Überwachte Zugangs-, Dienst- oder Autostart-Dateien wurden geändert.',
      evidence: sensitive.slice(0, 6).map((bucket: any) => `${bucket.key} (${(bucket.events?.buckets ?? []).map((entry: any) => entry.key).join('/')})`),
      checks: ['Änderung mit geplanten Arbeiten abgleichen', 'Inhalt der Datei prüfen'],
      eventCount: sensitive.reduce((sum: number, bucket: any) => sum + bucket.doc_count, 0),
      firstSeen: sensitive.map((bucket: any) => bucket.first?.value_as_string).sort()[0],
      lastSeen: sensitive.map((bucket: any) => bucket.last?.value_as_string).sort().pop(),
      query: `host:"${host}" group:syscheck`,
    });
  }

  // Configuration (SCA)
  const scaHits = (sca.hits?.hits ?? []).map((hit: any) => hit._source);
  const latestPolicies = new Map<string, any>();
  scaHits.forEach((source: any) => {
    const policy = source.data?.sca?.policy_id;
    if (policy && !latestPolicies.has(policy)) latestPolicies.set(policy, { ...source.data.sca, timestamp: source.timestamp });
  });
  for (const policy of latestPolicies.values()) {
    const score = Number(policy.score);
    if (Number.isFinite(score) && score < 60) {
      add({
        key: ['sca', String(policy.policy_id)],
        category: 'Konfiguration',
        title: `Konfigurationsprüfung: ${score} % (${policy.policy})`,
        severity: score < 35 ? 'medium' : 'low',
        reason: `${policy.failed} von ${policy.total_checks} Prüfungen der Richtlinie nicht erfüllt.`,
        evidence: [`Score ${score} %`, `${policy.passed} bestanden, ${policy.failed} nicht bestanden`],
        checks: ['Fehlgeschlagene Prüfungen im Wazuh-Dashboard (Configuration Assessment) ansehen', 'Wichtigste Punkte zuerst: Passwortrichtlinien, Dienste, Protokollierung'],
        eventCount: Number(policy.failed) || 0,
        lastSeen: policy.timestamp,
        query: `host:"${host}" group:sca`,
      });
    }
  }

  // Vulnerabilities
  const vulnAggs = vulns?.aggregations ?? {};
  const critical = vulnAggs.critical?.doc_count ?? 0;
  const high = (vulnAggs.severity?.buckets ?? []).find((bucket: any) => bucket.key === 'High')?.doc_count ?? 0;
  if (critical || high) {
    add({
      key: ['vulnerabilities'],
      category: 'Schwachstellen',
      title: `${critical} kritische und ${high} hohe Schwachstellen`,
      severity: critical ? 'high' : 'medium',
      reason: 'Installierte Software mit bekannten Schwachstellen. Je erreichbarer der Dienst, desto dringender.',
      evidence: (vulnAggs.critical?.cves?.buckets ?? []).slice(0, 6).map((bucket: any) => `${bucket.key} · ${bucket.package?.buckets?.[0]?.key ?? ''} (CVSS ${bucket.score?.value == null ? '?' : Math.round(bucket.score.value * 10) / 10})`),
      checks: ['Betroffene Pakete aktualisieren', 'Prüfen, ob die Dienste von außen erreichbar sind'],
      eventCount: critical + high,
      query: undefined,
    });
  }

  // Public sources seen in events (e.g. logins from the internet)
  const external = (publicSources.aggregations?.sources?.buckets ?? []).filter((bucket: any) => !isPrivate(cleanIp(String(bucket.key))));
  if (external.length) {
    const total = external.reduce((sum: number, bucket: any) => sum + bucket.doc_count, 0);
    add({
      key: ['public-sources'],
      category: 'Exposition',
      title: `Zugriffe von ${external.length} öffentlichen IP-Adressen`,
      severity: external.some((bucket: any) => (bucket.maxLevel?.value ?? 0) >= 7) ? 'medium' : 'low',
      reason: 'Der Host wird aus dem Internet angesprochen. Das ist bei VPN- oder Webdiensten erwartet, sonst ein Hinweis auf eine Freigabe zu viel.',
      evidence: external.slice(0, 6).map((bucket: any) => `${cleanIp(String(bucket.key))}: ${bucket.doc_count}× · ${bucket.rule?.buckets?.[0]?.key ?? ''}`),
      checks: ['Sind die Quellen bekannt (Mitarbeiter, Partner)?', 'Ist die Freigabe in der Firewall gewollt?'],
      eventCount: total,
      firstSeen: external.map((bucket: any) => bucket.first?.value_as_string).sort()[0],
      lastSeen: external.map((bucket: any) => bucket.last?.value_as_string).sort().pop(),
      query: `host:"${host}"`,
    });
  }

  // Listening services on all interfaces (inventory snapshot)
  const portDocs = (ports?.hits?.hits ?? []).map((hit: any) => hit._source ?? {});
  const listening = portDocs.filter((doc: any) => doc.interface?.state === 'listening' && ['0.0.0.0', '::'].includes(String(doc.source?.ip)));
  const outbound = portDocs.filter((doc: any) => doc.destination?.ip && !isPrivate(String(doc.destination.ip)) && doc.interface?.state && doc.interface.state !== 'listening');
  const risky = listening.filter((doc: any) => [21, 23, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 6379, 9200, 27017].includes(Number(doc.source?.port)));
  if (risky.length) {
    add({
      key: ['risky-listeners'],
      category: 'Exposition',
      title: `${risky.length} sensible Dienste lauschen auf allen Adressen`,
      severity: 'low',
      reason: 'Dienste wie SMB, RDP oder Datenbanken sind aus jedem Netz erreichbar, das den Host erreicht. Ob sie es wirklich sind, entscheidet die Firewall.',
      evidence: risky.slice(0, 8).map((doc: any) => `${doc.network?.transport} ${doc.source?.port} · ${doc.process?.name ?? '?'}`),
      checks: ['Nur benötigte Dienste freigeben', 'Zugriff per Firewall auf berechtigte Netze begrenzen'],
      eventCount: risky.length,
    });
  }

  const system = inventory?.hits?.hits?.[0]?._source?.host ?? null;

  // Linux hosts: read logs and state live over SSH, if SAR has an SSH system for the agent
  let live: Awaited<ReturnType<typeof liveScan>> | null = null;
  const platform = String(system?.os?.platform ?? system?.os?.type ?? '').toLowerCase();
  if (platform && !platform.includes('windows')) {
    const agent = managerConfigured() ? (await managerAgents().catch(() => [])).find((entry) => entry.name === host) : undefined;
    // a connected SAR agent already has logs and state: no SSH login needed
    const connection = connectionForAgent({ name: host, ip: agent?.ip, hostname: system?.hostname });
    live = (connection && liveFromAgent(connection.id, hours)) || (await liveScan({ name: host, ip: agent?.ip, hostname: system?.hostname }, hours).catch((error: Error) => ({ error: error.message })));
    if (live && !('error' in live)) liveFindings(live).forEach((finding) => add(finding));
  }

  findings.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.eventCount - a.eventCount);
  const worst = findings[0]?.severity ?? 'info';
  const overviewAggs = overview.aggregations ?? {};
  const result = {
    host,
    hours,
    scannedAt: new Date().toISOString(),
    summary: {
      worst,
      events: overview.hits?.total?.value ?? 0,
      levels: { low: overviewAggs.levels?.buckets?.low?.doc_count ?? 0, medium: overviewAggs.levels?.buckets?.medium?.doc_count ?? 0, high: overviewAggs.levels?.buckets?.high?.doc_count ?? 0 },
      firstSeen: overviewAggs.first?.value_as_string,
      lastSeen: overviewAggs.last?.value_as_string,
      findings: { total: findings.length, bySeverity: Object.fromEntries((['critical', 'high', 'medium', 'low'] as Severity[]).map((severity) => [severity, findings.filter((finding) => finding.severity === severity).length])) },
    },
    modules: {
      system: system ? { os: system.os?.name, version: system.os?.version, hostname: system.hostname, architecture: system.architecture } : null,
      auth: {
        failed: authAggs.failed?.doc_count ?? 0,
        success: authAggs.success?.doc_count ?? 0,
        failedUsers: [...(authAggs.failed?.users?.buckets ?? []), ...(authAggs.failed?.linuxUsers?.buckets ?? [])].map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })).slice(0, 10),
      },
      fim: { changes: fimPaths.reduce((sum: number, bucket: any) => sum + bucket.doc_count, 0), paths: fimPaths.slice(0, 15).map((bucket: any) => ({ path: bucket.key, count: bucket.doc_count, sensitive: SENSITIVE_PATHS.test(String(bucket.key)) })) },
      sca: [...latestPolicies.values()].map((policy) => ({ policy: policy.policy, score: Number(policy.score), passed: Number(policy.passed), failed: Number(policy.failed), total: Number(policy.total_checks), at: policy.timestamp })),
      vulnerabilities: {
        // Wazuh reports some entries without severity ("" or "-"): merge them as "Unbewertet"
        bySeverity: (vulnAggs.severity?.buckets ?? []).reduce((all: Record<string, number>, bucket: any) => {
          const name = !bucket.key || bucket.key === '-' ? 'Unbewertet' : String(bucket.key);
          all[name] = (all[name] ?? 0) + bucket.doc_count;
          return all;
        }, {}),
        critical: (vulnAggs.critical?.cves?.buckets ?? []).map((bucket: any) => ({ cve: bucket.key, package: bucket.package?.buckets?.[0]?.key, score: bucket.score?.value == null ? undefined : Math.round(bucket.score.value * 10) / 10 })),
        packages: (vulnAggs.packages?.buckets ?? []).map((bucket: any) => ({ name: bucket.key, count: bucket.doc_count })),
      },
      mitre: (overviewAggs.mitre?.buckets ?? []).map((bucket: any) => ({ technique: bucket.key, id: bucket.id?.buckets?.[0]?.key, count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })),
      threatIntel: { connected: false, publicSources: external.slice(0, 15).map((bucket: any) => ({ ip: cleanIp(String(bucket.key)), count: bucket.doc_count, maxLevel: bucket.maxLevel?.value ?? 0 })) },
      network: {
        listening: listening.slice(0, 40).map((doc: any) => ({ protocol: doc.network?.transport, port: doc.source?.port, process: doc.process?.name })),
        outbound: outbound.slice(0, 40).map((doc: any) => ({ ip: doc.destination?.ip, port: doc.destination?.port, process: doc.process?.name, state: doc.interface?.state })),
      },
    },
    live,
    findings,
  };
  const scanId = saveScan(host, hours, result);
  const stored = upsertFindings(findings);
  return { id: scanId, ...result, stored };
}

/* ---------- baseline ---------- */

export async function baseline(host: string, baselineDays = 7) {
  const recent = [range('now-24h'), hostFilter(host)];
  const past = [range(`now-${baselineDays + 1}d`, 'now-24h'), hostFilter(host)];
  const aggs = {
    rules: { terms: { field: 'rule.id', size: 1000 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } } } },
    users: { terms: { field: 'data.win.eventdata.targetUserName', size: 500 } },
    linuxUsers: { terms: { field: 'data.dstuser', size: 500 } },
    sources: { terms: { field: 'data.srcip', size: 500 } },
    winSources: { terms: { field: 'data.win.eventdata.ipAddress', size: 500 } },
    processes: { terms: { field: 'data.win.eventdata.newProcessName', size: 1000 } },
    programs: { terms: { field: 'predecoder.program_name', size: 500 } },
    eventIds: { terms: { field: 'data.win.system.eventID', size: 500 } },
    daily: { date_histogram: { field: 'timestamp', calendar_interval: '1d', min_doc_count: 0 } },
  };
  const [now, before] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, { size: 0, track_total_hits: true, query: { bool: { filter: recent } }, aggs }, 60_000),
    indexer<any>(`/${ALERTS()}/_search`, { size: 0, track_total_hits: true, query: { bool: { filter: past } }, aggs }, 60_000),
  ]);
  const keys = (data: any, ...names: string[]) => new Set(names.flatMap((name) => (data.aggregations?.[name]?.buckets ?? []).map((bucket: any) => String(bucket.key))));
  const newOnes = (name: string[], filter: (value: string) => boolean = () => true) => {
    const old = keys(before, ...name);
    return names(now, name).filter((entry) => !old.has(entry.key) && filter(entry.key));
  };
  function names(data: any, list: string[]) {
    return list.flatMap((name) => (data.aggregations?.[name]?.buckets ?? []).map((bucket: any) => ({ key: String(bucket.key), count: bucket.doc_count, description: bucket.description?.buckets?.[0]?.key, maxLevel: bucket.maxLevel?.value })));
  }
  const days = Math.max(1, (before.aggregations?.daily?.buckets ?? []).filter((bucket: any) => bucket.doc_count > 0).length);
  const average = (before.hits?.total?.value ?? 0) / days;
  const recentTotal = now.hits?.total?.value ?? 0;

  const deviations = {
    rules: newOnes(['rules']),
    users: newOnes(['users', 'linuxUsers'], (value) => value !== '-' && !value.endsWith('$')),
    sources: newOnes(['sources', 'winSources'], (value) => value !== '-' && value !== '::1' && value !== '127.0.0.1').map((entry) => ({ ...entry, key: cleanIp(entry.key), external: !isPrivate(cleanIp(entry.key)) })),
    processes: newOnes(['processes', 'programs']),
    eventIds: newOnes(['eventIds']),
  };
  const volume = { recent: recentTotal, average: Math.round(average), ratio: average ? Math.round((recentTotal / average) * 10) / 10 : null, baselineDays: days };

  const findings: FindingInput[] = [];
  const add = (finding: Omit<FindingInput, 'host' | 'source' | 'key'> & { key: string[] }) => findings.push({ ...finding, key: key(host, 'baseline', ...finding.key), host, source: 'baseline' });
  deviations.rules.filter((rule) => (rule.maxLevel ?? 0) >= 5).forEach((rule) =>
    add({ key: ['rule', rule.key], category: 'Baseline', title: `Neue Regel: ${rule.description ?? rule.key}`, severity: (rule.maxLevel ?? 0) >= 10 ? 'medium' : 'low', reason: `Regel ${rule.key} kam in den ${days} Tagen davor auf diesem Host nicht vor.`, evidence: [`${rule.count}× in 24 h`, `Level ${rule.maxLevel}`], checks: ['Was hat sich geändert (Update, neue Software, neuer Benutzer)?'], eventCount: rule.count, query: `host:"${host}" rule:${rule.key}` }),
  );
  deviations.sources.filter((source) => source.external).forEach((source) =>
    add({ key: ['source', source.key], category: 'Baseline', title: `Neue öffentliche Quelle ${source.key}`, severity: 'medium', reason: 'Diese IP aus dem Internet ist vorher nie aufgetaucht.', evidence: [`${source.count}× in 24 h`], checks: ['Herkunft der IP prüfen', 'Ist der Zugriff gewollt?'], eventCount: source.count, query: `host:"${host}" ip:${source.key}` }),
  );
  if (volume.ratio && volume.ratio >= 3 && recentTotal > 200) {
    add({ key: ['volume'], category: 'Baseline', title: `Event-Menge ${volume.ratio}× höher als üblich`, severity: 'low', reason: `${recentTotal} Events in 24 h gegenüber durchschnittlich ${volume.average} pro Tag.`, evidence: [`Basis: ${days} Tage`], checks: ['Welche Regeln treiben den Anstieg (Statistik/Investigation)?'], eventCount: recentTotal, query: `host:"${host}"` });
  }
  return { host, deviations, volume, findings };
}

export function storeBaselineFindings(findings: FindingInput[]) {
  return upsertFindings(findings);
}

/* ---------- event map: host → rule → MITRE technique ---------- */

export async function eventMap(hours: number, minLevel = 7) {
  const data = await indexer<any>(`/${ALERTS()}/_search`, {
    size: 0,
    query: { bool: { filter: [range(`now-${hours}h`), { range: { 'rule.level': { gte: minLevel } } }] } },
    aggs: {
      hosts: {
        terms: { field: 'agent.name', size: 18 },
        aggs: {
          maxLevel: { max: { field: 'rule.level' } },
          rules: { terms: { field: 'rule.id', size: 6 }, aggs: { description: { terms: { field: 'rule.description', size: 1 } }, maxLevel: { max: { field: 'rule.level' } }, mitre: { terms: { field: 'rule.mitre.id', size: 3 }, aggs: { technique: { terms: { field: 'rule.mitre.technique', size: 1 } }, tactic: { terms: { field: 'rule.mitre.tactic', size: 1 } } } } } },
        },
      },
    },
  }, 60_000);
  const nodes = new Map<string, any>();
  const links: Array<{ source: string; target: string; count: number }> = [];
  for (const host of data.aggregations?.hosts?.buckets ?? []) {
    const hostId = `host:${host.key}`;
    nodes.set(hostId, { id: hostId, kind: 'host', label: host.key, count: host.doc_count, maxLevel: host.maxLevel?.value ?? 0 });
    for (const rule of host.rules?.buckets ?? []) {
      const ruleId = `rule:${rule.key}`;
      const existing = nodes.get(ruleId);
      nodes.set(ruleId, { id: ruleId, kind: 'rule', label: rule.description?.buckets?.[0]?.key ?? rule.key, ruleId: String(rule.key), count: (existing?.count ?? 0) + rule.doc_count, maxLevel: Math.max(existing?.maxLevel ?? 0, rule.maxLevel?.value ?? 0) });
      links.push({ source: hostId, target: ruleId, count: rule.doc_count });
      for (const technique of rule.mitre?.buckets ?? []) {
        const techniqueId = `mitre:${technique.key}`;
        const current = nodes.get(techniqueId);
        nodes.set(techniqueId, { id: techniqueId, kind: 'mitre', label: technique.technique?.buckets?.[0]?.key ?? technique.key, mitreId: String(technique.key), tactic: technique.tactic?.buckets?.[0]?.key, count: (current?.count ?? 0) + technique.doc_count, maxLevel: Math.max(current?.maxLevel ?? 0, rule.maxLevel?.value ?? 0) });
        const linkKey = links.find((link) => link.source === ruleId && link.target === techniqueId);
        if (linkKey) linkKey.count += technique.doc_count;
        else links.push({ source: ruleId, target: techniqueId, count: technique.doc_count });
      }
    }
  }
  return { hours, minLevel, nodes: [...nodes.values()], links };
}

/* ---------- exposure map ---------- */

export async function exposure(hours: number) {
  const [inbound, portsData] = await Promise.all([
    indexer<any>(`/${ALERTS()}/_search`, {
      size: 0,
      query: { bool: { filter: [range(`now-${hours}h`), { exists: { field: 'data.srcip' } }] } },
      aggs: { sources: { terms: { field: 'data.srcip', size: 300 }, aggs: { hosts: { terms: { field: 'agent.name', size: 5 } }, maxLevel: { max: { field: 'rule.level' } }, rule: { terms: { field: 'rule.description', size: 1 } }, last: { max: { field: 'timestamp' } } } } },
    }, 60_000),
    indexer<any>(`/${PORTS}/_search`, { size: 10_000, _source: ['agent.name', 'source', 'destination', 'interface.state', 'network.transport', 'process.name'] }, 60_000).catch(() => null),
  ]);
  const inboundList = (inbound.aggregations?.sources?.buckets ?? [])
    .map((bucket: any) => ({ ip: cleanIp(String(bucket.key)), count: bucket.doc_count, hosts: (bucket.hosts?.buckets ?? []).map((entry: any) => entry.key), maxLevel: bucket.maxLevel?.value ?? 0, rule: bucket.rule?.buckets?.[0]?.key, last: bucket.last?.value_as_string }))
    .filter((entry: any) => /^[\d.]+$|:/.test(entry.ip) && !isPrivate(entry.ip));

  const outbound = new Map<string, { ip: string; ports: Set<number>; hosts: Set<string>; processes: Set<string>; connections: number }>();
  const listening = new Map<string, Array<{ port: number; protocol: string; process?: string }>>();
  for (const hit of portsData?.hits?.hits ?? []) {
    const doc = hit._source ?? {};
    const agent = doc.agent?.name;
    if (!agent) continue;
    if (doc.interface?.state === 'listening' && ['0.0.0.0', '::'].includes(String(doc.source?.ip))) {
      const list = listening.get(agent) ?? [];
      if (!list.some((entry) => entry.port === doc.source?.port && entry.protocol === doc.network?.transport)) list.push({ port: doc.source?.port, protocol: doc.network?.transport, process: doc.process?.name });
      listening.set(agent, list);
    }
    const destination = String(doc.destination?.ip ?? '');
    if (destination && !isPrivate(destination) && doc.interface?.state && doc.interface.state !== 'listening') {
      const entry = outbound.get(destination) ?? { ip: destination, ports: new Set<number>(), hosts: new Set<string>(), processes: new Set<string>(), connections: 0 };
      entry.ports.add(Number(doc.destination?.port));
      entry.hosts.add(agent);
      if (doc.process?.name) entry.processes.add(doc.process.name);
      entry.connections += 1;
      outbound.set(destination, entry);
    }
  }
  return {
    hours,
    inbound: inboundList.slice(0, 60),
    outbound: [...outbound.values()].map((entry) => ({ ip: entry.ip, ports: [...entry.ports].sort((a, b) => a - b), hosts: [...entry.hosts], processes: [...entry.processes].slice(0, 5), connections: entry.connections })).sort((a, b) => b.connections - a.connections).slice(0, 80),
    listening: [...listening.entries()].map(([host, ports]) => ({ host, ports: ports.sort((a, b) => a.port - b.port) })).sort((a, b) => b.ports.length - a.ports.length),
    note: 'Ausgehende Verbindungen und lauschende Ports stammen aus dem Wazuh-Inventar (Momentaufnahme des letzten Scans je Agent), eingehende aus Events mit öffentlicher Quell-IP. Kein Firewall-/Flow-Log angebunden.',
  };
}

/* ---------- system health ---------- */

export async function systemHealth() {
  const cfg = indexerConfig();
  const [health, nodes, shards, indices, ingest, managerStatus, managerLogs, info] = await Promise.all([
    indexer<any>('/_cluster/health', undefined, 10_000).catch((error) => ({ error: error.message })),
    indexer<any>('/_nodes/stats/jvm,fs,os,process', undefined, 10_000).catch(() => null),
    indexer<any[]>('/_cat/shards?format=json&h=index,prirep,state,unassigned.reason', undefined, 10_000).catch(() => []),
    indexer<any[]>(`/_cat/indices?format=json&h=index,docs.count,store.size,health&bytes=b`, undefined, 10_000).catch(() => []),
    indexer<any>(`/${cfg.indexPattern}/_search`, { size: 0, query: { range: { timestamp: { gte: 'now-2h' } } }, aggs: { rate: { date_histogram: { field: 'timestamp', fixed_interval: '5m', min_doc_count: 0, extended_bounds: { min: 'now-2h', max: 'now' } } } } }, 15_000).catch(() => null),
    managerConfigured() ? manager<any>('/manager/status').catch(() => null) : Promise.resolve(null),
    managerConfigured() ? manager<any>('/manager/logs/summary').catch(() => null) : Promise.resolve(null),
    managerConfigured() ? managerInfo().catch(() => null) : Promise.resolve(null),
  ]);

  const nodeStats = Object.values(nodes?.nodes ?? {}).map((node: any) => ({
    name: node.name,
    heapPercent: node.jvm?.mem?.heap_used_percent,
    cpuPercent: node.os?.cpu?.percent ?? node.process?.cpu?.percent,
    load: node.os?.cpu?.load_average?.['1m'],
    memPercent: node.os?.mem?.used_percent,
    diskTotal: node.fs?.total?.total_in_bytes,
    diskFree: node.fs?.total?.available_in_bytes,
  }));
  const unassigned = shards.filter((shard) => shard.state === 'UNASSIGNED');
  const unassignedReplicas = unassigned.filter((shard) => shard.prirep === 'r').length;
  const groups = new Map<string, { count: number; docs: number; bytes: number }>();
  indices.forEach((index) => {
    const group = String(index.index).replace(/-\d{4}\.\d{2}(\.\d{2}|w)$/, '-*').replace(/^\.(.*)/, '.$1');
    const entry = groups.get(group) ?? { count: 0, docs: 0, bytes: 0 };
    entry.count += 1;
    entry.docs += Number(index['docs.count'] ?? 0);
    entry.bytes += Number(index['store.size'] ?? 0);
    groups.set(group, entry);
  });
  const daemons = Object.entries(managerStatus?.affected_items?.[0] ?? {}).map(([name, state]) => ({ name, state: String(state) }));
  const logSummary = Object.entries(managerLogs?.affected_items?.[0] ?? {}).map(([component, counts]: [string, any]) => ({ component, error: counts?.error ?? 0, warning: counts?.warning ?? 0, info: counts?.info ?? 0 }));

  // Docker containers of the stack: read-only `docker ps` on the Wazuh host, if an SSH system for it exists
  let containers: Array<{ name: string; status: string; image: string }> | null = null;
  try {
    const indexerHost = new URL(cfg.url).hostname;
    const connection: any = (connectionDb.getAll() as any[]).find((entry) => entry.host === indexerHost && entry.type !== 'rdp');
    if (connection) {
      const result = await SSHService.executeCommand(
        { id: connection.id, name: connection.name, host: connection.host, port: connection.port, username: connection.username, authType: connection.auth_type || 'password', password: connection.password, privateKeyPath: connection.private_key_path } as any,
        "docker ps -a --format '{{.Names}}|{{.Status}}|{{.Image}}' 2>/dev/null",
      );
      containers = String(result.data?.stdout ?? '')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [name, status, image] = line.split('|');
          return { name, status, image };
        });
    }
  } catch {
    containers = null;
  }

  return {
    indexer: {
      status: health?.status ?? 'unbekannt',
      error: health?.error,
      nodes: health?.number_of_nodes,
      activeShards: health?.active_shards,
      unassigned: unassigned.length,
      unassignedReplicas,
      explanation:
        unassigned.length && unassignedReplicas === unassigned.length && health?.number_of_nodes === 1
          ? 'Nur ein Indexer-Node: Replikate können nirgends abgelegt werden. „yellow“ ist in diesem Aufbau normal; abhilfe wäre number_of_replicas = 0 für diese Indizes.'
          : unassigned.length
            ? 'Nicht zugewiesene primäre Shards bedeuten fehlende Daten: dringend prüfen (_cluster/allocation/explain).'
            : undefined,
      nodeStats,
      indexGroups: [...groups.entries()].map(([name, entry]) => ({ name, ...entry })).sort((a, b) => b.bytes - a.bytes).slice(0, 15),
    },
    ingest: (ingest?.aggregations?.rate?.buckets ?? []).map((bucket: any) => ({ time: Math.round(bucket.key / 1000), count: bucket.doc_count })),
    manager: managerConfigured() ? { version: info?.version, connection: info?.connection, daemons, logs: logSummary } : null,
    containers,
  };
}
