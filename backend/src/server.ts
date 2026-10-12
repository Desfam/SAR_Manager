import express, { Express, Request, Response, NextFunction } from 'express';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Import routes
import connectionRoutes from './routes/connections.js';
import dockerRoutes from './routes/docker.js';
import diagnosticsRoutes from './routes/diagnostics.js';
import securityRoutes from './routes/security.js';
import scriptsRoutes from './routes/scripts.js';
import systemRoutes from './routes/system.js';
import sshKeysRoutes from './routes/ssh-keys.js';
import sshKeyDeployRoutes from './routes/ssh-key-deploy.js';
import filesRoutes from './routes/files.js';
import agentRoutes, { setupAgentWebSocket } from './routes/agents.js';
import authRoutes from './routes/auth.js';
import portForwardsRoutes from './routes/port-forwards.js';
import proxmoxRoutes from './routes/proxmox.js';
import networkRoutes from './routes/network.js';
import hardeningRoutes from './routes/hardening.js';
import wazuhRoutes from './routes/wazuh.js';
import plannerRoutes from './routes/planner.js';

// Import services
import { initDatabase, getDatabase, connectionDb, metricsDb, alertsDb } from './services/database.js';
import { evaluateMetrics, probeConnections } from './services/alerting.js';
import { hasOnlineAgent } from './services/sar-agent.js';
import alertingRoutes from './routes/alerting.js';
import sarAgentRoutes from './routes/sar-agent.js';
import { setupWebSocketHandlers } from './services/websocket.js';
import { SSHService, collectSSHMemoryMetrics } from './services/ssh.js';
import { initAgentDatabase } from './services/agent-database.js';
import { collectNodeExporterSystemMetrics } from './services/node-exporter.js';
import { requireAuthIfEnabled, isAuthEnabled, requireRoleIfEnabled } from './middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
config({ path: path.join(__dirname, '../.env') });

function isWeakJwtSecret(secret: string): boolean {
  if (!secret || secret.length < 32) return true;
  return /change-this|default|example|test|secret-key/i.test(secret);
}

function validateProductionSecurityConfig(): void {
  const nodeEnv = process.env.NODE_ENV || 'development';
  const enforceProdSecurity = process.env.ENFORCE_PROD_SECURITY !== 'false';

  if (nodeEnv !== 'production' || !enforceProdSecurity) {
    return;
  }

  const issues: string[] = [];

  if (process.env.ENABLE_AUTH !== 'true') {
    issues.push('ENABLE_AUTH must be set to true in production');
  }

  if (isWeakJwtSecret(process.env.JWT_SECRET || '')) {
    issues.push('JWT_SECRET must be set and at least 32 characters with a strong random value');
  }

  const corsOrigin = process.env.CORS_ORIGIN || '';
  if (!corsOrigin || /localhost|127\.0\.0\.1/i.test(corsOrigin)) {
    issues.push('CORS_ORIGIN must be set to your production frontend domain (not localhost)');
  }

  if (issues.length > 0) {
    console.error('❌ Production security validation failed:');
    for (const issue of issues) {
      console.error(` - ${issue}`);
    }
    console.error('Set ENFORCE_PROD_SECURITY=false only for temporary break-glass scenarios.');
    process.exit(1);
  }
}

validateProductionSecurityConfig();

const app: Express = express();
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// Trust first reverse proxy (nginx) so client IP and rate-limiting work correctly
app.set('trust proxy', process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) || 1 : 1);

// Create HTTP server
const server = createServer(app);

// WebSocket servers (using noServer mode for manual routing)
const terminalWss = new WebSocketServer({ noServer: true });
const agentWss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade requests
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url!, `http://${request.headers.host}`);
  console.log(`[WS] Upgrade request for path: ${url.pathname}`);
  
  if (url.pathname === '/terminal') {
    console.log('[WS] Routing to terminal WebSocket');
    terminalWss.handleUpgrade(request, socket, head, (ws) => {
      terminalWss.emit('connection', ws, request);
    });
  } else if (url.pathname === '/agent') {
    console.log('[WS] Routing to agent WebSocket');
    agentWss.handleUpgrade(request, socket, head, (ws) => {
      agentWss.emit('connection', ws, request);
    });
  } else {
    console.log(`[WS] Unknown path: ${url.pathname}, destroying socket`);
    socket.destroy();
  }
});

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Disable for WebSocket
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));

// Compression
app.use(compression());

// Body parsers
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Rate limiting (write-heavy endpoints only; skip read polling to avoid false "offline" states)
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '200'),
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: Request) => {
    if (req.method === 'GET' || req.method === 'OPTIONS') return true;
    if (req.path.startsWith('/agents')) return true;
    return false;
  },
});
app.use('/api', limiter);

// Request logging
app.use((req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    authEnabled: isAuthEnabled(),
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api', requireAuthIfEnabled);

// RBAC enforcement
app.use('/api/connections', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/docker', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/scripts', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/files', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/agents', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/port-forwards', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/proxmox', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/network', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/hardening', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/wazuh', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/planner', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/security', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/alerting', requireRoleIfEnabled(['user'], { writeOnly: true }));
app.use('/api/sar-agent', requireRoleIfEnabled(['admin'], { writeOnly: true }));
app.use('/api/ssh-keys', requireRoleIfEnabled(['admin']));
app.use('/api/ssh-key-deploy', requireRoleIfEnabled(['admin']));

app.use('/api/connections', connectionRoutes);
app.use('/api/alerting', alertingRoutes);
app.use('/api/sar-agent', sarAgentRoutes);
app.use('/api/docker', dockerRoutes);
app.use('/api/diagnostics', diagnosticsRoutes);
app.use('/api/security', securityRoutes);
app.use('/api/scripts', scriptsRoutes);
app.use('/api/system', systemRoutes);
app.use('/api/ssh-keys', sshKeysRoutes);
app.use('/api/ssh-key-deploy', sshKeyDeployRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/agents', agentRoutes);
app.use('/api/port-forwards', portForwardsRoutes);
app.use('/api/proxmox', proxmoxRoutes);
app.use('/api/network', networkRoutes);
app.use('/api/hardening', hardeningRoutes);
app.use('/api/wazuh', wazuhRoutes);
app.use('/api/planner', plannerRoutes);

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// 404 handler
app.use((req: Request, res: Response) => {
  res.status(404).json({ error: 'Route not found' });
});

// Metrics collection scheduler
function startMetricsScheduler() {
  // Collect frequently so charts look smooth and reflect reality.
  const intervalSeconds = Math.max(10, parseInt(process.env.METRICS_INTERVAL_SECONDS || '30') || 30);
  const interval = intervalSeconds * 1000;
  
  let collecting = false;
  const collectMetrics = async () => {
    // reachability of all systems runs alongside the metrics
    void probeConnections().catch((error) => console.error('Reachability check failed:', error));
    // a slow round must not overlap with the next one (the first hosts would be measured twice, the last ones starve)
    if (collecting) return;
    collecting = true;
    try {
      // systems with a connected SAR agent report on their own, no SSH needed
      const connections: any[] = (connectionDb.getAll() as any[]).filter((conn) => conn.status === 'online' && !hasOnlineAgent(conn.id));
      const queue = [...connections];
      // 4 hosts at a time
      await Promise.all(Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const conn = queue.shift();
        
        try {
          const connConfig = {
            id: conn.id,
            name: conn.name,
            host: conn.host,
            port: conn.port,
            username: conn.username,
            password: conn.password,
            authType: conn.auth_type || 'password',
            privateKeyPath: conn.private_key_path,
            passphrase: conn.passphrase,
          };

          let metrics: {
            cpu: number;
            memory: number;
            disk: number;
            loadAvg1: number;
            loadAvg5: number;
            loadAvg15: number;
            netRxRate?: number;
            netTxRate?: number;
            diskReadRate?: number;
            diskWriteRate?: number;
          } | null = null;

          if (process.env.USE_NODE_EXPORTER !== 'false') {
            const exporterUrl = (conn.metrics_url as string | undefined) || `http://${conn.host}:9100/metrics`;

            try {
              const nodeMetrics = await collectNodeExporterSystemMetrics(exporterUrl);
              const sshMemory = await collectSSHMemoryMetrics(connConfig).catch((error) => {
                console.warn(`guest memory override failed for ${conn.name}:`, error);
                return null;
              });
              
              // Only use SSH memory if it's reasonably close to node-exporter memory.
              // If SSH total is much smaller, it's likely a container with cgroup limits—use node-exporter instead.
              let useSSHMemory = false;
              if (sshMemory && nodeMetrics.memory.total > 0) {
                const ratio = sshMemory.total / nodeMetrics.memory.total;
                useSSHMemory = ratio > 0.8; // SSH memory is within 80% of node-exporter
              }
              
              metrics = {
                cpu: nodeMetrics.cpu.usage,
                memory: useSSHMemory ? sshMemory!.percentUsed : nodeMetrics.memory.percentUsed,
                disk: nodeMetrics.disk.percentUsed,
                loadAvg1: nodeMetrics.loadAverage.one,
                loadAvg5: nodeMetrics.loadAverage.five,
                loadAvg15: nodeMetrics.loadAverage.fifteen,
                netRxRate: nodeMetrics.networkRates?.rxRate,
                netTxRate: nodeMetrics.networkRates?.txRate,
                diskReadRate: nodeMetrics.diskIO?.readRate,
                diskWriteRate: nodeMetrics.diskIO?.writeRate,
              };
            } catch (nodeExporterError) {
              console.warn(`node_exporter unavailable for ${conn.name}:`, nodeExporterError);
            }
          }

          if (!metrics) {
          // Get current metrics
          const [cpuResult, loadResult, memResult, dfResult, topResult] = await Promise.all([
            SSHService.executeCommand(connConfig, 'nproc'),
            SSHService.executeCommand(connConfig, 'cat /proc/loadavg'),
            SSHService.executeCommand(connConfig, 'free -b'),
            SSHService.executeCommand(connConfig, 'df -P -B1 /'),
            // two /proc/stat samples 1 s apart; `top -bn1` only has one frame and reads 0 or 100 % in LXC containers
            SSHService.executeCommand(connConfig, 'head -n1 /proc/stat; sleep 1; head -n1 /proc/stat'),
          ]);

          const loadLine = loadResult.data?.stdout?.trim() || '0 0 0';
          const loadAvg = loadLine.split(/\s+/).slice(0, 3).map((v: string) => parseFloat(v) || 0);

          const memLine = (memResult.data?.stdout || '')
            .split('\n')
            .find((line: string) => line.trim().startsWith('Mem:')) || '';
          const memParts = memLine.trim().split(/\s+/);
          const memTotal = parseInt(memParts[1] || '0') || 0;
          const memAvailable = parseInt(memParts[6] || memParts[3] || '0') || 0;
          const memUsed = Math.max(0, memTotal - memAvailable);
          const memPercent = memTotal > 0 ? (memUsed / memTotal) * 100 : 0;

          // df -P: one line per filesystem, columns Filesystem 1-blocks Used Available Capacity Mounted
          // (a regex over the whole line used to catch the "1" of /dev/sda1 as total size)
          const dfColumns = ((dfResult.data?.stdout || '').split('\n')[1] || '').trim().split(/\s+/);
          const diskTotal = parseInt(dfColumns[1] || '0') || 0;
          const diskUsed = parseInt(dfColumns[2] || '0') || 0;
          const diskPercent = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;

          const [statA, statB] = (topResult.data?.stdout || '').trim().split('\n').map((line: string) => line.trim().split(/\s+/).slice(1).map(Number));
          let cpuUsage = Number.NaN;
          if (statA?.length >= 4 && statB?.length >= 4) {
            const total = statB.reduce((sum: number, value: number) => sum + value, 0) - statA.reduce((sum: number, value: number) => sum + value, 0);
            // idle + iowait count as not busy
            const idle = statB[3] + (statB[4] || 0) - (statA[3] + (statA[4] || 0));
            if (total > 0) cpuUsage = Math.max(0, Math.min(100, (1 - idle / total) * 100));
          }

          metrics = {
            cpu: cpuUsage,
            memory: memPercent,
            disk: diskPercent,
            loadAvg1: loadAvg[0],
            loadAvg5: loadAvg[1],
            loadAvg15: loadAvg[2],
          };
          }

          // Save to database
          metricsDb.save(conn.id, metrics);

          // Thresholds with spike filter, alerts and notifications (services/alerting.ts)
          evaluateMetrics(conn, metrics);
        } catch (err) {
          console.error(`Failed to collect metrics for ${conn.name}:`, err);
        }
      }
      }));
    } catch (err) {
      console.error('Failed to collect metrics:', err);
    } finally {
      collecting = false;
    }
  };

  // Collect metrics immediately, then every interval
  collectMetrics();
  setInterval(collectMetrics, interval);
  
  console.log(`✓ Metrics scheduler started (every ${intervalSeconds}s)`);
}

// Initialize database
initDatabase()
  .then(() => {
    console.log('✓ Database initialized');
    
    // Initialize agent database
    initAgentDatabase();
    console.log('✓ Agent database initialized');
    
    // Setup Agent WebSocket handlers
    setupAgentWebSocket(agentWss);
    console.log('✓ Agent WebSocket server configured');
    
    // Setup WebSocket handlers
    setupWebSocketHandlers(terminalWss);
    console.log('✓ WebSocket handlers configured');

    // Start metrics collection scheduler
    startMetricsScheduler();

    // One-time startup cleanup: prune runaway duplicate alert rows and
    // auto-resolve alerts for connections that are currently offline
    // (stale records from a previous session).
    try {
      const pruneResult = alertsDb.pruneDuplicates();
      console.log(`✓ Alert dedup: removed ${pruneResult.changes} duplicate rows`);

      const offlineConnections: any[] = connectionDb.getAll().filter((c: any) => c.status !== 'online');
      let resolvedCount = 0;
      for (const conn of offlineConnections) {
        for (const alertType of ['cpu', 'memory', 'disk']) {
          const r = alertsDb.resolveByType(conn.id, alertType);
          resolvedCount += r.changes;
        }
      }
      if (resolvedCount > 0) console.log(`✓ Alert cleanup: resolved ${resolvedCount} stale alerts for offline hosts`);

      // disk alerts from the old df parsing bug (values far above 100 %) were never real
      const bogus = getDatabase().prepare("UPDATE alerts SET is_resolved = 1, resolved_at = CURRENT_TIMESTAMP WHERE alert_type = 'disk' AND is_resolved = 0 AND actual_value > 100").run();
      if (bogus.changes) console.log(`✓ Alert cleanup: resolved ${bogus.changes} disk alerts with impossible values`);

      alertsDb.deleteOlderThan(30);
    } catch (cleanupErr) {
      console.warn('Alert cleanup failed (non-fatal):', cleanupErr);
    }

    // Start server
    server.listen(parseInt(PORT.toString()), HOST, () => {
      console.log('╔════════════════════════════════════════════╗');
      console.log('║  SSH & RDP Manager Backend Server         ║');
      console.log('╠════════════════════════════════════════════╣');
      console.log(`║  Environment: ${process.env.NODE_ENV?.padEnd(28) || 'production'.padEnd(28)} ║`);
      console.log(`║  HTTP Server: http://${HOST}:${PORT}${' '.repeat(18 - HOST.length - PORT.toString().length)} ║`);
      console.log(`║  WebSocket:   ws://${HOST}:${PORT}/terminal${' '.repeat(14 - HOST.length - PORT.toString().length)} ║`);
      console.log('╚════════════════════════════════════════════╝');
    });
  })
  .catch((err) => {
    console.error('Failed to initialize server:', err);
    process.exit(1);
  });

// Graceful shutdown
const shutdown = () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

export { app, server, terminalWss as wss };
