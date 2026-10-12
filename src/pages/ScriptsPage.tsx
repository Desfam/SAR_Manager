import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Check, CheckCircle2, Code2, Copy, FileCode2, History, Loader2, Pencil, Play, Plus, Search, Server, Trash2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AnimatedNumber } from '@/components/ui/viz';
import { ScriptEditor } from '@/components/scripts/ScriptEditor';
import { RunView } from '@/components/scripts/RunView';
import { useConnections, type Connection } from '@/hooks/use-infrastructure';
import { scriptKeys, useScriptLibrary, useScriptRuns } from '@/hooks/use-scripts';
import { scriptsApi, type RunSummary, type ScriptInput, type ScriptRun, type StoredScript } from '@/services/scripts';
import { TYPE_LABEL, formatDuration } from '@/lib/scripts';
import { formatRelative } from '@/lib/format';

type Tab = 'run' | 'live' | 'history' | 'code';

/* ---------- server picker ---------- */

function ServerPicker({ systems, selected, onChange }: { systems: Connection[]; selected: Set<string>; onChange: (next: Set<string>) => void }) {
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState<string | null>(null);
  const tags = useMemo(() => [...new Set(systems.flatMap((system) => system.tags ?? []))].sort(), [systems]);
  const needle = query.trim().toLowerCase();
  const visible = systems.filter((system) => (!tag || (system.tags ?? []).includes(tag)) && (!needle || `${system.name} ${system.host} ${system.username}`.toLowerCase().includes(needle)));
  const allVisibleSelected = visible.length > 0 && visible.every((system) => selected.has(system.id));

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };
  const setVisible = (value: boolean) => {
    const next = new Set(selected);
    visible.forEach((system) => (value ? next.add(system.id) : next.delete(system.id)));
    onChange(next);
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="flex h-9 w-60 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3.5 focus-within:border-accent/40">
          <Search className="size-3.5 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="System suchen …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
        </label>
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 10).map((entry) => (
              <button key={entry} type="button" onClick={() => setTag(tag === entry ? null : entry)} className={cn('rounded-full border px-2.5 py-1 text-[11.5px]', tag === entry ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
                {entry}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={() => setVisible(!allVisibleSelected)} className="ml-auto rounded-full border border-line/[0.10] px-3 py-1.5 text-[12px] text-muted hover:text-ink">
          {allVisibleSelected ? 'Keine' : `Alle${tag || needle ? ' gefilterten' : ''} wählen`}
        </button>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {visible.map((system) => {
          const on = selected.has(system.id);
          const online = system.status === 'online';
          return (
            <button
              key={system.id}
              type="button"
              onClick={() => toggle(system.id)}
              className={cn('flex items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition-all', on ? 'border-accent/45 bg-accent/[0.08]' : 'border-line/[0.08] hover:border-line/[0.18]')}
            >
              <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-md border transition-colors', on ? 'border-accent bg-accent text-accent-ink' : 'border-line/[0.2]')}>
                {on && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{system.name}</span>
                <span className="block truncate font-mono text-[11px] text-faint">{system.username}@{system.host}</span>
              </span>
              <span className={cn('size-1.5 shrink-0 rounded-full', online ? 'bg-ok' : system.status === 'offline' ? 'bg-bad' : 'bg-faint')} title={online ? 'online' : system.status === 'offline' ? 'offline' : 'unbekannt'} />
            </button>
          );
        })}
        {visible.length === 0 && <p className="col-span-full py-6 text-center text-[12.5px] text-muted">Keine SSH-Systeme gefunden.</p>}
      </div>
    </div>
  );
}

/* ---------- history ---------- */

function RunHistory({ runs, onOpen }: { runs: RunSummary[]; onOpen: (run: RunSummary) => void }) {
  if (!runs.length) return <p className="rounded-2xl border border-dashed border-line/[0.12] py-10 text-center text-[13px] text-muted">Noch keine Läufe.</p>;
  return (
    <ul className="space-y-1.5">
      {runs.map((run) => {
        const live = !run.finishedAt;
        return (
          <li key={run.id}>
            <button type="button" onClick={() => onOpen(run)} className="flex w-full items-center gap-4 rounded-2xl border border-line/[0.07] px-4 py-3 text-left transition-colors hover:border-line/[0.16] hover:bg-hover/40">
              {live ? <Loader2 className="size-4 animate-spin text-accent" /> : run.counts.failed ? <XCircle className="size-4 text-bad" /> : <CheckCircle2 className="size-4 text-ok" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-medium">{formatRelative(run.startedAt)}</span>
                <span className="block text-[11.5px] text-faint">{run.counts.total} Systeme{run.sudo ? ' · sudo' : ''} · {formatDuration(run.startedAt, run.finishedAt)}</span>
              </span>
              <span className="flex h-1.5 w-32 overflow-hidden rounded-full bg-line/[0.08]">
                <span className="bg-ok" style={{ width: `${(run.counts.success / Math.max(run.counts.total, 1)) * 100}%` }} />
                <span className="bg-bad" style={{ width: `${(run.counts.failed / Math.max(run.counts.total, 1)) * 100}%` }} />
              </span>
              <span className="w-16 text-right font-mono text-[12px] text-muted">{run.counts.success}/{run.counts.total}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------- page ---------- */

export function ScriptsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const library = useScriptLibrary();
  const connections = useConnections();
  const allRuns = useScriptRuns();
  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ script: StoredScript | null } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<StoredScript | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [sudo, setSudo] = useState(false);
  const [args, setArgs] = useState('');
  const [timeoutSec, setTimeoutSec] = useState(300);
  const [confirmRun, setConfirmRun] = useState<{ ids: string[] } | null>(null);

  const scripts = useMemo(() => library.data ?? [], [library.data]);
  const systems = useMemo(() => (connections.data ?? []).filter((connection) => connection.type !== 'rdp').sort((a, b) => a.name.localeCompare(b.name)), [connections.data]);
  const selected = scripts.find((script) => script.id === params.get('script')) ?? scripts[0] ?? null;
  const runId = params.get('run');
  const tab: Tab = (params.get('tab') as Tab) || (runId ? 'live' : 'run');
  const scriptRuns = useScriptRuns(selected?.id);

  const setView = (next: { script?: string; tab?: Tab; run?: string | null }) => {
    const copy = new URLSearchParams(params);
    if (next.script !== undefined) copy.set('script', next.script);
    if (next.tab) copy.set('tab', next.tab);
    if (next.run === null) copy.delete('run');
    else if (next.run) copy.set('run', next.run);
    setParams(copy, { replace: true });
  };

  const lastRunOf = useMemo(() => {
    const map = new Map<string, RunSummary>();
    (allRuns.data ?? []).forEach((run) => !map.has(run.scriptId) && map.set(run.scriptId, run));
    return map;
  }, [allRuns.data]);

  const filtered = scripts.filter((script) => !query.trim() || `${script.name} ${script.description ?? ''} ${script.tags.join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()));

  const invalidate = () => queryClient.invalidateQueries({ queryKey: scriptKeys.list });
  const save = useMutation({
    mutationFn: (input: ScriptInput) => {
      const id = editor?.script?.id;
      return id ? scriptsApi.update(id, input).then(() => id) : scriptsApi.create(input).then((result) => result.id);
    },
    onSuccess: (id) => {
      toast.success(editor?.script?.id ? 'Script gespeichert' : 'Script angelegt');
      setEditor(null);
      void invalidate();
      setView({ script: id, tab: 'run', run: null });
    },
    onError: (failure: Error) => toast.error('Speichern fehlgeschlagen', { description: failure.message }),
  });
  const remove = useMutation({
    mutationFn: (script: StoredScript) => scriptsApi.remove(script.id),
    onSuccess: () => {
      toast.success('Script gelöscht');
      setParams({}, { replace: true });
      void invalidate();
      void queryClient.invalidateQueries({ queryKey: ['infra', 'script-runs'] });
    },
    onError: (failure: Error) => toast.error('Löschen fehlgeschlagen', { description: failure.message }),
  });
  const start = useMutation({
    mutationFn: (ids: string[]) =>
      scriptsApi.run(selected!.id, { connectionIds: ids, sudo, args: args.trim() ? args.trim().split(/\s+/) : [], timeoutSec }),
    onSuccess: (run) => {
      setView({ tab: 'live', run: run.id });
      void queryClient.invalidateQueries({ queryKey: ['infra', 'script-runs'] });
    },
    onError: (failure: Error) => toast.error('Start fehlgeschlagen', { description: failure.message }),
  });

  const retry = (run: ScriptRun, ids: string[]) => {
    setSudo(run.sudo);
    setArgs(run.args.join(' '));
    setConfirmRun({ ids });
  };

  const totals = (allRuns.data ?? []).reduce(
    (sum, run) => ({ runs: sum.runs + 1, ok: sum.ok + run.counts.success, failed: sum.failed + run.counts.failed, total: sum.total + run.counts.total }),
    { runs: 0, ok: 0, failed: 0, total: 0 },
  );
  const lastRun = allRuns.data?.[0];
  const selectedSystems = systems.filter((system) => selection.has(system.id));

  const tabs: Array<{ value: Tab; label: string; icon: typeof Play; hidden?: boolean }> = [
    { value: 'run', label: 'Ausführen', icon: Play },
    { value: 'live', label: 'Lauf', icon: Server, hidden: !runId },
    { value: 'history', label: `Verlauf${scriptRuns.data?.length ? ` (${scriptRuns.data.length})` : ''}`, icon: History },
    { value: 'code', label: 'Code', icon: Code2 },
  ];

  return (
    <>
      <PageHeader
        section="Betrieb"
        title="Scripts"
        description="Eigene Scripts ablegen, auf beliebig vielen Servern gleichzeitig ausführen und jede Ausgabe live verfolgen"
        actions={
          <button
            type="button"
            onClick={() => setEditor({ script: null })}
            className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)]"
          >
            <Plus className="size-4" /> Neues Script
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[140px]" eyebrow="Bibliothek" title="Scripts">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={scripts.length} /></p>
          <p className="mt-2 text-[12.5px] text-muted">{(['bash', 'python', 'powershell'] as const).map((type) => `${scripts.filter((script) => script.type === type).length} ${TYPE_LABEL[type]}`).join(' · ')}</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[140px]" eyebrow="Zuletzt" title="Läufe">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={totals.runs} /></p>
          <p className="mt-2 text-[12.5px] text-muted">{totals.total} Ausführungen auf Servern</p>
        </NotchCard>
        <NotchCard index={2} className="min-h-[140px]" tone={totals.failed ? 'warn' : undefined} eyebrow="Zuletzt" title="Erfolgsquote">
          <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', totals.failed ? 'text-accent' : 'text-ok')}>
            {totals.total ? <><AnimatedNumber value={Math.round((totals.ok / totals.total) * 100)} /><span className="ml-1 text-[18px] font-medium text-muted">%</span></> : '–'}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{totals.failed} fehlgeschlagen</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[140px]" eyebrow="Letzter Lauf" title={lastRun?.scriptName ?? 'Noch keiner'}>
          <p className="mt-3 text-[22px] font-semibold">{lastRun ? formatRelative(lastRun.startedAt) : '–'}</p>
          <p className="mt-2 text-[12.5px] text-muted">{lastRun ? `${lastRun.counts.success}/${lastRun.counts.total} erfolgreich` : 'Script wählen und starten'}</p>
        </NotchCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <NotchCard index={4} eyebrow="Bibliothek" title="Meine Scripts" bodyClassName="pt-3" actions={[{ label: 'Neues Script', icon: <Plus />, onClick: () => setEditor({ script: null }) }]}>
          <label className="flex h-10 items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 focus-within:border-accent/40">
            <Search className="size-4 text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Tag …" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
          </label>
          <ul className="scroll-thin -mx-2 mt-3 max-h-[640px] space-y-0.5 overflow-y-auto px-2">
            {filtered.map((script) => {
              const active = selected?.id === script.id;
              const last = lastRunOf.get(script.id);
              return (
                <li key={script.id}>
                  <button type="button" onClick={() => setParams({ script: script.id }, { replace: true })} className={cn('relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors', !active && 'hover:bg-hover/60')}>
                    {active && <motion.span layoutId="script-active" className="absolute inset-0 rounded-xl border border-accent/25 bg-accent/[0.10]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                    <FileCode2 className="relative size-4 shrink-0 text-muted" />
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{script.name}</span>
                      <span className="block truncate text-[11px] text-faint">{TYPE_LABEL[script.type]}{script.tags.length ? ` · ${script.tags.join(', ')}` : ''}</span>
                    </span>
                    {last && (
                      <span
                        className={cn('relative size-2 shrink-0 rounded-full', !last.finishedAt ? 'animate-pulse bg-accent' : last.counts.failed ? 'bg-bad' : 'bg-ok')}
                        title={`Letzter Lauf ${formatRelative(last.startedAt)}: ${last.counts.success}/${last.counts.total}`}
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {library.isLoading && <li className="py-6 text-center text-[13px] text-muted">Lädt …</li>}
            {!library.isLoading && scripts.length === 0 && (
              <li className="rounded-2xl border border-dashed border-line/[0.12] px-4 py-8 text-center text-[12.5px] text-muted">
                Noch keine Scripts.
                <button type="button" onClick={() => setEditor({ script: null })} className="mt-2 block w-full text-accent hover:underline">Erstes Script anlegen</button>
              </li>
            )}
          </ul>
        </NotchCard>

        <NotchCard
          index={5}
          eyebrow={selected ? `${TYPE_LABEL[selected.type]} · ${selected.content.split('\n').length} Zeilen` : 'Script'}
          title={selected?.name ?? 'Kein Script gewählt'}
          bodyClassName="pt-3"
          actions={
            selected
              ? [
                  { label: 'Bearbeiten', icon: <Pencil />, onClick: () => setEditor({ script: selected }) },
                  { label: 'Duplizieren', icon: <Copy />, onClick: () => setEditor({ script: { ...selected, id: '', name: `${selected.name} (Kopie)` } }) },
                  { label: 'Löschen', icon: <Trash2 />, onClick: () => setDeleteTarget(selected) },
                ]
              : []
          }
        >
          {!selected ? (
            <div className="flex flex-col items-center py-16 text-center">
              <FileCode2 className="mb-3 size-7 text-muted" />
              <p className="text-[14px] font-medium">Leg dein erstes Script an</p>
              <p className="mt-1 max-w-md text-[12.5px] text-muted">Einfügen oder als Datei (.sh, .py, .ps1) hineinziehen, dann Server anklicken und starten. Jeder Server bekommt eine eigene Karte mit Live-Ausgabe.</p>
              <button type="button" onClick={() => setEditor({ script: null })} className="mt-4 flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13px] font-medium text-accent-ink">
                <Plus className="size-4" /> Neues Script
              </button>
            </div>
          ) : (
            <>
              {selected.description && <p className="-mt-1 mb-3 text-[12.5px] text-muted">{selected.description}</p>}
              <div className="mb-4 flex gap-1 border-b border-line/[0.07]">
                {tabs.filter((entry) => !entry.hidden).map((entry) => (
                  <button key={entry.value} type="button" onClick={() => setView({ tab: entry.value })} className={cn('relative flex items-center gap-2 px-3 pb-2.5 pt-1 text-[13px] transition-colors', tab === entry.value ? 'text-ink' : 'text-muted hover:text-ink')}>
                    <entry.icon className="size-3.5" /> {entry.label}
                    {tab === entry.value && <motion.span layoutId="script-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />}
                  </button>
                ))}
              </div>

              {tab === 'run' && (
                <div className="space-y-5">
                  <ServerPicker systems={systems} selected={selection} onChange={setSelection} />
                  <div className="grid gap-3 rounded-2xl border border-line/[0.07] bg-raised/25 p-4 md:grid-cols-[auto_minmax(0,1fr)_auto]">
                    <label className="flex items-center gap-3 text-[13px]">
                      <button type="button" role="switch" aria-checked={sudo} onClick={() => setSudo(!sudo)} className={cn('relative h-6 w-10 shrink-0 rounded-full border transition-colors', sudo ? 'border-accent/40 bg-accent/25' : 'border-line/[0.14] bg-raised')}>
                        <motion.span className={cn('absolute top-0.5 size-[18px] rounded-full', sudo ? 'bg-accent' : 'bg-faint')} animate={{ left: sudo ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
                      </button>
                      mit sudo
                    </label>
                    <input value={args} onChange={(event) => setArgs(event.target.value)} placeholder="Argumente (optional), z. B. --dry-run" className="h-10 rounded-full border border-line/[0.10] bg-raised/50 px-4 font-mono text-[12.5px] outline-none placeholder:font-sans placeholder:text-faint focus:border-accent/40" />
                    <select value={timeoutSec} onChange={(event) => setTimeoutSec(Number(event.target.value))} className="h-10 rounded-full border border-line/[0.10] bg-raised/50 px-3 text-[12.5px] outline-none" title="Zeitlimit je Server">
                      {[[60, '1 min'], [300, '5 min'], [900, '15 min'], [1800, '30 min'], [3600, '60 min']].map(([value, label]) => <option key={value} value={value}>Zeitlimit {label}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-[12.5px] text-muted">
                      {selection.size ? `${selection.size} ${selection.size === 1 ? 'System' : 'Systeme'} gewählt: ${selectedSystems.slice(0, 4).map((system) => system.name).join(', ')}${selection.size > 4 ? ' …' : ''}` : 'Systeme anklicken, auf denen das Script laufen soll'}
                    </p>
                    <button
                      type="button"
                      disabled={!selection.size || start.isPending}
                      onClick={() => setConfirmRun({ ids: [...selection] })}
                      className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
                    >
                      {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Play className="size-4" />} Auf {selection.size || '…'} {selection.size === 1 ? 'System' : 'Systemen'} ausführen
                    </button>
                  </div>
                </div>
              )}

              {tab === 'live' && runId && <RunView key={runId} runId={runId} onRetry={retry} />}

              {tab === 'history' && <RunHistory runs={scriptRuns.data ?? []} onOpen={(run) => setView({ tab: 'live', run: run.id })} />}

              {tab === 'code' && (
                <pre className="scroll-thin max-h-[560px] overflow-auto rounded-2xl bg-canvas p-4 font-mono text-[12px] leading-[19px] text-ink/90">
                  {selected.content.split('\n').map((line, index) => (
                    <div key={index} className="flex gap-4">
                      <span className="w-6 shrink-0 select-none text-right text-faint">{index + 1}</span>
                      <span className={cn('whitespace-pre-wrap break-all', /^\s*#/.test(line) && 'text-muted')}>{line || ' '}</span>
                    </div>
                  ))}
                </pre>
              )}
            </>
          )}
        </NotchCard>
      </div>

      <Drawer open={!!editor} onClose={() => setEditor(null)} label="Script" width={760}>
        {editor && (
          <ScriptEditor
            key={editor.script?.id || 'new'}
            script={editor.script}
            saving={save.isPending}
            onSave={(input) => save.mutate(input)}
            onCancel={() => setEditor(null)}
          />
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmRun}
        title={`„${selected?.name}“ ausführen?`}
        description={
          confirmRun ? (
            <>
              Läuft auf {confirmRun.ids.length} {confirmRun.ids.length === 1 ? 'System' : 'Systemen'}
              {sudo ? ' mit sudo' : ''}
              {args.trim() ? <> mit <span className="font-mono">{args.trim()}</span></> : ''}:{' '}
              <span className="text-ink">{systems.filter((system) => confirmRun.ids.includes(system.id)).map((system) => system.name).join(', ')}</span>
            </>
          ) : ''
        }
        confirmLabel="Jetzt ausführen"
        icon={<Play />}
        onCancel={() => setConfirmRun(null)}
        onConfirm={() => {
          if (confirmRun) start.mutate(confirmRun.ids);
          setConfirmRun(null);
        }}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        title="Script löschen?"
        description={deleteTarget ? `„${deleteTarget.name}“ und sein Verlauf werden entfernt.` : ''}
        confirmLabel="Löschen"
        tone="danger"
        icon={<Trash2 />}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
