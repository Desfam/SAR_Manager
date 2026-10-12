import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'motion/react';
import { Activity, ArrowUpRight, FileSearch, GitCommitVertical, Monitor, ScanSearch, Search, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { AnimatedNumber } from '@/components/ui/viz';
import { Beacon, FillBar, Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { EventTable } from '@/components/soc/EventTable';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { useSocHost, useSocHosts } from '@/hooks/use-soc';
import { useConnections } from '@/hooks/use-infrastructure';
import { useGuestNetworks } from '@/hooks/use-network';
import { eventKey, formatTime } from '@/lib/soc';
import { formatCount, matchAgent } from '@/lib/wazuh';
import type { SocEvent, SocHost } from '@/services/soc';

type StatusFilter = 'all' | 'active' | 'disconnected';

function HostDetail({ name, onOpenEvent }: { name: string; onOpenEvent: (event: SocEvent) => void }) {
  const navigate = useNavigate();
  const context = useSocHost(name, 24);
  const connections = useConnections();
  const guests = useGuestNetworks();
  const host = context.data?.host;
  const match = host ? matchAgent(host, connections.data ?? [], guests.data ?? []) : {};
  return (
    <div className="space-y-5 px-7 pb-8 pt-7">
      <div>
        <p className="text-[12px] text-muted">Wazuh-Agent {host?.id ?? ''}</p>
        <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{name}</h2>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12.5px] text-muted">
          {host?.status && <span className={cn('flex items-center gap-1.5', host.status === 'active' ? 'text-ok' : 'text-bad')}><Beacon tone={host.status === 'active' ? 'ok' : 'bad'} size={6} /> {host.status === 'active' ? 'aktiv' : host.status === 'disconnected' ? 'getrennt' : host.status}</span>}
          <span className="font-mono">{host?.ip}</span>
          <span>{[host?.os, host?.osVersion].filter(Boolean).join(' ')}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(`host:"${name}"`)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised"><FileSearch className="size-3.5" /> Investigation</button>
          <button type="button" onClick={() => navigate(`/wazuh/timeline?q=${encodeURIComponent(`host:"${name}"`)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised"><GitCommitVertical className="size-3.5" /> Timeline</button>
          <button type="button" onClick={() => navigate(`/wazuh/full-scan?host=${encodeURIComponent(name)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised"><ScanSearch className="size-3.5" /> Full Scan</button>
          <button type="button" onClick={() => navigate(`/wazuh/baseline?host=${encodeURIComponent(name)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised"><Activity className="size-3.5" /> Baseline</button>
          {match.connection && <button type="button" onClick={() => navigate(`/systems/${encodeURIComponent(match.connection!.id)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-accent/30 px-3 text-[12px] text-accent hover:bg-accent/10"><ArrowUpRight className="size-3.5" /> Server-Übersicht {match.connection.name}</button>}
        </div>
      </div>
      {!context.data ? (
        <Shimmer className="h-64 w-full" />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {[
              ['Risiko', `${host?.risk ?? 0}/100`],
              ['Events 24 h', formatCount(host?.events ?? 0)],
              ['ab Level 7', formatCount(host?.serious ?? 0)],
              ['CVEs krit./hoch', `${host?.critical ?? 0} / ${host?.high ?? 0}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-line/[0.07] px-3 py-2">
                <p className="text-[11px] text-muted">{label}</p>
                <p className="text-[15px] font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">System</p>
              <dl className="space-y-1 text-[12.5px]">
                <div className="flex justify-between gap-3"><dt className="text-muted">Hostname</dt><dd className="font-mono">{host?.hostname ?? '–'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Architektur</dt><dd className="font-mono">{host?.architecture ?? '–'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">CPU</dt><dd className="truncate">{context.data.hardware?.cpu?.name ?? '–'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Agent-Version</dt><dd className="font-mono">{host?.version ?? '–'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Gruppen</dt><dd>{host?.groups?.join(', ') || '–'}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-muted">Letzter Kontakt</dt><dd className="font-mono">{formatTime(host?.lastKeepAlive, true)}</dd></div>
              </dl>
            </div>
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Wichtigste Regeln</p>
              <ul className="space-y-1">{context.data.rules.slice(0, 7).map((rule) => <li key={rule.id} className="flex items-center gap-2 text-[12px]"><LevelPill level={rule.maxLevel} /><span className="truncate">{rule.description}</span><span className="ml-auto font-mono text-faint">{formatCount(rule.count)}</span></li>)}</ul>
            </div>
          </div>
          {context.data.users.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Benutzer in den Events</p>
              <div className="flex flex-wrap gap-1.5">{context.data.users.map((user) => <span key={user.name} className="rounded-full border border-line/[0.10] px-2 py-0.5 font-mono text-[11px]">{user.name} <span className="text-faint">{formatCount(user.count)}</span></span>)}</div>
            </div>
          )}
          {context.data.ports.length > 0 && (
            <div>
              <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Lauschende Ports (Inventar)</p>
              <div className="flex flex-wrap gap-1">{context.data.ports.map((port) => <span key={`${port.protocol}-${port.port}-${port.address}`} className="rounded-md border border-line/[0.08] px-1.5 py-0.5 font-mono text-[11px]">{port.protocol} {port.port}{port.process ? ` · ${port.process}` : ''}</span>)}</div>
            </div>
          )}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Neueste Events</p>
            <EventTable events={context.data.recent} onSelect={onOpenEvent} maxHeight={360} />
          </div>
        </>
      )}
    </div>
  );
}

export function Hosts() {
  const [params, setParams] = useSearchParams();
  const hosts = useSocHosts(24);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [platform, setPlatform] = useState<'all' | 'windows' | 'linux'>('all');
  const [event, setEvent] = useState<SocEvent | null>(null);
  const selected = params.get('host');
  const list = useMemo(() => hosts.data ?? [], [hosts.data]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list.filter((host: SocHost) => {
      if (status !== 'all' && host.status !== status) return false;
      if (platform === 'windows' && host.platform !== 'windows') return false;
      if (platform === 'linux' && (!host.platform || host.platform === 'windows')) return false;
      return !needle || `${host.name} ${host.ip ?? ''} ${host.os ?? ''} ${host.hostname ?? ''}`.toLowerCase().includes(needle);
    });
  }, [list, query, status, platform]);

  const active = list.filter((host) => host.status === 'active').length;
  const disconnected = list.filter((host) => host.status === 'disconnected').length;

  return (
    <>
      <PageHeader section="Endpoint Security" title="Hosts" description="Alle Wazuh-Agents: Status, System, Events, Schwachstellen und Risiko" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {[
          ['Agents', list.length, undefined],
          ['Aktiv', active, undefined],
          ['Getrennt', disconnected, disconnected ? 'warn' : undefined],
          ['Mit kritischen CVEs', list.filter((host) => (host.critical ?? 0) > 0).length, undefined],
        ].map(([label, value, tone], index) => (
          <NotchCard key={label as string} index={index} className="min-h-[118px]" eyebrow="Wazuh" title={label as string} tone={tone as 'warn' | undefined}>
            <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{hosts.data ? <AnimatedNumber value={value as number} /> : <Shimmer className="h-8 w-14" />}</p>
          </NotchCard>
        ))}
      </div>

      <NotchCard index={4} className="mt-5" eyebrow={`${filtered.length} von ${list.length}`} title="Hosts nach Risiko" bodyClassName="pt-3">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="flex h-9 w-64 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3.5 focus-within:border-accent/40">
            <Search className="size-3.5 text-muted" />
            <input value={query} onChange={(entry) => setQuery(entry.target.value)} placeholder="Name, IP, System …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          {([['all', 'Alle'], ['active', 'Aktiv'], ['disconnected', 'Getrennt']] as Array<[StatusFilter, string]>).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setStatus(value)} className={cn('rounded-full border px-3 py-1 text-[12px]', status === value ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>{label}</button>
          ))}
          <span className="mx-1 h-5 w-px bg-line/[0.1]" />
          {([['all', 'Alle Systeme'], ['windows', 'Windows'], ['linux', 'Linux']] as Array<['all' | 'windows' | 'linux', string]>).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setPlatform(value)} className={cn('rounded-full border px-3 py-1 text-[12px]', platform === value ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>{label}</button>
          ))}
        </div>
        <div className="overflow-x-auto">
          <div className="min-w-[940px]">
            <div className="grid grid-cols-[minmax(160px,1.2fr)_110px_minmax(150px,1fr)_90px_60px_110px_150px] gap-3 border-b border-line/[0.07] px-3 pb-2 text-[10.5px] uppercase tracking-[0.1em] text-faint">
              <span>Host</span><span>IP</span><span>System</span><span>Events 24 h</span><span>Level</span><span>CVEs krit./hoch</span><span>Risiko</span>
            </div>
            <ul className="scroll-thin max-h-[640px] overflow-y-auto">
              {filtered.map((host, index) => (
                <motion.li key={host.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: Math.min(index * 0.01, 0.3) }}>
                  <button type="button" onClick={() => setParams({ host: host.name }, { replace: true })} className={cn('grid w-full grid-cols-[minmax(160px,1.2fr)_110px_minmax(150px,1fr)_90px_60px_110px_150px] items-center gap-3 border-b border-line/[0.04] px-3 py-2 text-left text-[12.5px] hover:bg-hover/50', selected === host.name && 'bg-accent/[0.08]')}>
                    <span className="flex min-w-0 items-center gap-2.5">
                      <Beacon tone={host.status === 'active' ? 'ok' : host.status === 'disconnected' ? 'bad' : 'muted'} size={6} />
                      {host.platform === 'windows' ? <Monitor className="size-3.5 shrink-0 text-muted" /> : <Server className="size-3.5 shrink-0 text-muted" />}
                      <span className="truncate font-medium">{host.name}</span>
                    </span>
                    <span className="truncate font-mono text-[11.5px] text-muted">{host.ip}</span>
                    <span className="truncate text-muted">{host.os ?? '–'}</span>
                    <span className="font-mono text-[11.5px]">{host.events ? formatCount(host.events) : '–'}</span>
                    <span>{host.maxLevel ? <LevelPill level={host.maxLevel} /> : <span className="text-faint">–</span>}</span>
                    <span className="font-mono text-[11.5px]"><span className={host.critical ? 'text-bad' : 'text-faint'}>{host.critical ?? 0}</span> / <span className={host.high ? 'text-accent' : 'text-faint'}>{host.high ?? 0}</span></span>
                    <span className="flex items-center gap-2"><span className="w-20"><FillBar value={host.risk} height={5} tone={host.risk >= 60 ? 'bad' : host.risk >= 35 ? 'warn' : 'normal'} /></span><span className="font-mono text-[11px] text-muted">{host.risk}</span></span>
                  </button>
                </motion.li>
              ))}
            </ul>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-faint">Risiko (0–100) = höchstes Event-Level, Häufung ab Level 7, kritische CVEs und Verbindungsstatus; eine grobe Reihenfolge zum Abarbeiten, keine Bewertung durch KI.</p>
      </NotchCard>

      <Drawer open={!!selected} onClose={() => setParams({}, { replace: true })} label="Host" width={820}>
        {selected && <HostDetail key={selected} name={selected} onOpenEvent={setEvent} />}
      </Drawer>
      <EventDrawer event={event} onClose={() => setEvent(null)} />
    </>
  );
}
