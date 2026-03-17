import { WebSocketServer, WebSocket } from 'ws';
import { Client } from 'ssh2';
import * as pty from 'node-pty';
import { connectionDb } from './database.js';

interface TerminalSession {
  ws: WebSocket;
  pty?: pty.IPty;
  sshClient?: Client;
  sshStream?: any;
  connectionId?: string;
}

const activeSessions = new Map<string, TerminalSession>();

export function setupWebSocketHandlers(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket, req) => {
    const sessionId = Math.random().toString(36).substring(7);
    console.log(`WebSocket connected: ${sessionId}`);

    activeSessions.set(sessionId, { ws });

    ws.on('message', async (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString());
        await handleMessage(sessionId, message);
      } catch (error: any) {
        console.error('WebSocket message error:', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: error.message,
        }));
      }
    });

    ws.on('close', () => {
      console.log(`WebSocket closed: ${sessionId}`);
      cleanupSession(sessionId);
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error (${sessionId}):`, error);
      cleanupSession(sessionId);
    });

    // Send connection confirmation
    ws.send(JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'Terminal session ready',
    }));
  });
}

async function handleMessage(sessionId: string, message: any) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  switch (message.type) {
    case 'connect-ssh':
      await connectSSH(sessionId, message.connectionId);
      break;

    case 'connect-local':
      connectLocalTerminal(sessionId);
      break;

    case 'input':
      handleTerminalInput(sessionId, message.data);
      break;

    case 'resize':
      resizeTerminal(sessionId, message.cols, message.rows);
      break;

    case 'disconnect':
      cleanupSession(sessionId);
      break;

    default:
      console.warn(`Unknown message type: ${message.type}`);
  }
}

async function connectSSH(sessionId: string, connectionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const connection: any = connectionDb.getById(connectionId);
  if (!connection) {
    session.ws.send(JSON.stringify({
      type: 'error',
      message: 'Connection not found',
    }));
    return;
  }

  const client = new Client();
  session.sshClient = client;
  session.connectionId = connectionId;

  client.on('ready', () => {
    session.ws.send(JSON.stringify({
      type: 'connected',
      message: `Connected to ${connection.name}`,
    }));

    client.shell((err, stream) => {
      if (err) {
        session.ws.send(JSON.stringify({
          type: 'error',
          message: `Shell error: ${err.message}`,
        }));
        return;
      }

      // Store stream reference for input handling
      session.sshStream = stream;

      stream.on('data', (data: Buffer) => {
        session.ws.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf-8'),
        }));
      });

      stream.on('close', () => {
        session.ws.send(JSON.stringify({
          type: 'disconnected',
          message: 'SSH session closed',
        }));
        cleanupSession(sessionId);
      });

      stream.stderr.on('data', (data: Buffer) => {
        session.ws.send(JSON.stringify({
          type: 'output',
          data: data.toString('utf-8'),
        }));
      });
    });
  });

  client.on('error', (err) => {
    session.ws.send(JSON.stringify({
      type: 'error',
      message: `SSH error: ${err.message}`,
    }));
  });

  const connectConfig: any = {
    host: connection.host,
    port: connection.port,
    username: connection.username,
  };

  if (connection.auth_type === 'password' && connection.password) {
    connectConfig.password = connection.password;
  } else if (connection.auth_type === 'key' && connection.private_key_path) {
    connectConfig.privateKey = require('fs').readFileSync(connection.private_key_path);
  }

  client.connect(connectConfig);
}

function connectLocalTerminal(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
  
  const ptyProcess = pty.spawn(shell, [], {
    name: 'xterm-256color',
    cols: 80,
    rows: 30,
    cwd: process.env.HOME || process.cwd(),
    env: process.env as any,
  });

  session.pty = ptyProcess;

  ptyProcess.onData((data) => {
    session.ws.send(JSON.stringify({
      type: 'output',
      data,
    }));
  });

  ptyProcess.onExit(({ exitCode }) => {
    session.ws.send(JSON.stringify({
      type: 'disconnected',
      message: `Terminal exited with code ${exitCode}`,
    }));
    cleanupSession(sessionId);
  });

  session.ws.send(JSON.stringify({
    type: 'connected',
    message: 'Local terminal connected',
  }));
}

function handleTerminalInput(sessionId: string, data: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.pty) {
    session.pty.write(data);
  } else if (session.sshStream) {
    session.sshStream.write(data);
  }
}

function resizeTerminal(sessionId: string, cols: number, rows: number) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.pty) {
    session.pty.resize(cols, rows);
  } else if (session.sshStream && session.sshStream.setWindow) {
    session.sshStream.setWindow(rows, cols, 0, 0);
  }
}

function cleanupSession(sessionId: string) {
  const session = activeSessions.get(sessionId);
  if (!session) return;

  if (session.pty) {
    session.pty.kill();
  }

  if (session.sshClient) {
    session.sshClient.end();
  }

  activeSessions.delete(sessionId);
}

export { activeSessions };
