import { motion } from 'motion/react';
import { Boxes, Database, Info, Loader2, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AreaLine } from '@/components/ui/viz';
import { Beacon, FillBar, Shimmer } from '@/components/systems/fx';
import { useHealth } from '@/hooks/use-soc';
import { formatCount } from '@/lib/wazuh';

const bytes = (value?: number) => {
  if (value == null) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1; }
  return `${size.toFixed(size >= 100 || unit === 0 ? 0 : 1)} ${units[unit]}`;
};

const tone = (percent?: number) => (percent == null ? undefined : percent >= 90 ? 'bad' : percent >= 75 ? 'warn' : 'ok') as 'bad' | 'warn' | 'ok' | undefined;

/** Daemons that are off unless configured (mail, syslog forwarding, agentless, DB output, reports, cluster) */
const OPTIONAL_DAEMONS = new Set(['wazuh-agentlessd', 'wazuh-csyslogd', 'wazuh-dbd', 'wazuh-maild', 'wazuh-reportd', 'wazuh-clusterd', 'wazuh-integratord']);

const STATUS_COLOR: Record<string, string> = { green: 'text-ok', yellow: 'text-accent', red: 'text-bad' };
const STATUS_LABEL: Record<string, string> = { green: 'Grün', yellow: 'Gelb', red: 'Rot' };

function Meter({ label, value }: { label: string; value?: number }) {
  return (
    <div>
      <p className="flex justify-between text-[11.5px]"><span className="text-muted">{label}</span><span className="font-mono">{value == null ? '–' : `${Math.round(value)} %`}</span></p>
      <FillBar value={value ?? null} tone={tone(value)} height={5} />
    </div>
  );
}

export function SystemHealth() {
  const health = useHealth();
  const d = health.data;
  const indexer = d?.indexer;
  const ingest = d?.ingest ?? [];
  // 5-minute buckets (time in seconds); the last one is still filling up
  const lastFull = ingest.length > 1 ? ingest[ingest.length - 2] : ingest[0];
  const perMinute = lastFull ? Math.round(lastFull.count / 5) : null;
  const core = d?.manager?.daemons.filter((daemon) => !OPTIONAL_DAEMONS.has(daemon.name)) ?? [];
  const coreRunning = core.filter((daemon) => daemon.state === 'running').length;
  const optionalOff = (d?.manager?.daemons.length ?? 0) - core.length - (d?.manager?.daemons.filter((daemon) => OPTIONAL_DAEMONS.has(daemon.name) && daemon.state === 'running').length ?? 0);

  return (
    <>
      <PageHeader
        section="Administration"
        title="System Health"
        description="Zustand von Wazuh-Indexer, Manager und Containern. Nur lesend, aktualisiert alle 30 Sekunden."
        actions={health.isFetching ? <Loader2 className="size-4 animate-spin text-muted" /> : undefined}
      />

      {health.isError && <p className="mb-4 rounded-2xl border border-bad/35 bg-bad/[0.06] px-4 py-3 text-[13px] text-bad">{(health.error as Error).message}</p>}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <NotchCard index={0} eyebrow="Indexer" title="Cluster" tone={indexer?.status === 'red' ? 'bad' : indexer?.status === 'yellow' ? 'warn' : undefined}>
          {indexer ? (
            <>
              <p className={cn('mt-2 text-[28px] font-bold leading-none', STATUS_COLOR[indexer.status] ?? 'text-bad')}>{STATUS_LABEL[indexer.status] ?? indexer.status}</p>
              <p className="mt-2 text-[11.5px] text-faint">{indexer.nodes ?? '–'} Knoten · {formatCount(indexer.activeShards ?? 0)} Shards</p>
            </>
          ) : <Shimmer className="mt-2 h-8 w-20" />}
        </NotchCard>
        <NotchCard index={1} eyebrow="nicht zugewiesen" title="Shards" tone={indexer && indexer.unassigned > indexer.unassignedReplicas ? 'bad' : undefined}>
          {indexer ? (
            <>
              <p className="mt-2 text-[28px] font-bold leading-none">{formatCount(indexer.unassigned)}</p>
              <p className="mt-2 text-[11.5px] text-faint">davon {formatCount(indexer.unassignedReplicas)} Replikate</p>
            </>
          ) : <Shimmer className="mt-2 h-8 w-20" />}
        </NotchCard>
        <NotchCard index={2} eyebrow="Events pro Minute" title="Ingest" tone={ingest.length && !perMinute ? 'bad' : undefined}>
          {d ? (
            <>
              <p className="mt-2 text-[28px] font-bold leading-none">{perMinute == null ? '–' : formatCount(perMinute)}</p>
              <p className="mt-2 text-[11.5px] text-faint">{perMinute === 0 ? 'Es kommen keine Events an' : 'Ø der letzten vollen 5 Minuten'}</p>
            </>
          ) : <Shimmer className="mt-2 h-8 w-20" />}
        </NotchCard>
        <NotchCard index={3} eyebrow={d?.manager?.version ?? 'Manager-API'} title="Manager" tone={d && (!d.manager || coreRunning < core.length) ? 'bad' : undefined}>
          {d ? (
            d.manager ? (
              <>
                <p className="mt-2 text-[28px] font-bold leading-none">{coreRunning}/{core.length}</p>
                <p className="mt-2 text-[11.5px] text-faint">Kerndienste laufen{optionalOff ? ` · ${optionalOff} optionale aus` : ''}{d.manager.connection ? ` · ${d.manager.connection.active}/${d.manager.connection.total} Agents aktiv` : ''}</p>
              </>
            ) : <p className="mt-2 text-[13px] text-muted">Manager-API nicht konfiguriert oder nicht erreichbar.</p>
          ) : <Shimmer className="mt-2 h-8 w-20" />}
        </NotchCard>
      </div>

      {indexer?.explanation && (
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex items-start gap-2 rounded-2xl border border-line/[0.08] bg-raised/30 px-4 py-3 text-[12.5px] text-muted"><Info className="mt-0.5 size-4 shrink-0 text-accent" />{indexer.explanation}</motion.p>
      )}
      {indexer?.error && <p className="mt-4 rounded-2xl border border-bad/35 bg-bad/[0.06] px-4 py-3 text-[12.5px] text-bad">{indexer.error}</p>}

      <NotchCard index={4} className="mt-5" eyebrow="letzte 2 Stunden, je 5 Minuten" title="Eingehende Events" bodyClassName="pt-3">
        {ingest.length ? (
          <>
            <AreaLine values={ingest.map((point) => point.count)} height={110} />
            <div className="mt-1 flex justify-between font-mono text-[10.5px] text-faint">
              <span>{new Date(ingest[0].time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
              <span>max. {formatCount(Math.max(...ingest.map((point) => point.count)))} / 5 min</span>
              <span>{new Date(ingest[ingest.length - 1].time * 1000).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</span>
            </div>
          </>
        ) : <Shimmer className="h-[110px] w-full" />}
      </NotchCard>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <NotchCard index={5} eyebrow="Indexer-Knoten" title="Ressourcen" bodyClassName="pt-3">
          {!indexer ? <Shimmer className="h-40" /> : !indexer.nodeStats.length ? <p className="text-[12.5px] text-muted">Keine Knotendaten.</p> : (
            <ul className="space-y-4">
              {indexer.nodeStats.map((node) => {
                const diskUsed = node.diskTotal && node.diskFree != null ? ((node.diskTotal - node.diskFree) / node.diskTotal) * 100 : undefined;
                return (
                  <li key={node.name}>
                    <p className="mb-2 flex items-center gap-2 text-[13px] font-medium"><Server className="size-4 text-muted" />{node.name}{node.load != null && <span className="ml-auto font-mono text-[11px] text-faint">Load {node.load.toFixed(2)}</span>}</p>
                    <div className="grid grid-cols-2 gap-x-5 gap-y-2">
                      <Meter label="Heap (JVM)" value={node.heapPercent} />
                      <Meter label="RAM" value={node.memPercent} />
                      <Meter label="CPU" value={node.cpuPercent} />
                      <Meter label={`Disk (${bytes(node.diskFree)} frei)`} value={diskUsed} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </NotchCard>
        <NotchCard index={6} eyebrow="nach Muster gruppiert" title="Indizes" bodyClassName="pt-3">
          {!indexer ? <Shimmer className="h-40" /> : (
            <ul className="space-y-1">
              {indexer.indexGroups.map((group) => (
                <li key={group.name} className="grid grid-cols-[18px_minmax(0,1fr)_60px_90px_80px] items-center gap-3 rounded-lg px-1.5 py-1 text-[12.5px]">
                  <Database className="size-3.5 text-faint" />
                  <span className="truncate font-mono">{group.name}</span>
                  <span className="text-right font-mono text-[11px] text-faint">{group.count} idx</span>
                  <span className="text-right font-mono text-[11px] text-muted">{formatCount(group.docs)}</span>
                  <span className="text-right font-mono text-[11px]">{bytes(group.bytes)}</span>
                </li>
              ))}
            </ul>
          )}
        </NotchCard>
        <NotchCard index={7} eyebrow="wazuh-control status" title="Manager-Dienste" bodyClassName="pt-3">
          {!d ? <Shimmer className="h-40" /> : !d.manager ? <p className="text-[12.5px] text-muted">Manager-API nicht verfügbar.</p> : (
            <>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-3">
                {d.manager.daemons.map((daemon) => (
                  <p key={daemon.name} className="flex items-center gap-2 text-[12px]"><Beacon tone={daemon.state === 'running' ? 'ok' : OPTIONAL_DAEMONS.has(daemon.name) ? 'muted' : 'bad'} size={6} /><span className={cn('truncate font-mono', daemon.state !== 'running' && OPTIONAL_DAEMONS.has(daemon.name) && 'text-faint')}>{daemon.name}</span></p>
                ))}
              </div>
              {!d.manager.logs.some((log) => log.error || log.warning) && <p className="mt-5 text-[12px] text-ok">Keine Fehler oder Warnungen im Manager-Log.</p>}
              {!!d.manager.logs.length && (
                <>
                  <p className="mb-1.5 mt-5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Log-Zusammenfassung (Fehler / Warnungen)</p>
                  <ul className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto">
                    {[...d.manager.logs].sort((a, b) => b.error - a.error || b.warning - a.warning).filter((log) => log.error || log.warning).map((log) => (
                      <li key={log.component} className="flex justify-between gap-3 font-mono text-[11.5px]">
                        <span className="truncate">{log.component}</span>
                        <span><span className={log.error ? 'text-bad' : 'text-faint'}>{log.error}</span> / <span className={log.warning ? 'text-accent' : 'text-faint'}>{log.warning}</span></span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </NotchCard>
        <NotchCard index={8} eyebrow="docker ps, read-only über SSH" title="Container" bodyClassName="pt-3">
          {!d ? <Shimmer className="h-40" /> : !d.containers ? (
            <p className="text-[12.5px] text-muted">Keine SSH-Verbindung zum Wazuh-Host gespeichert oder Docker nicht lesbar.</p>
          ) : !d.containers.length ? <p className="text-[12.5px] text-muted">Keine Container.</p> : (
            <ul className="space-y-1.5">
              {d.containers.map((container) => (
                <li key={container.name} className="flex items-center gap-3 text-[12.5px]">
                  <Beacon tone={container.status.startsWith('Up') ? (container.status.includes('unhealthy') ? 'bad' : 'ok') : 'bad'} size={7} />
                  <Boxes className="size-4 text-muted" />
                  <span className="min-w-0 flex-1"><span className="block truncate font-medium">{container.name}</span><span className="block truncate font-mono text-[10.5px] text-faint">{container.image}</span></span>
                  <span className="text-right font-mono text-[11px] text-muted">{container.status}</span>
                </li>
              ))}
            </ul>
          )}
        </NotchCard>
      </div>
    </>
  );
}
