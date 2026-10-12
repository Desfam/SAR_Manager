// Alert engine for the SAR part: thresholds with a spike filter, offline detection and notifications.
// Desktop notifications are shown by the Electron main process from the notification log; ntfy, Discord and a
// generic webhook are sent from here.
import net from 'net';
import { getDatabase, alertsDb, thresholdsDb, connectionDb } from './database.js';

export type AlertType = 'cpu' | 'memory' | 'disk' | 'offline';
export type Level = 'warning' | 'critical';

export interface AlertSettings {
  /** consecutive measurements over the threshold before an alert fires (spike filter) */
  sustainChecks: number;
  offline: { enabled: boolean; afterChecks: number };
  notify: {
    minSeverity: Level;
    types: Record<AlertType, boolean>;
    onResolve: boolean;
    /** no repeat notification for the same host and type within this time */
    cooldownMinutes: number;
  };
  channels: {
    desktop: { enabled: boolean; sound: boolean };
    ntfy: { enabled: boolean; server: string; topic: string; token: string };
    discord: { enabled: boolean; webhookUrl: string };
    webhook: { enabled: boolean; url: string };
  };
}

const DEFAULTS: AlertSettings = {
  sustainChecks: 2,
  offline: { enabled: true, afterChecks: 2 },
  notify: { minSeverity: 'warning', types: { cpu: true, memory: true, disk: true, offline: true }, onResolve: true, cooldownMinutes: 30 },
  channels: {
    desktop: { enabled: true, sound: true },
    ntfy: { enabled: false, server: 'https://ntfy.sh', topic: '', token: '' },
    discord: { enabled: false, webhookUrl: '' },
    webhook: { enabled: false, url: '' },
  },
};

const LABEL: Record<AlertType, string> = { cpu: 'CPU', memory: 'Arbeitsspeicher', disk: 'Festplatte', offline: 'Erreichbarkeit' };
const LEVEL_LABEL: Record<Level, string> = { warning: 'Warnung', critical: 'Kritisch' };

/* ---------- storage ---------- */

let ready = false;
function db() {
  const database = getDatabase();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS alert_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE IF NOT EXISTS notification_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        connection_id TEXT,
        alert_type TEXT,
        channels TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_notification_log_created ON notification_log(created_at);
    `);
    ready = true;
  }
  return database;
}

const merge = <T,>(base: T, value: any): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return (value ?? base) as T;
  const result: any = { ...base };
  for (const [key, entry] of Object.entries(value)) result[key] = key in (base as any) && typeof (base as any)[key] === 'object' && !Array.isArray((base as any)[key]) ? merge((base as any)[key], entry) : entry;
  return result;
};

export function getSettings(): AlertSettings {
  const row: any = db().prepare("SELECT value FROM alert_settings WHERE key = 'settings'").get();
  try {
    return merge(DEFAULTS, row ? JSON.parse(row.value) : {});
  } catch {
    return DEFAULTS;
  }
}

const SECRET = '••••••';
const mask = (value: string) => (value ? `${SECRET}${value.slice(-4)}` : '');

/** Settings for the UI: secrets (Discord URL, ntfy token, webhook URL) only as a hint */
export function publicSettings() {
  const settings = getSettings();
  return {
    ...settings,
    channels: {
      ...settings.channels,
      ntfy: { ...settings.channels.ntfy, token: mask(settings.channels.ntfy.token) },
      discord: { ...settings.channels.discord, webhookUrl: mask(settings.channels.discord.webhookUrl) },
      webhook: { ...settings.channels.webhook, url: mask(settings.channels.webhook.url) },
    },
  };
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};
const httpUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) return '';
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw Object.assign(new Error('Nur http(s)-Adressen erlaubt'), { status: 400 });
  return url.toString();
};
/** keep the stored secret when the UI sends back the masked value */
const keep = (incoming: unknown, current: string, parse: (value: unknown) => string) =>
  typeof incoming === 'string' && incoming.startsWith(SECRET) ? current : parse(incoming);

export function saveSettings(input: any) {
  const current = getSettings();
  const next = merge(current, input ?? {});
  const settings: AlertSettings = {
    sustainChecks: clamp(next.sustainChecks, 1, 20, DEFAULTS.sustainChecks),
    offline: { enabled: !!next.offline.enabled, afterChecks: clamp(next.offline.afterChecks, 1, 20, DEFAULTS.offline.afterChecks) },
    notify: {
      minSeverity: next.notify.minSeverity === 'critical' ? 'critical' : 'warning',
      types: { cpu: !!next.notify.types.cpu, memory: !!next.notify.types.memory, disk: !!next.notify.types.disk, offline: !!next.notify.types.offline },
      onResolve: !!next.notify.onResolve,
      cooldownMinutes: clamp(next.notify.cooldownMinutes, 0, 24 * 60, DEFAULTS.notify.cooldownMinutes),
    },
    channels: {
      desktop: { enabled: !!next.channels.desktop.enabled, sound: !!next.channels.desktop.sound },
      ntfy: {
        enabled: !!next.channels.ntfy.enabled,
        server: httpUrl(next.channels.ntfy.server) || DEFAULTS.channels.ntfy.server,
        topic: String(next.channels.ntfy.topic ?? '').trim().replace(/[^\w-]/g, '').slice(0, 64),
        token: keep(input?.channels?.ntfy?.token, current.channels.ntfy.token, (value) => String(value ?? '').trim().slice(0, 200)),
      },
      discord: { enabled: !!next.channels.discord.enabled, webhookUrl: keep(input?.channels?.discord?.webhookUrl, current.channels.discord.webhookUrl, httpUrl) },
      webhook: { enabled: !!next.channels.webhook.enabled, url: keep(input?.channels?.webhook?.url, current.channels.webhook.url, httpUrl) },
    },
  };
  db().prepare("INSERT INTO alert_settings (key, value, updated_at) VALUES ('settings', ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP").run(JSON.stringify(settings));
  return publicSettings();
}

/* ---------- notifications ---------- */

export interface NotificationEvent {
  kind: 'triggered' | 'escalated' | 'resolved' | 'test';
  severity: Level | 'info';
  title: string;
  body: string;
  connectionId?: string;
  alertType?: AlertType;
}

const lastSent = new Map<string, number>();

async function post(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
}

async function sendExternal(event: NotificationEvent, settings: AlertSettings) {
  const results: Record<string, string> = {};
  const { ntfy, discord, webhook } = settings.channels;
  const jobs: Array<Promise<void>> = [];
  if (ntfy.enabled && ntfy.topic) {
    jobs.push(
      post(`${ntfy.server.replace(/\/$/, '')}/${encodeURIComponent(ntfy.topic)}`, {
        method: 'POST',
        body: event.body,
        headers: {
          Title: encodeURIComponent(event.title).length === event.title.length ? event.title : `=?UTF-8?B?${Buffer.from(event.title).toString('base64')}?=`,
          Priority: event.severity === 'critical' ? '5' : event.severity === 'warning' ? '4' : '3',
          Tags: event.kind === 'resolved' ? 'white_check_mark' : event.severity === 'critical' ? 'rotating_light' : 'warning',
          ...(ntfy.token ? { Authorization: `Bearer ${ntfy.token}` } : {}),
        },
      }).then(() => void (results.ntfy = 'ok'), (error) => void (results.ntfy = error.message)),
    );
  }
  if (discord.enabled && discord.webhookUrl) {
    const color = event.kind === 'resolved' ? 0x22c55e : event.severity === 'critical' ? 0xef4444 : event.severity === 'warning' ? 0xf59e0b : 0x64748b;
    jobs.push(
      post(discord.webhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'SAR Manager', embeds: [{ title: event.title, description: event.body, color, timestamp: new Date().toISOString() }] }) })
        .then(() => void (results.discord = 'ok'), (error) => void (results.discord = error.message)),
    );
  }
  if (webhook.enabled && webhook.url) {
    jobs.push(
      post(webhook.url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'sar-manager', ...event, text: `${event.title}\n${event.body}`, at: new Date().toISOString() }) })
        .then(() => void (results.webhook = 'ok'), (error) => void (results.webhook = error.message)),
    );
  }
  await Promise.all(jobs);
  return results;
}

/** Log the notification (the desktop app reads the log) and send it to the external channels */
export async function notify(event: NotificationEvent, options: { force?: boolean } = {}) {
  const settings = getSettings();
  if (!options.force && event.kind !== 'test') {
    if (event.alertType && !settings.notify.types[event.alertType]) return null;
    if (event.kind !== 'resolved' && settings.notify.minSeverity === 'critical' && event.severity !== 'critical') return null;
    if (event.kind === 'resolved' && !settings.notify.onResolve) return null;
    const key = `${event.connectionId}|${event.alertType}|${event.kind === 'resolved' ? 'resolved' : 'fire'}`;
    const last = lastSent.get(key) ?? 0;
    // escalations to critical always go out
    if (event.kind !== 'escalated' && Date.now() - last < settings.notify.cooldownMinutes * 60_000) return null;
    lastSent.set(key, Date.now());
  }
  const channels: Record<string, string> = settings.channels.desktop.enabled ? { desktop: 'ok' } : {};
  const info = db()
    .prepare('INSERT INTO notification_log (kind, severity, title, body, connection_id, alert_type, channels) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(event.kind, event.severity, event.title, event.body, event.connectionId ?? null, event.alertType ?? null, JSON.stringify(channels));
  const id = Number(info.lastInsertRowid);
  const external = await sendExternal(event, settings).catch(() => ({}));
  if (Object.keys(external).length) db().prepare('UPDATE notification_log SET channels = ? WHERE id = ?').run(JSON.stringify({ ...channels, ...external }), id);
  db().prepare("DELETE FROM notification_log WHERE created_at < datetime('now', '-30 days')").run();
  return { id, channels: { ...channels, ...external } };
}

export function notificationLog(after = 0, limit = 50) {
  const rows = db().prepare('SELECT * FROM notification_log WHERE id > ? ORDER BY id DESC LIMIT ?').all(after, Math.min(Math.max(limit, 1), 200)) as any[];
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    severity: row.severity,
    title: row.title,
    body: row.body,
    connectionId: row.connection_id,
    alertType: row.alert_type,
    channels: JSON.parse(row.channels || '{}'),
    createdAt: /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.created_at) ? `${row.created_at.replace(' ', 'T')}Z` : row.created_at,
    sound: getSettings().channels.desktop.sound,
    desktop: getSettings().channels.desktop.enabled,
  }));
}

export function sendTest() {
  return notify({ kind: 'test', severity: 'info', title: 'SAR Manager: Test-Benachrichtigung', body: `Wenn du das liest, kommen Benachrichtigungen an (${new Date().toLocaleString('de-DE')}).` }, { force: true });
}

/* ---------- evaluation ---------- */

const breaches = new Map<string, number>();
/** alerts this engine notified about; only those get a "resolved" message (not stale ones from before a restart) */
const notified = new Set<string>();
const RANK = { info: 0, warning: 1, critical: 2 } as const;

function fire(connection: any, type: AlertType, level: Level, message: string, threshold: number | null, value: number | null) {
  const existing: any = getDatabase().prepare('SELECT id, severity FROM alerts WHERE connection_id = ? AND alert_type = ? AND is_resolved = 0 LIMIT 1').get(connection.id, type);
  alertsDb.upsert({ connectionId: connection.id, alertType: type, severity: level, message, thresholdValue: threshold, actualValue: value });
  const kind = !existing ? 'triggered' : RANK[level] > RANK[existing.severity as Level] ? 'escalated' : null;
  if (kind) notified.add(`${connection.id}|${type}`);
  if (kind) void notify({ kind, severity: level, title: `${LEVEL_LABEL[level]}: ${connection.name} · ${LABEL[type]}`, body: message, connectionId: connection.id, alertType: type });
}

function clear(connection: any, type: AlertType, message: string) {
  const existing: any = getDatabase().prepare('SELECT id, severity FROM alerts WHERE connection_id = ? AND alert_type = ? AND is_resolved = 0 LIMIT 1').get(connection.id, type);
  if (!existing) return;
  alertsDb.resolveByType(connection.id, type);
  if (!notified.delete(`${connection.id}|${type}`)) return;
  void notify({ kind: 'resolved', severity: existing.severity, title: `Behoben: ${connection.name} · ${LABEL[type]}`, body: message, connectionId: connection.id, alertType: type });
}

/** Called by the metrics scheduler for every measurement */
export function evaluateMetrics(connection: any, metrics: { cpu: number; memory: number; disk: number }) {
  const settings = getSettings();
  const t: any = thresholdsDb.getFor(connection.id) || { cpu_warning: 70, cpu_critical: 85, memory_warning: 75, memory_critical: 90, disk_warning: 80, disk_critical: 95 };
  const checks: Array<[AlertType, number, number, number]> = [
    ['cpu', metrics.cpu, t.cpu_warning, t.cpu_critical],
    ['memory', metrics.memory, t.memory_warning, t.memory_critical],
    ['disk', metrics.disk, t.disk_warning, t.disk_critical],
  ];
  for (const [type, value, warning, critical] of checks) {
    if (!Number.isFinite(value)) continue;
    const key = `${connection.id}|${type}`;
    const level: Level | null = value >= critical ? 'critical' : value >= warning ? 'warning' : null;
    if (!level) {
      breaches.delete(key);
      clear(connection, type, `${LABEL[type]} wieder bei ${value.toFixed(0)} % (unter ${warning} %).`);
      continue;
    }
    const count = (breaches.get(key) ?? 0) + 1;
    breaches.set(key, count);
    // disk changes slowly, a single measurement is enough; CPU/RAM must stay high (spike filter)
    if (type !== 'disk' && count < settings.sustainChecks) continue;
    const limit = level === 'critical' ? critical : warning;
    const sustained = type === 'disk' ? '' : ` seit ${count} Messungen`;
    fire(connection, type, level, `${LABEL[type]} bei ${value.toFixed(1)} %${sustained} (Schwelle ${LEVEL_LABEL[level]}: ${limit} %).`, limit, value);
  }
}

/* ---------- reachability ---------- */

const failures = new Map<string, number>();

function reachable(host: string, port: number, timeout = 4000) {
  return new Promise<boolean>((resolve) => {
    const socket = net.connect({ host, port });
    const done = (ok: boolean) => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeout, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

/** TCP check of every saved system (SSH or RDP port); offline after N failed checks in a row */
export async function probeConnections() {
  const settings = getSettings();
  if (!settings.offline.enabled) return;
  const connections = connectionDb.getAll() as any[];
  await Promise.all(
    connections.map(async (connection) => {
      const port = Number(connection.port) || (connection.type === 'rdp' ? 3389 : 22);
      const ok = await reachable(connection.host, port);
      if (ok) {
        failures.delete(connection.id);
        clear(connection, 'offline', `${connection.name} (${connection.host}:${port}) ist wieder erreichbar.`);
        return;
      }
      const count = (failures.get(connection.id) ?? 0) + 1;
      failures.set(connection.id, count);
      if (count >= settings.offline.afterChecks) {
        fire(connection, 'offline', 'critical', `${connection.name} (${connection.host}:${port}) antwortet seit ${count} Prüfungen nicht.`, null, null);
      }
    }),
  );
}

/* ---------- read models ---------- */

export function alertList(options: { status: 'active' | 'history'; days: number }) {
  // records from the old df parsing bug (disk far above 100 %) are hidden, not deleted
  const rows = (options.status === 'active'
    ? getDatabase().prepare('SELECT a.*, c.name AS connection_name, c.host AS connection_host FROM alerts a LEFT JOIN connections c ON c.id = a.connection_id WHERE a.is_resolved = 0 ORDER BY CASE a.severity WHEN \'critical\' THEN 0 ELSE 1 END, a.created_at DESC').all()
    : getDatabase().prepare("SELECT a.*, c.name AS connection_name, c.host AS connection_host FROM alerts a LEFT JOIN connections c ON c.id = a.connection_id WHERE a.created_at >= datetime('now', ?) AND NOT (a.alert_type = 'disk' AND a.actual_value > 100) ORDER BY a.created_at DESC LIMIT 500").all(`-${options.days} days`)) as any[];
  const utc = (value?: string | null) => (value && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(' ', 'T')}Z` : value ?? null);
  return rows.map((row) => ({
    id: row.id,
    connectionId: row.connection_id,
    connectionName: row.connection_name ?? row.connection_id,
    host: row.connection_host,
    type: row.alert_type,
    severity: row.severity,
    message: row.message,
    threshold: row.threshold_value,
    value: row.actual_value,
    resolved: !!row.is_resolved,
    createdAt: utc(row.created_at),
    resolvedAt: utc(row.resolved_at),
  }));
}

export function thresholdOverview() {
  const global: any = thresholdsDb.getFor() ?? { cpu_warning: 70, cpu_critical: 85, memory_warning: 75, memory_critical: 90, disk_warning: 80, disk_critical: 95 };
  const overrides = getDatabase().prepare('SELECT t.*, c.name AS connection_name FROM alert_thresholds t JOIN connections c ON c.id = t.connection_id WHERE t.connection_id IS NOT NULL').all() as any[];
  const shape = (row: any) => ({ cpuWarning: row.cpu_warning, cpuCritical: row.cpu_critical, memoryWarning: row.memory_warning, memoryCritical: row.memory_critical, diskWarning: row.disk_warning, diskCritical: row.disk_critical });
  return { global: shape(global), overrides: overrides.map((row) => ({ connectionId: row.connection_id, connectionName: row.connection_name, ...shape(row) })) };
}

export function saveThresholds(connectionId: string | null, input: any) {
  const value = (key: string, fallback: number) => clamp(input?.[key], 1, 100, fallback);
  const thresholds = {
    cpuWarning: value('cpuWarning', 70),
    cpuCritical: value('cpuCritical', 85),
    memoryWarning: value('memoryWarning', 75),
    memoryCritical: value('memoryCritical', 90),
    diskWarning: value('diskWarning', 80),
    diskCritical: value('diskCritical', 95),
  };
  for (const kind of ['cpu', 'memory', 'disk']) {
    if ((thresholds as any)[`${kind}Warning`] >= (thresholds as any)[`${kind}Critical`]) throw Object.assign(new Error(`${LABEL[kind as AlertType]}: Warnung muss unter Kritisch liegen`), { status: 400 });
  }
  // setFor matches "connection_id = ?", which never matches NULL: handle the global row directly
  if (connectionId === null) {
    const database = getDatabase();
    const existing = database.prepare('SELECT id FROM alert_thresholds WHERE connection_id IS NULL').get();
    if (existing) database.prepare('UPDATE alert_thresholds SET cpu_warning = ?, cpu_critical = ?, memory_warning = ?, memory_critical = ?, disk_warning = ?, disk_critical = ?, updated_at = CURRENT_TIMESTAMP WHERE connection_id IS NULL').run(thresholds.cpuWarning, thresholds.cpuCritical, thresholds.memoryWarning, thresholds.memoryCritical, thresholds.diskWarning, thresholds.diskCritical);
    else database.prepare('INSERT INTO alert_thresholds (connection_id, cpu_warning, cpu_critical, memory_warning, memory_critical, disk_warning, disk_critical) VALUES (NULL, ?, ?, ?, ?, ?, ?)').run(thresholds.cpuWarning, thresholds.cpuCritical, thresholds.memoryWarning, thresholds.memoryCritical, thresholds.diskWarning, thresholds.diskCritical);
  } else {
    if (!connectionDb.getById(connectionId)) throw Object.assign(new Error('System nicht gefunden'), { status: 404 });
    thresholdsDb.setFor(connectionId, thresholds);
  }
  return thresholdOverview();
}

export function deleteOverride(connectionId: string) {
  getDatabase().prepare('DELETE FROM alert_thresholds WHERE connection_id = ?').run(connectionId);
  return thresholdOverview();
}
