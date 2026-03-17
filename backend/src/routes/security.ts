import express from 'express';
import { SecurityService } from '../services/security.js';
import { connectionDb } from '../services/database.js';

const router = express.Router();

/**
 * Run security audit on a single connection
 */
router.post('/scan/:connectionId', async (req, res) => {
  try {
    const connectionId = req.params.connectionId;
    const connection = connectionDb.getById(connectionId);

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const audit = await SecurityService.runNIS2Audit(connection);

    // Store audit result in database
    const db = connectionDb.getDb();
    const criticalIssues = audit.failed.filter(f => f.severity === 'critical' || f.severity === 'high').length;
    db.prepare(
      `INSERT INTO security_scans (connection_id, scan_type, score, issues, passed_checks, critical_issues, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      connectionId,
      'NIS2',
      audit.score,
      JSON.stringify(audit.failed),
      JSON.stringify(audit.passed),
      criticalIssues,
      audit.timestamp
    );

    res.json({ success: true, audit });
  } catch (error) {
    console.error('Security scan failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to run security scan' 
    });
  }
});

/**
 * Run security audit on all connections
 */
router.post('/scan-all', async (req, res) => {
  try {
    const connections = connectionDb.getAll() as any[];
    const audits = [];
    const db = connectionDb.getDb();

    for (const connection of connections) {
      try {
        const audit = await SecurityService.runNIS2Audit(connection);
        audits.push(audit);

        // Store in database
        const criticalIssues = audit.failed.filter(f => f.severity === 'critical' || f.severity === 'high').length;
        db.prepare(
          `INSERT INTO security_scans (connection_id, scan_type, score, issues, passed_checks, critical_issues, scanned_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(
          connection.id,
          'NIS2',
          audit.score,
          JSON.stringify(audit.failed),
          JSON.stringify(audit.passed),
          criticalIssues,
          audit.timestamp
        );
      } catch (error) {
        console.error(`Failed to scan ${connection.name}:`, error);
        audits.push({
          hostId: connection.id,
          hostName: connection.name,
          timestamp: new Date().toISOString(),
          score: 0,
          passed: [],
          failed: [],
          status: 'failed',
          error: error instanceof Error ? error.message : 'Scan failed',
        });
      }
    }

    res.json({ success: true, audits });
  } catch (error) {
    console.error('Security scan all failed:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to run security scans' 
    });
  }
});

/**
 * Get all audit results (latest per host)
 */
router.get('/audits', (req, res) => {
  try {
    const db = connectionDb.getDb();
    // Get only the most recent scan for each connection using a subquery with GROUP BY
    const audits = db.prepare(
      `SELECT s.*, c.name as host_name, c.host
       FROM security_scans s
       LEFT JOIN connections c ON s.connection_id = c.id
       INNER JOIN (
         SELECT connection_id, MAX(id) as max_id
         FROM security_scans
         GROUP BY connection_id
       ) latest ON s.connection_id = latest.connection_id AND s.id = latest.max_id
       ORDER BY s.scanned_at DESC`
    ).all();

    const formattedAudits = audits.map((audit: any) => ({
      id: audit.id,
      hostId: audit.connection_id,
      hostName: audit.host_name,
      host: audit.host,
      scanType: audit.scan_type,
      score: audit.score,
      failed: JSON.parse(audit.issues || '[]'),
      passed: JSON.parse(audit.passed_checks || '[]'),
      criticalIssues: audit.critical_issues,
      timestamp: audit.scanned_at,
    }));

    res.json({ success: true, audits: formattedAudits });
  } catch (error) {
    console.error('Failed to get audits:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to retrieve audits' 
    });
  }
});

/**
 * Get historical audit score trends (daily aggregates)
 */
router.get('/audits/trends', (req, res) => {
  try {
    const db = connectionDb.getDb();
    const trendRows = db.prepare(
      `SELECT t.day,
              t.avg_score,
              t.min_score,
              t.max_score,
              t.scan_count
       FROM (
         SELECT date(scanned_at) as day,
                ROUND(AVG(score), 1) as avg_score,
                MIN(score) as min_score,
                MAX(score) as max_score,
                COUNT(*) as scan_count
         FROM security_scans
         GROUP BY date(scanned_at)
         ORDER BY day DESC
         LIMIT 30
       ) t
       ORDER BY t.day ASC`
    ).all();

    const trends = trendRows.map((row: any) => ({
      date: row.day,
      avgScore: row.avg_score,
      minScore: row.min_score,
      maxScore: row.max_score,
      scans: row.scan_count,
    }));

    res.json({ success: true, trends });
  } catch (error) {
    console.error('Failed to get audit trends:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to retrieve audit trends'
    });
  }
});

/**
 * Get audit results for a specific connection
 */
router.get('/audits/:connectionId', (req, res) => {
  try {
    const connectionId = req.params.connectionId;
    const db = connectionDb.getDb();
    const audits = db.prepare(
      `SELECT s.*, c.name as host_name, c.host
       FROM security_scans s
       LEFT JOIN connections c ON s.connection_id = c.id
       WHERE s.connection_id = ?
       ORDER BY s.scanned_at DESC
       LIMIT 10`
    ).all(connectionId);

    const formattedAudits = audits.map((audit: any) => ({
      id: audit.id,
      hostId: audit.connection_id,
      hostName: audit.host_name,
      host: audit.host,
      scanType: audit.scan_type,
      score: audit.score,
      failed: JSON.parse(audit.issues || '[]'),
      passed: JSON.parse(audit.passed_checks || '[]'),
      criticalIssues: audit.critical_issues,
      timestamp: audit.scanned_at,
    }));

    res.json({ success: true, audits: formattedAudits });
  } catch (error) {
    console.error('Failed to get audits for connection:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to retrieve audits' 
    });
  }
});

/**
 * Delete audit result
 */
router.delete('/audits/:auditId', (req, res) => {
  try {
    const auditId = parseInt(req.params.auditId);
    const db = connectionDb.getDb();
    db.prepare('DELETE FROM security_scans WHERE id = ?').run(auditId);
    res.json({ success: true });
  } catch (error) {
    console.error('Failed to delete audit:', error);
    res.status(500).json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Failed to delete audit' 
    });
  }
});

export default router;
