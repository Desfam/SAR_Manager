import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, Radar, ScanSearch, Search, Square } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatRelative } from '@/lib/format';
import { networkKeys, useLanInterfaces, useLanScan } from '@/hooks/use-network';
import { scanApi, type DeviceKind, type GuestNetwork, type ScanDevice } from '@/services/network';
import { CONFIDENCE_LABEL, DEVICE_KINDS, KIND_ORDER } from '@/lib/devices';
import { PORT_NAMES } from '@/lib/net';


/* ---------- scan controls ---------- */

export function ScanControls({ compact }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const scan = useLanScan();
  const interfaces = useLanInterfaces();
  const [subnet, setSubnet] = useState('');
  const running = scan.data?.running ?? null;
  const last = scan.data?.last ?? null;

  useEffect(() => {
    if (!subnet && interfaces.data?.[0]) setSubnet(interfaces.data[0].cidr);
  }, [interfaces.data, subnet]);

  // Report the end of a scan once
  const [watching, setWatching] = useState<string | null>(null);
  useEffect(() => {
    if (running) setWatching(running.id);
    else if (watching && last?.id === watching) {
      toast.success(`Scan fertig: ${last.devices.length} Geräte`, { description: last.subnet });
      setWatching(null);
    } else if (watching && scan.data && !running) setWatching(null);
  }, [running, last, watching, scan.data]);

  const start = useMutation({
    mutationFn: (mode: 'discover' | 'quick') => scanApi.start(subnet, mode),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: networkKeys.scan }),
    onError: (failure: Error) => toast.error('Scan nicht gestartet', { description: failure.message }),
  });
  const cancel = useMutation({
    mutationFn: scanApi.cancel,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: networkKeys.scan }),
  });

  if (running) {
    return (
      <div className={cn('flex min-w-[280px] flex-1 items-center gap-3', compact && 'max-w-md')}>
        <Radar className="size-4 shrink-0 animate-pulse text-accent" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] text-muted">
            {running.phase === 'ports' ? 'Quick-Scan: Ports und Dienste' : 'Suche Geräte'} in <span className="font-mono text-ink">{running.subnet}</span>
          </p>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line/[0.08]">
            <div className="h-full rounded-full bg-gradient-to-r from-accent-strong to-accent transition-[width] duration-700" style={{ width: `${Math.max(3, running.progress)}%` }} />
          </div>
        </div>
        <span className="font-mono text-[11.5px] text-muted">{Math.round(running.progress)} %</span>
        <button type="button" onClick={() => cancel.mutate()} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] hover:bg-raised">
          <Square className="size-3" /> Abbrechen
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={subnet}
        onChange={(event) => setSubnet(event.target.value)}
        className="h-9 rounded-full border border-line/[0.12] bg-raised/60 px-3 font-mono text-[12px] outline-none focus:border-accent/40"
        title="Netz für den Scan"
      >
        {(interfaces.data ?? []).map((entry) => <option key={entry.cidr} value={entry.cidr}>{entry.cidr} · {entry.iface}</option>)}
        {last && !(interfaces.data ?? []).some((entry) => entry.cidr === last.subnet) && <option value={last.subnet}>{last.subnet}</option>}
      </select>
      <button
        type="button"
        disabled={!subnet || start.isPending}
        onClick={() => start.mutate('discover')}
        title="Ping-Sweep und ARP: findet alle Geräte, ordnet sie über Hersteller und Namen grob zu (meist unter 1 Minute)"
        className="flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-3.5 text-[12.5px] transition-colors hover:border-accent/40 hover:bg-raised disabled:opacity-50"
      >
        <ScanSearch className="size-4" /> Geräte finden
      </button>
      <button
        type="button"
        disabled={!subnet || start.isPending}
        onClick={() => start.mutate('quick')}
        title="Zusätzlich die 100 häufigsten Ports und Dienste prüfen, um Drucker, PCs, Server, VMs … zu erkennen (einige Minuten)"
        className="flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-3.5 text-[12.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
      >
        {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Radar className="size-4" />} Quick-Scan
      </button>
      {!compact && last && (
        <span className="text-[11.5px] text-faint">
          Letzter Scan {formatRelative(last.finishedAt ?? last.startedAt)} · {last.mode === 'quick' ? 'Quick-Scan' : 'Gerätesuche'} · {last.devices.length} Geräte
        </span>
      )}
    </div>
  );
}

/* ---------- device details ---------- */

export function DeviceDetails({ device, guest }: { device: ScanDevice; guest?: GuestNetwork }) {
  const meta = DEVICE_KINDS[device.kind];
  return (
    <div className="space-y-4 text-[12.5px]">
      <div className="flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl border border-line/[0.10] bg-raised" style={{ color: meta.color }}>
          <meta.icon className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[14px] font-medium">{meta.label}{device.os ? <span className="font-normal text-muted"> · {device.os}</span> : null}</p>
          <p className="text-[11.5px] text-muted">{CONFIDENCE_LABEL[device.confidence]}{guest ? ` · Proxmox ${guest.type === 'lxc' ? 'CT' : 'VM'} ${guest.vmid}` : ''}</p>
        </div>
      </div>

      <dl className="divide-y divide-line/[0.06] rounded-2xl border border-line/[0.07]">
        {[
          ['IP', device.ip],
          ['Name', device.hostname ?? '–'],
          ['MAC', device.mac ?? '–'],
          ['Hersteller', device.vendor ?? (device.randomMac ? 'zufällige MAC' : '–')],
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted">{label}</dt>
            <dd className="truncate text-right font-mono text-[11.5px]">{value}</dd>
          </div>
        ))}
      </dl>

      <div>
        <p className="mb-1.5 text-muted">Warum diese Zuordnung</p>
        <ul className="space-y-1">
          {device.reasons.map((reason) => <li key={reason} className="flex gap-2"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" /> {reason}</li>)}
        </ul>
      </div>

      <div>
        <p className="mb-1.5 text-muted">Offene Ports</p>
        {!device.ports ? (
          <p className="text-faint">Noch nicht geprüft · Quick-Scan starten</p>
        ) : device.ports.length === 0 ? (
          <p className="text-faint">keine unter den 100 häufigsten</p>
        ) : (
          <ul className="space-y-1">
            {device.ports.map((port) => (
              <li key={`${port.proto}-${port.port}`} className="rounded-xl border border-line/[0.06] px-2.5 py-1.5">
                <p className="flex gap-2 font-mono text-[11.5px]"><span className="text-ink">{port.port}</span><span className="text-muted">{port.service ?? PORT_NAMES[port.port] ?? ''}</span></p>
                {(port.product || port.title) && <p className="truncate text-[11px] text-faint" title={port.title}>{[port.product, port.version].filter(Boolean).join(' ')}{port.title ? ` · ${port.title}` : ''}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/* ---------- device list ---------- */

export function DeviceTable({ devices, guestByIp, selected, onSelect }: { devices: ScanDevice[]; guestByIp: Map<string, GuestNetwork>; selected?: string; onSelect: (device: ScanDevice) => void }) {
  const [kind, setKind] = useState<DeviceKind | 'all'>('all');
  const [query, setQuery] = useState('');
  const counts = useMemo(() => {
    const map = new Map<DeviceKind, number>();
    devices.forEach((device) => map.set(device.kind, (map.get(device.kind) ?? 0) + 1));
    return map;
  }, [devices]);
  const needle = query.trim().toLowerCase();
  const list = devices.filter(
    (device) => (kind === 'all' || device.kind === kind) && (!needle || [device.ip, device.hostname, device.vendor, device.mac, ...(device.ports ?? []).map((port) => String(port.port))].join(' ').toLowerCase().includes(needle)),
  );

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => setKind('all')} className={cn('rounded-full border px-3 py-1 text-[12px]', kind === 'all' ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
          Alle <span className="font-mono text-faint">{devices.length}</span>
        </button>
        {KIND_ORDER.filter((entry) => counts.get(entry)).map((entry) => {
          const meta = DEVICE_KINDS[entry];
          return (
            <button key={entry} type="button" onClick={() => setKind(entry)} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12px]', kind === entry ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
              <meta.icon className="size-3.5" style={{ color: meta.color }} /> {meta.plural} <span className="font-mono text-faint">{counts.get(entry)}</span>
            </button>
          );
        })}
        <label className="ml-auto flex h-8 w-56 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3 focus-within:border-accent/40">
          <Search className="size-3.5 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="IP, Name, Hersteller, Port …" className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint" />
        </label>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line/[0.07]">
        <div className="grid grid-cols-[140px_minmax(0,1.2fr)_minmax(0,1fr)_150px_minmax(0,1.3fr)] gap-3 border-b border-line/[0.07] bg-raised/40 px-4 py-2 text-[11px] uppercase tracking-[0.08em] text-faint">
          <span>IP</span><span>Name</span><span>Hersteller · MAC</span><span>Typ</span><span>Offene Ports</span>
        </div>
        <ul className="scroll-thin max-h-[520px] overflow-y-auto">
          {list.map((device) => {
            const meta = DEVICE_KINDS[device.kind];
            const guest = guestByIp.get(device.ip);
            return (
              <li key={device.ip}>
                <button
                  type="button"
                  onClick={() => onSelect(device)}
                  className={cn('grid w-full grid-cols-[140px_minmax(0,1.2fr)_minmax(0,1fr)_150px_minmax(0,1.3fr)] items-center gap-3 border-b border-line/[0.04] px-4 py-2 text-left text-[12.5px] transition-colors hover:bg-hover/50', selected === device.ip && 'bg-accent/[0.08]')}
                >
                  <span className="font-mono text-[12px]">{device.ip}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{guest?.name ?? device.hostname ?? <span className="text-faint">–</span>}</span>
                    {guest && <span className="block truncate text-[11px] text-faint">Proxmox {guest.type === 'lxc' ? 'CT' : 'VM'} {guest.vmid}</span>}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-muted">{device.vendor ?? (device.randomMac ? 'zufällige MAC' : '–')}</span>
                    <span className="block truncate font-mono text-[10.5px] text-faint">{device.mac ?? ''}</span>
                  </span>
                  <span className="flex items-center gap-2">
                    <meta.icon className="size-4 shrink-0" style={{ color: meta.color }} />
                    <span className="truncate">{meta.label}</span>
                    {device.confidence === 'low' && <span className="text-[10.5px] text-faint">?</span>}
                  </span>
                  <span className="truncate font-mono text-[11px] text-muted">
                    {device.ports ? (device.ports.length ? device.ports.map((port) => port.port).join(', ') : 'keine') : <span className="font-sans text-faint">nicht geprüft</span>}
                  </span>
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-4 py-8 text-center text-[13px] text-muted">Keine Geräte für diesen Filter.</li>}
        </ul>
      </div>
    </div>
  );
}
