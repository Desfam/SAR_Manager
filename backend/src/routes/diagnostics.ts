import { Router, Request, Response } from 'express';
import { NetworkDiagnosticsService } from '../services/diagnostics.js';

const router = Router();

// Ping
router.post('/ping', async (req: Request, res: Response) => {
  try {
    const { host, count } = req.body;
    
    if (!host) {
      return res.status(400).json({ error: 'Host is required' });
    }
    
    const result = await NetworkDiagnosticsService.ping(host, count);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Traceroute
router.post('/traceroute', async (req: Request, res: Response) => {
  try {
    const { host } = req.body;
    
    if (!host) {
      return res.status(400).json({ error: 'Host is required' });
    }
    
    const result = await NetworkDiagnosticsService.traceroute(host);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Test port
router.post('/port', async (req: Request, res: Response) => {
  try {
    const { host, port, timeout } = req.body;
    
    if (!host || !port) {
      return res.status(400).json({ error: 'Host and port are required' });
    }
    
    const result = await NetworkDiagnosticsService.testPort(host, port, timeout);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// DNS lookup
router.post('/dns', async (req: Request, res: Response) => {
  try {
    const { hostname } = req.body;
    
    if (!hostname) {
      return res.status(400).json({ error: 'Hostname is required' });
    }
    
    const result = await NetworkDiagnosticsService.dnsLookup(hostname);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Reverse DNS
router.post('/rdns', async (req: Request, res: Response) => {
  try {
    const { ip } = req.body;
    
    if (!ip) {
      return res.status(400).json({ error: 'IP address is required' });
    }
    
    const result = await NetworkDiagnosticsService.reverseDNS(ip);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// WHOIS
router.post('/whois', async (req: Request, res: Response) => {
  try {
    const { target } = req.body;
    
    if (!target) {
      return res.status(400).json({ error: 'Target is required' });
    }
    
    const result = await NetworkDiagnosticsService.whois(target);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Port scan
router.post('/portscan', async (req: Request, res: Response) => {
  try {
    const { host, ports, preset } = req.body;
    
    if (!host) {
      return res.status(400).json({ error: 'Host is required' });
    }
    
    let portsToScan = ports;
    
    if (preset) {
      const commonPorts = NetworkDiagnosticsService.getCommonPorts();
      portsToScan = commonPorts[preset] || [];
    }
    
    if (!portsToScan || portsToScan.length === 0) {
      return res.status(400).json({ error: 'Ports or preset is required' });
    }
    
    const result = await NetworkDiagnosticsService.portScan(host, portsToScan);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get common port presets
router.get('/port-presets', async (req: Request, res: Response) => {
  try {
    const presets = NetworkDiagnosticsService.getCommonPorts();
    res.json(presets);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Network interfaces
router.get('/interfaces', async (req: Request, res: Response) => {
  try {
    const result = await NetworkDiagnosticsService.getNetworkInterfaces();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Routing table
router.get('/routes', async (req: Request, res: Response) => {
  try {
    const result = await NetworkDiagnosticsService.getRoutingTable();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Active connections
router.get('/connections', async (req: Request, res: Response) => {
  try {
    const result = await NetworkDiagnosticsService.getActiveConnections();
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
