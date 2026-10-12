import { Router, Request, Response } from 'express';
import { auditState, checkReachability, saveProfile, startAudit } from '../services/hardening/audit.js';
import { GUEST_AUDIT_COMMAND, parseGuestFacts } from '../services/hardening/guest-facts.js';
import { getWazuhJob, startWazuhInstall, validateWazuhInput } from '../services/hardening/wazuh.js';
import { connectionDb } from '../services/database.js';
import { SSHService } from '../services/ssh.js';

const router: Router = Router();

// Last audit result and the progress of a running one
router.get('/audit', async (_req: Request, res: Response) => {
  try {
    res.json(await auditState());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start a read-only audit of the Proxmox host, all guests and all SSH systems
router.post('/audit', (req: Request, res: Response) => {
  try {
    const target = typeof req.body?.target === 'string' ? req.body.target : undefined;
    res.status(202).json(startAudit(target));
  } catch (error: any) {
    res.status(409).json({ error: error.message });
  }
});

// Target profile of a guest (purpose, exposure, expected ports, …)
router.put('/profiles/:key', (req: Request, res: Response) => {
  if (!/^(vm:\d+|conn:[\w-]+)$/.test(req.params.key)) return res.status(400).json({ error: 'invalid key' });
  return res.json(saveProfile(req.params.key, req.body ?? {}));
});

// Which common ports are reachable from this machine (nmap TCP connect)
router.post('/reach', async (req: Request, res: Response) => {
  try {
    res.json(await checkReachability(String(req.body?.ip ?? '')));
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

// Live facts of one SSH system for the server overview (read-only, same command as the audit)
router.get('/system/:connectionId', async (req: Request, res: Response) => {
  try {
    const connection: any = connectionDb.getById(req.params.connectionId);
    if (!connection) return res.status(404).json({ error: 'Connection not found' });
    if (connection.type === 'rdp') return res.status(400).json({ error: 'Only available for SSH connections' });
    const result = await SSHService.executeCommand(
      {
        id: connection.id,
        name: connection.name,
        host: connection.host,
        port: connection.port,
        username: connection.username,
        authType: connection.auth_type || 'password',
        password: connection.password,
        privateKeyPath: connection.private_key_path,
      } as any,
      GUEST_AUDIT_COMMAND,
    );
    const stdout = result.data?.stdout ?? '';
    if (!stdout.includes('@@ID')) return res.status(502).json({ error: result.error || result.message || 'SSH-Abfrage fehlgeschlagen' });
    return res.json({ collectedAt: new Date().toISOString(), ...parseGuestFacts(stdout) });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
});

// Install the Wazuh agent (changes the system: only on explicit request from the UI)
router.post('/wazuh/:connectionId/install', (req: Request, res: Response) => {
  const input = validateWazuhInput(req.body ?? {});
  if ('error' in input) return res.status(400).json({ error: input.error });
  try {
    return res.status(202).json(startWazuhInstall(req.params.connectionId, input as { manager: string; version: string; agentName?: string }, req.ip));
  } catch (error: any) {
    return res.status(error.status || 500).json({ error: error.message });
  }
});

router.get('/wazuh/jobs/:jobId', (req: Request, res: Response) => {
  const job = getWazuhJob(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  return res.json(job);
});

export default router;
