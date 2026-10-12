import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Siren, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { FindingCard } from '@/components/soc/FindingCard';
import { IncidentFormDrawer } from '@/components/soc/IncidentForm';
import { socKeys, useFindings } from '@/hooks/use-soc';
import { FINDING_STATUS, SEVERITY_ORDER, SEVERITY_STYLE, draftFromFindings, type IncidentDraft } from '@/lib/soc';
import { socOps, type Finding } from '@/services/soc';

const chip = (active: boolean) => cn('rounded-full border px-3 py-1 text-[12px]', active ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.10] text-muted hover:text-ink');

export function Findings() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const host = params.get('host') ?? undefined;
  const status = params.get('status') ?? 'open';
  const severity = params.get('severity') ?? undefined;
  const findings = useFindings({ host, status: status === 'all' ? undefined : status, severity });
  const all = useFindings({ host });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState<IncidentDraft | null>(null);

  const set = (entries: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(entries).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    setParams(next, { replace: true });
    setSelected(new Set());
  };

  const list = useMemo(() => [...(findings.data ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '')), [findings.data]);
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    (all.data ?? []).forEach((finding) => { result[finding.status] = (result[finding.status] ?? 0) + 1; });
    return result;
  }, [all.data]);
  const openBySeverity = useMemo(() => {
    const result: Record<string, number> = {};
    (all.data ?? []).filter((finding) => finding.status === 'open').forEach((finding) => { result[finding.severity] = (result[finding.severity] ?? 0) + 1; });
    return result;
  }, [all.data]);

  const update = useMutation({
    mutationFn: ({ ids, next }: { ids: string[]; next: Finding['status'] }) => Promise.all(ids.map((id) => socOps.setFindingStatus(id, next))),
    onSuccess: (_, { ids, next }) => {
      toast.success(`${ids.length} ${ids.length === 1 ? 'Finding' : 'Findings'}: ${FINDING_STATUS[next]}`);
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: socKeys.findings });
    },
    onError: (failure: Error) => toast.error('Status nicht geändert', { description: failure.message }),
  });

  const toggle = (id: string) => setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const chosen = list.filter((finding) => selected.has(finding.id));

  return (
    <>
      <PageHeader section="Security Operations" title="Findings" description="Zentrale Befundliste aus Full Scans und Baseline-Abweichungen. Gleiche Befunde werden zusammengeführt, nicht doppelt angelegt." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        {(['critical', 'high', 'medium', 'low'] as const).map((level, index) => (
          <NotchCard key={level} index={index} eyebrow="offen" title={SEVERITY_STYLE[level].label} tone={openBySeverity[level] && (level === 'critical' || level === 'high') ? 'bad' : undefined} onClick={() => set({ severity: severity === level ? undefined : level, status: 'open' })}>
            <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]" style={{ color: openBySeverity[level] ? SEVERITY_STYLE[level].color : undefined }}>{all.data ? <AnimatedNumber value={openBySeverity[level] ?? 0} /> : <Shimmer className="h-8 w-14" />}</p>
          </NotchCard>
        ))}
        <NotchCard index={4} eyebrow="gesamt" title="Erledigt">
          <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{all.data ? <AnimatedNumber value={(counts.resolved ?? 0) + (counts.false_positive ?? 0)} /> : <Shimmer className="h-8 w-14" />}</p>
        </NotchCard>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {[...Object.entries(FINDING_STATUS), ['all', 'Alle']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => set({ status: key === 'open' ? undefined : key })} className={chip(status === key)}>
            {label} <span className="font-mono text-faint">{key === 'all' ? all.data?.length ?? '' : counts[key] ?? 0}</span>
          </button>
        ))}
        {severity && <button type="button" onClick={() => set({ severity: undefined })} className={cn(chip(true), 'flex items-center gap-1')}>{SEVERITY_STYLE[severity as Finding['severity']]?.label ?? severity}<X className="size-3" /></button>}
        {host && <button type="button" onClick={() => set({ host: undefined })} className={cn(chip(true), 'flex items-center gap-1 font-mono')}>{host}<X className="size-3" /></button>}
      </div>

      {chosen.length > 0 && (
        <div className="sticky top-2 z-20 mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/30 bg-panel/95 px-4 py-2.5 text-[12.5px] shadow-xl backdrop-blur">
          <span className="font-medium">{chosen.length} ausgewählt</span>
          <span className="mx-1 h-4 w-px bg-line/20" />
          {(['in_progress', 'resolved', 'false_positive', 'open'] as const).map((next) => (
            <button key={next} type="button" disabled={update.isPending} onClick={() => update.mutate({ ids: chosen.map((finding) => finding.id), next })} className="h-8 rounded-full border border-line/[0.12] px-3 hover:bg-raised disabled:opacity-50">{FINDING_STATUS[next]}</button>
          ))}
          <button type="button" onClick={() => setDraft(draftFromFindings(chosen))} className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-accent-strong to-accent px-3.5 font-medium text-accent-ink"><Siren className="size-3.5" /> Incident aus Auswahl</button>
          <button type="button" onClick={() => setSelected(new Set())} className="flex size-8 items-center justify-center rounded-full text-muted hover:text-ink" aria-label="Auswahl aufheben"><X className="size-4" /></button>
        </div>
      )}

      <NotchCard index={5} className="mt-4" eyebrow={`${list.length} Einträge`} title="Befunde" bodyClassName="pt-3">
        {findings.isError ? (
          <p className="py-8 text-center text-[13px] text-bad">{(findings.error as Error).message}</p>
        ) : !findings.data ? (
          <div className="space-y-2">{Array.from({ length: 5 }, (_, index) => <Shimmer key={index} className="h-14" />)}</div>
        ) : !list.length ? (
          <p className="py-10 text-center text-[13px] text-muted">Keine Findings mit diesem Filter. Findings entstehen durch einen Full Scan oder aus Baseline-Abweichungen.</p>
        ) : (
          <>
            <label className="mb-2 flex items-center gap-2 px-1 text-[12px] text-muted">
              <input type="checkbox" checked={chosen.length === list.length} onChange={(event) => setSelected(event.target.checked ? new Set(list.map((finding) => finding.id)) : new Set())} className="accent-[rgb(var(--accent))]" /> Alle auswählen
            </label>
            <ul className="space-y-2">
              {list.map((finding, index) => (
                <FindingCard
                  key={finding.id}
                  finding={finding}
                  index={index}
                  showHost
                  leading={<input type="checkbox" checked={selected.has(finding.id)} onChange={() => toggle(finding.id)} className="accent-[rgb(var(--accent))]" aria-label="Auswählen" />}
                  trailing={
                    <span className="flex items-center gap-2">
                      <span className="hidden rounded-full border border-line/[0.10] px-2 py-px text-[10.5px] text-faint md:inline">{finding.source === 'baseline' ? 'Baseline' : 'Full Scan'}</span>
                      <select value={finding.status} onChange={(event) => update.mutate({ ids: [finding.id], next: event.target.value as Finding['status'] })} className="h-8 rounded-full border border-line/[0.12] bg-raised/60 px-2.5 text-[12px] outline-none">
                        {Object.entries(FINDING_STATUS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
                      </select>
                    </span>
                  }
                />
              ))}
            </ul>
          </>
        )}
      </NotchCard>

      <IncidentFormDrawer draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}
