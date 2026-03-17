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

  // Create indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_agent_id ON agent_metrics(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_metrics_timestamp ON agent_metrics(timestamp);
    CREATE INDEX IF NOT EXISTS idx_agent_commands_agent_id ON agent_commands(agent_id);
    CREATE INDEX IF NOT EXISTS idx_agent_commands_status ON agent_commands(status);
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

export const agentDb = new AgentDatabase();
export const agentMetricsDb = new AgentMetricsDatabase();

// Initialize on module load
initAgentDatabase();
