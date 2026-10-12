import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { CheckCircle2, Copy, Expand, Loader2, RotateCcw, Square, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { scriptKeys, useScriptRun } from '@/hooks/use-scripts';
import { scriptsApi, type RunExecution, type ScriptRun } from '@/services/scripts';
import { STATUS_META, formatDuration } from '@/lib/scripts';
import { formatRelative } from '@/lib/format';

/* ---------- one card per server ---------- */

function OutputTail({ text, live }: { text: string; live: boolean }) {
  const ref = useRef<HTMLPreElement>(null);
  const stick = useRef(true);
  useLayoutEffect(() => {
    if (ref.current && stick.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre
      ref={ref}
      onScroll={(event) => {
        const element = event.currentTarget;
        stick.current = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
      }}
      className="scroll-thin h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-canvas px-3 py-2 font-mono text-[11px] leading-[17px] text-ink/85"
    >
      {text || <span className="text-faint">{live ? 'warte auf Ausgabe …' : 'keine Ausgabe'}</span>}
      {live && <span className="ml-0.5 inline-block h-3 w-1.5 animate-pulse bg-accent/80 align-middle" />}
    </pre>
  );
}

function ExecutionCard({ execution, index, onOpen }: { execution: RunExecution; index: number; onOpen: () => void }) {
  const meta = STATUS_META[execution.status];
  const live = execution.status === 'running';
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: Math.min(index * 0.03, 0.4) }}
      className={cn('flex min-w-0 flex-col rounded-2xl border bg-card p-3.5 transition-colors', meta.border)}
    >
      <div className="mb-2.5 flex items-start gap-2.5">
        <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', meta.dot)} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13.5px] font-medium">{execution.name}</p>
          <p className="truncate font-mono text-[11px] text-faint">{execution.host}</p>
        </div>
        <button type="button" onClick={onOpen} aria-label="Ganze Ausgabe" className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink">
          <Expand className="size-3.5" />
        </button>
      </div>
      <OutputTail text={execution.output} live={live} />
      <div className="mt-2.5 flex items-center gap-2 text-[11.5px]">
        <span className={cn('font-medium', meta.text)}>{meta.label}</span>
        {execution.exitCode !== null && <span className="font-mono text-faint">exit {execution.exitCode}</span>}
        <span className="ml-auto font-mono text-faint">{execution.startedAt ? formatDuration(execution.startedAt, execution.finishedAt) : ''}</span>
      </div>
      {execution.error && execution.status !== 'success' && <p className="mt-1 truncate text-[11.5px] text-bad" title={execution.error}>{execution.error}</p>}
    </motion.div>
  );
}

function FullOutput({ execution }: { execution: RunExecution }) {
  const full = useQuery({ queryKey: ['infra', 'script-output', execution.id, execution.status], queryFn: () => scriptsApi.output(execution.id) });
  const text = full.data?.output ?? execution.output;
  const meta = STATUS_META[execution.status];
  return (
    <div className="flex h-full flex-col px-7 pb-6 pt-7">
      <p className="text-[12px] text-muted">Ausgabe</p>
      <h2 className="mt-1 pr-12 text-[22px] font-semibold tracking-[-0.02em]">{execution.name}</h2>
      <p className="mt-1 flex items-center gap-2 text-[12.5px]">
        <span className={meta.text}>{meta.label}</span>
        {execution.exitCode !== null && <span className="font-mono text-muted">exit {execution.exitCode}</span>}
        <span className="font-mono text-muted">· {formatDuration(execution.startedAt, execution.finishedAt)}</span>
        <button
          type="button"
          onClick={() => void navigator.clipboard.writeText(text).then(() => toast.success('Ausgabe kopiert'))}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised"
        >
          <Copy className="size-3.5" /> Kopieren
        </button>
      </p>
      {execution.error && execution.status !== 'success' && <p className="mt-2 text-[12.5px] text-bad">{execution.error}</p>}
      <pre className="scroll-thin mt-4 min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-canvas p-4 font-mono text-[12px] leading-[19px] text-ink/90">
        {full.isLoading ? 'Lädt …' : text || 'keine Ausgabe'}
      </pre>
      {full.data?.truncated && <p className="mt-2 text-[11.5px] text-faint">Ausgabe nach 512 KB abgeschnitten.</p>}
    </div>
  );
}

/* ---------- run ---------- */

type Filter = 'all' | 'failed' | 'success';

export function RunView({ runId, onRetry }: { runId: string; onRetry: (run: ScriptRun, connectionIds: string[]) => void }) {
  const queryClient = useQueryClient();
  const run = useScriptRun(runId);
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<number | null>(null);
  const data = run.data;

  const cancel = useMutation({
    mutationFn: () => scriptsApi.cancel(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: scriptKeys.run(runId) }),
  });

  // Refresh the history once the run is done
  const finished = !!data?.finishedAt;
  useEffect(() => {
    if (finished) void queryClient.invalidateQueries({ queryKey: ['infra', 'script-runs'] });
  }, [finished, queryClient]);

  if (run.isLoading) return <p className="flex items-center justify-center py-16 text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lade Lauf …</p>;
  if (run.isError || !data) return <p className="py-16 text-center text-[13px] text-bad">{(run.error as Error)?.message ?? 'Lauf nicht gefunden'}</p>;

  const executions = data.executions;
  const count = (status: RunExecution['status'][]) => executions.filter((execution) => status.includes(execution.status)).length;
  const done = count(['success', 'failed', 'cancelled']);
  const ok = count(['success']);
  const bad = count(['failed', 'cancelled']);
  const visible = executions.filter((execution) => filter === 'all' || (filter === 'success' ? execution.status === 'success' : execution.status === 'failed' || execution.status === 'cancelled'));
  const open = executions.find((execution) => execution.id === openId) ?? null;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-2xl border border-line/[0.07] bg-raised/25 p-4">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div className="min-w-0">
            <p className="text-[12px] text-muted">
              {data.scriptName} · gestartet {formatRelative(data.startedAt)}
              {data.sudo && ' · mit sudo'}
              {data.args.length > 0 && <span className="font-mono"> · {data.args.join(' ')}</span>}
            </p>
            <p className="mt-0.5 text-[15px] font-medium">
              {finished ? (bad ? `${ok} von ${executions.length} erfolgreich` : `Alle ${executions.length} erfolgreich`) : `Läuft auf ${executions.length - done} von ${executions.length} Systemen …`}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-4 text-[12.5px]">
            <span className="flex items-center gap-1.5 text-ok"><CheckCircle2 className="size-4" /> {ok}</span>
            <span className="flex items-center gap-1.5 text-bad"><XCircle className="size-4" /> {bad}</span>
            <span className="font-mono text-muted">{formatDuration(data.startedAt, data.finishedAt)}</span>
            {!finished ? (
              <button type="button" onClick={() => cancel.mutate()} disabled={cancel.isPending} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised disabled:opacity-50">
                <Square className="size-3" /> Abbrechen
              </button>
            ) : bad > 0 ? (
              <button
                type="button"
                onClick={() => onRetry(data, executions.filter((execution) => execution.status !== 'success').map((execution) => execution.connectionId))}
                className="flex h-8 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/[0.08] px-3 text-[12px] text-accent hover:bg-accent/[0.14]"
              >
                <RotateCcw className="size-3.5" /> Fehlgeschlagene erneut
              </button>
            ) : null}
          </div>
        </div>
        {/* Segmented progress: one segment per server */}
        <div className="mt-3 flex h-1.5 gap-0.5 overflow-hidden rounded-full">
          {executions.map((execution) => (
            <span
              key={execution.id}
              className={cn(
                'h-full flex-1 transition-colors duration-500',
                execution.status === 'success' ? 'bg-ok' : execution.status === 'failed' ? 'bg-bad' : execution.status === 'running' ? 'animate-pulse bg-accent' : execution.status === 'cancelled' ? 'bg-muted' : 'bg-line/[0.10]',
              )}
            />
          ))}
        </div>
      </div>

      {/* Filter */}
      <div className="flex items-center gap-1.5">
        {([
          ['all', `Alle ${executions.length}`],
          ['failed', `Fehler ${bad}`],
          ['success', `Erfolgreich ${ok}`],
        ] as Array<[Filter, string]>).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setFilter(value)} className={cn('rounded-full border px-3 py-1 text-[12px]', filter === value ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
        <AnimatePresence initial={false}>
          {visible.map((execution, index) => (
            <ExecutionCard key={execution.id} execution={execution} index={index} onOpen={() => setOpenId(execution.id)} />
          ))}
        </AnimatePresence>
        {visible.length === 0 && <p className="col-span-full py-8 text-center text-[13px] text-muted">Keine Systeme für diesen Filter.</p>}
      </div>

      <Drawer open={!!open} onClose={() => setOpenId(null)} label="Ausgabe" width={760}>
        {open && <FullOutput execution={open} />}
      </Drawer>
    </div>
  );
}
