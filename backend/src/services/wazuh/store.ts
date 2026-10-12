// Incidents, findings and full-scan history of the Wazuh workspace (app database)
import { randomUUID } from 'crypto';
import { auditLogDb, getDatabase } from '../database.js';

let ready = false;
function db() {
  const database = getDatabase();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS soc_findings (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL UNIQUE,
        host TEXT NOT NULL,
        category TEXT NOT NULL,
        title TEXT NOT NULL,
        severity TEXT NOT NULL,
        reason TEXT,
        evidence TEXT,
        checks TEXT,
        event_count INTEGER DEFAULT 0,
        first_seen TEXT,
        last_seen TEXT,
        source TEXT,
        query TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS soc_incidents (
        id TEXT PRIMARY KEY,
        number INTEGER,
        title TEXT NOT NULL,
        host TEXT,
        severity TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        description TEXT,
        event_refs TEXT,
        rule_ids TEXT,
        event_ids TEXT,
        checks TEXT,
        finding_ids TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS soc_incident_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        incident_id TEXT NOT NULL,
        text TEXT NOT NULL,
        kind TEXT DEFAULT 'note',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS soc_scans (
        id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        hours INTEGER NOT NULL,
        result TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_soc_findings_host ON soc_findings(host);
      CREATE INDEX IF NOT EXISTS idx_soc_scans_host ON soc_scans(host, created_at);
    `);
    ready = true;
  }
  return database;
}

const json = (value: unknown) => JSON.stringify(value ?? []);
const parse = <T,>(value: unknown, fallback: T): T => {
  try {
    return value ? (JSON.parse(String(value)) as T) : fallback;
  } catch {
    return fallback;
  }
};
const audit = (action: string, target: string, details: string, user = 'app') =>
  auditLogDb.create({ user, action, target, details, status: 'success', ipAddress: user });

/* ---------- findings ---------- */

export const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
export const FINDING_STATUS = ['open', 'in_progress', 'resolved', 'false_positive'] as const;

export interface FindingInput {
  key: string;
  host: string;
  category: string;
  title: string;
  severity: (typeof SEVERITIES)[number];
  reason: string;
  evidence: string[];
  checks: string[];
  eventCount: number;
  firstSeen?: string;
  lastSeen?: string;
  source: 'full_scan' | 'baseline';
  query?: string;
}

const rowToFinding = (row: any) => ({
  id: row.id,
  key: row.key,
  host: row.host,
  category: row.category,
  title: row.title,
  severity: row.severity,
  reason: row.reason,
  evidence: parse<string[]>(row.evidence, []),
  checks: parse<string[]>(row.checks, []),
  eventCount: row.event_count,
  firstSeen: row.first_seen,
  lastSeen: row.last_seen,
  source: row.source,
  query: row.query,
  status: row.status,
  createdAt: utc(row.created_at),
  updatedAt: utc(row.updated_at),
});

/** Insert or refresh findings by their stable key; a resolved finding that shows up again is reopened */
/** SQLite CURRENT_TIMESTAMP is UTC without zone marker */
const utc = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value ?? undefined);

export function upsertFindings(findings: FindingInput[]) {
  const database = db();
  const select = database.prepare('SELECT id, status FROM soc_findings WHERE key = ?');
  const insert = database.prepare(
    'INSERT INTO soc_findings (id, key, host, category, title, severity, reason, evidence, checks, event_count, first_seen, last_seen, source, query) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const update = database.prepare(
    "UPDATE soc_findings SET title = ?, severity = ?, reason = ?, evidence = ?, checks = ?, event_count = ?, first_seen = COALESCE(first_seen, ?), last_seen = ?, query = ?, status = CASE WHEN status = 'resolved' THEN 'open' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE key = ?",
  );
  let created = 0;
  database.transaction(() => {
    for (const finding of findings) {
      const existing = select.get(finding.key) as { id: string } | undefined;
      if (existing) {
        update.run(finding.title, finding.severity, finding.reason, json(finding.evidence), json(finding.checks), finding.eventCount, finding.firstSeen ?? null, finding.lastSeen ?? null, finding.query ?? null, finding.key);
      } else {
        insert.run(randomUUID(), finding.key, finding.host, finding.category, finding.title, finding.severity, finding.reason, json(finding.evidence), json(finding.checks), finding.eventCount, finding.firstSeen ?? null, finding.lastSeen ?? null, finding.source, finding.query ?? null);
        created += 1;
      }
    }
  })();
  return { created, updated: findings.length - created };
}

export function listFindings(filters: { host?: string; status?: string; severity?: string; category?: string }) {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.host) {
    where.push('host = ?');
    values.push(filters.host);
  }
  if (filters.status) {
    where.push('status = ?');
    values.push(filters.status);
  }
  if (filters.severity) {
    where.push('severity = ?');
    values.push(filters.severity);
  }
  if (filters.category) {
    where.push('category = ?');
    values.push(filters.category);
  }
  const rows = db()
    .prepare(
      `SELECT * FROM soc_findings ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END, last_seen DESC LIMIT 1000`,
    )
    .all(...values);
  return rows.map(rowToFinding);
}

export function setFindingStatus(id: string, status: string, user?: string) {
  if (!(FINDING_STATUS as readonly string[]).includes(status)) throw Object.assign(new Error('invalid status'), { status: 400 });
  const row: any = db().prepare('SELECT host, title FROM soc_findings WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Finding not found'), { status: 404 });
  db().prepare('UPDATE soc_findings SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  audit('SOC_FINDING_STATUS', row.host, `${row.title} → ${status}`, user);
  return { id, status };
}

/* ---------- incidents ---------- */

export const INCIDENT_STATUS = ['open', 'in_progress', 'resolved', 'closed'] as const;

const rowToIncident = (row: any) => ({
  id: row.id,
  number: row.number,
  title: row.title,
  host: row.host,
  severity: row.severity,
  status: row.status,
  description: row.description,
  eventRefs: parse<Array<{ index: string; id: string; description?: string; timestamp?: string }>>(row.event_refs, []),
  ruleIds: parse<string[]>(row.rule_ids, []),
  eventIds: parse<string[]>(row.event_ids, []),
  checks: parse<string[]>(row.checks, []),
  findingIds: parse<string[]>(row.finding_ids, []),
  createdAt: utc(row.created_at),
  updatedAt: utc(row.updated_at),
});

const text = (value: unknown, max: number) => (typeof value === 'string' ? value.trim().slice(0, max) : '');
const strings = (value: unknown, max = 50) => (Array.isArray(value) ? value.map((entry) => String(entry).slice(0, 300)).slice(0, max) : []);

function validateIncident(input: any) {
  const title = text(input.title, 200);
  if (!title) throw Object.assign(new Error('Titel fehlt'), { status: 400 });
  const severity = (SEVERITIES as readonly string[]).includes(input.severity) ? input.severity : 'medium';
  const status = (INCIDENT_STATUS as readonly string[]).includes(input.status) ? input.status : 'open';
  const eventRefs = Array.isArray(input.eventRefs)
    ? input.eventRefs
        .filter((ref: any) => typeof ref?.index === 'string' && typeof ref?.id === 'string' && /^wazuh-alerts/.test(ref.index))
        .slice(0, 100)
        .map((ref: any) => ({ index: ref.index, id: ref.id, description: text(ref.description, 300) || undefined, timestamp: text(ref.timestamp, 40) || undefined }))
    : [];
  return { title, host: text(input.host, 120) || null, severity, status, description: text(input.description, 8000), eventRefs, ruleIds: strings(input.ruleIds), eventIds: strings(input.eventIds), checks: strings(input.checks, 30), findingIds: strings(input.findingIds) };
}

export function listIncidents(filters: { status?: string; host?: string }) {
  const where: string[] = [];
  const values: unknown[] = [];
  if (filters.status) {
    where.push('status = ?');
    values.push(filters.status);
  }
  if (filters.host) {
    where.push('host = ?');
    values.push(filters.host);
  }
  const rows = db().prepare(`SELECT * FROM soc_incidents ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY updated_at DESC LIMIT 500`).all(...values);
  const counts = db().prepare('SELECT incident_id, COUNT(*) AS n FROM soc_incident_notes GROUP BY incident_id').all() as Array<{ incident_id: string; n: number }>;
  const noteCount = new Map(counts.map((entry) => [entry.incident_id, entry.n]));
  return rows.map((row: any) => ({ ...rowToIncident(row), notes: noteCount.get(row.id) ?? 0 }));
}

export function getIncident(id: string) {
  const row = db().prepare('SELECT * FROM soc_incidents WHERE id = ?').get(id);
  if (!row) return null;
  const notes = db().prepare('SELECT id, text, kind, created_at FROM soc_incident_notes WHERE incident_id = ? ORDER BY id').all(id) as any[];
  return { ...rowToIncident(row), timeline: notes.map((note) => ({ id: note.id, text: note.text, kind: note.kind, createdAt: utc(note.created_at) })) };
}

export function createIncident(input: any, user?: string) {
  const value = validateIncident(input);
  const database = db();
  const id = randomUUID();
  const number = ((database.prepare('SELECT MAX(number) AS n FROM soc_incidents').get() as { n: number | null }).n ?? 0) + 1;
  database
    .prepare('INSERT INTO soc_incidents (id, number, title, host, severity, status, description, event_refs, rule_ids, event_ids, checks, finding_ids) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, number, value.title, value.host, value.severity, value.status, value.description, json(value.eventRefs), json(value.ruleIds), json(value.eventIds), json(value.checks), json(value.findingIds));
  database.prepare("INSERT INTO soc_incident_notes (incident_id, text, kind) VALUES (?, ?, 'system')").run(id, 'Incident angelegt');
  if (value.findingIds.length) {
    const update = database.prepare("UPDATE soc_findings SET status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?");
    value.findingIds.forEach((findingId) => update.run(findingId));
  }
  audit('SOC_INCIDENT_CREATED', value.host ?? '-', `#${number} ${value.title}`, user);
  return getIncident(id);
}

const LABEL: Record<string, string> = {
  open: 'Offen', in_progress: 'In Bearbeitung', resolved: 'Gelöst', closed: 'Geschlossen',
  info: 'Info', low: 'Niedrig', medium: 'Mittel', high: 'Hoch', critical: 'Kritisch',
};

export function updateIncident(id: string, input: any, user?: string) {
  const current = getIncident(id);
  if (!current) throw Object.assign(new Error('Incident not found'), { status: 404 });
  const value = validateIncident({ ...current, ...input });
  const database = db();
  database
    .prepare('UPDATE soc_incidents SET title = ?, host = ?, severity = ?, status = ?, description = ?, event_refs = ?, rule_ids = ?, event_ids = ?, checks = ?, finding_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(value.title, value.host, value.severity, value.status, value.description, json(value.eventRefs), json(value.ruleIds), json(value.eventIds), json(value.checks), json(value.findingIds), id);
  const changes: string[] = [];
  if (current.status !== value.status) changes.push(`Status: ${LABEL[current.status] ?? current.status} → ${LABEL[value.status] ?? value.status}`);
  if (current.severity !== value.severity) changes.push(`Schwere: ${LABEL[current.severity] ?? current.severity} → ${LABEL[value.severity] ?? value.severity}`);
  if (current.eventRefs.length !== value.eventRefs.length) changes.push(`Events: ${current.eventRefs.length} → ${value.eventRefs.length}`);
  if (changes.length) database.prepare("INSERT INTO soc_incident_notes (incident_id, text, kind) VALUES (?, ?, 'system')").run(id, changes.join(' · '));
  audit('SOC_INCIDENT_UPDATED', value.host ?? '-', `#${current.number} ${changes.join(', ') || 'bearbeitet'}`, user);
  return getIncident(id);
}

export function addIncidentNote(id: string, note: string, user?: string) {
  const current = getIncident(id);
  if (!current) throw Object.assign(new Error('Incident not found'), { status: 404 });
  const value = text(note, 4000);
  if (!value) throw Object.assign(new Error('Notiz ist leer'), { status: 400 });
  db().prepare("INSERT INTO soc_incident_notes (incident_id, text, kind) VALUES (?, ?, 'note')").run(id, value);
  db().prepare('UPDATE soc_incidents SET updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  audit('SOC_INCIDENT_NOTE', current.host ?? '-', `#${current.number}`, user);
  return getIncident(id);
}

export function deleteIncident(id: string, user?: string) {
  const current = getIncident(id);
  if (!current) throw Object.assign(new Error('Incident not found'), { status: 404 });
  db().transaction(() => {
    db().prepare('DELETE FROM soc_incident_notes WHERE incident_id = ?').run(id);
    db().prepare('DELETE FROM soc_incidents WHERE id = ?').run(id);
  })();
  audit('SOC_INCIDENT_DELETED', current.host ?? '-', `#${current.number} ${current.title}`, user);
  return { deleted: true };
}

/* ---------- scan history ---------- */

export function saveScan(host: string, hours: number, result: unknown) {
  const id = randomUUID();
  db().prepare('INSERT INTO soc_scans (id, host, hours, result) VALUES (?, ?, ?, ?)').run(id, host, hours, JSON.stringify(result));
  // keep the last 20 scans per host
  db().prepare('DELETE FROM soc_scans WHERE host = ? AND id NOT IN (SELECT id FROM soc_scans WHERE host = ? ORDER BY created_at DESC LIMIT 20)').run(host, host);
  return id;
}

export function listScans(host?: string) {
  const rows = (host
    ? db().prepare('SELECT id, host, hours, created_at, result FROM soc_scans WHERE host = ? ORDER BY created_at DESC LIMIT 50').all(host)
    : db().prepare('SELECT id, host, hours, created_at, result FROM soc_scans ORDER BY created_at DESC LIMIT 50').all()) as any[];
  return rows.map((row) => {
    const result = parse<any>(row.result, {});
    return { id: row.id, host: row.host, hours: row.hours, createdAt: utc(row.created_at), findings: result.findings?.length ?? 0, worst: result.summary?.worst ?? 'info' };
  });
}

export function getScan(id: string) {
  const row: any = db().prepare('SELECT * FROM soc_scans WHERE id = ?').get(id);
  return row ? { id: row.id, host: row.host, hours: row.hours, createdAt: utc(row.created_at), ...parse<any>(row.result, {}) } : null;
}

/** Attach the AI evaluation to a stored scan */
export function saveScanAnalysis(id: string, analysis: unknown, user?: string) {
  const row: any = db().prepare('SELECT host, result FROM soc_scans WHERE id = ?').get(id);
  if (!row) throw Object.assign(new Error('Scan not found'), { status: 404 });
  const result = parse<any>(row.result, {});
  db().prepare('UPDATE soc_scans SET result = ? WHERE id = ?').run(JSON.stringify({ ...result, ai: analysis }), id);
  audit('SOC_SCAN_AI_ANALYSIS', row.host, `Scan ${id.slice(0, 8)} mit Claude ausgewertet`, user);
}
