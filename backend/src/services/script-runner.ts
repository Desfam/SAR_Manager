// Runs a stored script on several SSH systems in parallel and keeps live output for polling.
// Every run is stored with a copy of the exact script content, so the history shows what really ran.
import { randomUUID } from 'crypto';
import { auditLogDb, connectionDb, getDatabase } from './database.js';
import { SSHService } from './ssh.js';

export type ExecutionStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface LiveExecution {
  id: number;
  connectionId: string;
  name: string;
  host: string;
  status: ExecutionStatus;
  output: string;
  truncated: boolean;
  exitCode: number | null;
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface LiveRun {
  id: string;
  scriptId: string;
  scriptName: string;
  scriptType: string;
  sudo: boolean;
  args: string[];
  startedAt: string;
  finishedAt?: string;
  executions: LiveExecution[];
}

const MAX_OUTPUT = 512 * 1024; // per server, kept in memory and stored
const CONCURRENCY = 8;
const live = new Map<string, LiveRun & { aborts: Map<number, (reason: string) => void>; cancelled: boolean }>();

let tablesReady = false;
function ensureTables() {
  if (tablesReady) return;
  const db = getDatabase();
  db.exec(`
    CREATE TABLE IF NOT EXISTS script_runs (
      id TEXT PRIMARY KEY,
      script_id TEXT NOT NULL,
      script_name TEXT NOT NULL,
      script_type TEXT NOT NULL,
      content TEXT NOT NULL,
      sudo INTEGER DEFAULT 0,
      args TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT
    )
  `);
  const columns = (db.prepare('PRAGMA table_info(script_executions)').all() as Array<{ name: string }>).map((column) => column.name);
  if (!columns.includes('run_id')) db.exec('ALTER TABLE script_executions ADD COLUMN run_id TEXT');
  if (!columns.includes('exit_code')) db.exec('ALTER TABLE script_executions ADD COLUMN exit_code INTEGER');
  db.exec('CREATE INDEX IF NOT EXISTS idx_script_executions_run ON script_executions(run_id)');
  tablesReady = true;
}

const INTERPRETER: Record<string, { ext: string; run: string }> = {
  bash: { ext: 'sh', run: 'bash' },
  python: { ext: 'py', run: 'python3' },
  powershell: { ext: 'ps1', run: 'pwsh -NoProfile -NonInteractive -File' },
};

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The script arrives on stdin, is written to a temp file, run, and removed again. */
function buildCommand(type: string, sudo: boolean, args: string[]) {
  const interpreter = INTERPRETER[type] ?? INTERPRETER.bash;
  const prefix = sudo ? 'sudo -n ' : '';
  return [
    `tmp=$(mktemp /tmp/sar-script-XXXXXX.${interpreter.ext}) || exit 97`,
    'cat > "$tmp"',
    `${prefix}${interpreter.run} "$tmp" ${args.map(quote).join(' ')}`.trim(),
    'code=$?',
    'rm -f "$tmp"',
    'exit $code',
  ].join('; ');
}

export function startRun(input: { scriptId: string; connectionIds: string[]; sudo: boolean; args: string[]; timeoutSec: number; requestedBy?: string }): LiveRun {
  ensureTables();
  const db = getDatabase();
  const script: any = db.prepare('SELECT * FROM scripts WHERE id = ?').get(input.scriptId);
  if (!script) throw Object.assign(new Error('Script not found'), { status: 404 });

  const connections = input.connectionIds.map((id) => connectionDb.getById(id) as any).filter(Boolean);
  if (!connections.length) throw Object.assign(new Error('Keine gültigen Systeme gewählt'), { status: 400 });
  const rdp = connections.filter((connection) => connection.type === 'rdp');
  if (rdp.length) throw Object.assign(new Error(`Nur SSH-Systeme möglich: ${rdp.map((connection) => connection.name).join(', ')}`), { status: 400 });

  const runId = randomUUID();
  const startedAt = new Date().toISOString();
  db.prepare('INSERT INTO script_runs (id, script_id, script_name, script_type, content, sudo, args, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    runId, script.id, script.name, script.script_type, script.content, input.sudo ? 1 : 0, JSON.stringify(input.args), startedAt,
  );
  const insert = db.prepare("INSERT INTO script_executions (script_id, connection_id, status, run_id, started_at) VALUES (?, ?, 'running', ?, ?)");

  const run: LiveRun & { aborts: Map<number, (reason: string) => void>; cancelled: boolean } = {
    id: runId,
    scriptId: script.id,
    scriptName: script.name,
    scriptType: script.script_type,
    sudo: input.sudo,
    args: input.args,
    startedAt,
    executions: connections.map((connection) => ({
      id: Number(insert.run(script.id, connection.id, runId, startedAt).lastInsertRowid),
      connectionId: connection.id,
      name: connection.name,
      host: connection.host,
      status: 'queued' as ExecutionStatus,
      output: '',
      truncated: false,
      exitCode: null,
    })),
    aborts: new Map(),
    cancelled: false,
  };
  live.set(runId, run);

  const command = buildCommand(script.script_type, input.sudo, input.args);
  const finishExecution = db.prepare('UPDATE script_executions SET status = ?, output = ?, error = ?, exit_code = ?, finished_at = ? WHERE id = ?');

  const runOne = async (execution: LiveExecution) => {
    if (run.cancelled) {
      execution.status = 'cancelled';
      execution.error = 'abgebrochen';
    } else {
      const connection: any = connections.find((entry) => entry.id === execution.connectionId);
      execution.status = 'running';
      execution.startedAt = new Date().toISOString();
      const handle = SSHService.execStreaming(
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
        command,
        {
          stdin: script.content.endsWith('\n') ? script.content : `${script.content}\n`,
          timeoutMs: input.timeoutSec * 1000,
          onData: (text) => {
            if (execution.output.length >= MAX_OUTPUT) {
              execution.truncated = true;
              return;
            }
            execution.output += text.slice(0, MAX_OUTPUT - execution.output.length);
          },
        },
      );
      run.aborts.set(execution.id, handle.abort);
      const result = await handle.done;
      run.aborts.delete(execution.id);
      execution.exitCode = result.exitCode;
      execution.error = result.error;
      execution.status = run.cancelled && result.exitCode === null ? 'cancelled' : result.exitCode === 0 ? 'success' : 'failed';
      if (result.exitCode !== null && result.exitCode !== 0 && !execution.error) {
        execution.error = result.exitCode === 97 ? 'Temp-Datei konnte nicht angelegt werden' : result.exitCode === 1 && input.sudo && /sudo/.test(execution.output) ? 'sudo verlangt ein Passwort' : `Exit-Code ${result.exitCode}`;
      }
    }
    execution.finishedAt = new Date().toISOString();
    finishExecution.run(execution.status === 'success' ? 'success' : 'failed', execution.output, execution.error ?? null, execution.exitCode, execution.finishedAt, execution.id);
  };

  // Simple worker pool
  const queue = [...run.executions];
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) await runOne(queue.shift()!);
  });
  void Promise.all(workers).then(() => {
    run.finishedAt = new Date().toISOString();
    db.prepare('UPDATE script_runs SET finished_at = ? WHERE id = ?').run(run.finishedAt, runId);
    const failed = run.executions.filter((execution) => execution.status !== 'success').length;
    auditLogDb.create({
      user: input.requestedBy ?? 'app',
      action: 'SCRIPT_RUN',
      target: script.name,
      details: `${run.executions.length - failed}/${run.executions.length} erfolgreich: ${run.executions.map((execution) => `${execution.name}=${execution.status}`).join(', ')}`,
      status: failed ? 'failed' : 'success',
      ipAddress: input.requestedBy ?? '',
    });
    // keep finished runs in memory for a while so polling clients see the final state
    setTimeout(() => live.delete(runId), 10 * 60_000);
  });

  return publicRun(run);
}

function publicRun(run: LiveRun, tail = Infinity): LiveRun {
  return {
    id: run.id,
    scriptId: run.scriptId,
    scriptName: run.scriptName,
    scriptType: run.scriptType,
    sudo: run.sudo,
    args: run.args,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    executions: run.executions.map((execution) => ({
      ...execution,
      output: execution.output.length > tail ? execution.output.slice(-tail) : execution.output,
      truncated: execution.truncated || execution.output.length > tail,
    })),
  };
}

export function cancelRun(runId: string) {
  const run = live.get(runId);
  if (!run || run.finishedAt) return false;
  run.cancelled = true;
  run.aborts.forEach((abort) => abort('abgebrochen'));
  return true;
}

/** Live run from memory, or a finished one from the database */
export function getRun(runId: string, tail = 64 * 1024): (LiveRun & { content?: string }) | null {
  ensureTables();
  const db = getDatabase();
  const meta: any = db.prepare('SELECT * FROM script_runs WHERE id = ?').get(runId);
  const memory = live.get(runId);
  if (memory) return { ...publicRun(memory, tail), content: meta?.content };
  if (!meta) return null;
  const rows = db
    .prepare('SELECT e.*, c.name AS connection_name, c.host AS connection_host FROM script_executions e LEFT JOIN connections c ON c.id = e.connection_id WHERE e.run_id = ? ORDER BY e.id')
    .all(runId) as any[];
  return {
    id: meta.id,
    scriptId: meta.script_id,
    scriptName: meta.script_name,
    scriptType: meta.script_type,
    sudo: !!meta.sudo,
    args: JSON.parse(meta.args || '[]'),
    startedAt: meta.started_at,
    finishedAt: meta.finished_at ?? undefined,
    content: meta.content,
    executions: rows.map((row) => {
      const output: string = row.output ?? '';
      return {
        id: row.id,
        connectionId: row.connection_id,
        name: row.connection_name ?? '(gelöschtes System)',
        host: row.connection_host ?? '',
        // a run that was interrupted by a backend restart stays "running" in the database
        status: (row.status === 'running' && !meta.finished_at ? 'failed' : row.status) as ExecutionStatus,
        output: output.length > tail ? output.slice(-tail) : output,
        truncated: output.length > tail,
        exitCode: row.exit_code ?? null,
        error: row.error ?? (row.status === 'running' ? 'unterbrochen (Backend neu gestartet)' : undefined),
        startedAt: row.started_at,
        finishedAt: row.finished_at ?? undefined,
      };
    }),
  };
}

export function getExecutionOutput(executionId: number) {
  for (const run of live.values()) {
    const execution = run.executions.find((entry) => entry.id === executionId);
    if (execution) return { output: execution.output, truncated: execution.truncated };
  }
  const row: any = getDatabase().prepare('SELECT output FROM script_executions WHERE id = ?').get(executionId);
  return row ? { output: row.output ?? '', truncated: (row.output ?? '').length >= MAX_OUTPUT } : null;
}

/** Recent runs with per-status counts, newest first */
export function listRuns(scriptId?: string, limit = 30) {
  ensureTables();
  const db = getDatabase();
  const runs = (scriptId
    ? db.prepare('SELECT id, script_id, script_name, started_at, finished_at, sudo FROM script_runs WHERE script_id = ? ORDER BY started_at DESC LIMIT ?').all(scriptId, limit)
    : db.prepare('SELECT id, script_id, script_name, started_at, finished_at, sudo FROM script_runs ORDER BY started_at DESC LIMIT ?').all(limit)) as any[];
  const countStmt = db.prepare('SELECT status, COUNT(*) AS n FROM script_executions WHERE run_id = ? GROUP BY status');
  return runs.map((run) => {
    const memory = live.get(run.id);
    const counts = { total: 0, success: 0, failed: 0, running: 0 };
    if (memory) {
      memory.executions.forEach((execution) => {
        counts.total += 1;
        if (execution.status === 'success') counts.success += 1;
        else if (execution.status === 'running' || execution.status === 'queued') counts.running += 1;
        else counts.failed += 1;
      });
    } else {
      (countStmt.all(run.id) as Array<{ status: string; n: number }>).forEach((row) => {
        counts.total += row.n;
        if (row.status === 'success') counts.success += row.n;
        else counts.failed += row.n; // "running" without a live run means interrupted
      });
    }
    return { id: run.id, scriptId: run.script_id, scriptName: run.script_name, startedAt: run.started_at, finishedAt: run.finished_at ?? undefined, sudo: !!run.sudo, counts };
  });
}
