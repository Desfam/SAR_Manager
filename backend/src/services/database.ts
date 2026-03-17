import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { mkdir } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db: Database.Database;

export async function initDatabase(): Promise<Database.Database> {
  const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '../../data/ssh-manager.db');
  
  // Ensure data directory exists
  await mkdir(path.dirname(dbPath), { recursive: true });
  
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  
  // Create tables
  createTables();

  // Migrate: add IO rate columns to databases that predate this feature
  for (const col of ['net_rx_rate', 'net_tx_rate', 'disk_read_rate', 'disk_write_rate']) {
    try {
      db.exec(`ALTER TABLE metrics_history ADD COLUMN ${col} REAL`);
    } catch {
      // Column already exists – ignore
    }
  }

  return db;
}

function createTables() {
  // SSH/RDP Connections table
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('ssh', 'rdp')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT NOT NULL,
      auth_type TEXT NOT NULL CHECK(auth_type IN ('password', 'key')),
      password TEXT,
      private_key_path TEXT,
      tags TEXT,
      status TEXT DEFAULT 'offline',
      last_connected TEXT,
      last_seen TEXT,
      os TEXT,
      is_favorite INTEGER DEFAULT 0,
      connection_group TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Add new columns if they don't exist (migration)
  try {
    db.exec('ALTER TABLE connections ADD COLUMN last_seen TEXT');
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE connections ADD COLUMN is_favorite INTEGER DEFAULT 0');
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec('ALTER TABLE connections ADD COLUMN connection_group TEXT');
  } catch (e) {
    // Column already exists
  }

  // Scripts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS scripts (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      script_type TEXT NOT NULL CHECK(script_type IN ('bash', 'powershell', 'python')),
      content TEXT NOT NULL,
      tags TEXT,
      is_scheduled BOOLEAN DEFAULT 0,
      schedule_cron TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Script executions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS script_executions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      script_id TEXT NOT NULL,
      connection_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('running', 'success', 'failed')),
      output TEXT,
      error TEXT,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      finished_at TEXT,
      FOREIGN KEY (script_id) REFERENCES scripts(id),
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Audit logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user TEXT NOT NULL,
      action TEXT NOT NULL,
      target TEXT,
      details TEXT,
      status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
      ip_address TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Port forwarding table
  db.exec(`
    CREATE TABLE IF NOT EXISTS port_forwards (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      connection_id TEXT NOT NULL,
      local_port INTEGER NOT NULL,
      remote_host TEXT NOT NULL,
      remote_port INTEGER NOT NULL,
      status TEXT DEFAULT 'inactive' CHECK(status IN ('active', 'inactive')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  try {
    db.exec("ALTER TABLE port_forwards ADD COLUMN type TEXT DEFAULT 'local'");
  } catch (e) {
    // Column already exists
  }

  // Security scans table
  db.exec(`
    CREATE TABLE IF NOT EXISTS security_scans (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      scan_type TEXT NOT NULL,
      score INTEGER,
      issues TEXT,
      passed_checks TEXT,
      critical_issues INTEGER DEFAULT 0,
      scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Add passed_checks column if it doesn't exist (migration)
  try {
    db.exec('ALTER TABLE security_scans ADD COLUMN passed_checks TEXT');
  } catch (e) {
    // Column already exists, ignore error
  }

  // Vulnerabilities table
  db.exec(`
    CREATE TABLE IF NOT EXISTS vulnerabilities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      package TEXT NOT NULL,
      installed_version TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low')),
      description TEXT NOT NULL,
      cve_id TEXT,
      scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Metrics history table for storing historical data
  db.exec(`
    CREATE TABLE IF NOT EXISTS metrics_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      cpu_usage REAL,
      memory_usage REAL,
      disk_usage REAL,
      load_avg_1 REAL,
      load_avg_5 REAL,
      load_avg_15 REAL,
      recorded_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Alerts table for threshold violations
  db.exec(`
    CREATE TABLE IF NOT EXISTS alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT NOT NULL,
      alert_type TEXT NOT NULL CHECK(alert_type IN ('cpu', 'memory', 'disk', 'offline', 'service')),
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      message TEXT NOT NULL,
      threshold_value REAL,
      actual_value REAL,
      is_resolved BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Alert thresholds configuration
  db.exec(`
    CREATE TABLE IF NOT EXISTS alert_thresholds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      connection_id TEXT,
      cpu_warning REAL DEFAULT 70,
      cpu_critical REAL DEFAULT 85,
      memory_warning REAL DEFAULT 75,
      memory_critical REAL DEFAULT 90,
      disk_warning REAL DEFAULT 80,
      disk_critical REAL DEFAULT 95,
      check_services BOOLEAN DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (connection_id) REFERENCES connections(id)
    )
  `);

  // Users table for authentication
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      role TEXT DEFAULT 'user' CHECK(role IN ('admin', 'user', 'readonly')),
      is_active BOOLEAN DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_login TEXT
    )
  `);

  // Planner tasks table
  db.exec(`
    CREATE TABLE IF NOT EXISTS planner_tasks (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT DEFAULT 'medium' CHECK(priority IN ('low', 'medium', 'high', 'critical')),
      deadline TEXT,
      status TEXT DEFAULT 'todo' CHECK(status IN ('todo', 'in_progress', 'done')),
      tags TEXT,
      linked_event_id TEXT,
      linked_note_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Planner events table
  db.exec(`
    CREATE TABLE IF NOT EXISTS planner_events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT,
      description TEXT,
      checklist TEXT,
      attachments TEXT,
      linked_task_id TEXT,
      linked_note_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Planner notes table
  db.exec(`
    CREATE TABLE IF NOT EXISTS planner_notes (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      tags TEXT,
      folder TEXT,
      linked_task_id TEXT,
      linked_event_id TEXT,
      linked_connection_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Planner quick links table
  db.exec(`
    CREATE TABLE IF NOT EXISTS planner_quick_links (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      icon TEXT,
      category TEXT DEFAULT 'service',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_connections_type ON connections(type);
    CREATE INDEX IF NOT EXISTS idx_connections_status ON connections(status);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_script_executions_status ON script_executions(status);
    CREATE INDEX IF NOT EXISTS idx_vulnerabilities_connection ON vulnerabilities(connection_id);
    CREATE INDEX IF NOT EXISTS idx_vulnerabilities_scanned_at ON vulnerabilities(scanned_at);
    CREATE INDEX IF NOT EXISTS idx_metrics_history_connection ON metrics_history(connection_id);
    CREATE INDEX IF NOT EXISTS idx_metrics_history_recorded_at ON metrics_history(recorded_at);
    CREATE INDEX IF NOT EXISTS idx_alerts_connection ON alerts(connection_id);
    CREATE INDEX IF NOT EXISTS idx_alerts_type ON alerts(alert_type);
    CREATE INDEX IF NOT EXISTS idx_alerts_resolved ON alerts(is_resolved);
    CREATE INDEX IF NOT EXISTS idx_planner_tasks_status ON planner_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_planner_tasks_deadline ON planner_tasks(deadline);
    CREATE INDEX IF NOT EXISTS idx_planner_events_start_at ON planner_events(start_at);
    CREATE INDEX IF NOT EXISTS idx_planner_notes_folder ON planner_notes(folder);
    CREATE INDEX IF NOT EXISTS idx_planner_quick_links_sort ON planner_quick_links(sort_order);
  `);
}

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// Connection operations
export const connectionDb = {
  getAll: () => {
    return db.prepare('SELECT * FROM connections ORDER BY name').all();
  },
  
  getById: (id: string) => {
    return db.prepare('SELECT * FROM connections WHERE id = ?').get(id);
  },
  
  create: (connection: any) => {
    const stmt = db.prepare(`
      INSERT INTO connections (id, name, type, host, port, username, auth_type, password, private_key_path, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      connection.id,
      connection.name,
      connection.type,
      connection.host,
      connection.port,
      connection.username,
      connection.authType,
      connection.password,
      connection.privateKeyPath,
      JSON.stringify(connection.tags || [])
    );
  },
  
  update: (id: string, connection: any) => {
    const stmt = db.prepare(`
      UPDATE connections 
      SET name = ?, host = ?, port = ?, username = ?, auth_type = ?, 
          password = ?, private_key_path = ?, tags = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    return stmt.run(
      connection.name,
      connection.host,
      connection.port,
      connection.username,
      connection.authType,
      connection.password,
      connection.privateKeyPath,
      JSON.stringify(connection.tags || []),
      id
    );
  },
  
  delete: (id: string) => {
    return db.prepare('DELETE FROM connections WHERE id = ?').run(id);
  },
  
  updateStatus: (id: string, status: string) => {
    return db.prepare('UPDATE connections SET status = ?, last_connected = CURRENT_TIMESTAMP WHERE id = ?').run(status, id);
  },
  
  getDb: (): Database.Database => {
    return db;
  },
};

// Audit log operations
export const auditLogDb = {
  create: (log: any) => {
    const stmt = db.prepare(`
      INSERT INTO audit_logs (user, action, target, details, status, ip_address)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      log.user,
      log.action,
      log.target,
      log.details,
      log.status,
      log.ipAddress
    );
  },
  
  getRecent: (limit: number = 100) => {
    return db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit);
  },
};

// Vulnerability operations
export const vulnerabilityDb = {
  save: (connectionId: string, vulnerabilities: any[]) => {
    // Delete old vulnerabilities for this connection
    db.prepare('DELETE FROM vulnerabilities WHERE connection_id = ?').run(connectionId);
    
    // Insert new vulnerabilities
    const stmt = db.prepare(`
      INSERT INTO vulnerabilities (connection_id, package, installed_version, severity, description, cve_id, scanned_at)
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    for (const vuln of vulnerabilities) {
      stmt.run(
        connectionId,
        vuln.package,
        vuln.installedVersion,
        vuln.severity,
        vuln.description,
        vuln.cveId || null
      );
    }
    
    return { saved: vulnerabilities.length };
  },

  getByConnectionId: (connectionId: string) => {
    return db.prepare(`
      SELECT * FROM vulnerabilities 
      WHERE connection_id = ? 
      ORDER BY 
        CASE severity 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          ELSE 4 
        END,
        scanned_at DESC
    `).all(connectionId);
  },

  getLatestScan: (connectionId: string) => {
    return db.prepare(`
      SELECT MAX(scanned_at) as last_scan 
      FROM vulnerabilities 
      WHERE connection_id = ?
    `).get(connectionId);
  },

  deleteByConnectionId: (connectionId: string) => {
    return db.prepare('DELETE FROM vulnerabilities WHERE connection_id = ?').run(connectionId);
  },
};

// Metrics history operations
export const metricsDb = {
  save: (connectionId: string, metrics: any) => {
    // Accept both legacy flat payloads and nested payloads.
    const cpuUsage =
      typeof metrics?.cpu === 'number'
        ? metrics.cpu
        : metrics?.cpu?.usage ?? null;
    const memoryUsage =
      typeof metrics?.memory === 'number'
        ? metrics.memory
        : metrics?.memory?.percentUsed ?? null;
    const diskUsage =
      typeof metrics?.disk === 'number'
        ? metrics.disk
        : metrics?.disk?.percentUsed ?? null;
    const loadAvg1 =
      typeof metrics?.loadAvg1 === 'number'
        ? metrics.loadAvg1
        : metrics?.loadAverage?.one ?? null;
    const loadAvg5 =
      typeof metrics?.loadAvg5 === 'number'
        ? metrics.loadAvg5
        : metrics?.loadAverage?.five ?? null;
    const loadAvg15 =
      typeof metrics?.loadAvg15 === 'number'
        ? metrics.loadAvg15
        : metrics?.loadAverage?.fifteen ?? null;
    const netRxRate = typeof metrics?.netRxRate === 'number' ? metrics.netRxRate : null;
    const netTxRate = typeof metrics?.netTxRate === 'number' ? metrics.netTxRate : null;
    const diskReadRate = typeof metrics?.diskReadRate === 'number' ? metrics.diskReadRate : null;
    const diskWriteRate = typeof metrics?.diskWriteRate === 'number' ? metrics.diskWriteRate : null;

    if (
      cpuUsage === null &&
      memoryUsage === null &&
      diskUsage === null &&
      loadAvg1 === null &&
      loadAvg5 === null &&
      loadAvg15 === null
    ) {
      return { changes: 0, lastInsertRowid: 0 };
    }

    const stmt = db.prepare(`
      INSERT INTO metrics_history
        (connection_id, cpu_usage, memory_usage, disk_usage, load_avg_1, load_avg_5, load_avg_15,
         net_rx_rate, net_tx_rate, disk_read_rate, disk_write_rate)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      connectionId,
      cpuUsage,
      memoryUsage,
      diskUsage,
      loadAvg1,
      loadAvg5,
      loadAvg15,
      netRxRate,
      netTxRate,
      diskReadRate,
      diskWriteRate
    );
  },

  getHistory: (connectionId: string, hours: number = 24) => {
    const since = new Date(Date.now() - hours * 3600000).toISOString();
    // No artificial minimum - let the data speak for itself
    const maxRows = Math.min(Math.max(hours * 120, 100), 100000);
    // Use datetime() to normalize format differences (stored timestamps are not ISO-8601 with T/Z)
    return db.prepare(`
      SELECT * FROM metrics_history 
      WHERE connection_id = ? AND recorded_at > datetime(?)
      ORDER BY recorded_at DESC
      LIMIT ?
    `).all(connectionId, since, maxRows);
  },

  getLatest: (connectionId: string) => {
    return db.prepare(`
      SELECT * FROM metrics_history 
      WHERE connection_id = ?
      ORDER BY recorded_at DESC
      LIMIT 1
    `).get(connectionId);
  },

  deleteOlderThan: (days: number = 7) => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare('DELETE FROM metrics_history WHERE recorded_at < ?').run(cutoff);
  },
  
  deleteByConnectionId: (connectionId: string) => {
    return db.prepare('DELETE FROM metrics_history WHERE connection_id = ?').run(connectionId);
  },
};

// Alerts operations
export const alertsDb = {
  create: (alert: any) => {
    const stmt = db.prepare(`
      INSERT INTO alerts (connection_id, alert_type, severity, message, threshold_value, actual_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      alert.connectionId,
      alert.alertType,
      alert.severity,
      alert.message,
      alert.thresholdValue,
      alert.actualValue
    );
  },

  // Upsert: update existing active alert of same type, or create new one.
  // Prevents thousands of duplicate rows from polling loops.
  upsert: (alert: any) => {
    const existing: any = db.prepare(`
      SELECT id FROM alerts
      WHERE connection_id = ? AND alert_type = ? AND is_resolved = 0
      LIMIT 1
    `).get(alert.connectionId, alert.alertType);

    if (existing) {
      db.prepare(`
        UPDATE alerts
        SET severity = ?, message = ?, threshold_value = ?, actual_value = ?, created_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(alert.severity, alert.message, alert.thresholdValue, alert.actualValue, existing.id);
      return existing;
    }
    return db.prepare(`
      INSERT INTO alerts (connection_id, alert_type, severity, message, threshold_value, actual_value)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(alert.connectionId, alert.alertType, alert.severity, alert.message, alert.thresholdValue, alert.actualValue);
  },

  // Auto-resolve active alerts of a specific type when metric is back below threshold.
  resolveByType: (connectionId: string, alertType: string) => {
    return db.prepare(`
      UPDATE alerts
      SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP
      WHERE connection_id = ? AND alert_type = ? AND is_resolved = 0
    `).run(connectionId, alertType);
  },

  getActive: (connectionId?: string) => {
    if (connectionId) {
      return db.prepare(`
        SELECT * FROM alerts 
        WHERE connection_id = ? AND is_resolved = 0
        ORDER BY created_at DESC
      `).all(connectionId);
    }
    return db.prepare(`
      SELECT * FROM alerts 
      WHERE is_resolved = 0
      ORDER BY severity, created_at DESC
    `).all();
  },

  getRecent: (connectionId: string, limit: number = 50) => {
    return db.prepare(`
      SELECT * FROM alerts 
      WHERE connection_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(connectionId, limit);
  },

  resolve: (alertId: number) => {
    return db.prepare(`
      UPDATE alerts 
      SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(alertId);
  },

  deleteOlderThan: (days: number = 30) => {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare('DELETE FROM alerts WHERE is_resolved = 1 AND resolved_at < ?').run(cutoff);
  },

  // Prune runaway duplicate unresolved alerts — keep only the latest one per (connection, alert_type).
  pruneDuplicates: () => {
    return db.prepare(`
      DELETE FROM alerts
      WHERE is_resolved = 0
        AND id NOT IN (
          SELECT MAX(id) FROM alerts
          WHERE is_resolved = 0
          GROUP BY connection_id, alert_type
        )
    `).run();
  },

  deleteByConnectionId: (connectionId: string) => {
    return db.prepare('DELETE FROM alerts WHERE connection_id = ?').run(connectionId);
  },
};

// Alert thresholds operations
export const thresholdsDb = {
  getFor: (connectionId?: string) => {
    if (connectionId) {
      return db.prepare(`
        SELECT * FROM alert_thresholds 
        WHERE connection_id = ? OR connection_id IS NULL
        ORDER BY connection_id DESC
        LIMIT 1
      `).get(connectionId);
    }
    return db.prepare('SELECT * FROM alert_thresholds WHERE connection_id IS NULL LIMIT 1').get();
  },

  setFor: (connectionId: string | null, thresholds: any) => {
    const existing = db.prepare('SELECT id FROM alert_thresholds WHERE connection_id = ?').get(connectionId);
    
    if (existing) {
      const stmt = db.prepare(`
        UPDATE alert_thresholds 
        SET cpu_warning = ?, cpu_critical = ?, memory_warning = ?, memory_critical = ?,
            disk_warning = ?, disk_critical = ?, check_services = ?, updated_at = CURRENT_TIMESTAMP
        WHERE connection_id = ?
      `);
      return stmt.run(
        thresholds.cpuWarning || 70,
        thresholds.cpuCritical || 85,
        thresholds.memoryWarning || 75,
        thresholds.memoryCritical || 90,
        thresholds.diskWarning || 80,
        thresholds.diskCritical || 95,
        thresholds.checkServices !== false ? 1 : 0,
        connectionId
      );
    } else {
      const stmt = db.prepare(`
        INSERT INTO alert_thresholds (connection_id, cpu_warning, cpu_critical, memory_warning, memory_critical, disk_warning, disk_critical, check_services)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      return stmt.run(
        connectionId,
        thresholds.cpuWarning || 70,
        thresholds.cpuCritical || 85,
        thresholds.memoryWarning || 75,
        thresholds.memoryCritical || 90,
        thresholds.diskWarning || 80,
        thresholds.diskCritical || 95,
        thresholds.checkServices !== false ? 1 : 0
      );
    }
  },
  
  deleteByConnectionId: (connectionId: string) => {
    return db.prepare('DELETE FROM alert_thresholds WHERE connection_id = ?').run(connectionId);
  },
};

export const plannerDb = {
  listTasks: (status?: string) => {
    if (status) {
      return db
        .prepare('SELECT * FROM planner_tasks WHERE status = ? ORDER BY deadline IS NULL, deadline ASC, created_at DESC')
        .all(status);
    }

    return db
      .prepare('SELECT * FROM planner_tasks ORDER BY deadline IS NULL, deadline ASC, created_at DESC')
      .all();
  },

  getTaskById: (id: string) => {
    return db.prepare('SELECT * FROM planner_tasks WHERE id = ?').get(id);
  },

  createTask: (task: {
    id: string;
    title: string;
    description?: string;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    deadline?: string | null;
    status?: 'todo' | 'in_progress' | 'done';
    tags?: string[];
    linkedEventId?: string | null;
    linkedNoteId?: string | null;
  }) => {
    return db.prepare(`
      INSERT INTO planner_tasks (id, title, description, priority, deadline, status, tags, linked_event_id, linked_note_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      task.id,
      task.title,
      task.description || null,
      task.priority || 'medium',
      task.deadline || null,
      task.status || 'todo',
      JSON.stringify(task.tags || []),
      task.linkedEventId || null,
      task.linkedNoteId || null
    );
  },

  updateTask: (id: string, task: {
    title?: string;
    description?: string | null;
    priority?: 'low' | 'medium' | 'high' | 'critical';
    deadline?: string | null;
    status?: 'todo' | 'in_progress' | 'done';
    tags?: string[];
    linkedEventId?: string | null;
    linkedNoteId?: string | null;
  }) => {
    return db.prepare(`
      UPDATE planner_tasks
      SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        priority = COALESCE(?, priority),
        deadline = ?,
        status = COALESCE(?, status),
        tags = COALESCE(?, tags),
        linked_event_id = ?,
        linked_note_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      task.title ?? null,
      task.description ?? null,
      task.priority ?? null,
      task.deadline ?? null,
      task.status ?? null,
      task.tags ? JSON.stringify(task.tags) : null,
      task.linkedEventId ?? null,
      task.linkedNoteId ?? null,
      id
    );
  },

  deleteTask: (id: string) => {
    return db.prepare('DELETE FROM planner_tasks WHERE id = ?').run(id);
  },

  listEventsInRange: (fromIso?: string, toIso?: string) => {
    if (fromIso && toIso) {
      return db.prepare(`
        SELECT * FROM planner_events
        WHERE start_at <= ? AND (end_at IS NULL OR end_at >= ?)
        ORDER BY start_at ASC
      `).all(toIso, fromIso);
    }

    return db.prepare('SELECT * FROM planner_events ORDER BY start_at ASC').all();
  },

  listUpcomingEvents: (limit: number = 10) => {
    return db.prepare(`
      SELECT * FROM planner_events
      WHERE start_at >= ?
      ORDER BY start_at ASC
      LIMIT ?
    `).all(new Date().toISOString(), limit);
  },

  getEventById: (id: string) => {
    return db.prepare('SELECT * FROM planner_events WHERE id = ?').get(id);
  },

  createEvent: (event: {
    id: string;
    title: string;
    startAt: string;
    endAt?: string | null;
    description?: string;
    checklist?: string[];
    attachments?: string[];
    linkedTaskId?: string | null;
    linkedNoteId?: string | null;
  }) => {
    return db.prepare(`
      INSERT INTO planner_events (id, title, start_at, end_at, description, checklist, attachments, linked_task_id, linked_note_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      event.id,
      event.title,
      event.startAt,
      event.endAt || null,
      event.description || null,
      JSON.stringify(event.checklist || []),
      JSON.stringify(event.attachments || []),
      event.linkedTaskId || null,
      event.linkedNoteId || null
    );
  },

  updateEvent: (id: string, event: {
    title?: string;
    startAt?: string;
    endAt?: string | null;
    description?: string | null;
    checklist?: string[];
    attachments?: string[];
    linkedTaskId?: string | null;
    linkedNoteId?: string | null;
  }) => {
    return db.prepare(`
      UPDATE planner_events
      SET
        title = COALESCE(?, title),
        start_at = COALESCE(?, start_at),
        end_at = ?,
        description = COALESCE(?, description),
        checklist = COALESCE(?, checklist),
        attachments = COALESCE(?, attachments),
        linked_task_id = ?,
        linked_note_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      event.title ?? null,
      event.startAt ?? null,
      event.endAt ?? null,
      event.description ?? null,
      event.checklist ? JSON.stringify(event.checklist) : null,
      event.attachments ? JSON.stringify(event.attachments) : null,
      event.linkedTaskId ?? null,
      event.linkedNoteId ?? null,
      id
    );
  },

  deleteEvent: (id: string) => {
    return db.prepare('DELETE FROM planner_events WHERE id = ?').run(id);
  },

  listNotes: (query?: string) => {
    if (query && query.trim().length > 0) {
      const search = `%${query.trim()}%`;
      return db.prepare(`
        SELECT * FROM planner_notes
        WHERE title LIKE ? OR content LIKE ?
        ORDER BY updated_at DESC
      `).all(search, search);
    }

    return db.prepare('SELECT * FROM planner_notes ORDER BY updated_at DESC').all();
  },

  getNoteById: (id: string) => {
    return db.prepare('SELECT * FROM planner_notes WHERE id = ?').get(id);
  },

  createNote: (note: {
    id: string;
    title: string;
    content: string;
    tags?: string[];
    folder?: string | null;
    linkedTaskId?: string | null;
    linkedEventId?: string | null;
    linkedConnectionId?: string | null;
  }) => {
    return db.prepare(`
      INSERT INTO planner_notes (id, title, content, tags, folder, linked_task_id, linked_event_id, linked_connection_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      note.id,
      note.title,
      note.content,
      JSON.stringify(note.tags || []),
      note.folder || null,
      note.linkedTaskId || null,
      note.linkedEventId || null,
      note.linkedConnectionId || null
    );
  },

  updateNote: (id: string, note: {
    title?: string;
    content?: string;
    tags?: string[];
    folder?: string | null;
    linkedTaskId?: string | null;
    linkedEventId?: string | null;
    linkedConnectionId?: string | null;
  }) => {
    return db.prepare(`
      UPDATE planner_notes
      SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        tags = COALESCE(?, tags),
        folder = ?,
        linked_task_id = ?,
        linked_event_id = ?,
        linked_connection_id = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      note.title ?? null,
      note.content ?? null,
      note.tags ? JSON.stringify(note.tags) : null,
      note.folder ?? null,
      note.linkedTaskId ?? null,
      note.linkedEventId ?? null,
      note.linkedConnectionId ?? null,
      id
    );
  },

  deleteNote: (id: string) => {
    return db.prepare('DELETE FROM planner_notes WHERE id = ?').run(id);
  },

  listQuickLinks: () => {
    return db.prepare('SELECT * FROM planner_quick_links ORDER BY sort_order ASC, name ASC').all();
  },

  createQuickLink: (quickLink: {
    id: string;
    name: string;
    url: string;
    icon?: string | null;
    category?: string | null;
    sortOrder?: number;
  }) => {
    return db.prepare(`
      INSERT INTO planner_quick_links (id, name, url, icon, category, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      quickLink.id,
      quickLink.name,
      quickLink.url,
      quickLink.icon || null,
      quickLink.category || 'service',
      quickLink.sortOrder ?? 0
    );
  },

  deleteQuickLink: (id: string) => {
    return db.prepare('DELETE FROM planner_quick_links WHERE id = ?').run(id);
  },
};

// User operations
export const userDb = {
  count: () => {
    const result = db.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number };
    return result?.count || 0;
  },

  getByUsername: (username: string) => {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  },

  getById: (id: string) => {
    return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  },

  create: (user: { id: string; username: string; email: string; passwordHash: string; role?: 'admin' | 'user' | 'readonly' }) => {
    const stmt = db.prepare(`
      INSERT INTO users (id, username, password_hash, email, role, is_active)
      VALUES (?, ?, ?, ?, ?, 1)
    `);

    return stmt.run(
      user.id,
      user.username,
      user.passwordHash,
      user.email,
      user.role || 'admin'
    );
  },

  list: () => {
    return db.prepare(`
      SELECT id, username, email, role, is_active, created_at, last_login
      FROM users
      ORDER BY created_at ASC
    `).all();
  },

  getByEmail: (email: string) => {
    return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  },

  updateRole: (id: string, role: 'admin' | 'user' | 'readonly') => {
    return db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  },

  setActive: (id: string, isActive: boolean) => {
    return db.prepare('UPDATE users SET is_active = ? WHERE id = ?').run(isActive ? 1 : 0, id);
  },

  delete: (id: string) => {
    return db.prepare('DELETE FROM users WHERE id = ?').run(id);
  },

  updateLastLogin: (id: string) => {
    return db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(id);
  },
};

export { db };
