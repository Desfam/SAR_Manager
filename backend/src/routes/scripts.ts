import { Router, Request, Response } from 'express';
import { getDatabase, auditLogDb, connectionDb } from '../services/database.js';
import { randomUUID } from 'crypto';
import { SSHService } from '../services/ssh.js';

const router = Router();

// Get all scripts
router.get('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const scripts = db.prepare('SELECT * FROM scripts ORDER BY name').all();
    
    const sanitized = scripts.map((script: any) => ({
      ...script,
      type: script.script_type,
      tags: JSON.parse(script.tags || '[]'),
    }));
    
    res.json(sanitized);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get single script
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const script: any = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
    
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    
    const sanitized = {
      ...script,
      type: script.script_type,
      tags: JSON.parse(script.tags || '[]'),
    };
    
    res.json(sanitized);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create script
router.post('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const script = {
      id: randomUUID(),
      ...req.body,
    };

    const scriptType = script.script_type || script.type || 'bash';
    
    const stmt = db.prepare(`
      INSERT INTO scripts (id, name, description, script_type, content, tags, is_scheduled, schedule_cron)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(
      script.id,
      script.name,
      script.description,
      scriptType,
      script.content,
      JSON.stringify(script.tags || []),
      script.is_scheduled ? 1 : 0,
      script.schedule_cron
    );
    
    auditLogDb.create({
      user: req.ip,
      action: 'SCRIPT_CREATED',
      target: script.name,
      details: `Created ${scriptType} script`,
      status: 'success',
      ipAddress: req.ip,
    });
    
    res.status(201).json({ id: script.id, message: 'Script created' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Update script
router.put('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const stmt = db.prepare(`
      UPDATE scripts 
      SET name = ?, description = ?, script_type = ?, content = ?, 
          tags = ?, is_scheduled = ?, schedule_cron = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `);

    const scriptType = req.body.script_type || req.body.type || 'bash';
    
    stmt.run(
      req.body.name,
      req.body.description,
      scriptType,
      req.body.content,
      JSON.stringify(req.body.tags || []),
      req.body.is_scheduled ? 1 : 0,
      req.body.schedule_cron,
      req.params.id
    );
    
    res.json({ message: 'Script updated' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Delete script
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    db.prepare('DELETE FROM scripts WHERE id = ?').run(req.params.id);
    
    res.json({ message: 'Script deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute script
router.post('/:id/execute', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const script: any = db.prepare('SELECT * FROM scripts WHERE id = ?').get(req.params.id);
    
    if (!script) {
      return res.status(404).json({ error: 'Script not found' });
    }
    
    const { connectionId } = req.body;
    if (!connectionId) {
      return res.status(400).json({ error: 'connectionId is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }
    
    // Create execution record
    const executionId = db.prepare(`
      INSERT INTO script_executions (script_id, connection_id, status)
      VALUES (?, ?, 'running')
    `).run(script.id, connectionId).lastInsertRowid;

    const scriptType = script.script_type || script.type || 'bash';
    const encodedContent = Buffer.from(script.content || '', 'utf8').toString('base64');

    let command = '';
    if (scriptType === 'python') {
      command = `tmp=$(mktemp /tmp/homelab-script-XXXXXX.py) && echo '${encodedContent}' | base64 -d > "$tmp" && python3 "$tmp"; code=$?; rm -f "$tmp"; exit $code`;
    } else if (scriptType === 'powershell') {
      command = `tmp=$(mktemp /tmp/homelab-script-XXXXXX.ps1) && echo '${encodedContent}' | base64 -d > "$tmp" && pwsh -NoProfile -NonInteractive -File "$tmp"; code=$?; rm -f "$tmp"; exit $code`;
    } else {
      command = `tmp=$(mktemp /tmp/homelab-script-XXXXXX.sh) && echo '${encodedContent}' | base64 -d > "$tmp" && chmod +x "$tmp" && bash "$tmp"; code=$?; rm -f "$tmp"; exit $code`;
    }

    const result = await SSHService.executeCommand({
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type,
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    }, command);

    const output = result.data?.stdout || '';
    const errorOutput = result.error || result.data?.stderr || '';
    const exitCode = result.data?.exitCode ?? (result.success ? 0 : 1);
    const status = result.success ? 'success' : 'failed';

    db.prepare(`
      UPDATE script_executions
      SET status = ?, output = ?, error = ?, finished_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, output, errorOutput, executionId);

    auditLogDb.create({
      user: req.ip,
      action: 'SCRIPT_EXECUTE',
      target: script.name,
      details: `${status === 'success' ? 'Executed' : 'Failed'} on ${connection.name}`,
      status: status === 'success' ? 'success' : 'failed',
      ipAddress: req.ip,
    });

    res.json({
      executionId,
      message: status === 'success' ? 'Script executed successfully' : 'Script execution failed',
      status,
      output,
      error: errorOutput,
      exitCode,
    });
    
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get script executions
router.get('/:id/executions', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const executions = db.prepare(`
      SELECT * FROM script_executions 
      WHERE script_id = ? 
      ORDER BY started_at DESC 
      LIMIT 50
    `).all(req.params.id);
    
    res.json(executions);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
