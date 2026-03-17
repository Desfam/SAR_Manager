import { Router, Request, Response } from 'express';
import { getDatabase, auditLogDb } from '../services/database.js';
import { randomUUID } from 'crypto';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT pf.*, c.name as host_name
      FROM port_forwards pf
      LEFT JOIN connections c ON pf.connection_id = c.id
      ORDER BY pf.created_at DESC
    `).all();

    const forwards = rows.map((row: any) => ({
      id: row.id,
      name: row.name,
      type: row.type || 'local',
      localPort: row.local_port,
      remoteHost: row.remote_host,
      remotePort: row.remote_port,
      hostId: row.connection_id,
      hostName: row.host_name,
      status: row.status === 'active' ? 'active' : 'stopped',
      createdAt: row.created_at,
    }));

    res.json(forwards);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const { name, type, localPort, remoteHost, remotePort, hostId } = req.body;

    if (!name || !hostId || !localPort) {
      return res.status(400).json({ error: 'name, hostId and localPort are required' });
    }

    const id = randomUUID();
    db.prepare(`
      INSERT INTO port_forwards (id, name, connection_id, local_port, remote_host, remote_port, type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'inactive')
    `).run(
      id,
      name,
      hostId,
      Number(localPort),
      remoteHost || 'localhost',
      Number(remotePort || 0),
      type || 'local'
    );

    auditLogDb.create({
      user: req.ip,
      action: 'PORT_FORWARD',
      target: name,
      details: `Created tunnel configuration on host ${hostId}`,
      status: 'success',
      ipAddress: req.ip,
    });

    res.status(201).json({ id, message: 'Port forward created' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/toggle', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const existing: any = db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Port forward not found' });
    }

    const nextStatus = existing.status === 'active' ? 'inactive' : 'active';
    db.prepare('UPDATE port_forwards SET status = ? WHERE id = ?').run(nextStatus, req.params.id);

    res.json({
      message: `Port forward ${nextStatus === 'active' ? 'started' : 'stopped'}`,
      status: nextStatus === 'active' ? 'active' : 'stopped',
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const db = getDatabase();
    const existing: any = db.prepare('SELECT * FROM port_forwards WHERE id = ?').get(req.params.id);

    if (!existing) {
      return res.status(404).json({ error: 'Port forward not found' });
    }

    db.prepare('DELETE FROM port_forwards WHERE id = ?').run(req.params.id);
    res.json({ message: 'Port forward deleted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
