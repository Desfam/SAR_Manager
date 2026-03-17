import { Router, Request, Response } from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { agentDb } from '../services/agent-database.js';
import { agentMetricsDb } from '../services/agent-database.js';

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
}

interface MetricsPayload {
  timestamp: string;
  agent_id: string;
  agent_name: string;
  cpu: any;
  memory: any;
  disk: any[];
  network: any;
  processes: any;
  system_info: any;
}

interface CommandResponse {
  id: string;
  success: boolean;
  output: string;
  error?: string;
  exit_code: number;
  duration: number;
}

/**
 * Setup WebSocket server for agent connections
 */
export function setupAgentWebSocket(server: Server) {
  const wss = new WebSocketServer({ 
    server,
    path: '/agent'
  });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    const token = url.searchParams.get('token');
    const agentId = url.searchParams.get('agent_id');

    // Validate token
    if (!token || !verifyAgentToken(token)) {
      console.error('Invalid agent token');
      ws.close(4001, 'Invalid token');
      return;
    }

    console.log(`Agent connected: ${agentId || 'unknown'}`);

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

    case 'pong':
      // Heartbeat response
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

  // Store connection
  activeAgents.set(payload.agent_id, ws);

  // Send acknowledgment
  sendMessage(ws, 'registered', {
    agent_id: payload.agent_id,
    message: 'Registration successful',
  });
}

/**
 * Handle metrics from agent
 */
async function handleMetrics(payload: MetricsPayload) {
  // Store metrics in database
  agentMetricsDb.storeMetrics(payload);

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
 * Get all registered agents
 */
router.get('/agents', (req: Request, res: Response) => {
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
router.get('/agents/:agentId', (req: Request, res: Response) => {
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
router.get('/agents/:agentId/metrics', (req: Request, res: Response) => {
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
router.get('/agents/:agentId/metrics/latest', (req: Request, res: Response) => {
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
 * Execute command on agent
 */
router.post('/agents/:agentId/execute', (req: Request, res: Response) => {
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
router.delete('/agents/:agentId', (req: Request, res: Response) => {
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
router.put('/agents/:agentId/config', (req: Request, res: Response) => {
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
router.get('/agents/:agentId/status', (req: Request, res: Response) => {
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

export default router;
