import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ExternalLink, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { FillBar, Shimmer, SplitBar } from '@/components/systems/fx';
import { useSocVulnerabilities } from '@/hooks/use-soc';
import { formatCount } from '@/lib/wazuh';
import { formatTime } from '@/lib/soc';

const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'];
const SEVERITY_CLASS: Record<string, string> = { Critical: 'border-bad bg-bad/15 text-bad', High: 'border-bad/40 text-bad', Medium: 'border-accent/40 text-accent', Low: 'border-line/[0.14] text-muted' };

export function Vulnerabilities() {
  const [params, setParams] = useSearchParams();
  const severity = params.get('severity') ?? undefined;
  const host = params.get('host') ?? undefined;
  const q = params.get('q') ?? undefined;
  const [search, setSearch] = useState(q ?? '');
  const [expanded, setExpanded] = useState<string | null>(null);
  const data = useSocVulnerabilities({ severity, host, q });
  const d = data.data;
  const set = (key: string, value?: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const timer = setTimeout(() => (search.trim() || undefined) !== q && set('q', search.trim() || undefined), 450);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  const maxHost = Math.max(1, ...(d?.hosts ?? []).map((entry) => entry.count));

  return (
    <>
      <PageHeader section="Threat Intelligence" title="Schwachstellen" description="CVEs aus der Wazuh-Schwachstellenerkennung: welche Hosts, welche Pakete, was zuerst gepatcht werden sollte" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {SEVERITIES.map((key, index) => (
          <NotchCard key={key} index={index} className="min-h-[118px]" eyebrow={host ?? 'alle Hosts'} title={{ Critical: 'Kritisch', High: 'Hoch', Medium: 'Mittel', Low: 'Niedrig' }[key]!} tone={key === 'Critical' && d?.severity.Critical ? 'bad' : undefined} onClick={() => set('severity', severity === key ? undefined : key)} ariaLabel={`Nach ${key} filtern`}>
            <p className={cn('mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]', key === 'Critical' || key === 'High' ? 'text-bad' : key === 'Medium' ? 'text-accent' : '')}>{d ? <AnimatedNumber value={d.severity[key] ?? 0} /> : <Shimmer className="h-8 w-20" />}</p>
          </NotchCard>
        ))}
      </div>
      {d && (
        <div className="mt-4">
          <SplitBar height={8} parts={[{ value: d.severity.Critical ?? 0, color: 'rgb(var(--bad))', label: 'Kritisch' }, { value: d.severity.High ?? 0, color: 'rgb(var(--bad) / 0.6)', label: 'Hoch' }, { value: d.severity.Medium ?? 0, color: 'rgb(var(--accent))', label: 'Mittel' }, { value: d.severity.Low ?? 0, color: 'rgb(var(--line) / 0.25)', label: 'Niedrig' }]} />
          <p className="mt-1.5 text-[11.5px] text-faint">{formatCount(d.total)} Befunde auf {d.hostCount} Hosts</p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <NotchCard index={4} eyebrow="nach Anzahl" title="Hosts" bodyClassName="pt-3">
          <ul className="scroll-thin max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {(d?.hosts ?? []).map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={() => set('host', host === entry.name ? undefined : entry.name)} className={cn('w-full rounded-lg px-2 py-1.5 text-left hover:bg-hover/50', host === entry.name && 'bg-accent/[0.10]')}>
                  <span className="flex items-center justify-between text-[12.5px]"><span className="truncate font-medium">{entry.name}</span><span className="font-mono text-[11px] text-faint"><span className="text-bad">{entry.critical}</span> · {entry.high} · {formatCount(entry.count)}</span></span>
                  <span className="mt-1 block"><FillBar value={(entry.count / maxHost) * 100} height={4} tone={entry.critical ? 'bad' : 'warn'} /></span>
                </button>
              </li>
            ))}
          </ul>
        </NotchCard>
        <NotchCard index={5} eyebrow="meist verbreitet" title="CVEs" bodyClassName="pt-3">
          <ul className="scroll-thin max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {(d?.cves ?? []).map((cve) => (
              <li key={cve.id}>
                <button type="button" onClick={() => setSearch(cve.id)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-hover/50">
                  <span className={cn('rounded-full border px-1.5 py-px text-[10px]', SEVERITY_CLASS[cve.severity ?? ''] ?? 'border-line/[0.12] text-muted')}>{cve.score?.toFixed(1) ?? '–'}</span>
                  <span className="font-mono">{cve.id}</span>
                  <span className="truncate text-muted">{cve.package}</span>
                  <span className="ml-auto font-mono text-[11px] text-faint">{cve.hosts} Hosts</span>
                </button>
              </li>
            ))}
          </ul>
        </NotchCard>
        <NotchCard index={6} eyebrow="am häufigsten betroffen" title="Pakete" bodyClassName="pt-3">
          <ul className="scroll-thin max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {(d?.packages ?? []).map((entry) => (
              <li key={entry.name}>
                <button type="button" onClick={() => setSearch(entry.name)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] hover:bg-hover/50">
                  <span className="truncate font-mono">{entry.name}</span>
                  <span className="ml-auto whitespace-nowrap font-mono text-[11px] text-faint"><span className="text-bad">{entry.critical}</span> krit. · {entry.hosts} Hosts · {formatCount(entry.count)}</span>
                </button>
              </li>
            ))}
          </ul>
        </NotchCard>
      </div>

      <NotchCard index={7} className="mt-5" eyebrow={d ? `${formatCount(d.total)} Treffer · nach CVSS sortiert` : 'Liste'} title="Befunde" bodyClassName="pt-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex h-9 w-72 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3.5 focus-within:border-accent/40">
            <Search className="size-3.5 text-muted" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="CVE, Paket, Beschreibung, Host …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          {severity && <button type="button" onClick={() => set('severity')} className="rounded-full border border-accent/40 bg-accent/[0.10] px-3 py-1 text-[12px]">Schwere: {severity} ×</button>}
          {host && <button type="button" onClick={() => set('host')} className="rounded-full border border-accent/40 bg-accent/[0.10] px-3 py-1 text-[12px]">Host: {host} ×</button>}
        </div>
        <ul className="space-y-1">
          {(d?.items ?? []).map((item) => (
            <li key={item.id} className="rounded-xl border border-line/[0.05]">
              <button type="button" onClick={() => setExpanded(expanded === item.id ? null : item.id)} className="grid w-full grid-cols-[60px_150px_minmax(0,1fr)_minmax(0,1fr)_110px] items-center gap-3 px-3 py-2 text-left text-[12.5px] hover:bg-hover/40">
                <span className={cn('rounded-full border px-1.5 py-px text-center text-[10.5px]', SEVERITY_CLASS[item.severity ?? ''] ?? 'border-line/[0.12] text-muted')}>{item.score?.toFixed(1) ?? item.severity}</span>
                <span className="font-mono text-[12px]">{item.cve}</span>
                <span className="truncate font-mono text-[11.5px]">{item.package} <span className="text-faint">{item.version}</span></span>
                <span className="truncate">{item.host}</span>
                <span className="font-mono text-[11px] text-faint">{formatTime(item.detectedAt, true).slice(0, 10)}</span>
              </button>
              {expanded === item.id && (
                <div className="space-y-2 border-t border-line/[0.05] px-4 py-3 text-[12.5px]">
                  <p className="text-ink/90">{item.description}</p>
                  <p className="text-muted">{item.os} · veröffentlicht {formatTime(item.publishedAt, true).slice(0, 10)}</p>
                  {item.reference && <a href={item.reference.split(',')[0]} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">Quelle <ExternalLink className="size-3" /></a>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </NotchCard>
    </>
  );
}
