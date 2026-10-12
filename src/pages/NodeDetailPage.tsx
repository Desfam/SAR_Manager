import { useMemo, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MotionConfig, motion } from 'motion/react';
import { ArrowLeft, ChevronRight, Container, Cpu, HardDrive, Layers, ListFilter, Monitor, Network, Package, ShieldHalf } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { TimeChart } from '@/components/ui/TimeChart';
import { Segmented, TimeframeSwitch } from '@/components/proxmox/shared';
import { GuestDrawer } from '@/components/proxmox/GuestDrawer';
import { guestKey, usePowerControl } from '@/components/proxmox/power';
import { Beacon, FillBar, Gauge, LiveSpark, Shimmer, SplitBar, Stagger } from '@/components/systems/fx';
import { staggerChild, useLiveSeries } from '@/lib/fx';
import { useConnections, useProxmoxSummary } from '@/hooks/use-infrastructure';
import { useGuestNetworks } from '@/hooks/use-network';
import { useClusterStatus, useNodeRrd, useNodeStatus, useNodeUpdates, useStorage } from '@/hooks/use-proxmox';
import type { Timeframe } from '@/services/proxmox';
import { formatBytes, proxmoxStats, type ProxmoxGuest } from '@/lib/proxmox';
import { formatRate } from '@/lib/format';
import { formatUptime } from '@/lib/usage';

const EASE = [0.22, 1, 0.36, 1] as const;
const percent = (value: number) => `${Math.round(value)} %`;
type ChartKind = 'cpu' | 'mem' | 'load' | 'net';

function Hero({ children }: { children: ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="panel-surface relative mb-5 overflow-hidden rounded-[26px] px-6 pb-5 pt-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[26px]" aria-hidden="true">
        <motion.div className="absolute -left-20 -top-24 size-[340px] rounded-full bg-accent/[0.16] blur-3xl" animate={{ x: [0, 140, 0], y: [0, 30, 0] }} transition={{ duration: 17, repeat: Infinity, ease: 'easeInOut' }} />
        <motion.div className="absolute -bottom-32 right-10 size-[300px] rounded-full bg-info/[0.08] blur-3xl" animate={{ x: [0, -110, 0], y: [0, -20, 0] }} transition={{ duration: 20, repeat: Infinity, ease: 'easeInOut' }} />
        <div className="grid-texture absolute inset-0 opacity-60" />
      </div>
      <div className="relative">{children}</div>
    </motion.div>
  );
}

/** Load average as three bars, scaled to the number of threads */
function LoadBars({ load, threads }: { load: number[] | null; threads: number }) {
  return (
    <div className="mt-3 space-y-2.5">
      {['1 min', '5 min', '15 min'].map((label, index) => {
        const value = load?.[index] ?? null;
        const share = value === null ? null : (value / Math.max(threads, 1)) * 100;
        return (
          <div key={label}>
            <div className="mb-1 flex justify-between text-[12px]">
              <span className="text-muted">{label}</span>
              <span className="font-mono">{value === null ? '–' : <AnimatedNumber value={value} decimals={2} />}</span>
            </div>
            <FillBar value={share} delay={0.2 + index * 0.12} />
          </div>
        );
      })}
      <p className="text-[11.5px] text-faint">Balken = Anteil an {threads} Threads</p>
    </div>
  );
}

export function NodeDetailPage() {
  const location = useLocation();
  const navigate = useNavigate();
  // Read once; see SystemDetailPage (page transition keeps the old page mounted for a moment)
  const [node] = useState(() => decodeURIComponent(location.pathname.split('/')[3] ?? ''));
  const status = useNodeStatus(node);
  const [timeframe, setTimeframe] = useState<Timeframe>('day');
  const [chart, setChart] = useState<ChartKind>('cpu');
  const rrd = useNodeRrd(node, timeframe);
  const storage = useStorage();
  const cluster = useClusterStatus();
  const updates = useNodeUpdates(node);
  const summary = useProxmoxSummary({ refetchInterval: 10_000 });
  const networks = useGuestNetworks();
  const connections = useConnections();
  const power = usePowerControl();
  const [drawerGuest, setDrawerGuest] = useState<string | null>(null);

  const s = status.data;
  const cpu = s ? s.cpu * 100 : null;
  const memory = s ? (s.memory.used / s.memory.total) * 100 : null;
  const rootfs = s ? (s.rootfs.used / s.rootfs.total) * 100 : null;
  const swap = s && s.swap.total ? (s.swap.used / s.swap.total) * 100 : null;
  const load = s?.loadavg.map(Number) ?? null;
  const cpuSeries = useLiveSeries(cpu === null ? null : Math.round(cpu * 10) / 10);

  const guests = useMemo(() => (proxmoxStats(summary.data)?.guests ?? []).filter((guest) => guest.node === node).sort((a, b) => Number(a.vmid) - Number(b.vmid)), [summary.data, node]);
  const running = guests.filter((guest) => guest.status === 'running');
  const clusterInfo = cluster.data?.find((entry) => entry.type === 'cluster');
  const clusterNodes = cluster.data?.filter((entry) => entry.type === 'node') ?? [];
  const self = clusterNodes.find((entry) => entry.name === node);
  const nodeStorage = (storage.data ?? []).filter((entry) => entry.node === node).sort((a, b) => a.storage.localeCompare(b.storage));
  const updateList = updates.data ?? [];
  const pveUpdates = updateList.filter((entry) => entry.origin === 'Proxmox').length;

  const chartData = useMemo(
    () =>
      (rrd.data ?? []).map((point) => ({
        time: point.time,
        cpu: typeof point.cpu === 'number' ? point.cpu * 100 : null,
        mem: point.memtotal ? ((point.memused ?? 0) / point.memtotal) * 100 : null,
        load: point.loadavg ?? null,
        iowait: typeof point.iowait === 'number' ? point.iowait * 100 : null,
        netin: point.netin ?? null,
        netout: point.netout ?? null,
      })),
    [rrd.data],
  );

  /** The system (SSH/RDP access) behind a guest, if any: opens the server overview instead of the drawer */
  const systemFor = (guest: ProxmoxGuest) => {
    const network = networks.data?.find((entry) => entry.vmid === Number(guest.vmid) && entry.node === guest.node);
    const list = connections.data ?? [];
    return list.find((connection) => network?.ips.includes(connection.host)) ?? list.find((connection) => !!guest.name && connection.name.toLowerCase() === guest.name.toLowerCase());
  };
  const openGuest = (guest: ProxmoxGuest) => {
    const system = systemFor(guest);
    if (system) navigate(`/systems/${encodeURIComponent(system.id)}`);
    else setDrawerGuest(guestKey(guest));
  };
  const drawer = guests.find((guest) => guestKey(guest) === drawerGuest) ?? null;

  const counts = {
    vmRunning: guests.filter((guest) => guest.type === 'qemu' && guest.status === 'running').length,
    ctRunning: guests.filter((guest) => guest.type === 'lxc' && guest.status === 'running').length,
    stopped: guests.filter((guest) => guest.status !== 'running').length,
  };

  return (
    <MotionConfig reducedMotion="user">
      <Hero>
        <button type="button" onClick={() => navigate('/proxmox')} className="group mb-3 flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink">
          <ArrowLeft className="size-3.5 transition-transform group-hover:-translate-x-0.5" /> Proxmox
        </button>
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <motion.div
              initial={{ scale: 0.6, opacity: 0, rotate: -20 }}
              animate={{ scale: 1, opacity: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18, delay: 0.1 }}
              className="relative flex size-14 shrink-0 items-center justify-center rounded-2xl border border-line/[0.12] bg-raised shadow-[0_12px_30px_-12px_rgb(var(--accent)/0.6)]"
            >
              <Layers className="size-6 text-accent" />
              <span className="absolute -bottom-1 -right-1"><Beacon tone={status.isError ? 'bad' : s ? 'ok' : 'muted'} size={9} /></span>
            </motion.div>
            <div className="min-w-0">
              <motion.p initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }} className="text-[12.5px] text-muted">
                Proxmox-Node{clusterInfo ? ` · Cluster ${clusterInfo.name}` : ''}{self?.ip ? ` · ${self.ip}` : ''}
              </motion.p>
              <motion.h1 initial={{ opacity: 0, y: 10, filter: 'blur(6px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} transition={{ delay: 0.2, duration: 0.5, ease: EASE }} className="truncate font-mono text-[32px] font-semibold tracking-[-0.03em]">
                {node}
              </motion.h1>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.35 }} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px] text-muted">
                {s ? (
                  <>
                    <span>{s.cpuinfo.model} · {s.cpuinfo.cpus} Threads</span>
                    <span className="font-mono text-[12px]">{s.pveversion.replace('pve-manager/', 'PVE ').split('/')[0]} · Kernel {s.kversion.split(' ')[1] ?? s.kversion}</span>
                    <span className="text-ok">läuft seit {formatUptime(s.uptime)}</span>
                  </>
                ) : status.isError ? (
                  <span className="text-bad">Status nicht verfügbar: {(status.error as Error).message}</span>
                ) : (
                  <Shimmer className="h-3.5 w-72" />
                )}
              </motion.p>
            </div>
          </div>
          <Stagger className="flex flex-wrap gap-2">
            {[
              { label: 'Gäste filtern', icon: ListFilter, onClick: () => navigate(`/proxmox?node=${encodeURIComponent(node)}`) },
              { label: 'Netzwerk', icon: Network, onClick: () => navigate('/network') },
              { label: 'Security', icon: ShieldHalf, onClick: () => navigate('/security') },
            ].map((action) => (
              <motion.button
                key={action.label}
                variants={staggerChild}
                whileHover={{ y: -2 }}
                whileTap={{ scale: 0.96 }}
                type="button"
                onClick={action.onClick}
                className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] bg-panel/60 px-4 text-[13px] backdrop-blur transition-colors hover:border-accent/35 hover:bg-raised"
              >
                <action.icon className="size-4" /> {action.label}
              </motion.button>
            ))}
          </Stagger>
        </div>
      </Hero>

      {/* Top row */}
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[220px]" eyebrow="Live alle 5 s" title="Auslastung">
          {s ? (
            <>
              <div className="mt-2 flex items-center justify-around">
                <Gauge value={cpu} label="CPU" sub={s.wait !== undefined ? `IO ${percent(s.wait * 100)}` : undefined} size={118} />
                <Gauge value={memory} label="RAM" sub={formatBytes(s.memory.total)} size={118} />
              </div>
              <div className="mt-2"><LiveSpark values={cpuSeries} max={Math.max(25, ...cpuSeries.map((value) => value * 1.3))} /></div>
            </>
          ) : (
            <div className="mt-4 flex justify-around"><Shimmer className="size-[110px] rounded-full" /><Shimmer className="size-[110px] rounded-full" /></div>
          )}
        </NotchCard>

        <NotchCard index={1} className="min-h-[220px]" eyebrow="Load Average" title="Last">
          <LoadBars load={load} threads={s?.cpuinfo.cpus ?? 1} />
        </NotchCard>

        <NotchCard index={2} className="min-h-[220px]" eyebrow="Lokal" title="Speicher" tone={(swap ?? 0) >= 90 || (rootfs ?? 0) >= 90 ? 'bad' : undefined}>
          <div className="mt-3 space-y-3.5">
            {[
              { label: 'Root-Dateisystem', value: rootfs, sub: s ? `${formatBytes(s.rootfs.used)} / ${formatBytes(s.rootfs.total)}` : '' },
              { label: 'RAM', value: memory, sub: s ? `${formatBytes(s.memory.used)} / ${formatBytes(s.memory.total)}` : '' },
              { label: 'Swap', value: swap, sub: s?.swap.total ? `${formatBytes(s.swap.used)} / ${formatBytes(s.swap.total)}` : 'kein Swap' },
            ].map((entry, index) => (
              <div key={entry.label}>
                <div className="mb-1 flex items-baseline justify-between text-[12px]">
                  <span className="text-muted">{entry.label}</span>
                  <span className={cn('font-mono', (entry.value ?? 0) >= 90 ? 'text-bad' : (entry.value ?? 0) >= 80 ? 'text-accent' : '')}>
                    {entry.value === null ? '–' : <><AnimatedNumber value={Math.round(entry.value)} /> %</>}
                  </span>
                </div>
                <FillBar value={entry.value} delay={0.2 + index * 0.12} />
                <p className="mt-1 font-mono text-[10.5px] text-faint">{entry.sub}</p>
              </div>
            ))}
          </div>
        </NotchCard>

        <NotchCard index={3} className="min-h-[220px]" eyebrow="Pakete" title="Updates" tone={updateList.length > 50 ? 'bad' : updateList.length ? 'warn' : undefined}>
          {updates.isLoading ? (
            <div className="mt-4 space-y-2"><Shimmer className="h-9 w-20" /><Shimmer className="h-2 w-full" /><Shimmer className="h-3 w-40" /></div>
          ) : updates.isError ? (
            <p className="mt-3 text-[12.5px] text-bad">{(updates.error as Error).message}</p>
          ) : (
            <>
              <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', updateList.length ? 'text-accent' : 'text-ok')}><AnimatedNumber value={updateList.length} /></p>
              <p className="mt-1 text-[12.5px] text-muted">ausstehend (Stand der letzten Paketliste)</p>
              {updateList.length > 0 && (
                <div className="mt-3">
                  <SplitBar parts={[{ value: pveUpdates, color: 'rgb(var(--accent))', label: 'Proxmox' }, { value: updateList.length - pveUpdates, color: 'rgb(var(--info))', label: 'Debian' }]} />
                  <p className="mt-1.5 flex justify-between text-[11px] text-faint"><span className="text-accent">{pveUpdates} Proxmox</span><span>{updateList.length - pveUpdates} Debian</span></p>
                </div>
              )}
            </>
          )}
        </NotchCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-5">
          <NotchCard index={4} eyebrow="Verlauf" title="Historie" bodyClassName="pt-3">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <Segmented<ChartKind>
                id={`node-chart-${node}`}
                value={chart}
                onChange={setChart}
                options={[
                  { value: 'cpu', label: 'CPU & IO' },
                  { value: 'mem', label: 'RAM' },
                  { value: 'load', label: 'Load' },
                  { value: 'net', label: 'Netzwerk' },
                ]}
              />
              <TimeframeSwitch value={timeframe} onChange={setTimeframe} id={`node-tf-${node}`} />
            </div>
            {rrd.isLoading ? (
              <Shimmer className="h-[220px] w-full rounded-2xl" />
            ) : (
              <motion.div key={`${chart}-${timeframe}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
                {chart === 'cpu' && (
                  <TimeChart data={chartData} timeframe={timeframe} max={100} format={percent} height={220} series={[{ key: 'cpu', label: 'CPU', color: 'rgb(var(--accent))' }, { key: 'iowait', label: 'IO-Wait', color: 'rgb(var(--info))' }]} />
                )}
                {chart === 'mem' && <TimeChart data={chartData} timeframe={timeframe} max={100} format={percent} height={220} series={[{ key: 'mem', label: 'RAM', color: 'rgb(var(--accent-strong))' }]} />}
                {chart === 'load' && (
                  <TimeChart data={chartData} timeframe={timeframe} height={220} format={(value) => value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} series={[{ key: 'load', label: 'Load (1 min)', color: 'rgb(var(--accent))' }]} />
                )}
                {chart === 'net' && (
                  <TimeChart data={chartData} timeframe={timeframe} height={220} format={(value) => formatRate(value)} series={[{ key: 'netin', label: 'Empfangen', color: 'rgb(var(--accent))' }, { key: 'netout', label: 'Gesendet', color: 'rgb(var(--info))' }]} />
                )}
              </motion.div>
            )}
          </NotchCard>

          <NotchCard index={5} eyebrow={`${nodeStorage.length} Speicher`} title="Storage" bodyClassName="pt-3">
            <Stagger className="grid gap-2.5 md:grid-cols-2">
              {nodeStorage.map((entry, index) => {
                const used = entry.maxdisk ? ((entry.disk ?? 0) / entry.maxdisk) * 100 : null;
                const offline = entry.status !== 'available';
                return (
                  <motion.div key={entry.id} variants={staggerChild} whileHover={{ y: -2 }} className={cn('rounded-2xl border px-3.5 py-3', offline ? 'border-bad/30 bg-bad/[0.04]' : 'border-line/[0.07] bg-raised/20')}>
                    <div className="flex items-center gap-2">
                      <HardDrive className="size-3.5 text-muted" />
                      <span className="flex-1 truncate font-mono text-[12.5px]">{entry.storage}</span>
                      <span className="rounded-md bg-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">{entry.plugintype}</span>
                    </div>
                    {offline ? (
                      <p className="mt-2 flex items-center gap-2 text-[12px] text-bad"><Beacon tone="bad" size={6} /> nicht erreichbar</p>
                    ) : (
                      <>
                        <div className="mt-2.5"><FillBar value={used} delay={0.25 + index * 0.06} /></div>
                        <p className="mt-1.5 flex justify-between font-mono text-[10.5px] text-faint">
                          <span>{formatBytes(entry.disk ?? 0)} / {formatBytes(entry.maxdisk ?? 0)}</span>
                          <span className={cn((used ?? 0) >= 90 ? 'text-bad' : (used ?? 0) >= 80 ? 'text-accent' : 'text-muted')}>{used === null ? '–' : percent(used)}</span>
                        </p>
                      </>
                    )}
                  </motion.div>
                );
              })}
            </Stagger>
            {nodeStorage.length === 0 && <p className="text-[13px] text-muted">{storage.isLoading ? 'Lädt …' : 'Kein Storage gemeldet.'}</p>}
          </NotchCard>
        </div>

        <div className="space-y-5">
          <NotchCard index={6} eyebrow={`${running.length} von ${guests.length} laufen`} title="Gäste" bodyClassName="pt-3">
            {guests.length > 0 && (
              <>
                <SplitBar
                  height={10}
                  parts={[
                    { value: counts.vmRunning, color: 'rgb(var(--accent))', label: 'VMs laufen' },
                    { value: counts.ctRunning, color: 'rgb(var(--accent-strong) / 0.7)', label: 'CTs laufen' },
                    { value: counts.stopped, color: 'rgb(var(--line) / 0.18)', label: 'gestoppt' },
                  ]}
                />
                <p className="mb-3 mt-2 flex gap-4 text-[11.5px] text-muted">
                  <span><span className="text-ink">{counts.vmRunning}</span> VMs laufen</span>
                  <span><span className="text-ink">{counts.ctRunning}</span> CTs laufen</span>
                  <span><span className="text-ink">{counts.stopped}</span> gestoppt</span>
                </p>
              </>
            )}
            <Stagger className="scroll-thin max-h-[520px] space-y-1 overflow-y-auto pr-1">
              {guests.map((guest) => {
                const on = guest.status === 'running';
                const guestCpu = on && typeof guest.cpu === 'number' ? guest.cpu * 100 : null;
                const guestMem = on && guest.maxmem ? ((guest.mem ?? 0) / guest.maxmem) * 100 : null;
                const system = systemFor(guest);
                return (
                  <motion.button
                    key={guestKey(guest)}
                    variants={staggerChild}
                    whileHover={{ x: 3 }}
                    type="button"
                    onClick={() => openGuest(guest)}
                    className="group grid w-full grid-cols-[18px_minmax(0,1fr)_64px_64px_14px] items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover/50"
                    title={system ? `Übersicht von ${system.name}` : 'Details und Steuerung'}
                  >
                    <Beacon tone={on ? 'ok' : 'muted'} size={7} />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-[13px] font-medium">
                        {guest.type === 'lxc' ? <Container className="size-3.5 shrink-0 text-muted" /> : <Monitor className="size-3.5 shrink-0 text-muted" />}
                        <span className="truncate">{guest.name ?? guest.vmid}</span>
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-faint">{guest.vmid}{system ? ` · ${system.username}@${system.host}` : ''}</span>
                    </span>
                    <span title="CPU"><span className="mb-1 flex items-center gap-1 font-mono text-[10px] text-muted"><Cpu className="size-2.5" />{guestCpu === null ? '–' : percent(guestCpu)}</span><FillBar value={guestCpu} height={4} /></span>
                    <span title="RAM"><span className="mb-1 block font-mono text-[10px] text-muted">{guestMem === null ? '–' : percent(guestMem)}</span><FillBar value={guestMem} height={4} /></span>
                    <ChevronRight className="size-3.5 text-faint transition-transform group-hover:translate-x-0.5" />
                  </motion.button>
                );
              })}
            </Stagger>
            {guests.length === 0 && <p className="text-[13px] text-muted">{summary.isLoading ? 'Lädt …' : 'Keine Gäste auf diesem Node.'}</p>}
          </NotchCard>

          {updateList.length > 0 && (
            <NotchCard index={7} eyebrow={`${updateList.length} Pakete`} title="Ausstehende Updates" bodyClassName="pt-3">
              <Stagger className="scroll-thin max-h-[300px] space-y-1 overflow-y-auto pr-1">
                {updateList.slice(0, 60).map((entry) => (
                  <motion.div key={entry.package} variants={staggerChild} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-[12px] hover:bg-hover/40">
                    <Package className={cn('size-3.5 shrink-0', entry.origin === 'Proxmox' ? 'text-accent' : 'text-info')} />
                    <span className="min-w-0 flex-1 truncate font-mono" title={entry.title}>{entry.package}</span>
                    <span className="hidden truncate font-mono text-[10.5px] text-faint sm:block">{entry.oldVersion} → <span className="text-ink/80">{entry.version}</span></span>
                  </motion.div>
                ))}
              </Stagger>
              <p className="mt-2 text-[11.5px] text-faint">Einspielen auf dem Node: <span className="font-mono">apt update && apt dist-upgrade</span>, nach Kernel-Updates geplant neu starten.</p>
            </NotchCard>
          )}

          <NotchCard index={8} eyebrow={clusterInfo ? `Cluster ${clusterInfo.name}` : 'Cluster'} title="Nodes" bodyClassName="pt-3">
            {clusterInfo && (
              <p className={cn('mb-3 flex items-center gap-2 text-[12.5px]', clusterInfo.quorate ? 'text-ok' : 'text-bad')}>
                <Beacon tone={clusterInfo.quorate ? 'ok' : 'bad'} size={7} /> {clusterInfo.quorate ? 'Quorum vorhanden' : 'Kein Quorum'} · {clusterInfo.online ?? clusterNodes.filter((entry) => entry.online).length} / {clusterInfo.nodes ?? clusterNodes.length} online
              </p>
            )}
            <Stagger className="space-y-1">
              {clusterNodes.map((entry) => (
                <motion.button
                  key={entry.name}
                  variants={staggerChild}
                  whileHover={{ x: 3 }}
                  type="button"
                  disabled={entry.name === node}
                  onClick={() => navigate(`/proxmox/node/${encodeURIComponent(entry.name)}`)}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors', entry.name === node ? 'bg-accent/[0.08]' : 'hover:bg-hover/50')}
                >
                  <Beacon tone={entry.online ? 'ok' : 'bad'} size={7} />
                  <span className="flex-1 font-mono">{entry.name}</span>
                  <span className="font-mono text-[12px] text-muted">{entry.ip}</span>
                </motion.button>
              ))}
            </Stagger>
          </NotchCard>
        </div>
      </div>

      <GuestDrawer guest={drawer} power={power} onClose={() => setDrawerGuest(null)} />
    </MotionConfig>
  );
}
