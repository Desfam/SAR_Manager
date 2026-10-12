import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, ArrowUp, FolderOpen, Loader2, MonitorPlay, MoreHorizontal, SquareTerminal } from 'lucide-react';
import { useRdpLaunch } from '@/hooks/use-rdp';
import { cn } from '@/lib/utils';
import { formatBytes, type ProxmoxGuest } from '@/lib/proxmox';
import { formatRate } from '@/lib/format';
import { useConnections } from '@/hooks/use-infrastructure';
import { useGuestRrd, useGuestStatus } from '@/hooks/use-proxmox';
import type { Timeframe } from '@/services/proxmox';
import { Drawer } from '@/components/ui/Drawer';
import { TimeChart } from '@/components/ui/TimeChart';
import { availableActions, guestKey, POWER, type PowerControl } from './power';
import { GuestStatusLabel, SectionTitle, StatTile, TimeframeSwitch } from './shared';
import { formatUptime, usageTone } from '@/lib/usage';

interface GuestDrawerProps {
  guest: ProxmoxGuest | null;
  power: PowerControl;
  onClose: () => void;
}

const percent = (value: number) => `${Math.round(value)} %`;

export function GuestDrawer({ guest, power, onClose }: GuestDrawerProps) {
  return (
    <Drawer open={!!guest} onClose={onClose} label="Gast-Details">
      {guest && <GuestDetails key={guestKey(guest)} guest={guest} power={power} onClose={onClose} />}
    </Drawer>
  );
}

function GuestDetails({ guest, power, onClose }: { guest: ProxmoxGuest; power: PowerControl; onClose: () => void }) {
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState<Timeframe>('day');
  const [menuOpen, setMenuOpen] = useState(false);
  const status = useGuestStatus(guest);
  const rrd = useGuestRrd(guest, timeframe);
  const connections = useConnections();

  const live = status.data;
  const current = { ...guest, status: live?.status ?? guest.status, lock: live?.lock ?? guest.lock };
  const pending = power.pending[guestKey(guest)];
  const allowed = availableActions(current, pending);
  const running = current.status === 'running';

  const cpu = running && typeof live?.cpu === 'number' ? live.cpu * 100 : null;
  const memory = running && live?.maxmem ? ((live.mem ?? 0) / live.maxmem) * 100 : null;
  const diskUsed = guest.type === 'lxc' && live?.maxdisk ? live.disk ?? 0 : null;

  // An SSH connection with the same name as the guest makes terminal and files available
  const connection = useMemo(
    () => connections.data?.find((item) => item.type !== 'rdp' && item.name.trim().toLowerCase() === (guest.name ?? '').trim().toLowerCase()),
    [connections.data, guest.name],
  );
  const rdpConnection = useMemo(
    () => connections.data?.find((item) => item.type === 'rdp' && item.name.trim().toLowerCase() === (guest.name ?? '').trim().toLowerCase()),
    [connections.data, guest.name],
  );
  const rdp = useRdpLaunch();

  const chartData = useMemo(
    () =>
      (rrd.data ?? []).map((point) => ({
        time: point.time,
        cpu: typeof point.cpu === 'number' ? point.cpu * 100 : null,
        mem: point.maxmem ? ((point.mem ?? 0) / point.maxmem) * 100 : null,
        netin: point.netin ?? null,
        netout: point.netout ?? null,
        diskread: point.diskread ?? null,
        diskwrite: point.diskwrite ?? null,
      })),
    [rrd.data],
  );

  const openWithConnection = (path: string) => {
    if (!connection) return;
    onClose();
    navigate(`${path}?host=${encodeURIComponent(connection.id)}`);
  };

  return (
    <div className="px-7 pb-8 pt-7">
      <p className="text-[12px] text-muted">{guest.type === 'lxc' ? 'Container' : 'Virtuelle Maschine'}</p>
      <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{guest.name ?? `#${guest.vmid}`}</h2>
      <p className="mt-1 font-mono text-[12.5px] text-muted">
        {guest.type === 'lxc' ? 'CT' : 'VM'} {guest.vmid} · {guest.node}
      </p>
      <div className="mt-3 flex items-center gap-3">
        <GuestStatusLabel status={current.status} pending={pending ? POWER[pending.action].progress : undefined} />
        {current.lock && <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[11px] text-warn">gesperrt: {current.lock}</span>}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        <StatTile label="CPU" value={cpu === null ? '–' : percent(cpu)} sub={live?.cpus ? `${live.cpus} vCPU` : undefined} tone={usageTone(cpu)} />
        <StatTile
          label="RAM"
          value={memory === null ? '–' : percent(memory)}
          sub={live?.maxmem ? `${running ? formatBytes(live.mem ?? 0) : '–'} / ${formatBytes(live.maxmem)}` : undefined}
          tone={usageTone(memory)}
        />
        <StatTile
          label="Disk"
          value={live?.maxdisk ? formatBytes(live.maxdisk) : '–'}
          sub={diskUsed !== null && live?.maxdisk ? `${formatBytes(diskUsed)} belegt (${Math.round((diskUsed / live.maxdisk) * 100)} %)` : 'Größe'}
          tone={diskUsed !== null && live?.maxdisk ? usageTone((diskUsed / live.maxdisk) * 100) : 'normal'}
        />
        <StatTile label="Uptime" value={running ? formatUptime(live?.uptime) : '–'} />
        <StatTile
          label="Netzwerk seit Start"
          value={
            <span className="flex items-center gap-3 text-[16px]">
              <span className="flex items-center gap-1"><ArrowDown className="size-3.5 text-accent" />{formatBytes(live?.netin ?? 0)}</span>
              <span className="flex items-center gap-1"><ArrowUp className="size-3.5 text-info" />{formatBytes(live?.netout ?? 0)}</span>
            </span>
          }
        />
        <StatTile
          label="Disk I/O seit Start"
          value={
            <span className="flex items-center gap-3 text-[16px]">
              <span className="flex items-center gap-1"><ArrowDown className="size-3.5 text-accent" />{formatBytes(live?.diskread ?? 0)}</span>
              <span className="flex items-center gap-1"><ArrowUp className="size-3.5 text-info" />{formatBytes(live?.diskwrite ?? 0)}</span>
            </span>
          }
        />
      </div>

      {/* Access */}
      {rdpConnection && (
        <button
          type="button"
          disabled={!running || rdp.isPending}
          onClick={() => rdp.mutate({ id: rdpConnection.id, name: rdpConnection.name })}
          title={!running ? 'Gast läuft nicht' : `${rdpConnection.username}@${rdpConnection.host}`}
          className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {rdp.isPending ? <Loader2 className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />} Per RDP verbinden
        </button>
      )}
      <div className={rdpConnection ? 'mt-2.5 grid grid-cols-2 gap-2.5' : 'mt-5 grid grid-cols-2 gap-2.5'}>
        {[
          { label: 'Terminal', icon: SquareTerminal, path: '/terminal' },
          { label: 'Dateien', icon: FolderOpen, path: '/files' },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={!connection || !running}
            onClick={() => openWithConnection(item.path)}
            title={!connection ? 'Kein SSH-Zugang mit diesem Namen hinterlegt' : !running ? 'Gast läuft nicht' : undefined}
            className="flex h-11 items-center justify-center gap-2 rounded-full border border-line/[0.12] text-[13.5px] transition-all enabled:hover:border-accent/40 enabled:hover:bg-raised disabled:cursor-not-allowed disabled:opacity-40"
          >
            <item.icon className="size-4" /> {item.label}
          </button>
        ))}
      </div>
      {!connection && <p className="mt-2 text-[11.5px] text-faint">Terminal und Dateien gehen, sobald unter „Systeme“ ein SSH-Zugang mit dem Namen „{guest.name}“ angelegt ist.</p>}

      {/* Power */}
      <div className="mt-3 flex items-center gap-2.5">
        {running ? (
          <>
            <PowerPill label="Herunterfahren" icon={POWER.shutdown.icon} enabled={allowed.shutdown} onClick={() => power.request(current, 'shutdown')} />
            <PowerPill label="Neustarten" icon={POWER.reboot.icon} enabled={allowed.reboot} onClick={() => power.request(current, 'reboot')} />
          </>
        ) : (
          <PowerPill label="Starten" icon={POWER.start.icon} enabled={allowed.start} onClick={() => power.request(current, 'start')} primary />
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((value) => !value)}
            aria-label="Weitere Aktionen"
            className="flex size-11 items-center justify-center rounded-full border border-line/[0.12] text-muted transition-colors hover:text-ink"
          >
            <MoreHorizontal className="size-4" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: -4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.15 }}
                className="panel-surface absolute right-0 top-12 z-10 w-52 rounded-2xl p-1.5 shadow-2xl"
              >
                <button
                  type="button"
                  disabled={!allowed.stop}
                  onClick={() => {
                    setMenuOpen(false);
                    power.request(current, 'stop');
                  }}
                  className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] text-bad transition-colors enabled:hover:bg-bad/10 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <POWER.stop.icon className="size-4" /> Sofort stoppen
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* History */}
      <SectionTitle aside={<TimeframeSwitch id={`guest-tf-${guest.vmid}`} value={timeframe} onChange={setTimeframe} />}>Verlauf</SectionTitle>
      {rrd.isLoading ? (
        <p className="py-8 text-center text-[13px] text-muted">Lädt Verlauf …</p>
      ) : rrd.isError ? (
        <p className="py-8 text-center text-[13px] text-bad">Verlauf nicht verfügbar: {(rrd.error as Error).message}</p>
      ) : (
        <div className="space-y-5">
          <ChartBlock title="CPU">
            <TimeChart data={chartData} timeframe={timeframe} max={100} format={percent} series={[{ key: 'cpu', label: 'CPU', color: 'rgb(var(--accent))' }]} />
          </ChartBlock>
          <ChartBlock title="RAM">
            <TimeChart data={chartData} timeframe={timeframe} max={100} format={percent} series={[{ key: 'mem', label: 'RAM', color: 'rgb(var(--accent-strong))' }]} />
          </ChartBlock>
          <ChartBlock title="Netzwerk">
            <TimeChart
              data={chartData}
              timeframe={timeframe}
              format={(value) => formatRate(value)}
              series={[
                { key: 'netin', label: 'Empfangen', color: 'rgb(var(--accent))' },
                { key: 'netout', label: 'Gesendet', color: 'rgb(var(--info))' },
              ]}
            />
          </ChartBlock>
          <ChartBlock title="Disk I/O">
            <TimeChart
              data={chartData}
              timeframe={timeframe}
              format={(value) => formatRate(value)}
              series={[
                { key: 'diskread', label: 'Lesen', color: 'rgb(var(--accent))' },
                { key: 'diskwrite', label: 'Schreiben', color: 'rgb(var(--info))' },
              ]}
            />
          </ChartBlock>
        </div>
      )}
    </div>
  );
}

function ChartBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-line/[0.07] bg-raised/30 px-3 pb-2 pt-3">
      <p className="mb-1 px-1 text-[12.5px] font-medium">{title}</p>
      {children}
    </div>
  );
}

function PowerPill({ label, icon: Icon, enabled, onClick, primary }: { label: string; icon: typeof SquareTerminal; enabled: boolean; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      disabled={!enabled}
      onClick={onClick}
      className={cn(
        'flex h-11 flex-1 items-center justify-center gap-2 rounded-full text-[13.5px] font-medium transition-all active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40',
        primary
          ? 'bg-gradient-to-r from-accent-strong to-accent text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)]'
          : 'border border-line/[0.12] enabled:hover:border-accent/40 enabled:hover:bg-raised',
      )}
    >
      <Icon className="size-4" /> {label}
    </button>
  );
}
