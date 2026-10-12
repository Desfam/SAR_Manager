import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArrowDownToLine, ArrowUpFromLine, Info, Loader2, RadioTower } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { useExposure } from '@/hooks/use-soc';
import { RANGES, formatTime } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';

/** Ports that are risky when reachable, for highlighting */
const RISKY = new Set([21, 23, 135, 139, 445, 1433, 3306, 3389, 5432, 5900, 5985, 5986, 6379, 9200, 27017]);

export function ExposureMap() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const exposure = useExposure(hours);
  const d = exposure.data;
  const [focus, setFocus] = useState<string | null>(null);

  const hosts = useMemo(() => {
    if (!d) return [];
    const names = new Set<string>([...d.inbound.flatMap((entry) => entry.hosts), ...d.outbound.flatMap((entry) => entry.hosts)]);
    return [...names].map((name) => ({
      name,
      inbound: d.inbound.filter((entry) => entry.hosts.includes(name)).length,
      outbound: d.outbound.filter((entry) => entry.hosts.includes(name)).length,
    })).sort((a, b) => b.inbound + b.outbound - (a.inbound + a.outbound));
  }, [d]);

  const inbound = (d?.inbound ?? []).filter((entry) => !focus || entry.hosts.includes(focus));
  const outbound = (d?.outbound ?? []).filter((entry) => !focus || entry.hosts.includes(focus));
  const listening = (d?.listening ?? []).filter((entry) => !focus || entry.host === focus);

  return (
    <>
      <PageHeader
        section="Explore"
        title="Exposure Map"
        description="Welche öffentlichen Adressen tauchen in Events auf, wohin verbinden sich interne Hosts, welche Ports sind offen?"
        actions={
          <div className="flex items-center gap-2">
            {exposure.isFetching && <Loader2 className="size-4 animate-spin text-muted" />}
            <div className="flex rounded-full border border-line/[0.12] p-1">
              {RANGES.map((range) => (
                <button key={range.hours} type="button" onClick={() => setHours(range.hours)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                  {hours === range.hours && <motion.span layoutId="exposure-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                  <span className="relative">{range.label}</span>
                </button>
              ))}
            </div>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          ['Öffentliche Quellen', d?.inbound.length, 'in Events (eingehend)', ArrowDownToLine],
          ['Externe Ziele', d?.outbound.length, 'aus Wazuh-Inventar (ausgehend)', ArrowUpFromLine],
          ['Hosts mit offenen Ports', d?.listening.length, 'lauschende Dienste', RadioTower],
        ].map(([label, value, sub, Icon], index) => {
          const IconComponent = Icon as typeof RadioTower;
          return (
            <NotchCard key={label as string} index={index} eyebrow={sub as string} title={label as string}>
              <div className="mt-2 flex items-center gap-3">
                <IconComponent className="size-5 text-accent" />
                <p className="text-[30px] font-bold leading-none tracking-[-0.03em]">{d ? <AnimatedNumber value={(value as number) ?? 0} /> : <Shimmer className="h-8 w-14" />}</p>
              </div>
            </NotchCard>
          );
        })}
      </div>

      {d && (
        <p className="mt-4 flex items-start gap-2 rounded-2xl border border-line/[0.08] bg-raised/30 px-4 py-3 text-[12px] text-muted"><Info className="mt-0.5 size-4 shrink-0" />{d.note}</p>
      )}

      {!!hosts.length && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => setFocus(null)} className={cn('rounded-full border px-3 py-1 text-[12px]', !focus ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>Alle Hosts</button>
          {hosts.slice(0, 30).map((host) => (
            <button key={host.name} type="button" onClick={() => setFocus(focus === host.name ? null : host.name)} className={cn('rounded-full border px-3 py-1 text-[12px]', focus === host.name ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>
              {host.name} <span className="font-mono text-faint">↓{host.inbound} ↑{host.outbound}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <NotchCard index={3} eyebrow="Öffentliche IPs in Events" title="Eingehend" bodyClassName="pt-3">
          {!d ? <Shimmer className="h-60" /> : !inbound.length ? <p className="py-6 text-center text-[12.5px] text-ok">Keine öffentlichen Quell-IPs im Zeitraum.</p> : (
            <ul className="scroll-thin max-h-[460px] space-y-1 overflow-y-auto pr-1">
              {inbound.map((entry) => (
                <li key={entry.ip}>
                  <button type="button" onClick={() => navigate(`/wazuh/ioc?value=${encodeURIComponent(entry.ip)}`)} className="grid w-full grid-cols-[130px_minmax(0,1fr)_56px_40px] items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-hover/50">
                    <span className="font-mono">{entry.ip}</span>
                    <span className="min-w-0">
                      <span className="block truncate">{entry.rule ?? '–'}</span>
                      <span className="block truncate text-[10.5px] text-faint">→ {entry.hosts.join(', ')} · {formatTime(entry.last, true)}</span>
                    </span>
                    <span className="text-right font-mono text-[11px] text-faint">{formatCount(entry.count)}</span>
                    <LevelPill level={entry.maxLevel} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </NotchCard>
        <NotchCard index={4} eyebrow="Verbindungen aus dem Inventar" title="Ausgehend" bodyClassName="pt-3">
          {!d ? <Shimmer className="h-60" /> : !outbound.length ? <p className="py-6 text-center text-[12.5px] text-muted">Keine externen Verbindungen im Inventar.</p> : (
            <ul className="scroll-thin max-h-[460px] space-y-1 overflow-y-auto pr-1">
              {outbound.map((entry) => (
                <li key={entry.ip}>
                  <button type="button" onClick={() => navigate(`/wazuh/ioc?value=${encodeURIComponent(entry.ip)}`)} className="grid w-full grid-cols-[130px_minmax(0,1fr)_70px] items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-hover/50">
                    <span className="font-mono">{entry.ip}</span>
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px]">{entry.ports.slice(0, 6).join(', ')}{entry.processes.length ? ` · ${entry.processes.slice(0, 3).join(', ')}` : ''}</span>
                      <span className="block truncate text-[10.5px] text-faint">← {entry.hosts.join(', ')}</span>
                    </span>
                    <span className="text-right font-mono text-[11px] text-faint">{entry.connections} Verb.</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </NotchCard>
      </div>

      <NotchCard index={5} className="mt-5" eyebrow="rot = häufig angegriffene Dienste" title="Lauschende Ports" bodyClassName="pt-3">
        {!d ? <Shimmer className="h-40" /> : !listening.length ? <p className="py-6 text-center text-[12.5px] text-muted">Keine Port-Daten im Inventar.</p> : (
          <ul className="grid gap-x-6 gap-y-2 md:grid-cols-2">
            {listening.map((entry) => (
              <li key={entry.host} className="flex items-start gap-3 border-b border-line/[0.05] py-1.5 text-[12.5px]">
                <span className="w-36 shrink-0 truncate font-medium">{entry.host}</span>
                <span className="flex flex-wrap gap-1">
                  {entry.ports.map((port) => (
                    <span key={`${port.protocol}-${port.port}`} title={port.process} className={cn('rounded-full border px-1.5 py-px font-mono text-[10.5px]', RISKY.has(port.port) ? 'border-bad/40 text-bad' : 'border-line/[0.10] text-muted')}>{port.port}/{port.protocol}</span>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        )}
      </NotchCard>
    </>
  );
}
