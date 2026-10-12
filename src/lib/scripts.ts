import type { ExecutionStatus, ScriptType } from '@/services/scripts';
import { parseBackendDate } from '@/lib/format';

export const TYPE_LABEL: Record<ScriptType, string> = { bash: 'Bash', python: 'Python', powershell: 'PowerShell' };

export const STATUS_META: Record<ExecutionStatus, { label: string; text: string; dot: string; border: string }> = {
  queued: { label: 'Wartet', text: 'text-muted', dot: 'bg-faint', border: 'border-line/[0.10]' },
  running: { label: 'Läuft', text: 'text-accent', dot: 'bg-accent animate-pulse', border: 'border-accent/40' },
  success: { label: 'Erfolgreich', text: 'text-ok', dot: 'bg-ok', border: 'border-ok/35' },
  failed: { label: 'Fehlgeschlagen', text: 'text-bad', dot: 'bg-bad', border: 'border-bad/40' },
  cancelled: { label: 'Abgebrochen', text: 'text-muted', dot: 'bg-muted', border: 'border-line/[0.14]' },
};

export function formatDuration(start?: string, end?: string) {
  const from = parseBackendDate(start);
  if (!from) return '–';
  const to = parseBackendDate(end) ?? new Date();
  const seconds = Math.max(0, Math.round((to.getTime() - from.getTime()) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${seconds % 60} s`;
}
