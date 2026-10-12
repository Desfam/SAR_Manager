import { Router, Request, Response } from 'express';
import { cancelScan, localSubnets, scanState, startScan, validateSubnet } from '../services/network-scan.js';

const router: Router = Router();

// Local IPv4 networks of this machine (suggestions for the scan)
router.get('/interfaces', (_req: Request, res: Response) => {
  res.json(localSubnets());
});

// Running scan (with progress) and the last finished one
router.get('/scan', async (_req: Request, res: Response) => {
  try {
    res.json(await scanState());
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start a scan: mode "discover" (find devices) or "quick" (also top-100 ports and type detection)
router.post('/scan', (req: Request, res: Response) => {
  const subnet = String(req.body?.subnet ?? '');
  const mode = req.body?.mode === 'quick' ? 'quick' : 'discover';
  const invalid = validateSubnet(subnet);
  if (invalid) return res.status(400).json({ error: invalid });
  try {
    return res.status(202).json(startScan(subnet, mode));
  } catch (error: any) {
    return res.status(409).json({ error: error.message });
  }
});

router.delete('/scan', (_req: Request, res: Response) => {
  res.json({ cancelled: cancelScan() });
});

export default router;
