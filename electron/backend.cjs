// Starts the existing SAR backend (backend/) unless one is already answering on its port.
const { spawn, execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const BACKEND_PORT = Number(process.env.SAR_BACKEND_PORT || 3001);
const BACKEND_DIR = path.join(__dirname, '..', 'backend');
const HEALTH_URL = `http://127.0.0.1:${BACKEND_PORT}/health`;
// Proxmox signs its API certificates with its own cluster CA; trusting that CA keeps TLS verification on
const PVE_CA_FILE = path.join(__dirname, '..', 'certs', 'pve-root-ca.pem');

let child = null;
let ownsBackend = false;

async function isHealthy() {
  try {
    const response = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}

/** The backend's native modules (better-sqlite3, node-pty) are built for the system Node, not Electron's. */
function findSystemNode() {
  const candidates = [process.env.SAR_NODE, '/usr/bin/node', '/usr/local/bin/node'];
  try {
    candidates.unshift(execFileSync('bash', ['-lc', 'command -v node'], { encoding: 'utf8' }).trim());
  } catch {
    // no login-shell node
  }
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || null;
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isHealthy()) return true;
    if (child && child.exitCode !== null) return false;
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  return false;
}

async function ensureBackend(log = console.log) {
  if (await isHealthy()) {
    log(`[backend] already running on :${BACKEND_PORT}, reusing it`);
    return { ok: true, owned: false, port: BACKEND_PORT };
  }

  const node = findSystemNode();
  const tsx = path.join(BACKEND_DIR, 'node_modules', 'tsx', 'dist', 'cli.mjs');
  const builtServer = path.join(BACKEND_DIR, 'dist', 'server.js');
  if (!node) return { ok: false, owned: false, port: BACKEND_PORT, error: 'Node.js wurde nicht gefunden (benötigt für das Backend).' };

  // During `npm run app:dev` the backend restarts itself on code changes
  const watch = process.env.SAR_DEV_URL ? ['watch'] : [];
  const args = fs.existsSync(tsx) ? [tsx, ...watch, 'src/server.ts'] : [builtServer];
  log(`[backend] starting: ${node} ${args.join(' ')}`);
  child = spawn(node, args, {
    cwd: BACKEND_DIR,
    env: {
      ...process.env,
      PORT: String(BACKEND_PORT),
      ...(fs.existsSync(PVE_CA_FILE) ? { NODE_EXTRA_CA_CERTS: PVE_CA_FILE } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  ownsBackend = true;
  child.stdout.on('data', (chunk) => log(`[backend] ${chunk.toString().trimEnd()}`));
  child.stderr.on('data', (chunk) => log(`[backend:err] ${chunk.toString().trimEnd()}`));
  child.on('exit', (code) => {
    log(`[backend] exited with ${code}`);
    child = null;
  });

  const ok = await waitForHealth(30_000);
  return ok
    ? { ok: true, owned: true, port: BACKEND_PORT }
    : { ok: false, owned: true, port: BACKEND_PORT, error: 'Backend ist nicht rechtzeitig gestartet.' };
}

function stopBackend() {
  if (!ownsBackend || !child) return;
  child.kill('SIGTERM');
  const pending = child;
  setTimeout(() => pending.exitCode === null && pending.kill('SIGKILL'), 3000).unref();
}

module.exports = { ensureBackend, stopBackend, BACKEND_PORT };
