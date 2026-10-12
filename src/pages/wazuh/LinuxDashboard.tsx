import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, FileSearch, FolderSearch, KeyRound, Monitor, RefreshCw, ShieldAlert, Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber, AreaLine, Orb, PillBars, Ring, Trend } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { EventTable } from '@/components/soc/EventTable';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { useSocLinux } from '@/hooks/use-soc';
import { RANGES, eventKey } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import type { SocEvent } from '@/services/soc';

const EASE = [0.22, 1, 0.36, 1] as const;

const CATEGORY: Record<string, { label: string; color: string }> = {
  authentication: { label: 'Anmeldung', color: 'rgb(var(--accent))' },
  privilege: { label: 'sudo / su', color: 'rgb(var(--bad))' },
  fim: { label: 'Dateiintegrität', color: 'rgb(var(--warn))' },
  service: { label: 'Dienste', color: 'rgb(var(--ok))' },
  kernel: { label: 'Kernel', color: 'rgb(var(--muted))' },
  package: { label: 'Pakete', color: 'rgb(var(--accent) / 0.55)' },
  network: { label: 'Netzwerk', color: 'rgb(var(--ok) / 0.55)' },
  other: { label: 'Sonstiges', color: 'rgb(var(--line) / 0.25)' },
};

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      {tone === 'ok' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok/40 [animation-duration:2.4s]" />}
      <span className={cn('relative size-2 rounded-full', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone])} />
    </span>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[12px] text-muted">{label}</p>
      <p className="mt-1 text-[18px] font-semibold tabular">{value}</p>
    </div>
  );
}

/** Label, animated bar and value in one row */
function BarRow({ label, value, max, delay = 0, mono, color, onClick }: { label: ReactNode; value: number; max: number; delay?: number; mono?: boolean; color?: string; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-colors', onClick && 'hover:bg-hover/60')}>
      <span className={cn('w-[42%] min-w-0 truncate text-[12.5px]', mono && 'font-mono text-[11.5px]')}>{label}</span>
      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-line/[0.07]">
        <motion.span
          className="block h-full rounded-full"
          style={{ background: color ?? 'linear-gradient(90deg, rgb(var(--accent) / 0.6), rgb(var(--accent)))' }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.max(3, (value / Math.max(1, max)) * 100)}%` }}
          transition={{ duration: 1, delay: 0.35 + delay, ease: EASE }}
        />
      </span>
      <span className="w-12 text-right font-mono text-[11.5px] tabular text-ink/80">{formatCount(value)}</span>
    </Tag>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 items-center justify-center py-6 text-center text-[13px] text-muted">{children}</div>;
}

/** Merge the timeline into about `count` bars */
function compress<T extends { time: number }>(buckets: T[], count: number, pick: (bucket: T) => number) {
  if (!buckets.length) return [];
  const size = Math.max(1, Math.ceil(buckets.length / count));
  const result: Array<{ time: number; value: number }> = [];
  for (let index = 0; index < buckets.length; index += size) {
    const slice = buckets.slice(index, index + size);
    result.push({ time: slice[0].time, value: slice.reduce((sum, bucket) => sum + pick(bucket), 0) });
  }
  return result;
}

export function LinuxDashboard() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [hours, setHours] = useState(24);
  const [category, setCategory] = useState<string | undefined>(undefined);
  const [loginChoice, setLoginView] = useState<'failed' | 'success' | null>(null);
  const linux = useSocLinux(hours, category);
  const [open, setOpen] = useState<SocEvent | null>(null);
  const d = linux.data;
  // show failed logins first, unless there are none
  const loginView = loginChoice ?? (d && !d.failedLogins?.total ? 'success' : 'failed');
  const investigate = (q: string) => navigate(`/wazuh/investigation?q=${encodeURIComponent(q)}${hours !== 24 ? `&hours=${hours}` : ''}`);

  const rangeLabel = RANGES.find((range) => range.hours === hours)?.label ?? `${hours} h`;
  const timeline = useMemo(() => d?.timeline ?? [], [d]);
  const totals = timeline.map((bucket) => bucket.total);
  const average = totals.length ? totals.reduce((sum, value) => sum + value, 0) / totals.length : null;
  const latest = totals.length > 1 ? totals[totals.length - 2] : null; // last complete bucket
  const failedBars = useMemo(() => compress(timeline, 12, (bucket) => bucket.failed), [timeline]);
  const failedPeak = Math.max(0, ...failedBars.map((bar) => bar.value));
  const timeFormat = (time: number) => new Date(time * 1000).toLocaleString('de-DE', hours > 24 ? { day: '2-digit', month: '2-digit' } : { hour: '2-digit', minute: '2-digit' });
  const maxHost = Math.max(1, ...(d?.hosts ?? []).map((host) => host.count));
  const maxProgram = Math.max(1, ...(d?.programs ?? []).map((program) => program.count));
  const categoryTotal = Object.values(d?.categories ?? {}).reduce((sum, value) => sum + value, 0);
  const osTotal = (d?.os ?? []).reduce((sum, entry) => sum + entry.count, 0);
  const loginList = loginView === 'failed'
    ? { sources: d?.failedLogins?.sources ?? [], users: d?.failedLogins?.users ?? [] }
    : { sources: d?.successLogins?.sources ?? [], users: d?.successLogins?.users ?? [] };
  const loginMax = Math.max(1, ...loginList.sources.map((entry) => entry.count), ...loginList.users.map((entry) => entry.count));

  return (
    <>
      <PageHeader
        section="Explore"
        title="Linux"
        description="SSH-Anmeldungen, sudo, Dienste, Dateiintegrität und Pakete auf allen Linux-Agents"
        actions={
          <>
            <div className="flex rounded-full border border-line/[0.12] p-1">
              {RANGES.map((range) => (
                <button key={range.hours} type="button" onClick={() => setHours(range.hours)} className={cn('relative h-8 rounded-full px-3.5 text-[13px] transition-colors', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                  {hours === range.hours && <motion.span layoutId="linux-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                  <span className="relative">{range.label}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => queryClient.invalidateQueries({ queryKey: ['infra', 'soc', 'linux'] })} className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] transition-all hover:border-accent/35 hover:bg-raised active:scale-[0.97]">
              <RefreshCw className={cn('size-4', linux.isFetching && 'animate-spin')} /> Aktualisieren
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-6 2xl:grid-cols-12">
        {/* fleet */}
        <NotchCard
          index={0}
          glow
          className="min-h-[300px] lg:col-span-6 2xl:col-span-6"
          eyebrow="Wazuh-Agents"
          title="Linux-Flotte"
          actions={[
            { label: 'Alle Hosts', icon: <Monitor />, onClick: () => navigate('/wazuh/hosts') },
            { label: 'In Investigation öffnen', icon: <ArrowUpRight />, onClick: () => navigate('/wazuh/investigation') },
          ]}
        >
          {!d ? (
            <Empty>{linux.isError ? (linux.error as Error).message : 'Lädt Linux-Agents …'}</Empty>
          ) : (
            <div className="flex flex-1 items-center gap-6">
              <div className="min-w-0 flex-1">
                <div className="mt-4 flex flex-wrap items-end gap-x-10 gap-y-4">
                  <div>
                    <AnimatedNumber value={d.agents.length} className="block text-[64px] font-bold leading-none tracking-[-0.04em]" />
                    <p className="mt-2 text-[13px] text-muted">Linux-Systeme</p>
                  </div>
                  <div className="flex gap-7 pb-6">
                    <Stat label="Online" value={<span className="text-ok">{d.status ? <AnimatedNumber value={d.status.active} /> : '–'}</span>} />
                    <Stat label="Getrennt" value={<span className={d.status?.disconnected ? 'text-bad' : undefined}>{d.status ? <AnimatedNumber value={d.status.disconnected} /> : '–'}</span>} />
                    <Stat label={`Events ${rangeLabel}`} value={<AnimatedNumber value={d.total} />} />
                    <Stat label="Aktiv" value={<AnimatedNumber value={d.hosts.length} />} />
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-2.5 text-[13px]">
                  <StatusDot tone={d.status?.disconnected ? 'warn' : 'ok'} />
                  <span className="text-muted">{d.status?.disconnected ? `${d.status.disconnected} Agent(s) ohne Verbindung zum Manager` : 'Alle Linux-Agents verbunden'}</span>
                </div>
                <ul className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-3">
                  {d.os.map((entry, index) => (
                    <li key={entry.name} className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-mono text-[12px] text-ink/90"><TerminalIcon className="size-3 text-muted" />{entry.name}</p>
                      <div className="mt-1.5 flex items-center gap-2 text-[10.5px] text-faint">
                        <div className="h-1 flex-1 overflow-hidden rounded-full bg-line/[0.07]">
                          <motion.div className="h-full rounded-full bg-gradient-to-r from-accent/60 to-accent" initial={{ width: 0 }} animate={{ width: `${(entry.count / Math.max(1, osTotal)) * 100}%` }} transition={{ duration: 1, delay: 0.4 + index * 0.08, ease: EASE }} />
                        </div>
                        <span className="w-6 text-right font-mono tabular text-ink/75">{entry.count}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
              <Orb size={170} className="hidden xl:block" />
            </div>
          )}
        </NotchCard>

        {/* failed logins */}
        <NotchCard
          index={1}
          tone={d?.failedLogins?.total ? 'warn' : undefined}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-3"
          eyebrow={`SSH / PAM · ${rangeLabel}`}
          title="Fehlanmeldungen"
          actions={[{ label: 'Fehlanmeldungen untersuchen', icon: <KeyRound />, onClick: () => investigate('group:authentication_failed') }]}
        >
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]">
            <span className={d?.failedLogins?.total ? 'text-accent' : 'text-ok'}><AnimatedNumber value={d ? d.failedLogins?.total ?? 0 : null} /></span>
          </p>
          <p className="mt-3 text-[13px] text-muted">
            {d?.failedLogins?.sources.length ?? 0} Quellen · {d?.failedLogins?.users.length ?? 0} Konten · <span className="text-ok">{formatCount(d?.successLogins?.total ?? 0)} erfolgreich</span>
          </p>
          <div className="mt-auto pt-5">
            {failedBars.length ? (
              <PillBars height={74} bars={failedBars.map((bar) => ({ label: timeFormat(bar.time), value: bar.value, highlight: failedPeak > 0 && bar.value === failedPeak, title: `${bar.value} Fehlanmeldungen ab ${timeFormat(bar.time)}` }))} />
            ) : <Shimmer className="h-[74px] w-full" />}
          </div>
        </NotchCard>

        {/* sudo */}
        <NotchCard
          index={2}
          className="min-h-[300px] lg:col-span-3 2xl:col-span-3"
          eyebrow="Rechteausweitung"
          title="sudo / su"
          actions={[{ label: 'sudo-Events untersuchen', icon: <ShieldAlert />, onClick: () => investigate('group:sudo') }]}
        >
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={d ? d.sudo?.total ?? 0 : null} /></p>
          <p className="mt-3 text-[13px] text-muted">{d?.sudo?.users.length ?? 0} Benutzer nutzen sudo</p>
          <div className="mt-auto space-y-0.5 pt-4">
            {(d?.sudo?.users ?? []).slice(0, 3).map((user, index) => (
              <BarRow key={user.name} label={user.name} value={user.count} max={d?.sudo?.users[0]?.count ?? 1} delay={index * 0.06} mono onClick={() => investigate(`group:sudo user:"${user.name}"`)} />
            ))}
            {d?.sudo?.commands[0] && (
              <p className="truncate px-2 pt-1.5 font-mono text-[11px] text-faint" title={d.sudo.commands[0].name}>häufigster Befehl: {d.sudo.commands[0].name}</p>
            )}
          </div>
        </NotchCard>

        {/* events over time */}
        <NotchCard index={3} className="min-h-[250px] lg:col-span-3 2xl:col-span-3" eyebrow={`Verlauf · ${rangeLabel}`} title="Ereignisse" actions={[{ label: 'Statistik öffnen', icon: <ArrowUpRight />, onClick: () => navigate('/wazuh/analytics') }]}>
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={d ? d.total : null} /></p>
          <p className="mt-3 flex items-center gap-1.5 text-[13px] text-muted">
            <Trend value={latest !== null && average ? ((latest - average) / average) * 100 : null} suffix=" %" goodWhenUp={false} />
            letzter Abschnitt ggü. Ø
          </p>
          <AreaLine values={totals} height={70} className="mt-auto pt-4" />
        </NotchCard>

        {/* agents online */}
        <NotchCard index={4} className="min-h-[250px] lg:col-span-3 2xl:col-span-3" eyebrow="Manager-API" title="Agents online" actions={[{ label: 'Hosts öffnen', icon: <Monitor />, onClick: () => navigate('/wazuh/hosts') }]}>
          {d?.status ? (
            <div className="flex flex-1 items-center gap-6 pt-3">
              <Ring value={(d.status.active / Math.max(1, d.status.total)) * 100}>
                <span className="text-[26px] font-bold tabular">{Math.round((d.status.active / Math.max(1, d.status.total)) * 100)}%</span>
              </Ring>
              <div>
                <p className="text-[34px] font-bold leading-none tabular"><AnimatedNumber value={d.status.active} /></p>
                <p className="mt-1.5 text-[13px] text-muted">von {d.status.total} verbunden</p>
              </div>
            </div>
          ) : <Empty>{d ? 'Manager-API nicht verbunden.' : 'Lädt …'}</Empty>}
        </NotchCard>

        {/* file integrity */}
        <NotchCard index={5} className="min-h-[250px] lg:col-span-3 2xl:col-span-3" eyebrow="syscheck" title="Dateiintegrität" actions={[{ label: 'FIM-Events untersuchen', icon: <FolderSearch />, onClick: () => investigate('group:syscheck') }]}>
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={d ? d.fim?.total ?? 0 : null} /></p>
          <p className="mt-3 text-[13px] text-muted">Änderungen auf {d?.fim?.hosts ?? 0} Hosts</p>
          <ul className="mt-auto space-y-1 pt-3">
            {(d?.fim?.paths ?? []).slice(0, 3).map((path, index) => (
              <motion.li key={path.path} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + index * 0.06 }} className="flex items-center gap-2 truncate font-mono text-[11px] text-muted" title={path.path}>
                <span className="size-1.5 shrink-0 rounded-full bg-warn" /> <span className="truncate">{path.path}</span>
              </motion.li>
            ))}
          </ul>
        </NotchCard>

        {/* categories */}
        <NotchCard index={6} className="min-h-[250px] lg:col-span-3 2xl:col-span-3" eyebrow="Klick filtert die Events" title="Kategorien">
          {d ? (
            <>
              <div className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-line/[0.07]">
                {Object.entries(CATEGORY).map(([key, meta]) => (
                  <motion.span key={key} style={{ background: meta.color }} initial={{ width: 0 }} animate={{ width: `${((d.categories[key] ?? 0) / Math.max(1, categoryTotal)) * 100}%` }} transition={{ duration: 1, delay: 0.3, ease: EASE }} title={`${meta.label}: ${d.categories[key] ?? 0}`} />
                ))}
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-0.5">
                {Object.entries(CATEGORY).map(([key, meta]) => (
                  <li key={key}>
                    <button type="button" disabled={key === 'other'} onClick={() => setCategory(category === key ? undefined : key)} className={cn('flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-hover/60 disabled:hover:bg-transparent', category === key && 'bg-accent/[0.12]')}>
                      <span className="size-2 shrink-0 rounded-full" style={{ background: meta.color }} />
                      <span className="truncate text-muted">{meta.label}</span>
                      <span className="ml-auto font-mono text-[11px]">{formatCount(d.categories[key] ?? 0)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : <Shimmer className="mt-4 h-24 w-full" />}
        </NotchCard>

        {/* hosts */}
        <NotchCard
          index={7}
          className="min-h-[340px] lg:col-span-6 2xl:col-span-6"
          eyebrow={`${d?.hosts.length ?? 0} Hosts mit Events`}
          title="Linux-Hosts"
          actions={[{ label: 'Alle Hosts', icon: <ArrowUpRight />, onClick: () => navigate('/wazuh/hosts') }]}
        >
          <ul className="scroll-thin mt-3 max-h-[380px] space-y-1 overflow-y-auto pr-1">
            {(d?.hosts ?? []).map((host, index) => (
              <motion.li key={host.name} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + Math.min(index, 12) * 0.04 }}>
                <button type="button" onClick={() => investigate(`host:"${host.name}"`)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover/60">
                  <StatusDot tone={host.maxLevel >= 10 ? 'bad' : host.maxLevel >= 7 ? 'warn' : 'ok'} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-medium">{host.name}</p>
                    <div className="mt-1 flex h-1 overflow-hidden rounded-full bg-line/[0.07]">
                      {Object.entries(CATEGORY).filter(([key]) => key !== 'other').map(([key, meta]) => (
                        <motion.span key={key} style={{ background: meta.color }} initial={{ width: 0 }} animate={{ width: `${((host.categories[key] ?? 0) / maxHost) * 100}%` }} transition={{ duration: 1, delay: 0.4 + Math.min(index, 12) * 0.04, ease: EASE }} />
                      ))}
                    </div>
                  </div>
                  <span className="w-14 text-right font-mono text-[11.5px] tabular text-ink/80">{formatCount(host.count)}</span>
                  <LevelPill level={host.maxLevel} />
                </button>
              </motion.li>
            ))}
            {!d && Array.from({ length: 6 }, (_, index) => <li key={index}><Shimmer className="h-11" /></li>)}
          </ul>
          <p className="mt-2 text-[11px] text-faint">Farbiger Balken = Anteil der Kategorien (siehe „Kategorien“). Punkt = höchstes Level.</p>
        </NotchCard>

        {/* login sources */}
        <NotchCard index={8} className="min-h-[340px] lg:col-span-3 2xl:col-span-3" eyebrow="Wer meldet sich an?" title="Anmelde-Quellen">
          <div className="mt-3 flex rounded-full border border-line/[0.10] p-0.5 text-[12px]">
            {([['failed', 'Fehlgeschlagen'], ['success', 'Erfolgreich']] as const).map(([key, label]) => (
              <button key={key} type="button" onClick={() => setLoginView(key)} className={cn('relative h-7 flex-1 rounded-full', loginView === key ? 'text-ink' : 'text-muted hover:text-ink')}>
                {loginView === key && <motion.span layoutId="login-view" className="absolute inset-0 rounded-full bg-accent/[0.12]" />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={loginView} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mt-3 space-y-3">
              <div>
                <p className="mb-1 px-2 text-[11px] uppercase tracking-[0.08em] text-faint">Quell-IPs</p>
                {loginList.sources.length ? loginList.sources.slice(0, 5).map((source, index) => (
                  <BarRow key={source.ip} label={source.ip} value={source.count} max={loginMax} delay={index * 0.05} mono color={loginView === 'failed' ? 'rgb(var(--bad) / 0.8)' : undefined} onClick={() => navigate(`/wazuh/ioc?value=${encodeURIComponent(source.ip)}`)} />
                )) : <p className="px-2 text-[12.5px] text-ok">Keine.</p>}
              </div>
              <div>
                <p className="mb-1 px-2 text-[11px] uppercase tracking-[0.08em] text-faint">Konten</p>
                {loginList.users.length ? loginList.users.slice(0, 5).map((user, index) => (
                  <BarRow key={user.name} label={user.name} value={user.count} max={loginMax} delay={0.2 + index * 0.05} mono color={loginView === 'failed' ? 'rgb(var(--bad) / 0.8)' : undefined} onClick={() => investigate(`user:"${user.name}"`)} />
                )) : <p className="px-2 text-[12.5px] text-ok">Keine.</p>}
              </div>
            </motion.div>
          </AnimatePresence>
        </NotchCard>

        {/* programs */}
        <NotchCard index={9} className="min-h-[340px] lg:col-span-3 2xl:col-span-3" eyebrow="Wer erzeugt die Logs?" title="Aktivste Programme" actions={[{ label: 'Investigation', icon: <FileSearch />, onClick: () => navigate('/wazuh/investigation') }]}>
          <div className="mt-4 flex flex-wrap content-start gap-2">
            {(d?.programs ?? []).map((program, index) => {
              const weight = program.count / maxProgram;
              return (
                <motion.button
                  key={program.name}
                  type="button"
                  onClick={() => investigate(`process:"${program.name}"`)}
                  initial={{ opacity: 0, scale: 0.8 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.3 + index * 0.04, type: 'spring', stiffness: 260, damping: 20 }}
                  whileHover={{ y: -2 }}
                  className="rounded-full border px-3 py-1 font-mono transition-colors hover:border-accent/50"
                  style={{ fontSize: 11 + weight * 5, borderColor: `rgb(var(--accent) / ${0.12 + weight * 0.4})`, background: `rgb(var(--accent) / ${weight * 0.14})` }}
                >
                  {program.name} <span className="text-[10.5px] text-faint">{formatCount(program.count)}</span>
                </motion.button>
              );
            })}
            {!d && <Shimmer className="h-32 w-full" />}
          </div>
        </NotchCard>

        {/* events */}
        <NotchCard index={10} className="lg:col-span-6 2xl:col-span-12" eyebrow={category ? `gefiltert: ${CATEGORY[category]?.label}` : 'alle Kategorien'} title="Neueste Linux-Events">
          <div className="mb-3 mt-3 flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setCategory(undefined)} className={cn('rounded-full border px-3 py-1 text-[12px] transition-colors', !category ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>Alle</button>
            {Object.entries(CATEGORY).filter(([key]) => key !== 'other').map(([key, meta]) => (
              <button key={key} type="button" onClick={() => setCategory(category === key ? undefined : key)} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px] transition-colors', category === key ? 'border-accent/40 bg-accent/[0.10]' : 'border-line/[0.10] text-muted hover:text-ink')}>
                <span className="size-1.5 rounded-full" style={{ background: meta.color }} /> {meta.label}
              </button>
            ))}
          </div>
          {d ? <EventTable events={d.events} selected={open ? eventKey(open) : null} onSelect={setOpen} showDate={hours > 24} maxHeight={480} /> : <Shimmer className="h-64 w-full" />}
        </NotchCard>
      </div>

      <EventDrawer event={open} onClose={() => setOpen(null)} />
    </>
  );
}
