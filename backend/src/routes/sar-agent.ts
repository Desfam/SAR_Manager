import { Router, type Request, type Response } from 'express';
import { AGENT_VERSION, agentEvents, agentStatus, backendUrlFor, installAgent, uninstallAgent } from '../services/sar-agent.js';
import { auditLogDb, connectionDb } from '../services/database.js';

const router: Router = Router();

const wrap = (handler: (req: Request) => unknown) => async (req: Request, res: Response) => {
  try {
    res.json(await handler(req));
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message ?? 'Fehler' });
  }
};

const audit = (action: string, connectionId: string, details: string, req: Request) => {
  const connection: any = connectionDb.getById(connectionId);
  try {
    auditLogDb.create({ action, target: connection?.name ?? connectionId, details, status: 'success', user: (req as any).user?.username ?? 'app', ipAddress: req.ip });
  } catch {
    // audit log is best effort
  }
};

router.get('/:connectionId', wrap((req) => {
  const connection: any = connectionDb.getById(req.params.connectionId);
  return { ...agentStatus(req.params.connectionId), latestVersion: AGENT_VERSION, serverUrl: connection ? backendUrlFor(connection.host) : null };
}));
router.get('/:connectionId/events', wrap((req) => agentEvents(req.params.connectionId, Math.min(Math.max(Number(req.query.hours) || 24, 1), 24 * 14), Math.min(Number(req.query.limit) || 300, 2000))));
router.post('/:connectionId/install', wrap(async (req) => {
  const result = await installAgent(req.params.connectionId, { serverUrl: typeof req.body?.serverUrl === 'string' ? req.body.serverUrl : undefined });
  audit('SAR_AGENT_INSTALLED', req.params.connectionId, `Agent ${result.version} → ${result.serverUrl}`, req);
  return result;
}));
router.post('/:connectionId/uninstall', wrap(async (req) => {
  const result = await uninstallAgent(req.params.connectionId);
  audit('SAR_AGENT_REMOVED', req.params.connectionId, 'Agent entfernt', req);
  return result;
}));

export default router;
