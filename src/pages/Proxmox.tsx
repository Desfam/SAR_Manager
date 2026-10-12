import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronRight, Loader2, RefreshCw, Search, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { formatBytes, proxmoxStats, type ProxmoxGuest } from '@/lib/proxmox';
import { getProxmoxTarget, infraKeys, useProxmoxSummary } from '@/hooks/use-infrastructure';
import { availableActions, guestKey, POWER, usePowerControl, type PowerAction } from '@/components/proxmox/power';
import { ActionButton, GuestStatusLabel, Meter, Segmented, UsageValue } from '@/components/proxmox/shared';
import { formatUptime, toneText, usageTone } from '@/lib/usage';
import { GuestDrawer } from '@/components/proxmox/GuestDrawer';
import { StorageSection } from '@/components/proxmox/StorageSection';

type StatusFilter = 'all' | 'running' | 'stopped';
type TypeFilter = 'all' | 'qemu' | 'lxc';

const ROW_GRID = 'grid-cols-[52px_minmax(170px,1.6fr)_120px_minmax(130px,1fr)_minmax(150px,1fr)_100px_164px_20px]';
const ORDER: PowerAction[] = ['start', 'shutdown', 'reboot', 'stop'];

export function Proxmox() {
  const queryClient = useQueryClient();
  const proxmox = useProxmoxSummary({ refetchInterval: 10_000 });
  const pve = proxmoxStats(proxmox.data);
  const power = usePowerControl();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [nodeFilter, setNodeFilter] = useState<string | null>(() => params.get('node'));
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);

  const guests = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (pve?.guests ?? [])
      .filter((guest) => statusFilter === 'all' || (statusFilter === 'running' ? guest.status === 'running' : guest.status !== 'running'))
      .filter((guest) => typeFilter === 'all' || guest.type === typeFilter)
      .filter((guest) => !nodeFilter || guest.node === nodeFilter)
      .filter((guest) => !needle || `${guest.name ?? ''} ${guest.vmid} ${guest.node} ${guest.tags ?? ''}`.toLowerCase().includes(needle))
      .sort((left, right) => Number(left.vmid) - Number(right.vmid));
  }, [nodeFilter, pve?.guests, query, statusFilter, typeFilter]);

  const guestForDrawer = pve?.guests.find((guest) => guestKey(guest) === selectedGuest) ?? null;
  const openGuest = (guest: ProxmoxGuest) => setSelectedGuest(guestKey(guest));

  return (
    <>
      <PageHeader
        section="Infrastruktur"
        title="Proxmox"
        description="Nodes, virtuelle Maschinen, Container und Storage in deinem Cluster"
        actions={
          <>
            {proxmox.data?.connected && (
              <span className="flex h-10 items-center gap-2 rounded-full border border-line/[0.10] px-4 text-[13px] text-muted">
                <span className="size-2 rounded-full bg-ok shadow-[0_0_8px_rgb(var(--ok))]" />
                <span className="font-mono">{getProxmoxTarget() ?? 'Backend-Standard'}</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => queryClient.invalidateQueries({ queryKey: infraKeys.proxmox })}
              className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] text-ink/90 transition-all hover:border-accent/35 hover:bg-raised active:scale-[0.97]"
            >
              <RefreshCw className={cn('size-4', proxmox.isFetching && 'animate-spin')} /> Aktualisieren
            </button>
          </>
        }
      />

      {proxmox.isLoading ? (
        <div className="flex h-60 items-center justify-center text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Verbinde mit Proxmox …</div>
      ) : !pve ? (
        <NotchCard className="min-h-[200px]" bodyClassName="justify-center">
          <p className="text-[15px] font-semibold">Proxmox nicht verbunden</p>
          <p className="mt-1.5 text-[13px] text-muted">{proxmox.data?.error ?? (proxmox.error as Error | null)?.message ?? 'Die Proxmox-API antwortet nicht.'}</p>
        </NotchCard>
      ) : (
        <div className="space-y-5">
          {/* Nodes */}
          <div className="grid gap-5 md:grid-cols-2 2xl:grid-cols-3">
            {pve.nodes.map((node, index) => {
              const onNode = pve.guests.filter((guest) => guest.node === node.node);
              const filtered = nodeFilter === node.node;
              const worst = Math.max(node.cpuPercent ?? 0, node.memoryPercent ?? 0);
              const tone = node.status !== 'online' ? 'bad' : usageTone(worst);
              return (
                <NotchCard
                  key={node.node}
                  index={index}
                  glow={filtered}
                  tone={tone === 'normal' ? undefined : tone}
                  onClick={() => navigate(`/proxmox/node/${encodeURIComponent(node.node)}`)}
                  ariaLabel={`Details zu ${node.node}`}
                  eyebrow={node.status === 'online' ? `Online · ${formatUptime(node.uptime)}` : 'Offline'}
                  title={node.node}
                  actions={[
                    {
                      label: filtered ? 'Filter aufheben' : 'Nur Gäste dieses Nodes',
                      icon: <Server />,
                      active: filtered,
                      onClick: () => setNodeFilter(filtered ? null : node.node),
                    },
                  ]}
                >
                  <div className="mt-4 flex items-end gap-8">
                    <div>
                      <p className="text-[34px] font-bold leading-none tabular">
                        <AnimatedNumber value={onNode.filter((guest) => guest.status === 'running').length} />
                        <span className="text-[18px] font-medium text-muted"> / {onNode.length}</span>
                      </p>
                      <p className="mt-1.5 text-[12px] text-muted">Gäste laufen</p>
                    </div>
                    <div className="flex-1 space-y-2.5 pb-1">
                      <div>
                        <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-muted">
                          <span>CPU · {node.maxcpu ?? '–'} Threads</span>
                          <UsageValue value={node.cpuPercent} />
                        </div>
                        <Meter value={node.cpuPercent} />
                      </div>
                      <div>
                        <div className="mb-1 flex items-baseline justify-between text-[11.5px] text-muted">
                          <span>RAM · {formatBytes(Number(node.mem ?? 0))} / {formatBytes(Number(node.maxmem ?? 0))}</span>
                          <UsageValue value={node.memoryPercent} />
                        </div>
                        <Meter value={node.memoryPercent} />
                      </div>
                    </div>
                  </div>
                  <p className="mt-3 flex items-center gap-1 text-[11.5px] text-faint transition-colors group-hover/card:text-accent">
                    Details <ChevronRight className="size-3.5" />
                  </p>
                </NotchCard>
              );
            })}
          </div>

          {/* Guests */}
          <NotchCard index={pve.nodes.length} eyebrow={nodeFilter ? `Gefiltert: ${nodeFilter}` : 'Alle Nodes'} title={`Gäste (${guests.length})`} bodyClassName="pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 transition-colors focus-within:border-accent/40 xl:max-w-[340px]">
                <Search className="size-4 text-muted" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Name, VMID oder Node …"
                  className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint"
                />
              </label>
              <Segmented<StatusFilter>
                id="status"
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: 'all', label: 'Alle', count: pve.guests.length },
                  { value: 'running', label: 'Running', count: pve.running },
                  { value: 'stopped', label: 'Stopped', count: pve.stopped },
                ]}
              />
              <Segmented<TypeFilter>
                id="type"
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: 'all', label: 'Alle' },
                  { value: 'qemu', label: 'VMs', count: pve.qemu },
                  { value: 'lxc', label: 'LXC', count: pve.lxc },
                ]}
              />
              {nodeFilter && (
                <button type="button" onClick={() => setNodeFilter(null)} className="text-[12.5px] text-accent hover:underline">
                  Node-Filter aufheben
                </button>
              )}
            </div>

            <div className={cn('mt-4 grid items-center gap-x-4 border-b border-line/[0.07] px-3 pb-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint max-xl:hidden', ROW_GRID)}>
              <span>Typ</span>
              <span>Name</span>
              <span>Status</span>
              <span>CPU</span>
              <span>RAM</span>
              <span>Uptime</span>
              <span className="text-right">Aktionen</span>
              <span />
            </div>

            {guests.length === 0 ? (
              <p className="py-10 text-center text-[13px] text-muted">Keine Gäste für diese Filter.</p>
            ) : (
              <ul>
                <AnimatePresence initial={false}>
                  {guests.map((guest, index) => {
                    const key = guestKey(guest);
                    const pend = power.pending[key];
                    const allowed = availableActions(guest, pend);
                    const running = guest.status === 'running';
                    const cpu = running && typeof guest.cpu === 'number' ? guest.cpu * 100 : null;
                    const memory = running && guest.maxmem ? (Number(guest.mem ?? 0) / Number(guest.maxmem)) * 100 : null;
                    return (
                      <motion.li
                        key={key}
                        layout
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.25, delay: Math.min(index, 12) * 0.02 }}
                        onClick={() => openGuest(guest)}
                        className={cn(
                          'group grid cursor-pointer items-center gap-x-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-hover/50',
                          ROW_GRID,
                          'max-xl:grid-cols-[minmax(0,1fr)_auto] max-xl:gap-y-2',
                          selectedGuest === key && 'bg-accent/[0.07]',
                        )}
                      >
                        <span className="w-11 rounded-md bg-hover px-1.5 py-0.5 text-center font-mono text-[10.5px] text-muted max-xl:hidden">
                          {guest.type === 'lxc' ? 'CT' : 'VM'}
                        </span>
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openGuest(guest);
                            }}
                            className="block max-w-full truncate text-left text-[13.5px] font-medium hover:text-accent"
                          >
                            {guest.name ?? `#${guest.vmid}`}
                          </button>
                          <p className="truncate font-mono text-[11.5px] text-muted">
                            {guest.vmid} · {guest.node}
                            {guest.lock && <span className="ml-1.5 text-warn">· gesperrt ({guest.lock})</span>}
                          </p>
                        </div>
                        <div className="max-xl:hidden"><GuestStatusLabel status={guest.status} pending={pend ? POWER[pend.action].progress : undefined} /></div>
                        <div className="flex items-center gap-2.5 max-xl:hidden">
                          <Meter value={cpu} className="flex-1" />
                          <UsageValue value={cpu} className="w-12 text-right" />
                        </div>
                        <div className="max-xl:hidden">
                          <div className="flex items-center gap-2.5">
                            <Meter value={memory} className="flex-1" />
                            <UsageValue value={memory} className="w-12 text-right" />
                          </div>
                          <p className={cn('mt-0.5 font-mono text-[10.5px]', memory !== null && usageTone(memory) !== 'normal' ? toneText[usageTone(memory)] : 'text-faint')}>
                            {running ? `${formatBytes(Number(guest.mem ?? 0))} / ` : ''}{formatBytes(Number(guest.maxmem ?? 0))}
                          </p>
                        </div>
                        <span className="font-mono text-[12px] text-muted max-xl:hidden">{running ? formatUptime(guest.uptime) : '–'}</span>
                        <div className="flex justify-end gap-1.5">
                          {ORDER.map((action) => (
                            <ActionButton
                              key={action}
                              action={action}
                              enabled={allowed[action]}
                              busy={pend?.action === action}
                              onClick={() => power.request(guest, action)}
                            />
                          ))}
                        </div>
                        <ChevronRight className="size-4 text-faint transition-all group-hover:translate-x-0.5 group-hover:text-ink max-xl:hidden" />
                      </motion.li>
                    );
                  })}
                </AnimatePresence>
              </ul>
            )}
          </NotchCard>

          <StorageSection index={pve.nodes.length + 1} />
        </div>
      )}

      <GuestDrawer guest={guestForDrawer} power={power} onClose={() => setSelectedGuest(null)} />
      {power.dialog}
    </>
  );
}
