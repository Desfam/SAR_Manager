import { Router, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import {
  agentDb, agentMetricsDb, agentServicesDb, agentLogsDb, agentConnectionsDb, agentSecurityAlertsDb,
  agentProfilesDb, agentPoliciesDb, agentJobsDb, auditResultsDb,
} from '../services/agent-database.js';

const router = Router();

// Store active agent connections
const activeAgents = new Map<string, WebSocket>();

// Message types
interface AgentMessage {
  type: string;
  payload: any;
}

interface RegisterPayload {
  agent_id: string;
  agent_name: string;
  version: string;
  tags: string[];
  environment: string;
  hostname: string;
  os: string;
  platform: string;
  ip_address?: string;
  capabilities?: Record<string, boolean>;
}

interface MetricsPayload {
  timestamp: string;
  agent_id: string;
  agent_name: string;
  cpu: any;
  memory: any;
  disk: any[];
  network: any;
  connections?: any[];
  processes: any;
  system_info: any;
  services?: any[];
  logs?: Record<string, string[]>;
}

interface CommandResponse {
  id: string;
  success: boolean;
  output: string;
  error?: string;
  exit_code: number;
  duration: number;
}

interface JobResultPayload {
  job_id: string;
  agent_id: string;
  job_type: string;
  status: string;
  result?: any;
  error?: string;
  completed_at: string;
}

interface AuditResultPayload {
  job_id: string;
  agent_id: string;
  audit_type: string;
  status: string;
  score: number;
  summary: { passed: number; failed: number; warnings: number };
  findings: any[];
  timestamp: string;
}

function parseAddress(address?: string): { host: string; port: number | null } {
  if (!address) return { host: '', port: null };

  const bracketMatch = address.match(/^\[([^\]]+)\]:(\d+)$/);
  if (bracketMatch) {
    return { host: bracketMatch[1], port: parseInt(bracketMatch[2], 10) || null };
  }

  const genericMatch = address.match(/^(.*):(\d+)$/);
  if (genericMatch) {
    return { host: genericMatch[1], port: parseInt(genericMatch[2], 10) || null };
  }

  return { host: address, port: null };
}

function isPublicIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return false;

  const [a, b] = parts;
  if (a === 10) return false;
  if (a === 127) return false;
  if (a === 192 && b === 168) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 169 && b === 254) return false;

  return true;
}

function analyzeConnectionSecurity(agentId: string, connections: any[]) {
  if (!Array.isArray(connections) || connections.length === 0) return;

  const establishedThreshold = parseInt(process.env.AGENT_ALERT_ESTABLISHED_THRESHOLD || '180', 10);
  const remoteFanoutThreshold = parseInt(process.env.AGENT_ALERT_REMOTE_FANOUT_THRESHOLD || '60', 10);
  const dedupeWindowMinutes = parseInt(process.env.AGENT_ALERT_DEDUPE_MINUTES || '10', 10);

  const established = connections.filter((connection) => connection?.status === 'ESTABLISHED');
  if (established.length >= establishedThreshold) {
    agentSecurityAlertsDb.create(
      {
        agent_id: agentId,
        alert_type: 'connection_volume',
        severity: established.length >= establishedThreshold * 1.5 ? 'critical' : 'warning',
        message: `High established connection volume detected (${established.length})`,
        evidence: JSON.stringify({ established: established.length, threshold: establishedThreshold }),
        fingerprint: `conn_volume:${Math.floor(established.length / 20)}`,
      },
      dedupeWindowMinutes,
    );
  }

  const publicRemoteIps = new Set<string>();
  for (const connection of established) {
    const remote = parseAddress(connection?.remote_addr);
    if (remote.host && isPublicIPv4(remote.host)) {
      publicRemoteIps.add(remote.host);
    }
  }

  if (publicRemoteIps.size >= remoteFanoutThreshold) {
    agentSecurityAlertsDb.create(
      {
        agent_id: agentId,
        alert_type: 'remote_fanout',
        severity: publicRemoteIps.size >= remoteFanoutThreshold * 1.5 ? 'critical' : 'warning',
        message: `High remote endpoint fan-out detected (${publicRemoteIps.size} public IPs)`,
        evidence: JSON.stringify({ remote_ips: publicRemoteIps.size, threshold: remoteFanoutThreshold }),
        fingerprint: `remote_fanout:${Math.floor(publicRemoteIps.size / 10)}`,
      },
      dedupeWindowMinutes,
    );
  }

  const sensitivePorts = new Map<number, string>([
    [23, 'telnet'],
    [445, 'smb'],
    [3389, 'rdp'],
    [5900, 'vnc'],
  ]);

  const sensitiveHits = new Map<number, number>();
  for (const connection of established) {
    const remote = parseAddress(connection?.remote_addr);
    if (!remote.port || !sensitivePorts.has(remote.port) || !isPublicIPv4(remote.host)) continue;
    sensitiveHits.set(remote.port, (sensitiveHits.get(remote.port) || 0) + 1);
  }

  for (const [port, count] of sensitiveHits.entries()) {
    const service = sensitivePorts.get(port) || `port_${port}`;
    agentSecurityAlertsDb.create(
      {
        agent_id: agentId,
        alert_type: 'sensitive_public_port',
        severity: count >= 5 ? 'critical' : 'warning',
        message: `Established ${service.toUpperCase()} sessions over public network (${count})`,
        evidence: JSON.stringify({ port, service, connections: count }),
        fingerprint: `sensitive:${service}:${Math.floor(count / 2)}`,
      },
      dedupeWindowMinutes,
    );
  }
}

/**
 * Setup WebSocket server for agent connections
 */
/**
 * Setup WebSocket handlers for agent connections
 */
export function setupAgentWebSocket(wss: WebSocketServer) {
  console.log('[AGENT SETUP] Configuring agent WebSocket handlers');

  wss.on('connection', (ws: WebSocket, req) => {
    console.log('[AGENT] New WebSocket connection attempt');
    console.log('[AGENT] URL:', req.url);
    console.log('[AGENT] Host:', req.headers.host);
    
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const agentId = url.searchParams.get('agent_id');

    console.log('[AGENT] Parsed token:', token ? 'present' : 'missing');
    console.log('[AGENT] Parsed agentId:', agentId || 'none');

    // Validate token
    if (!token || !verifyAgentToken(token)) {
      console.error('[AGENT] Invalid agent token - rejecting');
      ws.close(4001, 'Invalid token');
      return;
    }

    console.log(`[AGENT] Agent connected: ${agentId || 'unknown'}`);

    let currentAgentId = agentId || '';

    // Setup message handler
    ws.on('message', async (data: Buffer) => {
      try {
        const message: AgentMessage = JSON.parse(data.toString());
        await handleAgentMessage(ws, message, currentAgentId);

        // Update agent ID after registration
        if (message.type === 'register' && message.payload.agent_id) {
          currentAgentId = message.payload.agent_id;
          activeAgents.set(currentAgentId, ws);
        }
      } catch (error) {
        console.error('Error handling agent message:', error);
      }
    });

    // Setup close handler
    ws.on('close', () => {
      console.log(`Agent disconnected: ${currentAgentId}`);
      activeAgents.delete(currentAgentId);

      // Update agent status
      if (currentAgentId) {
        agentDb.updateAgentStatus(currentAgentId, 'offline', null);
      }
    });

    // Setup error handler
    ws.on('error', (error) => {
      console.error(`Agent error (${currentAgentId}):`, error);
    });

    // Send initial ping
    sendMessage(ws, 'ping', {});
  });

  // Global error handler for WebSocket server
  wss.on('error', (error) => {
    console.error('[AGENT] WebSocket server error:', error);
  });

  // Stale agent detection — runs every 60s
  setInterval(() => {
    const staleMinutes = parseInt(process.env.AGENT_STALE_MINUTES || '3', 10);
    agentDb.markStaleAgents(staleMinutes, new Set(activeAgents.keys()));
  }, 60_000);

  // Periodic ping to all connected agents to keep last_seen fresh
  setInterval(() => {
    for (const [agentId, ws] of activeAgents.entries()) {
      sendMessage(ws, 'ping', { timestamp: new Date().toISOString() });
    }
  }, 30_000);

  console.log('Agent WebSocket server started on /agent');

  return wss;
}

/**
 * Handle incoming messages from agents
 */
async function handleAgentMessage(ws: WebSocket, message: AgentMessage, agentId: string) {
  switch (message.type) {
    case 'register':
      await handleRegister(ws, message.payload as RegisterPayload);
      break;

    case 'metrics':
      await handleMetrics(message.payload as MetricsPayload);
      break;

    case 'command_response':
      await handleCommandResponse(message.payload as CommandResponse);
      break;

    case 'job_result':
      await handleJobResult(message.payload as JobResultPayload);
      break;

    case 'job_status':
      await handleJobStatus(message.payload as JobResultPayload);
      break;

    case 'audit_result':
      await handleAuditResult(message.payload as AuditResultPayload);
      break;

    case 'pong':
      // Heartbeat response — update last_seen
      if (agentId) agentDb.updateAgentStatus(agentId, 'online', new Date().toISOString());
      break;

    default:
      console.warn(`Unknown message type from agent: ${message.type}`);
  }
}

/**
 * Handle agent registration
 */
async function handleRegister(ws: WebSocket, payload: RegisterPayload) {
  console.log(`Registering agent: ${payload.agent_name} (${payload.agent_id})`);

  // Store agent in database
  agentDb.registerAgent({
    id: payload.agent_id,
    name: payload.agent_name,
    hostname: payload.hostname,
    os: payload.os,
    platform: payload.platform,
    version: payload.version,
    tags: payload.tags,
    environment: payload.environment,
    status: 'online',
    last_seen: new Date().toISOString(),
  });

  // Store capabilities and IP
  if (payload.capabilities || payload.ip_address) {
    agentDb.updateCapabilities(payload.agent_id, payload.capabilities || {}, payload.ip_address);
  }

  // Store connection
  activeAgents.set(payload.agent_id, ws);

  // Send acknowledgment
  sendMessage(ws, 'registered', {
    agent_id: payload.agent_id,
    message: 'Registration successful',
  });

  // Push effective policy to agent
  setTimeout(() => {
    try {
      const policy = agentPoliciesDb.getEffectivePolicy(payload.agent_id);
      sendMessage(ws, 'policy_update', policy);
      console.log(`[AGENT] Pushed policy to ${payload.agent_id} (profile: ${policy.profile_id})`);
    } catch (err) {
      console.error('[AGENT] Failed to push policy:', err);
    }
  }, 300);

  // Dispatch pending jobs
  setTimeout(() => {
    try {
      const pending = agentJobsDb.getPending(payload.agent_id);
      for (const job of pending) {
        sendMessage(ws, 'job_dispatch', {
          job_id: job.id,
          job_type: job.job_type,
          audit_type: job.audit_type || undefined,
          requested_by: job.requested_by || 'system',
          options: job.payload ? JSON.parse(job.payload) : {},
        });
        agentJobsDb.markSent(job.id);
        console.log(`[AGENT] Dispatched pending job ${job.id} to ${payload.agent_id}`);
      }
    } catch (err) {
      console.error('[AGENT] Failed to dispatch pending jobs:', err);
    }
  }, 600);
}

/**
 * Handle metrics from agent
 */
async function handleMetrics(payload: MetricsPayload) {
  console.log(`[AGENT] Received metrics from agent: ${payload.agent_id}`);
  
  // Store metrics in database
  agentMetricsDb.storeMetrics(payload);

  // Store services if provided
  if (payload.services && payload.services.length > 0) {
    agentServicesDb.storeServices(payload.agent_id, payload.services);
    console.log(`[AGENT] Stored ${payload.services.length} services`);
  }

  // Store latest live connections snapshot if provided
  if (payload.connections) {
    agentConnectionsDb.storeConnections(payload.agent_id, payload.timestamp, payload.connections);
    analyzeConnectionSecurity(payload.agent_id, payload.connections);
  }

  // Store logs if provided
  if (payload.logs) {
    agentLogsDb.storeLogs(payload.agent_id, payload.logs);
    const logCount = Object.keys(payload.logs).length;
    console.log(`[AGENT] Stored ${logCount} log sources`);
  }

  // Update agent last seen
  agentDb.updateAgentStatus(payload.agent_id, 'online', payload.timestamp);

  // Broadcast to connected web clients if needed
  // broadcastToWebClients('agent_metrics', payload);
}

/**
 * Handle command execution response
 */
async function handleCommandResponse(payload: CommandResponse) {
  console.log(`Command response received: ${payload.id}`);
  
  // Store command result
  // commandHistoryDb.storeResult(payload);

  // Notify web client that requested the command
  // notifyCommandCompleted(payload);
}

/**
 * Handle job status update from agent
 */
async function handleJobStatus(payload: JobResultPayload) {
  const { job_id, status } = payload;
  if (!job_id) return;
  if (status === 'running') {
    agentJobsDb.markRunning(job_id);
  }
}

/**
 * Handle completed job result from agent
 */
async function handleJobResult(payload: JobResultPayload) {
  const { job_id, status, result, error } = payload;
  if (!job_id) return;

  if (status === 'completed' || status === 'failed') {
    if (status === 'failed') {
      agentJobsDb.fail(job_id, error || 'unknown error');
    } else {
      agentJobsDb.complete(job_id, result || {});
    }
    console.log(`[AGENT] Job ${job_id} → ${status}`);
  }
}

/**
 * Handle structured audit result from agent
 */
async function handleAuditResult(payload: AuditResultPayload) {
  if (!payload.job_id || !payload.agent_id) return;

  auditResultsDb.store({
    job_id: payload.job_id,
    agent_id: payload.agent_id,
    audit_type: payload.audit_type,
    status: payload.status,
    score: payload.score || 0,
    passed: payload.summary?.passed || 0,
    failed: payload.summary?.failed || 0,
    warnings: payload.summary?.warnings || 0,
    findings: payload.findings || [],
  });

  // Mark parent job as completed
  agentJobsDb.complete(payload.job_id, {
    score: payload.score,
    summary: payload.summary,
    audit_type: payload.audit_type,
  });

  console.log(`[AGENT] Audit result stored: ${payload.audit_type} for ${payload.agent_id} (score: ${payload.score})`);
}

/**
 * Send a message to an agent
 */
function sendMessage(ws: WebSocket, type: string, payload: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type, payload }));
  }
}

/**
 * Verify agent authentication token
 */
function verifyAgentToken(token: string): boolean {
  // TODO: Implement proper token verification
  // For now, just check it's not empty and matches expected format
  const validTokens = process.env.AGENT_TOKENS?.split(',') || [];
  return validTokens.length === 0 || validTokens.includes(token);
}

// REST API endpoints

/**
 * Get active agent security alerts
 */
router.get('/alerts/active', (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 200;
    const alerts = agentSecurityAlertsDb.getActive(limit);
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching active agent alerts:', error);
    res.status(500).json({ error: 'Failed to fetch active agent alerts' });
  }
});

/**
 * Resolve agent security alert
 */
router.post('/alerts/:id/resolve', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) {
      return res.status(400).json({ error: 'Invalid alert id' });
    }

    agentSecurityAlertsDb.resolve(id);
    res.json({ success: true, message: 'Agent alert resolved' });
  } catch (error) {
    console.error('Error resolving agent alert:', error);
    res.status(500).json({ error: 'Failed to resolve agent alert' });
  }
});

/**
 * Get all registered agents
 */
router.get('/', (req: Request, res: Response) => {
  try {
    const agents = agentDb.getAllAgents();
    res.json(agents);
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
});

/**
 * Get specific agent details
 */
router.get('/:agentId', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const agent = agentDb.getAgent(agentId);

    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }

    res.json(agent);
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
});

/**
 * Get agent metrics
 */
router.get('/:agentId/metrics', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { from, to, limit } = req.query;

    const metrics = agentMetricsDb.getMetrics(
      agentId,
      from as string,
      to as string,
      limit ? parseInt(limit as string) : 100
    );

    res.json(metrics);
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * Get latest metrics for an agent
 */
router.get('/:agentId/metrics/latest', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const latest = agentMetricsDb.getLatestMetrics(agentId);

    if (!latest) {
      return res.status(404).json({ error: 'No metrics found' });
    }

    res.json(latest);
  } catch (error) {
    console.error('Error fetching latest metrics:', error);
    res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

/**
 * Get agent services
 */
router.get('/:agentId/services', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const activeOnly = req.query.active === 'true';
    const services = agentServicesDb.getServices(agentId, activeOnly);

    res.json(services);
  } catch (error) {
    console.error('Error fetching services:', error);
    res.status(500).json({ error: 'Failed to fetch services' });
  }
});

/**
 * Get agent logs
 */
router.get('/:agentId/logs', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const source = req.query.source as string | undefined;
    const limit = parseInt(req.query.limit as string) || 10;
    const logs = agentLogsDb.getLogs(agentId, source, limit);

    res.json(logs);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * Get recent alerts for an agent
 */
router.get('/:agentId/alerts', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 100;
    const alerts = agentSecurityAlertsDb.getRecent(agentId, limit);
    res.json(alerts);
  } catch (error) {
    console.error('Error fetching agent alerts:', error);
    res.status(500).json({ error: 'Failed to fetch agent alerts' });
  }
});

/**
 * Get latest live connections snapshot for an agent
 */
router.get('/:agentId/connections', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 200;
    const connections = agentConnectionsDb.getConnections(agentId, limit);

    res.json(connections);
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).json({ error: 'Failed to fetch connections' });
  }
});

/**
 * Execute command on agent
 */
router.post('/:agentId/execute', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { command, args, timeout } = req.body;

    const ws = activeAgents.get(agentId);
    if (!ws) {
      return res.status(404).json({ error: 'Agent not connected' });
    }

    const commandId = `cmd-${Date.now()}`;
    sendMessage(ws, 'execute_command', {
      id: commandId,
      command,
      args: args || [],
      timeout: timeout || 300,
    });

    res.json({
      command_id: commandId,
      message: 'Command sent to agent',
    });
  } catch (error) {
    console.error('Error executing command:', error);
    res.status(500).json({ error: 'Failed to execute command' });
  }
});

/**
 * Delete agent
 */
router.delete('/:agentId', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;

    // Disconnect agent if connected
    const ws = activeAgents.get(agentId);
    if (ws) {
      ws.close();
      activeAgents.delete(agentId);
    }

    // Delete from database
    agentDb.deleteAgent(agentId);

    res.json({ message: 'Agent deleted successfully' });
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
});

/**
 * Update agent configuration
 */
router.put('/:agentId/config', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const config = req.body;

    const ws = activeAgents.get(agentId);
    if (!ws) {
      return res.status(404).json({ error: 'Agent not connected' });
    }

    sendMessage(ws, 'config_update', config);

    res.json({ message: 'Configuration update sent to agent' });
  } catch (error) {
    console.error('Error updating config:', error);
    res.status(500).json({ error: 'Failed to update configuration' });
  }
});

/**
 * Get agent connection status
 */
router.get('/:agentId/status', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const isConnected = activeAgents.has(agentId);

    res.json({
      agent_id: agentId,
      connected: isConnected,
      connection_count: activeAgents.size,
    });
  } catch (error) {
    console.error('Error checking status:', error);
    res.status(500).json({ error: 'Failed to check status' });
  }
});

// ─────────────────────────────────────────────
//  Profiles
// ─────────────────────────────────────────────

router.get('/profiles', (_req: Request, res: Response) => {
  try {
    res.json(agentProfilesDb.getAll());
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch profiles' });
  }
});

router.post('/profiles', (req: Request, res: Response) => {
  try {
    const { id, name, description, features } = req.body;
    if (!id || !name || !features) return res.status(400).json({ error: 'id, name, features required' });
    agentProfilesDb.upsert({ id, name, description, features });
    res.status(201).json(agentProfilesDb.get(id));
  } catch (error) {
    res.status(500).json({ error: 'Failed to create profile' });
  }
});

router.delete('/profiles/:profileId', (req: Request, res: Response) => {
  try {
    agentProfilesDb.delete(req.params.profileId);
    res.json({ message: 'Profile deleted' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete profile' });
  }
});

// ─────────────────────────────────────────────
//  Policy (per-agent)
// ─────────────────────────────────────────────

router.get('/:agentId/policy', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const policy = agentPoliciesDb.getEffectivePolicy(agentId);
    const raw = agentPoliciesDb.get(agentId);
    res.json({ effective: policy, stored: raw });
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch policy' });
  }
});

router.put('/:agentId/policy', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { profile_id, feature_overrides, metrics_interval_seconds, audit_interval_seconds } = req.body;

    agentPoliciesDb.upsert({
      agent_id: agentId,
      profile_id: profile_id || 'standard-linux',
      feature_overrides: feature_overrides || {},
      metrics_interval_seconds: metrics_interval_seconds || 30,
      audit_interval_seconds: audit_interval_seconds || 3600,
    });

    const effective = agentPoliciesDb.getEffectivePolicy(agentId);

    // Push to agent if connected
    const ws = activeAgents.get(agentId);
    if (ws) {
      sendMessage(ws, 'policy_update', effective);
      console.log(`[AGENT] Policy update pushed to ${agentId}`);
    }

    res.json({ message: 'Policy updated', effective });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update policy' });
  }
});

// ─────────────────────────────────────────────
//  Jobs
// ─────────────────────────────────────────────

router.get('/:agentId/jobs', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 50;
    res.json(agentJobsDb.listForAgent(agentId, limit));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
});

router.post('/:agentId/jobs', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const { job_type, audit_type, options, requested_by } = req.body;

    if (!job_type) return res.status(400).json({ error: 'job_type required' });

    const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = agentJobsDb.create({
      id: jobId,
      agent_id: agentId,
      job_type,
      audit_type: audit_type || undefined,
      payload: JSON.stringify(options || {}),
      status: 'pending',
      requested_by: requested_by || 'api',
    });

    // Immediately dispatch if agent is connected
    const ws = activeAgents.get(agentId);
    if (ws) {
      sendMessage(ws, 'job_dispatch', {
        job_id: jobId,
        job_type,
        audit_type: audit_type || undefined,
        requested_by: requested_by || 'api',
        options: options || {},
      });
      agentJobsDb.markSent(jobId);
      console.log(`[AGENT] Job ${jobId} dispatched immediately to ${agentId}`);
    }

    res.status(202).json(job);
  } catch (error) {
    console.error('Error creating job:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

router.get('/:agentId/jobs/:jobId', (req: Request, res: Response) => {
  try {
    const job = agentJobsDb.get(req.params.jobId);
    if (!job || job.agent_id !== req.params.agentId) {
      return res.status(404).json({ error: 'Job not found' });
    }
    res.json(job);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch job' });
  }
});

// ─────────────────────────────────────────────
//  Audit Results
// ─────────────────────────────────────────────

router.get('/:agentId/audit-results', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 20;
    const auditType = req.query.type as string | undefined;
    if (auditType) {
      const latest = auditResultsDb.getLatest(agentId, auditType);
      return res.json(latest ? [latest] : []);
    }
    res.json(auditResultsDb.listForAgent(agentId, limit));
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch audit results' });
  }
});

router.get('/:agentId/audit-results/latest', (req: Request, res: Response) => {
  try {
    const { agentId } = req.params;
    const auditType = req.query.type as string | undefined;
    const result = auditResultsDb.getLatest(agentId, auditType);
    if (!result) return res.status(404).json({ error: 'No audit results found' });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch latest audit result' });
  }
});

export default router;
