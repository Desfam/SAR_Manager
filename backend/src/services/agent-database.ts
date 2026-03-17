import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const AGENT_DB_PATH = process.env.AGENT_DB_PATH || path.join(process.cwd(), 'data', 'agents.db');

// Ensure data directory exists
const dataDir = path.dirname(AGENT_DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(AGENT_DB_PATH);
db.pragma('journal_mode = WAL');

// Agent interface
export interface Agent {
  id: string;
  name: string;
  hostname: string;
  os: string;
  platform: string;
  version: string;
  tags: string[];
  environment: string;
  status: 'online' | 'offline' | 'error';
  last_seen: string;
  created_at?: string;
  updated_at?: string;
}

export interface AgentSecurityAlert {
  id?: number;
  agent_id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  evidence?: string;
  fingerprint?: string;
  is_resolved?: number;
  created_at?: string;
  resolved_at?: string | null;
}

/**
 * Initialize agent database tables
 */
export function initAgentDatabase() {
  // Agents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      hostname TEXT,
      os TEXT,
      platform TEXT,
      version TEXT,
      tags TEXT,
      environment TEXT,
      status TEXT DEFAULT 'offline',
      last_seen TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Agent metrics table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      cpu_usage REAL,
      cpu_cores INTEGER,
      memory_total INTEGER,
      memory_used INTEGER,
      memory_percent REAL,
      disk_total INTEGER,
      disk_used INTEGER,
      disk_percent REAL,
      network_sent INTEGER,
      network_recv INTEGER,
      processes_total INTEGER,
      processes_running INTEGER,
      load_avg_1 REAL,
      load_avg_5 REAL,
      load_avg_15 REAL,
      uptime INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Command history table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_commands (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      command TEXT NOT NULL,
      args TEXT,
      status TEXT DEFAULT 'pending',
      output TEXT,
      error TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      requested_by TEXT,
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Services table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_services (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      load_state TEXT,
      active_state TEXT,
      sub_state TEXT,
      description TEXT,
      pid INTEGER,
      memory INTEGER,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Logs table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      log_source TEXT NOT NULL,
      log_lines TEXT NOT NULL,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Live connections snapshot table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_connections (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      protocol TEXT,
      local_address TEXT,
      remote_address TEXT,
      state TEXT,
      pid INTEGER,
      process_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Agent security alerts table
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_security_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      alert_type TEXT NOT NULL,
      severity TEXT NOT NULL CHECK(severity IN ('critical', 'warning', 'info')),
      message TEXT NOT NULL,
      evidence TEXT,
      fingerprint TEXT,
      is_resolved BOOLEAN DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_id ON agent_metrics(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_timestamp ON agent_metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_agent_commands_agent_id ON agent_commands(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_commands_status ON agent_commands(status);
    CREATE INDEX IF NOT EXISTS idx_agent_services_agent_id ON agent_services(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_logs_agent_id ON agent_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_connections_agent_id ON agent_connections(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_connections_timestamp ON agent_connections(timestamp);
    CREATE INDEX IF NOT EXISTS idx_agent_security_alerts_agent_id ON agent_security_alerts(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_security_alerts_resolved ON agent_security_alerts(is_resolved);
    CREATE INDEX IF NOT EXISTS idx_agent_security_alerts_created_at ON agent_security_alerts(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_security_alerts_fingerprint ON agent_security_alerts(fingerprint);
  `);

  // --- Hybrid Agent Extension Tables ---

  // Migrate agents table: add new columns if missing
  for (const col of ['capabilities TEXT DEFAULT \'{}\'', 'ip_address TEXT']) {
    try { db.exec(`ALTER TABLE agents ADD COLUMN ${col}`); } catch { /* already exists */ }
  }

  // Agent profiles (built-in presets + custom)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      features TEXT NOT NULL DEFAULT '{}',
      is_builtin INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    INSERT OR IGNORE INTO agent_profiles (id, name, description, features, is_builtin) VALUES
    ('minimal-monitoring', 'Minimal Monitoring', 'Heartbeat and basic metrics only',
      '{"metrics":true,"security_audits":false,"command_execution":false,"file_collection":false,"service_inspection":false,"artifact_upload":false}', 1),
    ('standard-linux', 'Standard Linux', 'Full monitoring with service inspection and basic audits',
      '{"metrics":true,"security_audits":true,"command_execution":true,"file_collection":false,"service_inspection":true,"artifact_upload":false}', 1),
    ('security-audit', 'Security Audit', 'Full security auditing with file collection and artifact upload',
      '{"metrics":true,"security_audits":true,"command_execution":false,"file_collection":true,"service_inspection":true,"artifact_upload":true}', 1),
    ('restricted-prod', 'Restricted Production', 'Monitoring only — no command execution or file collection',
      '{"metrics":true,"security_audits":true,"command_execution":false,"file_collection":false,"service_inspection":true,"artifact_upload":false}', 1)
  `);

  // Agent policies (per-agent profile assignment + overrides)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_policies (
      agent_id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL DEFAULT 'standard-linux',
      feature_overrides TEXT NOT NULL DEFAULT '{}',
      metrics_interval_seconds INTEGER DEFAULT 30,
      audit_interval_seconds INTEGER DEFAULT 3600,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Agent jobs (server → agent task queue)
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_jobs (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      job_type TEXT NOT NULL,
      audit_type TEXT,
      payload TEXT DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      result TEXT,
      requested_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sent_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  // Audit results (structured findings from agent audit engine)
  db.exec(`
    CREATE TABLE IF NOT EXISTS audit_results (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      audit_type TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'success',
      score INTEGER DEFAULT 0,
      passed INTEGER DEFAULT 0,
      failed INTEGER DEFAULT 0,
      warnings INTEGER DEFAULT 0,
      findings TEXT DEFAULT '[]',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tokens (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_used_at TEXT,
      revoked_at TEXT
    )
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_agent_id ON agent_jobs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_jobs_status ON agent_jobs(status);
    CREATE INDEX IF NOT EXISTS idx_audit_results_agent_id ON audit_results(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_results_created_at ON audit_results(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_tokens_created_at ON agent_tokens(created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_tokens_revoked_at ON agent_tokens(revoked_at);
  `);

  console.log('Agent database initialized');
}

/**
 * Agent Database Service
 */
class AgentDatabase {
  /**
   * Register a new agent or update existing
   */
  registerAgent(agent: Agent) {
    const stmt = db.prepare(`
      INSERT INTO agents (id, name, hostname, os, platform, version, tags, environment, status, last_seen, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        hostname = excluded.hostname,
        os = excluded.os,
        platform = excluded.platform,
        version = excluded.version,
        tags = excluded.tags,
        environment = excluded.environment,
        status = excluded.status,
        last_seen = excluded.last_seen,
        updated_at = CURRENT_TIMESTAMP
    `);

    stmt.run(
      agent.id,
      agent.name,
      agent.hostname,
      agent.os,
      agent.platform,
      agent.version,
      JSON.stringify(agent.tags),
      agent.environment,
      agent.status,
      agent.last_seen
    );
  }

  /**
   * Get all agents
   */
  getAllAgents(): Agent[] {
    const stmt = db.prepare('SELECT * FROM agents ORDER BY name');
    const rows = stmt.all() as any[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
    }));
  }

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Agent | null {
    const stmt = db.prepare('SELECT * FROM agents WHERE id = ?');
    const row = stmt.get(agentId) as any;

    if (!row) return null;

    return {
      ...row,
      tags: JSON.parse(row.tags || '[]'),
    };
  }

  /**
   * Update agent status
   */
  updateAgentStatus(agentId: string, status: string, lastSeen: string | null) {
    const stmt = db.prepare(`
      UPDATE agents 
      SET status = ?, last_seen = COALESCE(?, last_seen), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    stmt.run(status, lastSeen, agentId);
  }

  /**
   * Delete agent
   */
  deleteAgent(agentId: string) {
    const stmt = db.prepare('DELETE FROM agents WHERE id = ?');
    stmt.run(agentId);
  }

  /**
   * Get agents by status
   */
  getAgentsByStatus(status: string): Agent[] {
    const stmt = db.prepare('SELECT * FROM agents WHERE status = ? ORDER BY name');
    const rows = stmt.all(status) as any[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
    }));
  }

  /**
   * Get agents by tag
   */
  getAgentsByTag(tag: string): Agent[] {
    const stmt = db.prepare(`SELECT * FROM agents WHERE tags LIKE ? ORDER BY name`);
    const rows = stmt.all(`%"${tag}"%`) as any[];

    return rows.map(row => ({
      ...row,
      tags: JSON.parse(row.tags || '[]'),
    }));
  }

  /**
   * Update agent capabilities and IP on registration
   */
  updateCapabilities(agentId: string, capabilities: object, ipAddress?: string) {
    const stmt = db.prepare(`
      UPDATE agents
      SET capabilities = ?, ip_address = COALESCE(?, ip_address), updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);
    stmt.run(JSON.stringify(capabilities), ipAddress || null, agentId);
  }

  /**
   * Mark online agents as stale if last_seen is older than threshold and no active WS
   */
  markStaleAgents(thresholdMinutes: number, activeIds: Set<string>) {
    const stmt = db.prepare(`
      SELECT id, last_seen FROM agents WHERE status = 'online'
    `);
    const rows = stmt.all() as { id: string; last_seen: string }[];
    const cutoff = Date.now() - thresholdMinutes * 60 * 1000;

    let count = 0;
    const update = db.prepare(`UPDATE agents SET status = 'stale', updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
    for (const row of rows) {
      if (!activeIds.has(row.id) && new Date(row.last_seen).getTime() < cutoff) {
        update.run(row.id);
        count++;
      }
    }
    if (count > 0) console.log(`[AGENT] Marked ${count} agent(s) as stale`);
  }
}

/**
 * Agent Metrics Database Service
 */
class AgentMetricsDatabase {
  /**
   * Store metrics from agent
   */
  storeMetrics(metrics: any) {
    const stmt = db.prepare(`
      INSERT INTO agent_metrics (
        agent_id, timestamp, cpu_usage, cpu_cores,
        memory_total, memory_used, memory_percent,
        disk_total, disk_used, disk_percent,
        network_sent, network_recv,
        processes_total, processes_running,
        load_avg_1, load_avg_5, load_avg_15, uptime
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const diskTotal = metrics.disk?.reduce((sum: number, d: any) => sum + d.total, 0) || 0;
    const diskUsed = metrics.disk?.reduce((sum: number, d: any) => sum + d.used, 0) || 0;
    const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

    stmt.run(
      metrics.agent_id,
      metrics.timestamp,
      metrics.cpu?.usage_percent || 0,
      metrics.cpu?.cores || 0,
      metrics.memory?.total || 0,
      metrics.memory?.used || 0,
      metrics.memory?.used_percent || 0,
      diskTotal,
      diskUsed,
      diskPercent,
      metrics.network?.bytes_sent || 0,
      metrics.network?.bytes_recv || 0,
      metrics.processes?.total || 0,
      metrics.processes?.running || 0,
      metrics.cpu?.load_avg?.[0] || 0,
      metrics.cpu?.load_avg?.[1] || 0,
      metrics.cpu?.load_avg?.[2] || 0,
      metrics.system_info?.uptime || 0
    );
  }

  /**
   * Get metrics for an agent
   */
  getMetrics(agentId: string, from?: string, to?: string, limit: number = 100) {
    let query = 'SELECT * FROM agent_metrics WHERE agent_id = ?';
    const params: any[] = [agentId];

    if (from) {
      query += ' AND timestamp >= ?';
      params.push(from);
    }

    if (to) {
      query += ' AND timestamp <= ?';
      params.push(to);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  /**
   * Get latest metrics for an agent
   */
  getLatestMetrics(agentId: string) {
    const stmt = db.prepare(`
      SELECT * FROM agent_metrics 
      WHERE agent_id = ? 
      ORDER BY timestamp DESC 
      LIMIT 1
    `);

    return stmt.get(agentId);
  }

  /**
   * Delete old metrics (retention policy)
   */
  deleteOldMetrics(daysToKeep: number = 30) {
    const stmt = db.prepare(`
      DELETE FROM agent_metrics 
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(daysToKeep);
    console.log(`Deleted ${result.changes} old metric records`);
  }

  /**
   * Get metrics summary for an agent
   */
  getMetricsSummary(agentId: string, hours: number = 24) {
    const stmt = db.prepare(`
      SELECT 
        AVG(cpu_usage) as avg_cpu,
        MAX(cpu_usage) as max_cpu,
        AVG(memory_percent) as avg_memory,
        MAX(memory_percent) as max_memory,
        AVG(disk_percent) as avg_disk,
        MAX(disk_percent) as max_disk,
        COUNT(*) as data_points
      FROM agent_metrics 
      WHERE agent_id = ? 
        AND timestamp >= datetime('now', '-' || ? || ' hours')
    `);

    return stmt.get(agentId, hours);
  }
}

/**
 * Agent Services Database
 */
class AgentServicesDatabase {
  /**
   * Store services for an agent
   */
  storeServices(agentId: string, services: any[]) {
    // Clear old services for this agent
    const deleteStmt = db.prepare('DELETE FROM agent_services WHERE agent_id = ?');
    deleteStmt.run(agentId);

    // Insert new services
    const insertStmt = db.prepare(`
      INSERT INTO agent_services (agent_id, name, load_state, active_state, sub_state, description, pid, memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const service of services) {
      insertStmt.run(
        agentId,
        service.name,
        service.load_state,
        service.active_state,
        service.sub_state,
        service.description,
        service.pid || null,
        service.memory || null
      );
    }
  }

  /**
   * Get services for an agent
   */
  getServices(agentId: string, activeOnly: boolean = false) {
    let query = 'SELECT * FROM agent_services WHERE agent_id = ?';
    
    if (activeOnly) {
      query += " AND active_state = 'active'";
    }
    
    query += ' ORDER BY name';

    const stmt = db.prepare(query);
    return stmt.all(agentId);
  }

  /**
   * Get service by name for an agent
   */
  getService(agentId: string, serviceName: string) {
    const stmt = db.prepare(`
      SELECT * FROM agent_services 
      WHERE agent_id = ? AND name = ?
      ORDER BY timestamp DESC
      LIMIT 1
    `);

    return stmt.get(agentId, serviceName);
  }
}

/**
 * Agent Logs Database
 */
class AgentLogsDatabase {
  /**
   * Store logs for an agent
   */
  storeLogs(agentId: string, logs: Record<string, string[]>) {
    const stmt = db.prepare(`
      INSERT INTO agent_logs (agent_id, log_source, log_lines)
      VALUES (?, ?, ?)
    `);

    for (const [source, lines] of Object.entries(logs)) {
      stmt.run(agentId, source, JSON.stringify(lines));
    }
  }

  /**
   * Get recent logs for an agent
   */
  getLogs(agentId: string, source?: string, limit: number = 10) {
    let query = 'SELECT * FROM agent_logs WHERE agent_id = ?';
    const params: any[] = [agentId];

    if (source) {
      query += ' AND log_source = ?';
      params.push(source);
    }

    query += ' ORDER BY timestamp DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    const rows = stmt.all(...params) as any[];

    return rows.map(row => ({
      ...row,
      log_lines: JSON.parse(row.log_lines)
    }));
  }

  /**
   * Delete old logs (retention policy)
   */
  deleteOldLogs(daysToKeep: number = 7) {
    const stmt = db.prepare(`
      DELETE FROM agent_logs 
      WHERE timestamp < datetime('now', '-' || ? || ' days')
    `);

    const result = stmt.run(daysToKeep);
    console.log(`Deleted ${result.changes} old log records`);
  }
}

/**
 * Agent Connections Database
 */
class AgentConnectionsDatabase {
  /**
   * Store latest connection snapshot for an agent
   */
  storeConnections(agentId: string, timestamp: string, connections: any[]) {
    const deleteStmt = db.prepare('DELETE FROM agent_connections WHERE agent_id = ?');
    deleteStmt.run(agentId);

    if (!connections || connections.length === 0) return;

    const insertStmt = db.prepare(`
      INSERT INTO agent_connections (
        agent_id, timestamp, protocol, local_address, remote_address, state, pid, process_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    for (const connection of connections) {
      insertStmt.run(
        agentId,
        timestamp,
        connection.protocol || null,
        connection.local_addr || null,
        connection.remote_addr || null,
        connection.status || null,
        connection.pid || null,
        connection.process_name || null,
      );
    }
  }

  /**
   * Get latest connection snapshot for an agent
   */
  getConnections(agentId: string, limit: number = 200) {
    const stmt = db.prepare(`
      SELECT * FROM agent_connections
      WHERE agent_id = ?
      ORDER BY
        CASE state
          WHEN 'ESTABLISHED' THEN 1
          WHEN 'LISTEN' THEN 2
          ELSE 3
        END,
        process_name,
        local_address
      LIMIT ?
    `);

    return stmt.all(agentId, limit);
  }
}

class AgentSecurityAlertsDatabase {
  create(alert: AgentSecurityAlert, dedupeWindowMinutes: number = 10) {
    if (alert.fingerprint) {
      const dedupeStmt = db.prepare(`
        SELECT id FROM agent_security_alerts
        WHERE agent_id = ?
          AND fingerprint = ?
          AND is_resolved = 0
          AND created_at >= datetime('now', '-' || ? || ' minutes')
        LIMIT 1
      `);

      const existing = dedupeStmt.get(alert.agent_id, alert.fingerprint, dedupeWindowMinutes);
      if (existing) {
        return null;
      }
    }

    const stmt = db.prepare(`
      INSERT INTO agent_security_alerts (agent_id, alert_type, severity, message, evidence, fingerprint)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    return stmt.run(
      alert.agent_id,
      alert.alert_type,
      alert.severity,
      alert.message,
      alert.evidence || null,
      alert.fingerprint || null,
    );
  }

  getActive(limit: number = 200, agentId?: string) {
    let query = `
      SELECT * FROM agent_security_alerts
      WHERE is_resolved = 0
    `;
    const params: any[] = [];

    if (agentId) {
      query += ' AND agent_id = ?';
      params.push(agentId);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const stmt = db.prepare(query);
    return stmt.all(...params);
  }

  getRecent(agentId: string, limit: number = 100) {
    const stmt = db.prepare(`
      SELECT * FROM agent_security_alerts
      WHERE agent_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `);

    return stmt.all(agentId, limit);
  }

  resolve(id: number) {
    const stmt = db.prepare(`
      UPDATE agent_security_alerts
      SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    return stmt.run(id);
  }
}

export const agentDb = new AgentDatabase();
export const agentMetricsDb = new AgentMetricsDatabase();
export const agentServicesDb = new AgentServicesDatabase();
export const agentLogsDb = new AgentLogsDatabase();
export const agentConnectionsDb = new AgentConnectionsDatabase();
export const agentSecurityAlertsDb = new AgentSecurityAlertsDatabase();

// ─────────────────────────────────────────────
//  Profiles
// ─────────────────────────────────────────────
export interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  features: Record<string, boolean>;
  is_builtin?: number;
  created_at?: string;
}

class AgentProfilesDatabase {
  getAll(): AgentProfile[] {
    const rows = db.prepare('SELECT * FROM agent_profiles ORDER BY is_builtin DESC, name').all() as any[];
    return rows.map(r => ({ ...r, features: JSON.parse(r.features || '{}') }));
  }

  get(id: string): AgentProfile | null {
    const row = db.prepare('SELECT * FROM agent_profiles WHERE id = ?').get(id) as any;
    if (!row) return null;
    return { ...row, features: JSON.parse(row.features || '{}') };
  }

  upsert(profile: AgentProfile) {
    db.prepare(`
      INSERT INTO agent_profiles (id, name, description, features, is_builtin)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name, description = excluded.description, features = excluded.features
    `).run(profile.id, profile.name, profile.description || '', JSON.stringify(profile.features));
  }

  delete(id: string) {
    db.prepare('DELETE FROM agent_profiles WHERE id = ? AND is_builtin = 0').run(id);
  }
}

// ─────────────────────────────────────────────
//  Policies
// ─────────────────────────────────────────────
export interface AgentPolicyRecord {
  agent_id: string;
  profile_id: string;
  feature_overrides: Record<string, boolean>;
  metrics_interval_seconds: number;
  audit_interval_seconds: number;
  updated_at?: string;
}

export interface EffectivePolicy {
  profile_id: string;
  features: Record<string, boolean>;
  metrics_interval_seconds: number;
  audit_interval_seconds: number;
}

class AgentPoliciesDatabase {
  get(agentId: string): AgentPolicyRecord | null {
    const row = db.prepare('SELECT * FROM agent_policies WHERE agent_id = ?').get(agentId) as any;
    if (!row) return null;
    return { ...row, feature_overrides: JSON.parse(row.feature_overrides || '{}') };
  }

  upsert(record: AgentPolicyRecord) {
    db.prepare(`
      INSERT INTO agent_policies (agent_id, profile_id, feature_overrides, metrics_interval_seconds, audit_interval_seconds, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(agent_id) DO UPDATE SET
        profile_id = excluded.profile_id,
        feature_overrides = excluded.feature_overrides,
        metrics_interval_seconds = excluded.metrics_interval_seconds,
        audit_interval_seconds = excluded.audit_interval_seconds,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      record.agent_id,
      record.profile_id,
      JSON.stringify(record.feature_overrides || {}),
      record.metrics_interval_seconds || 30,
      record.audit_interval_seconds || 3600,
    );
  }

  getEffectivePolicy(agentId: string): EffectivePolicy {
    const policy = this.get(agentId);
    const profileId = policy?.profile_id || 'standard-linux';
    const profile = agentProfilesDb.get(profileId);

    const baseFeatures: Record<string, boolean> = profile?.features || {
      metrics: true, security_audits: true, command_execution: true,
      file_collection: false, service_inspection: true, artifact_upload: false,
    };

    const overrides = policy?.feature_overrides || {};
    const merged = { ...baseFeatures, ...overrides };

    return {
      profile_id: profileId,
      features: merged,
      metrics_interval_seconds: policy?.metrics_interval_seconds || 30,
      audit_interval_seconds: policy?.audit_interval_seconds || 3600,
    };
  }
}

// ─────────────────────────────────────────────
//  Jobs
// ─────────────────────────────────────────────
export interface AgentJob {
  id: string;
  agent_id: string;
  job_type: string;
  audit_type?: string;
  payload?: string;
  status: 'pending' | 'sent' | 'running' | 'completed' | 'failed';
  result?: string;
  requested_by?: string;
  created_at?: string;
  sent_at?: string;
  completed_at?: string;
}

class AgentJobsDatabase {
  create(job: Omit<AgentJob, 'created_at'>): AgentJob {
    db.prepare(`
      INSERT INTO agent_jobs (id, agent_id, job_type, audit_type, payload, status, requested_by)
      VALUES (?, ?, ?, ?, ?, 'pending', ?)
    `).run(job.id, job.agent_id, job.job_type, job.audit_type || null, job.payload || '{}', job.requested_by || null);
    return this.get(job.id)!;
  }

  get(jobId: string): AgentJob | null {
    return db.prepare('SELECT * FROM agent_jobs WHERE id = ?').get(jobId) as AgentJob | null;
  }

  listForAgent(agentId: string, limit = 50): AgentJob[] {
    return db.prepare('SELECT * FROM agent_jobs WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?').all(agentId, limit) as AgentJob[];
  }

  getPending(agentId: string): AgentJob[] {
    return db.prepare("SELECT * FROM agent_jobs WHERE agent_id = ? AND status = 'pending' ORDER BY created_at").all(agentId) as AgentJob[];
  }

  markSent(jobId: string) {
    db.prepare("UPDATE agent_jobs SET status = 'sent', sent_at = CURRENT_TIMESTAMP WHERE id = ?").run(jobId);
  }

  markRunning(jobId: string) {
    db.prepare("UPDATE agent_jobs SET status = 'running' WHERE id = ?").run(jobId);
  }

  complete(jobId: string, result: object) {
    db.prepare(`
      UPDATE agent_jobs SET status = 'completed', result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify(result), jobId);
  }

  fail(jobId: string, error: string) {
    db.prepare(`
      UPDATE agent_jobs SET status = 'failed', result = ?, completed_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(JSON.stringify({ error }), jobId);
  }
}

// ─────────────────────────────────────────────
//  Audit Results
// ─────────────────────────────────────────────
export interface AuditFinding {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  status: 'passed' | 'failed' | 'warning';
  message: string;
  detail?: string;
}

export interface AuditResultRecord {
  job_id: string;
  agent_id: string;
  audit_type: string;
  status: string;
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  findings: AuditFinding[];
  created_at?: string;
}

export interface AgentTokenRecord {
  id: string;
  label: string;
  created_by?: string | null;
  created_at?: string;
  last_used_at?: string | null;
  revoked_at?: string | null;
}

class AuditResultsDatabase {
  store(result: AuditResultRecord): number {
    const info = db.prepare(`
      INSERT INTO audit_results (job_id, agent_id, audit_type, status, score, passed, failed, warnings, findings)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      result.job_id, result.agent_id, result.audit_type, result.status,
      result.score, result.passed, result.failed, result.warnings,
      JSON.stringify(result.findings || []),
    );
    return info.lastInsertRowid as number;
  }

  listForAgent(agentId: string, limit = 20): AuditResultRecord[] {
    const rows = db.prepare(
      'SELECT * FROM audit_results WHERE agent_id = ? ORDER BY created_at DESC LIMIT ?'
    ).all(agentId, limit) as any[];
    return rows.map(r => ({ ...r, findings: JSON.parse(r.findings || '[]') }));
  }

  getLatest(agentId: string, auditType?: string): AuditResultRecord | null {
    let query = 'SELECT * FROM audit_results WHERE agent_id = ?';
    const params: any[] = [agentId];
    if (auditType) { query += ' AND audit_type = ?'; params.push(auditType); }
    query += ' ORDER BY created_at DESC LIMIT 1';
    const row = db.prepare(query).get(...params) as any;
    if (!row) return null;
    return { ...row, findings: JSON.parse(row.findings || '[]') };
  }

  getByJob(jobId: string): AuditResultRecord | null {
    const row = db.prepare('SELECT * FROM audit_results WHERE job_id = ? LIMIT 1').get(jobId) as any;
    if (!row) return null;
    return { ...row, findings: JSON.parse(row.findings || '[]') };
  }

  deleteOld(daysToKeep = 90) {
    db.prepare(`DELETE FROM audit_results WHERE created_at < datetime('now', '-' || ? || ' days')`).run(daysToKeep);
  }
}

class AgentTokensDatabase {
  list(): AgentTokenRecord[] {
    return db.prepare(`
      SELECT id, label, created_by, created_at, last_used_at, revoked_at
      FROM agent_tokens
      ORDER BY created_at DESC
    `).all() as AgentTokenRecord[];
  }

  create(id: string, label: string, tokenHash: string, createdBy?: string | null) {
    db.prepare(`
      INSERT INTO agent_tokens (id, label, token_hash, created_by)
      VALUES (?, ?, ?, ?)
    `).run(id, label, tokenHash, createdBy || null);
  }

  revoke(id: string) {
    return db.prepare(`
      UPDATE agent_tokens
      SET revoked_at = CURRENT_TIMESTAMP
      WHERE id = ? AND revoked_at IS NULL
    `).run(id);
  }

  isValidHash(tokenHash: string): boolean {
    const row = db.prepare(`
      SELECT id FROM agent_tokens
      WHERE token_hash = ? AND revoked_at IS NULL
      LIMIT 1
    `).get(tokenHash) as { id: string } | undefined;
    return !!row;
  }

  touchLastUsed(tokenHash: string) {
    db.prepare(`
      UPDATE agent_tokens
      SET last_used_at = CURRENT_TIMESTAMP
      WHERE token_hash = ? AND revoked_at IS NULL
    `).run(tokenHash);
  }
}

export const agentProfilesDb = new AgentProfilesDatabase();
export const agentPoliciesDb = new AgentPoliciesDatabase();
export const agentJobsDb = new AgentJobsDatabase();
export const auditResultsDb = new AuditResultsDatabase();
export const agentTokensDb = new AgentTokensDatabase();

// Initialize on module load
initAgentDatabase();
