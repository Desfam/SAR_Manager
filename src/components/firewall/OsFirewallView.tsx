import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight, KeyRound, Loader2, MonitorPlay, MonitorX, Power, RefreshCw, ShieldCheck, ShieldOff, ShieldQuestion } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useConnections, type Connection } from '@/hooks/use-infrastructure';
import { useRdpLaunch } from '@/hooks/use-rdp';
import { useGuestOsFirewall } from '@/hooks/use-network';
import type { GuestNetwork, GuestOsFirewall, OsChain } from '@/services/network';
import { iptablesInput, isWindowsGuest, nftInputChains, osFirewallVerdict } from '@/lib/os-firewall';

const VERDICT_STYLE = {
  filtering: { box: 'border-ok/35 bg-ok/[0.07]', icon: <ShieldCheck className="size-4 text-ok" /> },
  open: { box: 'border-accent/35 bg-accent/[0.07]', icon: <ShieldOff className="size-4 text-accent" /> },
  unknown: { box: 'border-line/[0.12] bg-raised/40', icon: <ShieldQuestion className="size-4 text-muted" /> },
};

function Notice({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center rounded-2xl border border-dashed border-line/[0.12] px-6 py-12 text-center">
      <span className="mb-3 flex size-10 items-center justify-center rounded-full bg-raised text-muted [&>svg]:size-5">{icon}</span>
      <p className="text-[14px] font-medium">{title}</p>
      {children && <div className="mt-1.5 max-w-md text-[12.5px] text-muted">{children}</div>}
    </div>
  );
}

function policyClass(policy?: string) {
  if (!policy) return 'text-muted';
  return /^(drop|reject|deny)$/i.test(policy) ? 'text-bad' : 'text-ok';
}

/** Tool status chip: installed/running/not present */
function ToolChip({ name, installed, state, highlight }: { name: string; installed: boolean; state?: string; highlight?: boolean }) {
  const running = state === 'active' || state === 'running';
  return (
    <span className={cn('flex items-center gap-2 rounded-xl border px-3 py-2', highlight ? 'border-accent/40 bg-accent/[0.08]' : 'border-line/[0.08]', !installed && 'opacity-45')}>
      <span className={cn('size-1.5 rounded-full', !installed ? 'bg-faint' : running ? 'bg-ok' : 'bg-muted')} />
      <span className="text-[12.5px] font-medium">{name}</span>
      <span className="text-[11px] text-muted">{!installed ? 'nicht installiert' : running ? 'läuft' : state === 'inactive' ? 'inaktiv' : (state ?? 'installiert')}</span>
    </span>
  );
}

function ChainBlock({ chain, title, defaultOpen }: { chain: OsChain; title?: string; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen && chain.rules.length > 0);
  return (
    <div className="rounded-xl border border-line/[0.07]">
      <button type="button" onClick={() => setOpen(!open)} disabled={!chain.rules.length} className="flex w-full items-center gap-2.5 px-3 py-2 text-left">
        <ChevronRight className={cn('size-3.5 text-faint transition-transform', open && 'rotate-90', !chain.rules.length && 'opacity-0')} />
        <span className="font-mono text-[12.5px]">{title ?? chain.name}</span>
        {chain.hook && <span className="rounded-full border border-line/[0.1] px-1.5 py-px text-[10.5px] text-muted">{chain.type} · {chain.hook}</span>}
        <span className="ml-auto text-[11.5px] text-muted">{chain.rules.length} Regeln</span>
        {chain.policy && <span className={cn('w-16 text-right font-mono text-[11.5px]', policyClass(chain.policy))}>{chain.policy}</span>}
      </button>
      {open && (
        <ol className="space-y-0.5 border-t border-line/[0.06] px-3 py-2">
          {chain.rules.map((rule, index) => (
            <li key={index} className="flex gap-2 font-mono text-[11.5px] leading-5">
              <span className="w-5 shrink-0 text-right text-faint">{index + 1}</span>
              <span className={cn('min-w-0 break-all', /\b(drop|reject|DROP|REJECT)\b/.test(rule) ? 'text-bad' : /\b(accept|ACCEPT)\b/.test(rule) ? 'text-ok/90' : 'text-ink/85')}>{rule}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-line/[0.07] bg-raised/25 p-4">
      <p className="mb-3 text-[13px] font-medium">
        {title} {hint && <span className="font-normal text-muted">· {hint}</span>}
      </p>
      {children}
    </div>
  );
}

function RawOutput({ report }: { report: GuestOsFirewall }) {
  const entries = Object.entries(report.raw).filter(([, text]) => text.trim());
  const [tab, setTab] = useState(entries[0]?.[0]);
  if (!entries.length) return null;
  return (
    <details className="rounded-2xl border border-line/[0.07] px-4 py-3">
      <summary className="cursor-pointer text-[12.5px] text-muted">Rohausgabe der Befehle</summary>
      <div className="mt-3 flex gap-1.5">
        {entries.map(([key]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={cn('rounded-full border px-3 py-1 font-mono text-[11.5px]', tab === key ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
            {key}
          </button>
        ))}
      </div>
      <pre className="scroll-thin mt-2 max-h-96 overflow-auto rounded-xl bg-canvas p-3 font-mono text-[11.5px] leading-5 text-ink/85">{report.raw[tab ?? ''] ?? ''}</pre>
    </details>
  );
}

function Report({ report }: { report: GuestOsFirewall }) {
  const verdict = osFirewallVerdict(report);
  const style = VERDICT_STYLE[verdict.state];
  const nftInput = nftInputChains(report);
  const input = iptablesInput(report);
  const [showAll, setShowAll] = useState(false);

  return (
    <div className="space-y-4">
      <div className={cn('flex items-start gap-3 rounded-2xl border p-4 text-[13px]', style.box)}>
        <span className="mt-0.5">{style.icon}</span>
        <div>
          <p className="font-medium">{verdict.title}</p>
          <p className="mt-1 text-muted">{verdict.detail}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <ToolChip name="ufw" installed={!!report.ufw} state={report.ufw?.status === 'unknown' ? report.services.ufw : report.ufw?.status} highlight={verdict.tool === 'ufw'} />
        <ToolChip name="firewalld" installed={!!report.firewalld} state={report.firewalld?.state} highlight={verdict.tool === 'firewalld'} />
        <ToolChip name="nftables" installed={!!report.nftables} state={report.services.nftables} highlight={verdict.tool === 'nftables'} />
        <ToolChip name="iptables" installed={!!report.iptables} state={report.iptables?.tables.length ? `${report.iptables.tables.length} Tabellen` : report.services.iptables} highlight={verdict.tool === 'iptables'} />
      </div>

      {report.ufw && report.ufw.status !== 'unknown' && (
        <Section title="ufw" hint={report.ufw.status === 'active' ? 'aktiv' : 'inaktiv'}>
          {report.ufw.defaults && (
            <div className="mb-3 grid grid-cols-3 gap-2 text-[12px]">
              {(['incoming', 'outgoing', 'routed'] as const).map((key) => (
                <div key={key} className="rounded-xl border border-line/[0.07] px-3 py-2">
                  <p className="text-[11px] text-muted">{{ incoming: 'Eingehend', outgoing: 'Ausgehend', routed: 'Weitergeleitet' }[key]}</p>
                  <p className={cn('font-mono', policyClass(report.ufw?.defaults?.[key]))}>{report.ufw?.defaults?.[key] ?? '–'}</p>
                </div>
              ))}
            </div>
          )}
          {report.ufw.rules.length ? (
            <ul className="space-y-1">
              {report.ufw.rules.map((rule, index) => (
                <li key={index} className="grid grid-cols-[minmax(0,1fr)_110px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-line/[0.06] px-3 py-1.5 font-mono text-[12px]">
                  <span className="truncate">{rule.to}</span>
                  <span className={cn('text-center', /DENY|REJECT/.test(rule.action) ? 'text-bad' : /LIMIT/.test(rule.action) ? 'text-accent' : 'text-ok')}>{rule.action}</span>
                  <span className="truncate text-muted">{rule.from}{rule.comment && <span className="font-sans"> · {rule.comment}</span>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12.5px] text-muted">{report.ufw.status === 'active' ? 'Keine Regeln, es gilt der Standard.' : 'ufw ist installiert, aber ausgeschaltet.'}</p>
          )}
        </Section>
      )}

      {report.firewalld && report.firewalld.state === 'running' && (
        <Section title="firewalld" hint={`${report.firewalld.zones.length} aktive Zonen`}>
          <div className="grid gap-2 lg:grid-cols-2">
            {report.firewalld.zones.map((zone) => (
              <div key={zone.name} className="rounded-xl border border-line/[0.07] p-3 text-[12px]">
                <p className="mb-1.5 flex items-center gap-2 font-medium">{zone.name} <span className="font-mono text-[11px] font-normal text-muted">{zone.target}</span></p>
                {[
                  ['Schnittstellen', zone.interfaces],
                  ['Quellen', zone.sources],
                  ['Dienste', zone.services],
                  ['Ports', zone.ports],
                  ['Rich Rules', zone.richRules],
                ].map(([label, values]) => (
                  <p key={label as string} className="flex gap-2"><span className="w-24 shrink-0 text-muted">{label as string}</span><span className="min-w-0 break-words font-mono">{(values as string[]).join(' ') || '–'}</span></p>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      {report.nftables && report.nftables.tables.length > 0 && (
        <Section title="nftables" hint={`${report.nftables.tables.length} Tabellen`}>
          <div className="space-y-1.5">
            {nftInput.map((chain) => {
              const table = report.nftables!.tables.find((entry) => entry.chains.includes(chain));
              return <ChainBlock key={`${table?.family}-${table?.name}-${chain.name}`} chain={chain} title={`${table?.family} ${table?.name} · ${chain.name}`} defaultOpen />;
            })}
            {showAll &&
              report.nftables.tables.flatMap((table) =>
                table.chains.filter((chain) => !nftInput.includes(chain)).map((chain) => <ChainBlock key={`${table.family}-${table.name}-${chain.name}`} chain={chain} title={`${table.family} ${table.name} · ${chain.name}`} />),
              )}
          </div>
        </Section>
      )}

      {report.iptables && report.iptables.tables.length > 0 && (
        <Section title="iptables" hint={report.nftables?.tables.length ? 'zeigt über iptables-nft meist dieselben Regeln wie nftables' : undefined}>
          <div className="space-y-1.5">
            {(report.iptables.tables.find((table) => table.name === 'filter')?.chains ?? [])
              .filter((chain) => ['INPUT', 'FORWARD', 'OUTPUT'].includes(chain.name))
              .map((chain) => <ChainBlock key={chain.name} chain={chain} title={`filter · ${chain.name}`} defaultOpen={chain === input} />)}
            {showAll &&
              report.iptables.tables.flatMap((table) =>
                table.chains
                  .filter((chain) => !(table.name === 'filter' && ['INPUT', 'FORWARD', 'OUTPUT'].includes(chain.name)))
                  .map((chain) => <ChainBlock key={`${table.name}-${chain.name}`} chain={chain} title={`${table.name} · ${chain.name}`} />),
              )}
          </div>
        </Section>
      )}

      {(report.nftables?.tables.length || report.iptables?.tables.length) ? (
        <button type="button" onClick={() => setShowAll(!showAll)} className="text-[12.5px] text-muted underline-offset-4 hover:text-ink hover:underline">
          {showAll ? 'Nur Eingangs-Ketten zeigen' : 'Alle Ketten zeigen (NAT, Docker, Forward …)'}
        </button>
      ) : null}

      <RawOutput report={report} />
    </div>
  );
}

export function OsFirewallView({ guest, system }: { guest: GuestNetwork; system?: Connection }) {
  const windows = isWindowsGuest(guest.ostype);
  const running = guest.status === 'running';
  const query = useGuestOsFirewall(running && !windows ? system?.id : undefined);
  const connections = useConnections();
  const rdp = useRdpLaunch();
  const rdpSystem = windows
    ? (connections.data ?? []).find((item) => item.type === 'rdp' && (guest.ips.includes(item.host) || item.name.toLowerCase() === (guest.name ?? '').toLowerCase()))
    : undefined;

  if (windows) {
    return (
      <Notice icon={<MonitorX />} title="Windows-Firewall kann hier nicht gelesen werden">
        Die App liest die Gast-Firewall über SSH mit Linux-Befehlen. Für Windows-Gäste bitte <span className="font-mono">wf.msc</span> über RDP öffnen.
        {rdpSystem && running && (
          <button
            type="button"
            onClick={() => rdp.mutate({ id: rdpSystem.id, name: rdpSystem.name })}
            disabled={rdp.isPending}
            className="mx-auto mt-4 flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13px] font-medium text-accent-ink disabled:opacity-60"
          >
            {rdp.isPending ? <Loader2 className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />} Per RDP verbinden
          </button>
        )}
      </Notice>
    );
  }
  if (!running) return <Notice icon={<Power />} title="Gast läuft nicht">Die Firewall im Gast lässt sich nur lesen, solange er läuft.</Notice>;
  if (!system) {
    return (
      <Notice icon={<KeyRound />} title="Kein SSH-Zugang zu diesem Gast">
        Die Regeln im Gast werden per SSH gelesen.{' '}
        <Link to="/systems" className="text-accent underline-offset-4 hover:underline">Zugang unter Systeme einrichten</Link>
      </Notice>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-[12px] text-muted">
        <span>
          Gelesen über <span className="text-ink">{system.name}</span>
          {query.data && <> als <span className="font-mono text-ink">{query.data.user}</span>{query.data.privilege === 'sudo -n' && ' (sudo)'} · {query.data.os}</>}
        </span>
        <button
          type="button"
          onClick={() => query.refetch()}
          disabled={query.isFetching}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line/[0.10] px-3 text-[12px] text-ink transition-colors hover:bg-raised disabled:opacity-60"
        >
          <RefreshCw className={cn('size-3.5', query.isFetching && 'animate-spin')} /> Neu lesen
        </button>
      </div>
      {query.isLoading ? (
        <p className="flex items-center justify-center py-14 text-[13px] text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lese Firewall im Gast …</p>
      ) : query.isError ? (
        <div className="rounded-2xl border border-bad/35 bg-bad/[0.07] p-4 text-[13px]">
          <p className="font-medium">SSH-Abfrage fehlgeschlagen</p>
          <p className="mt-1 text-muted">{(query.error as Error).message}</p>
        </div>
      ) : query.data ? (
        <Report report={query.data} />
      ) : null}
    </div>
  );
}
