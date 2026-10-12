import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ClipboardPlus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { HostPicker } from '@/components/soc/HostPicker';
import { FindingCard } from '@/components/soc/FindingCard';
import { socKeys, useBaseline } from '@/hooks/use-soc';
import { formatCount } from '@/lib/wazuh';
import { socOps } from '@/services/soc';

const SPANS = [7, 14, 30];

function List({ title, index, items, query, render }: { title: string; index: number; items: Array<{ key: string; count: number }>; query: (key: string) => string; render?: (item: { key: string; count: number }) => React.ReactNode }) {
  const navigate = useNavigate();
  return (
    <NotchCard index={index} eyebrow={items.length ? `${items.length} neu` : 'keine Abweichung'} title={title} tone={items.length ? 'warn' : undefined} bodyClassName="pt-3">
      {items.length ? (
        <ul className="scroll-thin max-h-72 space-y-0.5 overflow-y-auto">
          {items.map((item) => (
            <li key={item.key}>
              <button type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(query(item.key))}`)} className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1 text-left text-[12.5px] hover:bg-hover/50">
                {render ? render(item) : <span className="truncate font-mono">{item.key}</span>}
                <span className="shrink-0 font-mono text-[11px] text-faint">{formatCount(item.count)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : <p className="text-[12.5px] text-ok">Nichts Neues gegenüber dem Normalverhalten.</p>}
    </NotchCard>
  );
}

export function Baseline() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const host = params.get('host');
  const [days, setDays] = useState(14);
  const baseline = useBaseline(host, days);
  const d = baseline.data;
  const store = useMutation({
    mutationFn: () => socOps.storeBaseline(host!, days),
    onSuccess: (result) => { toast.success(`Findings: ${result.created} neu, ${result.updated} aktualisiert`); void queryClient.invalidateQueries({ queryKey: socKeys.findings }); },
    onError: (failure: Error) => toast.error('Nicht übernommen', { description: failure.message }),
  });
  const hostFilter = host ? ` host:"${host}"` : '';
  const ratio = d?.volume.ratio;

  return (
    <>
      <PageHeader section="Explore" title="Baseline" description="Normalverhalten eines Hosts aus den letzten Tagen im Vergleich zu den letzten 24 Stunden: was ist neu?" />

      <NotchCard index={0} eyebrow="Host" title="Vergleich" bodyClassName="pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <HostPicker value={host} onChange={(name) => setParams({ host: name }, { replace: true })} />
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {SPANS.map((span) => (
              <button key={span} type="button" onClick={() => setDays(span)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', days === span ? 'text-ink' : 'text-muted hover:text-ink')}>
                {days === span && <motion.span layoutId="baseline-span" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{span} Tage Basis</span>
              </button>
            ))}
          </div>
          {baseline.isFetching && <Loader2 className="size-4 animate-spin text-muted" />}
          <button type="button" disabled={!d?.findings.length || store.isPending} onClick={() => store.mutate()} className="ml-auto flex h-10 items-center gap-2 rounded-full border border-accent/35 px-4 text-[12.5px] text-accent hover:bg-accent/10 disabled:opacity-40">
            {store.isPending ? <Loader2 className="size-4 animate-spin" /> : <ClipboardPlus className="size-4" />} Als Findings übernehmen
          </button>
        </div>
      </NotchCard>

      {!host ? (
        <p className="mt-10 text-center text-[13px] text-muted">Host wählen.</p>
      ) : baseline.isError ? (
        <p className="mt-10 text-center text-[13px] text-bad">{(baseline.error as Error).message}</p>
      ) : !d ? (
        <div className="mt-5 grid gap-4 md:grid-cols-3">{Array.from({ length: 6 }, (_, index) => <Shimmer key={index} className="h-40" />)}</div>
      ) : (
        <>
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            <NotchCard index={1} eyebrow="letzte 24 h" title="Event-Volumen" tone={ratio && ratio >= 3 ? 'warn' : undefined}>
              <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{formatCount(d.volume.recent)}</p>
              <p className="mt-2 text-[12px] text-muted">Ø {formatCount(Math.round(d.volume.average))} pro Tag in {d.volume.baselineDays} Tagen</p>
            </NotchCard>
            <NotchCard index={2} eyebrow="Faktor" title="Gegenüber Normal" tone={ratio && ratio >= 3 ? 'warn' : undefined}>
              <p className={cn('mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]', ratio && ratio >= 3 ? 'text-bad' : ratio && ratio <= 0.3 ? 'text-accent' : '')}>{ratio == null ? '–' : `×${ratio.toFixed(1)}`}</p>
              <p className="mt-2 text-[12px] text-muted">{ratio == null ? 'Keine Basisdaten' : ratio >= 3 ? 'deutlich mehr als üblich' : ratio <= 0.3 ? 'deutlich weniger: Agent still?' : 'im üblichen Rahmen'}</p>
            </NotchCard>
            <NotchCard index={3} eyebrow="regelbasiert" title="Abweichungen">
              <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{d.findings.length}</p>
              <p className="mt-2 text-[12px] text-muted">bewertete Auffälligkeiten</p>
            </NotchCard>
          </div>

          {!!d.findings.length && (
            <NotchCard index={4} className="mt-5" eyebrow="Vorschau, noch nicht gespeichert" title="Mögliche Findings" bodyClassName="pt-3">
              <ul className="space-y-2">{d.findings.map((finding, index) => <FindingCard key={finding.key} finding={finding} index={index} />)}</ul>
            </NotchCard>
          )}

          <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2 xl:grid-cols-3">
            <List title="Neue Regeln" index={5} items={d.deviations.rules} query={(key) => `rule:${key}${hostFilter}`} render={(item) => {
              const rule = d.deviations.rules.find((entry) => entry.key === item.key);
              return <span className="flex min-w-0 items-center gap-2">{rule?.maxLevel != null && <LevelPill level={rule.maxLevel} />}<span className="truncate">{rule?.description ?? item.key}</span><span className="font-mono text-[10.5px] text-faint">{item.key}</span></span>;
            }} />
            <List title="Neue Benutzer" index={6} items={d.deviations.users} query={(key) => `user:"${key}"${hostFilter}`} />
            <List title="Neue Quell-IPs" index={7} items={d.deviations.sources} query={(key) => `ip:${key}${hostFilter}`} render={(item) => {
              const external = d.deviations.sources.find((entry) => entry.key === item.key)?.external;
              return <span className="flex items-center gap-2 font-mono">{item.key}{external && <span className="rounded-full border border-bad/35 px-1.5 text-[10px] text-bad">extern</span>}</span>;
            }} />
            <List title="Neue Prozesse" index={8} items={d.deviations.processes} query={(key) => `process:"${key}"${hostFilter}`} />
            <List title="Neue Windows-Event-IDs" index={9} items={d.deviations.eventIds} query={(key) => `eid:${key}${hostFilter}`} />
          </div>
        </>
      )}
    </>
  );
}
