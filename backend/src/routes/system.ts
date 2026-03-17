import { Router, Request, Response } from 'express';
import si from 'systeminformation';
import { auditLogDb } from '../services/database.js';

const router = Router();

// Get system information
router.get('/info', async (req: Request, res: Response) => {
  try {
    const [system, os, cpu, mem, disk, network] = await Promise.all([
      si.system(),
      si.osInfo(),
      si.cpu(),
      si.mem(),
      si.fsSize(),
      si.networkInterfaces(),
    ]);
    
    res.json({
      system,
      os,
      cpu,
      memory: mem,
      disk,
      network,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get CPU usage
router.get('/cpu', async (req: Request, res: Response) => {
  try {
    const load = await si.currentLoad();
    res.json(load);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get memory usage
router.get('/memory', async (req: Request, res: Response) => {
  try {
    const mem = await si.mem();
    res.json(mem);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get disk usage
router.get('/disk', async (req: Request, res: Response) => {
  try {
    const disk = await si.fsSize();
    res.json(disk);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get network stats
router.get('/network', async (req: Request, res: Response) => {
  try {
    const [interfaces, stats] = await Promise.all([
      si.networkInterfaces(),
      si.networkStats(),
    ]);
    
    res.json({ interfaces, stats });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get processes
router.get('/processes', async (req: Request, res: Response) => {
  try {
    const processes = await si.processes();
    res.json(processes);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get system uptime
router.get('/uptime', async (req: Request, res: Response) => {
  try {
    const time = await si.time();
    res.json({ 
      uptime: time.uptime,
      uptimeFormatted: formatUptime(time.uptime),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get audit logs
router.get('/audit-logs', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const logs = auditLogDb.getRecent(limit);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`);
  
  return parts.join(' ');
}

export default router;
