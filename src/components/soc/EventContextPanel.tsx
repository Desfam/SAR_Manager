import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowUpRight, Copy, FileSearch, GitCommitVertical, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LevelPill } from '@/components/wazuh/EventList';
import { useEventContext, useSocHost, useSocUser } from '@/hooks/use-soc';
import { useConnections } from '@/hooks/use-infrastructure';
import { useGuestNetworks } from '@/hooks/use-network';
import { matchAgent, formatCount } from '@/lib/wazuh';
import type { SocEvent } from '@/services/soc';
import { formatTime } from '@/lib/soc';

type Tab = 'details' | 'related' | 'host' | 'user' | 'raw';

function Field({ label, children, mono }: { label: string; children: ReactNode; mono?: boolean }) {
  if (children === undefined || children === null || children === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-line/[0.05] py-1.5 last:border-0">
      <dt className="shrink-0 text-[12px] text-muted">{label}</dt>
      <dd className={cn('min-w-0 break-words text-right text-[12.5px]', mono && 'font-mono text-[12px]')}>{children}</dd>
    </div>
  );
}

function Small({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">{title}</p>
      {children}
    </div>
  );
}

function MiniEvents({ events, showOffset }: { events: Array<{ id: string; timestamp: string; rule: { level: number; description?: string; id?: string }; agent: { name?: string }; offsetSeconds?: number }>; showOffset?: boolean }) {
  if (!events.length) return <p className="text-[12px] text-muted">Keine.</p>;
  return (
    <ul className="space-y-1">
      {events.map((event) => (
        <li key={event.id} className="grid grid-cols-[72px_36px_minmax(0,1fr)] items-center gap-2 text-[12px]">
          <span className={cn('font-mono text-[11px]', showOffset && event.offsetSeconds === 0 ? 'text-accent' : 'text-muted')}>
            {showOffset && event.offsetSeconds !== undefined ? `${event.offsetSeconds > 0 ? '+' : ''}${Math.round(event.offsetSeconds / 60)} min` : formatTime(event.timestamp)}
          </span>
          <LevelPill level={event.rule.level} />
          <span className="truncate" title={event.rule.description}>{event.rule.description}</span>
        </li>
      ))}
    </ul>
  );
}

export function EventContextPanel({ event }: { event: SocEvent | null }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('details');
  const context = useEventContext(event);
  const host = useSocHost(tab === 'host' && event?.agent.name ? event.agent.name : null, 24);
  const user = useSocUser(tab === 'user' && event?.user ? event.user : null, 24);
  const connections = useConnections();
  const guests = useGuestNetworks();

  if (!event) return <p className="py-10 text-center text-[13px] text-muted">Ein Event in der Liste auswählen.</p>;
  const match = matchAgent(event.agent, connections.data ?? [], guests.data ?? []);
  const raw = context.data ? JSON.stringify(context.data.raw, null, 2) : '';

  const tabs: Array<[Tab, string]> = [
    ['details', 'Event Details'],
    ['related', 'Related Events'],
    ['host', 'Host Context'],
    ['user', 'User Context'],
    ['raw', 'Raw JSON'],
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1 border-b border-line/[0.07]">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} disabled={value === 'user' && !event.user} className={cn('relative px-3 pb-2.5 pt-1 text-[12.5px] disabled:opacity-35', tab === value ? 'text-ink' : 'text-muted hover:text-ink')}>
            {label}
            {tab === value && <motion.span layoutId="ctx-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
        <div className="ml-auto flex gap-1 pb-1.5">
          <button type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(`host:"${event.agent.name}"`)}`)} className="flex h-7 items-center gap-1.5 rounded-full border border-line/[0.10] px-2.5 text-[11.5px] text-muted hover:text-ink"><FileSearch className="size-3.5" /> Host untersuchen</button>
          <button type="button" onClick={() => navigate(`/wazuh/timeline?q=${encodeURIComponent(`host:"${event.agent.name}"`)}&at=${encodeURIComponent(event.timestamp)}`)} className="flex h-7 items-center gap-1.5 rounded-full border border-line/[0.10] px-2.5 text-[11.5px] text-muted hover:text-ink"><GitCommitVertical className="size-3.5" /> Timeline</button>
          {match.connection && (
            <button type="button" onClick={() => navigate(`/systems/${encodeURIComponent(match.connection!.id)}`)} className="flex h-7 items-center gap-1.5 rounded-full border border-accent/30 px-2.5 text-[11.5px] text-accent hover:bg-accent/10"><ArrowUpRight className="size-3.5" /> {match.connection.name}</button>
          )}
        </div>
      </div>

      {tab === 'details' && (
        <dl className="grid gap-x-8 md:grid-cols-2">
          <div>
            <Field label="Zeitpunkt" mono>{formatTime(event.timestamp, true)}</Field>
            <Field label="Agent" mono>{event.agent.name}{event.agent.id ? ` (${event.agent.id})` : ''}</Field>
            <Field label="Agent-IP" mono>{event.agent.ip}</Field>
            <Field label="Rule-ID" mono>{event.rule.id}</Field>
            <Field label="Rule-Level"><LevelPill level={event.rule.level} /></Field>
            <Field label="Beschreibung">{event.rule.description}</Field>
            <Field label="Gruppen">{event.rule.groups.join(', ')}</Field>
          </div>
          <div>
            <Field label="Benutzer" mono>{event.user}</Field>
            <Field label="Windows-Event-ID" mono>{event.eventId}</Field>
            <Field label="Anmeldetyp" mono>{event.logonType}</Field>
            <Field label="Programm/Prozess" mono>{event.program}</Field>
            <Field label="Quell-IP" mono>{event.sourceIp}</Field>
            <Field label="Decoder" mono>{event.decoder}</Field>
            <Field label="Ort" mono>{event.location}</Field>
            <Field label="MITRE">{[...event.rule.mitre.ids, ...event.rule.mitre.techniques].join(' · ')}</Field>
          </div>
          {event.fullLog && (
            <div className="md:col-span-2">
              <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Log</p>
              <pre className="scroll-thin max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-canvas p-3 font-mono text-[11.5px] leading-[18px]">{event.fullLog}</pre>
            </div>
          )}
        </dl>
      )}

      {tab === 'related' &&
        (context.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted"><Loader2 className="size-4 animate-spin" /> Suche zusammenhängende Events …</p>
        ) : context.data ? (
          <div className="grid gap-5 md:grid-cols-2">
            <Small title={`Gleicher Host, ±30 min (${context.data.related.sameHost.length})`}>
              <div className="scroll-thin max-h-72 overflow-y-auto pr-1"><MiniEvents events={[...context.data.related.sameHost, { ...event, offsetSeconds: 0 }].sort((a, b) => a.offsetSeconds - b.offsetSeconds)} showOffset /></div>
            </Small>
            <div className="space-y-5">
              <Small title={`Gleiche Regel, 24 h: ${formatCount(context.data.related.sameRule.total)}×`}>
                <div className="flex flex-wrap gap-1.5">
                  {context.data.related.sameRule.hosts.map((entry) => (
                    <span key={entry.name} className={cn('rounded-full border px-2 py-0.5 text-[11.5px]', entry.name === event.agent.name ? 'border-accent/40 text-accent' : 'border-line/[0.10]')}>{entry.name} <span className="font-mono text-faint">{formatCount(entry.count)}</span></span>
                  ))}
                </div>
              </Small>
              {event.user && (
                <Small title={`Gleicher Benutzer ${event.user}, 24 h`}>
                  <div className="scroll-thin max-h-48 overflow-y-auto pr-1"><MiniEvents events={context.data.related.sameUser} /></div>
                </Small>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-bad">{(context.error as Error)?.message}</p>
        ))}

      {tab === 'host' &&
        (host.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted"><Loader2 className="size-4 animate-spin" /> Lade Host …</p>
        ) : host.data ? (
          <div className="grid gap-5 md:grid-cols-2">
            <dl>
              <Field label="Host" mono>{host.data.host.name}</Field>
              <Field label="Status">{host.data.host.status === 'active' ? <span className="text-ok">aktiv</span> : host.data.host.status === 'disconnected' ? <span className="text-bad">getrennt</span> : host.data.host.status}</Field>
              <Field label="Agent-ID / IP" mono>{[host.data.host.id, host.data.host.ip].filter(Boolean).join(' · ')}</Field>
              <Field label="System">{[host.data.host.os, host.data.host.osVersion].filter(Boolean).join(' ')}</Field>
              <Field label="Hardware">{host.data.hardware?.cpu?.name ? `${host.data.hardware.cpu.name} · ${host.data.hardware.cpu.cores} Kerne` : undefined}</Field>
              <Field label="Letzter Kontakt" mono>{formatTime(host.data.host.lastKeepAlive, true)}</Field>
              <Field label="Events 24 h">{formatCount(host.data.host.events ?? 0)}{host.data.host.serious ? ` · ${host.data.host.serious} ab Level 7` : ''}</Field>
              <Field label="Schwachstellen">{host.data.host.vulnerabilities ? `${host.data.host.vulnerabilities} (${host.data.host.critical} kritisch)` : undefined}</Field>
              <Field label="Risiko">{host.data.host.risk}/100</Field>
            </dl>
            <div className="space-y-4">
              <Small title="Wichtigste Regeln (24 h)">
                <ul className="space-y-1">{host.data.rules.slice(0, 6).map((rule) => <li key={rule.id} className="flex items-center gap-2 text-[12px]"><LevelPill level={rule.maxLevel} /><span className="truncate">{rule.description}</span><span className="ml-auto font-mono text-faint">{formatCount(rule.count)}</span></li>)}</ul>
              </Small>
              {host.data.ports.length > 0 && (
                <Small title="Offene Ports (Inventar)">
                  <div className="flex flex-wrap gap-1">{host.data.ports.slice(0, 20).map((port) => <span key={`${port.protocol}-${port.port}-${port.address}`} className="rounded-md border border-line/[0.08] px-1.5 py-0.5 font-mono text-[11px]">{port.port}{port.process ? ` ${port.process}` : ''}</span>)}</div>
                </Small>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-bad">{(host.error as Error)?.message}</p>
        ))}

      {tab === 'user' &&
        (user.isLoading ? (
          <p className="flex items-center gap-2 py-6 text-[12.5px] text-muted"><Loader2 className="size-4 animate-spin" /> Lade Benutzer …</p>
        ) : user.data ? (
          <div className="grid gap-5 md:grid-cols-2">
            <dl>
              <Field label="Benutzer" mono>{user.data.user}</Field>
              <Field label="Events 24 h">{formatCount(user.data.total)}</Field>
              <Field label="Anmeldungen ok">{formatCount(user.data.success)}</Field>
              <Field label="Fehlanmeldungen">{user.data.failed ? <span className="text-bad">{formatCount(user.data.failed)}</span> : '0'}</Field>
              <Field label="Erstes / letztes" mono>{`${formatTime(user.data.first)} – ${formatTime(user.data.last)}`}</Field>
            </dl>
            <div className="space-y-4">
              <Small title="Hosts">
                <div className="flex flex-wrap gap-1.5">{user.data.hosts.map((entry) => <span key={entry.name} className="rounded-full border border-line/[0.10] px-2 py-0.5 text-[11.5px]">{entry.name} <span className="font-mono text-faint">{formatCount(entry.count)}</span></span>)}</div>
              </Small>
              {user.data.sources.length > 0 && (
                <Small title="Quell-IPs">
                  <div className="flex flex-wrap gap-1.5">{user.data.sources.map((entry) => <span key={entry.ip} className="rounded-full border border-line/[0.10] px-2 py-0.5 font-mono text-[11px]">{entry.ip} <span className="text-faint">{formatCount(entry.count)}</span></span>)}</div>
                </Small>
              )}
            </div>
          </div>
        ) : (
          <p className="text-[12.5px] text-bad">{(user.error as Error)?.message}</p>
        ))}

      {tab === 'raw' && (
        <div>
          {raw && (
            <button type="button" onClick={() => void navigator.clipboard.writeText(raw).then(() => toast.success('JSON kopiert'))} className="mb-2 flex h-7 items-center gap-1.5 rounded-full border border-line/[0.12] px-2.5 text-[11.5px] hover:bg-raised">
              <Copy className="size-3" /> Kopieren
            </button>
          )}
          <pre className="scroll-thin max-h-[420px] overflow-auto rounded-xl bg-canvas p-3 font-mono text-[11px] leading-[17px] text-ink/85">{context.isLoading ? 'Lädt …' : raw}</pre>
        </div>
      )}
    </div>
  );
}
