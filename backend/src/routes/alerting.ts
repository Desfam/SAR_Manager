import { Router, type Request, type Response } from 'express';
import { alertsDb } from '../services/database.js';
import { alertList, deleteOverride, notificationLog, publicSettings, saveSettings, saveThresholds, sendTest, thresholdOverview } from '../services/alerting.js';

const router: Router = Router();

const wrap = (handler: (req: Request) => unknown) => async (req: Request, res: Response) => {
  try {
    res.json(await handler(req));
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message ?? 'Fehler' });
  }
};

router.get('/settings', wrap(() => publicSettings()));
router.put('/settings', wrap((req) => saveSettings(req.body)));
router.get('/thresholds', wrap(() => thresholdOverview()));
router.put('/thresholds/global', wrap((req) => saveThresholds(null, req.body)));
router.put('/thresholds/:connectionId', wrap((req) => saveThresholds(req.params.connectionId, req.body)));
router.delete('/thresholds/:connectionId', wrap((req) => deleteOverride(req.params.connectionId)));
router.get('/alerts', wrap((req) => alertList({ status: req.query.status === 'history' ? 'history' : 'active', days: Math.min(Math.max(Number(req.query.days) || 7, 1), 90) })));
router.post('/alerts/:id/resolve', wrap((req) => {
  alertsDb.resolve(Number(req.params.id));
  return { resolved: true };
}));
router.get('/notifications', wrap((req) => notificationLog(Number(req.query.after) || 0, Number(req.query.limit) || 50)));
router.post('/notifications/test', wrap(() => sendTest()));

export default router;
