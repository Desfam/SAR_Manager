// Script library and runs on several systems (see backend/src/routes/scripts.ts and services/script-runner.ts)
import { API_CONFIG } from './api-config';

export type ScriptType = 'bash' | 'python' | 'powershell';

export interface StoredScript {
  id: string;
  name: string;
  description?: string;
  type: ScriptType;
  content: string;
  tags: string[];
  created_at?: string;
  updated_at?: string;
}

export type ExecutionStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled';

export interface RunExecution {
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

export interface ScriptRun {
  id: string;
  scriptId: string;
  scriptName: string;
  scriptType: string;
  sudo: boolean;
  args: string[];
  startedAt: string;
  finishedAt?: string;
  content?: string;
  executions: RunExecution[];
}

export interface RunSummary {
  id: string;
  scriptId: string;
  scriptName: string;
  startedAt: string;
  finishedAt?: string;
  sudo: boolean;
  counts: { total: number; success: number; failed: number; running: number };
}

export interface ScriptInput {
  name: string;
  description?: string;
  type: ScriptType;
  content: string;
  tags: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/scripts${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json', ...init.headers } : init?.headers,
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const scriptsApi = {
  list: () => request<StoredScript[]>(''),
  create: (input: ScriptInput) => request<{ id: string }>('', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: ScriptInput) => request<{ message: string }>(`/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(input) }),
  remove: (id: string) => request<{ message: string }>(`/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  run: (id: string, options: { connectionIds: string[]; sudo: boolean; args: string[]; timeoutSec: number }) =>
    request<ScriptRun>(`/${encodeURIComponent(id)}/run`, { method: 'POST', body: JSON.stringify(options) }),
  runs: (scriptId?: string) => request<RunSummary[]>(`/runs${scriptId ? `?scriptId=${encodeURIComponent(scriptId)}` : ''}`),
  getRun: (runId: string) => request<ScriptRun>(`/runs/${encodeURIComponent(runId)}`),
  cancel: (runId: string) => request<{ cancelled: boolean }>(`/runs/${encodeURIComponent(runId)}/cancel`, { method: 'POST' }),
  output: (executionId: number) => request<{ output: string; truncated: boolean }>(`/executions/${executionId}/output`),
};
