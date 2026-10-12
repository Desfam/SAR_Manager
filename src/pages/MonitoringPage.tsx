import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, ChevronRight, Container, Cpu, HardDrive, LayoutGrid, List, Loader2, MemoryStick, Monitor, RefreshCw, Search, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Meter, UsageValue } from '@/components/proxmox/shared';
import { GuestDrawer } from '@/components/proxmox/GuestDrawer';
import { guestKey, usePowerControl } from '@/components/proxmox/power';
import { formatBytes, type ProxmoxGuest } from '@/lib/proxmox';
import { formatUptime, toneText, usageTone, type UsageTone } from '@/lib/usage';
import { getProxmoxTarget } from '@/hooks/use-infrastructure';

/* ---------- data ---------- */

interface Filesystem {
  mount: string;
  type: string;
  used: number;
  total: number;
}

interface MonitoredGuest {
  vmid: number;
  name?: string;
  node: string;
  type: 'qemu' | 'lxc';
  status: string;
  cpu: number;
  maxcpu: number;
  mem: number;
  maxmem: number;
  netin: number;
  netout: number;
  uptime: number;
  storage: { source: 'lxc' | 'agent' | 'size'; used: number | null; total: number | null; filesystems: Filesystem[] };
}

function useMonitoring() {
  return useQuery<MonitoredGuest[]>({
    queryKey: ['infra', 'proxmox', 'monitoring'],
    queryFn: async () => {
      const target = getProxmoxTarget();
      const response = await fetch(`${API_CONFIG.baseURL}/proxmox/monitoring${target ? `?target=${encodeURIComponent(target)}` : ''}`);
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data;
    },
    refetchInterval: 20_000,
  });
}

const pct = (used: number | null, total: number | null) => (used !== null && total ? (used / total) * 100 : null);

function metrics(guest: MonitoredGuest) {
  const running = guest.status === 'running';
  return {
    running,
    cpu: running ? guest.cpu * 100 : null,
    ram: running && guest.maxmem ? (guest.mem / guest.maxmem) * 100 : null,
    disk: pct(guest.storage.used, guest.storage.total),
  };
}

const worstTone = (values: Array<number | null>): UsageTone => {
  const tones = values.map(usageTone);
  return tones.includes('bad') ? 'bad' : tones.includes('warn') ? 'warn' : 'normal';
};

type SortKey = 'name' | 'cpu' | 'ram' | 'disk';
type StatusFilter = 'running' | 'all' | 'stopped';

/* ---------- small pieces ---------- */

function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; id: string }) {
  return (
    <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} className={cn('relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition-colors', value === option.value ? 'text-ink' : 'text-muted hover:text-ink')}>
          {value === option.value && <motion.span layoutId={`mon-${id}`} className="absolute inset-0 rounded-full border border-accent/25 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
          <span className="relative flex items-center gap-1.5">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

function StorageCell({ guest, compact }: { guest: MonitoredGuest; compact?: boolean }) {
  const { storage } = guest;
  const value = pct(storage.used, storage.total);
  if (storage.source === 'size' || value === null) {
    return (
      <div title={guest.status === 'running' ? 'Belegung unbekannt: in der VM läuft kein QEMU-Gast-Agent' : 'Gast läuft nicht'}>
        <div className="h-1.5 rounded-full bg-line/[0.05] hatched" />
        <p className="mt-1 font-mono text-[10.5px] text-faint">{storage.total ? formatBytes(storage.total) : '–'}{!compact && ' · Belegung unbekannt'}</p>
      </div>
    );
  }
  return (
    <div title={storage.filesystems.map((fs) => `${fs.mount}: ${formatBytes(fs.used)} / ${formatBytes(fs.total)}`).join('\n') || undefined}>
      <div className="flex items-center gap-2">
        <Meter value={value} className="flex-1" />
        <UsageValue value={value} className="w-12 text-right" />
      </div>
      <p className={cn('mt-1 font-mono text-[10.5px]', usageTone(value) !== 'normal' ? toneText[usageTone(value)] : 'text-faint')}>
        {formatBytes(storage.used ?? 0)} / {formatBytes(storage.total ?? 0)}
        {!compact && storage.filesystems.length > 1 && <span className="text-faint"> · {storage.filesystems.length} Laufwerke</span>}
      </p>
    </div>
  );
}

/* ---------- page ---------- */

export function MonitoringPage() {
  const monitoring = useMonitoring();
  const power = usePowerControl();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('running');
  const [type, setType] = useState<'all' | 'qemu' | 'lxc'>('all');
  const [node, setNode] = useState<string>('all');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'ram', dir: -1 });
  const [view, setView] = useState<'list' | 'tiles'>('list');
  const [selected, setSelected] = useState<string | null>(null);

  const all = useMemo(() => monitoring.data ?? [], [monitoring.data]);
  const nodes = useMemo(() => [...new Set(all.map((guest) => guest.node))].sort(), [all]);

  const guests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const value = (guest: MonitoredGuest) => {
      const m = metrics(guest);
      return sort.key === 'name' ? 0 : (sort.key === 'cpu' ? m.cpu : sort.key === 'ram' ? m.ram : m.disk) ?? -1;
    };
    return all
      .filter((guest) => status === 'all' || (status === 'running' ? guest.status === 'running' : guest.status !== 'running'))
      .filter((guest) => type === 'all' || guest.type === type)
      .filter((guest) => node === 'all' || guest.node === node)
      .filter((guest) => !needle || `${guest.name} ${guest.vmid} ${guest.node}`.toLowerCase().includes(needle))
      .sort((left, right) => (sort.key === 'name' ? (left.name ?? '').localeCompare(right.name ?? '') : value(left) - value(right)) * sort.dir);
  }, [all, node, query, sort, status, type]);

  /* summary */
  const running = all.filter((guest) => guest.status === 'running');
  const coreTotal = running.reduce((sum, guest) => sum + guest.maxcpu, 0);
  const cpuAvg = coreTotal ? (running.reduce((sum, guest) => sum + guest.cpu * guest.maxcpu, 0) / coreTotal) * 100 : null;
  const memUsed = running.reduce((sum, guest) => sum + guest.mem, 0);
  const memTotal = running.reduce((sum, guest) => sum + guest.maxmem, 0);
  const known = all.filter((guest) => guest.storage.used !== null && guest.storage.total);
  const diskUsed = known.reduce((sum, guest) => sum + (guest.storage.used ?? 0), 0);
  const diskTotal = known.reduce((sum, guest) => sum + (guest.storage.total ?? 0), 0);
  const unknownStorage = running.filter((guest) => guest.storage.source === 'size').length;
  const hotspots = running
    .flatMap((guest) => {
      const m = metrics(guest);
      return [
        { guest, label: 'RAM', value: m.ram },
        { guest, label: 'CPU', value: m.cpu },
        { guest, label: 'Speicher', value: m.disk },
      ];
    })
    .filter((entry) => entry.value !== null && entry.value >= 80)
    .sort((left, right) => (right.value ?? 0) - (left.value ?? 0));

  const selectedGuest = all.find((guest) => guestKey(guest) === selected) as unknown as ProxmoxGuest | undefined;

  const sortHeader = (key: SortKey, label: string, icon?: ReactNode) => (
    <button type="button" onClick={() => setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : key === 'name' ? 1 : -1 }))} className={cn('flex items-center gap-1.5 hover:text-ink', sort.key === key && 'text-ink')}>
      {icon}
      {label}
      {sort.key === key && (sort.dir === 1 ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
    </button>
  );

  return (
    <>
      <PageHeader
        section="Infrastruktur"
        title="Monitoring"
        description="CPU, RAM und Speicher aller VMs und Container im Proxmox-Cluster"
        actions={
          <button type="button" onClick={() => void monitoring.refetch()} className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] transition-all hover:border-accent/35 hover:bg-raised">
            <RefreshCw className={cn('size-4', monitoring.isFetching && 'animate-spin')} /> Aktualisieren
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[150px]" eyebrow="Gäste" title="Laufen gerade">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={monitoring.data ? running.length : null} /><span className="ml-1 text-[18px] font-medium text-muted">/ {all.length}</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{coreTotal} vCPU · {formatBytes(memTotal)} RAM zugewiesen</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[150px]" eyebrow="Ø gewichtet nach vCPU" title="CPU">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">
            {cpuAvg === null ? '–' : <><AnimatedNumber value={cpuAvg} decimals={1} /><span className="ml-1 text-[18px] text-muted">%</span></>}
          </p>
          <Meter value={cpuAvg} className="mt-3" />
        </NotchCard>
        <NotchCard index={2} className="min-h-[150px]" tone={usageTone(pct(memUsed, memTotal)) === 'normal' ? undefined : usageTone(pct(memUsed, memTotal)) as 'warn' | 'bad'} eyebrow="Laufende Gäste" title="RAM">
          <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', toneText[usageTone(pct(memUsed, memTotal))])}>
            {memTotal ? <><AnimatedNumber value={pct(memUsed, memTotal)} /><span className="ml-1 text-[18px] text-muted">%</span></> : '–'}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{formatBytes(memUsed)} von {formatBytes(memTotal)}</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[150px]" eyebrow={unknownStorage ? `${unknownStorage} ohne Belegungsdaten` : 'Alle erfasst'} title="Speicher">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">
            {diskTotal ? <><AnimatedNumber value={pct(diskUsed, diskTotal)} /><span className="ml-1 text-[18px] text-muted">%</span></> : '–'}
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{formatBytes(diskUsed)} von {formatBytes(diskTotal)} belegt</p>
        </NotchCard>
      </div>

      {/* Hotspots */}
      <AnimatePresence>
        {hotspots.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-5 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent/[0.06] px-4 py-3 text-[12.5px]">
            <TriangleAlert className="size-4 text-accent" />
            <span className="font-medium">Auffällig:</span>
            {hotspots.slice(0, 8).map((entry) => (
              <button
                key={`${guestKey(entry.guest)}-${entry.label}`}
                type="button"
                onClick={() => setSelected(guestKey(entry.guest))}
                className={cn('rounded-full border px-2.5 py-1 transition-colors hover:bg-raised', usageTone(entry.value) === 'bad' ? 'border-bad/35 text-bad' : 'border-accent/35 text-accent')}
              >
                {entry.guest.name} · {entry.label} {Math.round(entry.value ?? 0)} %
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      <NotchCard
        index={4}
        className="mt-5"
        eyebrow={node === 'all' ? 'Alle Nodes' : node}
        title={`VMs & Container (${guests.length})`}
        bodyClassName="pt-4"
        actions={[
          { label: 'Listenansicht', icon: <List />, onClick: () => setView('list'), active: view === 'list' },
          { label: 'Kachelansicht', icon: <LayoutGrid />, onClick: () => setView('tiles'), active: view === 'tiles' },
        ]}
      >
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 focus-within:border-accent/40 xl:max-w-[320px]">
            <Search className="size-4 text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, VMID oder Node …" className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
          </label>
          <Segmented<StatusFilter> id="status" value={status} onChange={setStatus} options={[{ value: 'running', label: 'Laufend' }, { value: 'stopped', label: 'Gestoppt' }, { value: 'all', label: 'Alle' }]} />
          <Segmented<'all' | 'qemu' | 'lxc'> id="type" value={type} onChange={setType} options={[{ value: 'all', label: 'Alle' }, { value: 'qemu', label: 'VMs' }, { value: 'lxc', label: 'LXC' }]} />
          <Segmented<string> id="node" value={node} onChange={setNode} options={[{ value: 'all', label: 'Alle Nodes' }, ...nodes.map((item) => ({ value: item, label: item }))]} />
        </div>

        {monitoring.isLoading ? (
          <p className="flex items-center justify-center py-20 text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lese Werte aller Gäste …</p>
        ) : monitoring.isError ? (
          <p className="py-16 text-center text-[13px] text-bad">{(monitoring.error as Error).message}</p>
        ) : guests.length === 0 ? (
          <p className="py-16 text-center text-[13px] text-muted">Keine Gäste für diese Filter.</p>
        ) : view === 'list' ? (
          <div className="mt-4">
            <div className="grid grid-cols-[52px_minmax(170px,1.3fr)_minmax(150px,1fr)_minmax(170px,1fr)_minmax(190px,1.1fr)_96px_20px] items-center gap-x-5 border-b border-line/[0.07] px-3 pb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
              <span>Typ</span>
              {sortHeader('name', 'Name')}
              {sortHeader('cpu', 'CPU', <Cpu className="size-3" />)}
              {sortHeader('ram', 'RAM', <MemoryStick className="size-3" />)}
              {sortHeader('disk', 'Speicher', <HardDrive className="size-3" />)}
              <span>Uptime</span>
              <span />
            </div>
            <ul>
              {guests.map((guest) => {
                const m = metrics(guest);
                const tone = worstTone([m.cpu, m.ram, m.disk]);
                return (
                  <motion.li
                    key={guestKey(guest)}
                    layout
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.25 }}
                    onClick={() => setSelected(guestKey(guest))}
                    className={cn(
                      'group grid cursor-pointer grid-cols-[52px_minmax(170px,1.3fr)_minmax(150px,1fr)_minmax(170px,1fr)_minmax(190px,1.1fr)_96px_20px] items-center gap-x-5 rounded-xl px-3 py-3 transition-colors hover:bg-hover/50',
                      !m.running && 'opacity-55',
                    )}
                  >
                    <span className={cn('w-11 rounded-md px-1.5 py-0.5 text-center font-mono text-[10.5px]', tone === 'bad' ? 'bg-bad/15 text-bad' : tone === 'warn' ? 'bg-accent/15 text-accent' : 'bg-hover text-muted')}>{guest.type === 'lxc' ? 'CT' : 'VM'}</span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate text-[13.5px] font-medium">
                        <span className={cn('size-1.5 shrink-0 rounded-full', m.running ? 'bg-ok' : 'bg-faint')} />
                        {guest.name ?? `#${guest.vmid}`}
                      </p>
                      <p className="truncate pl-3.5 font-mono text-[11px] text-muted">{guest.vmid} · {guest.node}</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Meter value={m.cpu} className="flex-1" />
                        <UsageValue value={m.cpu} className="w-12 text-right" />
                      </div>
                      <p className="mt-1 font-mono text-[10.5px] text-faint">{guest.maxcpu} vCPU</p>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <Meter value={m.ram} className="flex-1" />
                        <UsageValue value={m.ram} className="w-12 text-right" />
                      </div>
                      <p className={cn('mt-1 font-mono text-[10.5px]', usageTone(m.ram) !== 'normal' ? toneText[usageTone(m.ram)] : 'text-faint')}>
                        {m.running ? `${formatBytes(guest.mem)} / ` : ''}{formatBytes(guest.maxmem)}
                      </p>
                    </div>
                    <StorageCell guest={guest} />
                    <span className="font-mono text-[12px] text-muted">{m.running ? formatUptime(guest.uptime) : '–'}</span>
                    <ChevronRight className="size-4 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-ink" />
                  </motion.li>
                );
              })}
            </ul>
          </div>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {guests.map((guest, index) => {
              const m = metrics(guest);
              const tone = worstTone([m.cpu, m.ram, m.disk]);
              const rows = [
                { label: 'CPU', icon: Cpu, value: m.cpu, detail: `${guest.maxcpu} vCPU` },
                { label: 'RAM', icon: MemoryStick, value: m.ram, detail: m.running ? `${formatBytes(guest.mem)} / ${formatBytes(guest.maxmem)}` : formatBytes(guest.maxmem) },
              ];
              return (
                <motion.button
                  key={guestKey(guest)}
                  type="button"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index, 16) * 0.03 }}
                  onClick={() => setSelected(guestKey(guest))}
                  className={cn(
                    'rounded-2xl border bg-raised/35 p-4 text-left transition-all hover:-translate-y-0.5 hover:bg-raised/60',
                    tone === 'bad' ? 'border-bad/40' : tone === 'warn' ? 'border-accent/40' : 'border-line/[0.07]',
                    !m.running && 'opacity-55',
                  )}
                >
                  <div className="flex items-center gap-2">
                    {guest.type === 'lxc' ? <Container className="size-4 text-muted" /> : <Monitor className="size-4 text-muted" />}
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">{guest.name}</span>
                    <span className={cn('size-2 rounded-full', m.running ? 'bg-ok' : 'bg-faint')} />
                  </div>
                  <p className="mt-0.5 font-mono text-[10.5px] text-faint">{guest.vmid} · {guest.node}</p>
                  <div className="mt-3 space-y-2.5">
                    {rows.map((row) => (
                      <div key={row.label}>
                        <div className="mb-1 flex items-center justify-between text-[11px] text-muted">
                          <span className="flex items-center gap-1.5"><row.icon className="size-3" /> {row.label}</span>
                          <UsageValue value={row.value} />
                        </div>
                        <Meter value={row.value} />
                      </div>
                    ))}
                    <div>
                      <div className="mb-1 flex items-center gap-1.5 text-[11px] text-muted"><HardDrive className="size-3" /> Speicher</div>
                      <StorageCell guest={guest} compact />
                    </div>
                  </div>
                </motion.button>
              );
            })}
          </div>
        )}
        <p className="mt-4 text-[11.5px] text-faint">
          Speicher: Container direkt aus Proxmox, VMs über den QEMU-Gast-Agent (Dateisysteme aus Sicht des Gastes). VMs ohne Agent zeigen nur die Plattengröße. Aktualisierung alle 20 s · Klick öffnet Details mit Verlauf.
        </p>
      </NotchCard>

      <GuestDrawer guest={selectedGuest ?? null} power={power} onClose={() => setSelected(null)} />
      {power.dialog}
    </>
  );
}
