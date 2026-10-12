import { useCallback, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, BrickWall, Container, Globe, Layers, Loader2, Maximize2, Minimize2, Monitor, Network, Radar, RefreshCw, Router, Server, Unplug, Wifi, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { useConnections, type Connection } from '@/hooks/use-infrastructure';
import { guestId, networkKeys, systemForGuest, useGuestNetworks, useLanScan, useNetstat } from '@/hooks/use-network';
import { networkApi, type DeviceKind, type GuestNetwork, type Netstat, type ScanDevice } from '@/services/network';
import { useScreenFullscreen } from '@/hooks/use-screen-fullscreen';
import { formatRelative } from '@/lib/format';
import { DEVICE_KINDS, KIND_ORDER, deviceName, shortHost } from '@/lib/devices';
import { PanZoom } from '@/components/network/PanZoom';
import { DeviceDetails, DeviceTable, ScanControls } from '@/components/network/LanScan';
import { PORT_NAMES, scopeOf } from '@/lib/net';

/* ---------- helpers ---------- */

interface PeerSummary {
  ip: string;
  scope: 'local' | 'internet';
  label: string;
  count: number;
  inbound: Set<number>;
  outbound: Set<number>;
}

/** Groups established connections by peer; a connection to one of our listening ports is inbound. */
function summarizePeers(netstat: Netstat | undefined, names: Map<string, string>): PeerSummary[] {
  if (!netstat) return [];
  const listening = new Set(netstat.listening.map((entry) => entry.local.port).filter((port): port is number => port !== null));
  const peers = new Map<string, PeerSummary>();
  netstat.established.forEach(({ local, peer }) => {
    const scope = scopeOf(peer.ip);
    if (scope === 'loopback') return;
    const entry = peers.get(peer.ip) ?? { ip: peer.ip, scope, label: names.get(peer.ip) ?? peer.ip, count: 0, inbound: new Set<number>(), outbound: new Set<number>() };
    entry.count += 1;
    if (local.port !== null && listening.has(local.port)) entry.inbound.add(local.port);
    else if (peer.port !== null) entry.outbound.add(peer.port);
    peers.set(peer.ip, entry);
  });
  return [...peers.values()].sort((left, right) => right.count - left.count);
}

const portLabel = (port: number) => (PORT_NAMES[port] ? `${PORT_NAMES[port]} ${port}` : String(port));

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

function curve(x1: number, y1: number, x2: number, y2: number) {
  const dy = (y2 - y1) * 0.5;
  return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
}

function hcurve(x1: number, y1: number, x2: number, y2: number) {
  const dx = (x2 - x1) * 0.5;
  return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}`;
}

/* ---------- map pieces ---------- */

function MapNode({ x, y, children, className, onClick, title }: { x: number; y: number; children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <motion.div
      className="absolute"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
    >
      <Tag type={onClick ? 'button' : undefined} onClick={onClick} title={title} className={cn('-translate-x-1/2 -translate-y-1/2', className)}>
        {children}
      </Tag>
    </motion.div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 text-[12px] text-muted">
      <span className="flex items-center gap-2"><span className="h-0.5 w-6 rounded-full bg-accent" /> Internet</span>
      <span className="flex items-center gap-2"><span className="h-0.5 w-6 rounded-full bg-info" /> Lokales Netz</span>
      <span className="flex items-center gap-2"><span className="h-px w-6 bg-line/30" /> Zugehörigkeit</span>
      <span className="flex items-center gap-2"><span className="size-2 rounded-full bg-ok" /> Live-Daten per SSH</span>
    </div>
  );
}

/* ---------- overview map ---------- */

interface OverviewProps {
  guests: GuestNetwork[];
  systems: Map<string, Connection>;
  netstats: Map<string, Netstat | undefined>;
  onSelect: (guest: GuestNetwork) => void;
  /** LAN devices from the last scan that are not Proxmox guests or nodes */
  devices: ScanDevice[];
  gateway?: ScanDevice;
  subnet?: string;
  nodeIps: Map<string, string>;
  selectedDevice?: string;
  onSelectDevice: (device: ScanDevice) => void;
}

const GUEST_W = 168;
const GUEST_H = 36;
const DEV_W = 152;
const DEV_H = 34;
const DEV_GAP = 8;

function OverviewMap({ guests, systems, netstats, onSelect, devices, gateway, subnet, nodeIps, selectedDevice, onSelectDevice }: OverviewProps) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const nodes = useMemo(() => [...new Set(guests.map((guest) => guest.node))].sort(), [guests]);
  const ipToGuest = useMemo(() => {
    const map = new Map<string, GuestNetwork>();
    guests.forEach((guest) => guest.ips.forEach((ip) => map.set(ip, guest)));
    return map;
  }, [guests]);

  const layout = useMemo(() => {
    if (!width) return null;
    // Columns get width by number of guests (a busy node gets more room), with a sensible minimum
    const counts = nodes.map((node) => guests.filter((guest) => guest.node === node).length);
    const weights = counts.map((count) => Math.max(Math.sqrt(Math.max(count, 1)), 1.4));
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0) || 1;
    const columnWidths = weights.map((weight) => (weight / totalWeight) * width);
    const columnStart = columnWidths.map((_, index) => columnWidths.slice(0, index).reduce((sum, value) => sum + value, 0));
    const internet = { x: width / 2, y: 46 };
    const busY = 132;
    const nodeY = 206;
    const startY = 288;
    const positions = new Map<string, { x: number; y: number }>();
    const nodePositions = new Map<string, { x: number; y: number }>();
    let height = startY;
    nodes.forEach((node, column) => {
      const columnWidth = columnWidths[column];
      const perRow = Math.max(1, Math.min(5, Math.floor((columnWidth - 16) / (GUEST_W + 10))));
      const cx = columnStart[column] + columnWidth / 2;
      nodePositions.set(node, { x: cx, y: nodeY });
      const list = guests.filter((guest) => guest.node === node);
      const rowWidth = Math.min(perRow, list.length) * (GUEST_W + 10) - 10;
      list.forEach((guest, index) => {
        const row = Math.floor(index / perRow);
        const col = index % perRow;
        const x = cx - rowWidth / 2 + col * (GUEST_W + 10) + GUEST_W / 2;
        const y = startY + row * (GUEST_H + 12);
        positions.set(guestId(guest), { x, y });
        height = Math.max(height, y + GUEST_H);
      });
    });
    if (!nodes.length) height = busY + 20;

    // LAN devices: groups by type, packed into shelves below the Proxmox area
    const trunkX = 18;
    const lanY = height + 56;
    const groups = KIND_ORDER.map((kind) => ({ kind, list: devices.filter((device) => device.kind === kind) })).filter((group) => group.list.length);
    const devicePositions = new Map<string, { x: number; y: number }>();
    const groupBoxes: Array<{ kind: DeviceKind; count: number; x: number; y: number; w: number; h: number }> = [];
    const shelves: number[] = [];
    let cursorX = trunkX + 22;
    let shelfY = lanY + 26;
    let shelfHeight = 0;
    const usable = width - cursorX - 8;
    groups.forEach((group) => {
      const maxPerRow = Math.max(1, Math.floor((usable + DEV_GAP) / (DEV_W + DEV_GAP)));
      const perRow = Math.min(maxPerRow, group.list.length, Math.max(1, Math.ceil(Math.sqrt(group.list.length * 2))));
      const rows = Math.ceil(group.list.length / perRow);
      const w = perRow * (DEV_W + DEV_GAP) - DEV_GAP + 20;
      const h = 34 + rows * (DEV_H + DEV_GAP) - DEV_GAP + 12;
      if (cursorX + w > width - 4 && cursorX > trunkX + 22) {
        shelfY += shelfHeight + 30;
        cursorX = trunkX + 22;
        shelfHeight = 0;
      }
      if (!shelves.includes(shelfY)) shelves.push(shelfY);
      groupBoxes.push({ kind: group.kind, count: group.list.length, x: cursorX, y: shelfY, w, h });
      group.list.forEach((device, index) => {
        const row = Math.floor(index / perRow);
        const col = index % perRow;
        devicePositions.set(device.ip, { x: cursorX + 10 + col * (DEV_W + DEV_GAP) + DEV_W / 2, y: shelfY + 34 + row * (DEV_H + DEV_GAP) + DEV_H / 2 });
      });
      cursorX += w + 16;
      shelfHeight = Math.max(shelfHeight, h);
    });
    const totalHeight = groups.length ? shelfY + shelfHeight + 24 : height + 30;
    return { internet, busY, nodePositions, positions, trunkX, lanY, shelves, groupBoxes, devicePositions, height: totalHeight };
  }, [devices, guests, nodes, width]);

  const nodeXs = layout ? [...layout.nodePositions.values()].map((point) => point.x) : [];

  return (
    <div ref={ref} className="relative w-full" style={{ height: layout?.height ?? 520 }}>
      {layout && (
        <>
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
            {/* Internet → LAN gateway → nodes */}
            <path d={`M${layout.internet.x},${layout.internet.y + 26} V${layout.busY}`} stroke="rgb(var(--line) / 0.22)" strokeWidth="1.5" fill="none" />
            <line x1={Math.min(layout.internet.x, ...nodeXs, devices.length ? layout.trunkX : Infinity)} x2={Math.max(layout.internet.x, ...nodeXs)} y1={layout.busY} y2={layout.busY} stroke="rgb(var(--line) / 0.22)" strokeWidth="1.5" />
            {nodeXs.map((x, index) => (
              <path key={index} d={`M${x},${layout.busY} V${layout.nodePositions.get(nodes[index])!.y - 22}`} stroke="rgb(var(--line) / 0.22)" strokeWidth="1.5" fill="none" />
            ))}
            {/* LAN trunk with one shelf line per row of device groups */}
            {devices.length > 0 && (
              <>
                <path d={`M${layout.trunkX},${layout.busY} V${layout.shelves[layout.shelves.length - 1] - 12}`} stroke="rgb(var(--line) / 0.22)" strokeWidth="1.5" fill="none" />
                {layout.shelves.map((y) => {
                  const boxes = layout.groupBoxes.filter((box) => box.y === y);
                  const right = Math.max(...boxes.map((box) => box.x + box.w / 2));
                  return (
                    <g key={y}>
                      <path d={`M${layout.trunkX},${y - 12} H${right}`} stroke="rgb(var(--line) / 0.16)" strokeWidth="1.2" fill="none" />
                      {boxes.map((box) => <path key={box.kind} d={`M${box.x + box.w / 2},${y - 12} V${y}`} stroke="rgb(var(--line) / 0.16)" strokeWidth="1.2" fill="none" />)}
                    </g>
                  );
                })}
              </>
            )}
            {/* Membership */}
            {guests.map((guest) => {
              const point = layout.positions.get(guestId(guest));
              const node = layout.nodePositions.get(guest.node);
              if (!point || !node) return null;
              return <path key={guestId(guest)} d={curve(node.x, node.y + 22, point.x, point.y - GUEST_H / 2)} stroke="rgb(var(--line) / 0.08)" strokeWidth="1" fill="none" />;
            })}
            {/* Live connections */}
            {guests.map((guest) => {
              const point = layout.positions.get(guestId(guest));
              const netstat = netstats.get(guestId(guest));
              if (!point || !netstat) return null;
              const peers = summarizePeers(netstat, new Map());
              const internet = peers.filter((peer) => peer.scope === 'internet');
              const local = peers.filter((peer) => peer.scope === 'local');
              return (
                <g key={`live-${guestId(guest)}`}>
                  {internet.length > 0 && (
                    <path
                      className="sar-flow"
                      d={curve(point.x, point.y - GUEST_H / 2, layout.internet.x, layout.internet.y + 26)}
                      stroke="rgb(var(--accent))"
                      strokeOpacity="0.85"
                      strokeWidth={Math.min(1.5 + internet.length * 0.5, 4)}
                      fill="none"
                    />
                  )}
                  {local.map((peer) => {
                    const other = ipToGuest.get(peer.ip);
                    const target = other ? layout.positions.get(guestId(other)) : layout.devicePositions.get(peer.ip);
                    const end = target ? { x: target.x, y: target.y } : { x: point.x + 40, y: layout.busY };
                    return (
                      <path
                        key={peer.ip}
                        className="sar-flow-slow"
                        d={target ? hcurve(point.x, point.y, end.x, end.y) : curve(point.x, point.y - GUEST_H / 2, end.x, end.y)}
                        stroke="rgb(var(--info))"
                        strokeOpacity="0.7"
                        strokeWidth={Math.min(1 + peer.count * 0.4, 3)}
                        fill="none"
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          <MapNode x={layout.internet.x} y={layout.internet.y}>
            <span className="flex items-center gap-2 rounded-full border border-accent/30 bg-accent/10 px-4 py-2 text-[13px] font-medium text-accent shadow-[0_10px_30px_-12px_rgb(var(--accent)/0.8)]">
              <Globe className="size-4" /> Internet
            </span>
          </MapNode>
          <MapNode x={layout.internet.x} y={layout.busY} onClick={gateway ? () => onSelectDevice(gateway) : undefined}>
            <span className={cn('flex items-center gap-2 rounded-full border bg-panel px-3 py-1 font-mono text-[11px] text-muted', selectedDevice && gateway?.ip === selectedDevice ? 'border-accent/50' : 'border-line/[0.12]')}>
              <Router className="size-3.5" /> Gateway{gateway ? ` · ${gateway.ip}` : ''}
            </span>
          </MapNode>
          {[...layout.nodePositions.entries()].map(([node, point]) => (
            <MapNode key={node} x={point.x} y={point.y}>
              <span className="flex items-center gap-2 rounded-2xl border border-line/[0.12] bg-raised px-4 py-2.5 shadow-lg">
                <Layers className="size-4 text-accent" />
                <span className="font-mono text-[13px] font-medium">{node}</span>
                {nodeIps.get(node) && <span className="font-mono text-[10.5px] text-faint">{nodeIps.get(node)}</span>}
                <span className="text-[11px] text-muted">{guests.filter((guest) => guest.node === node).length}</span>
              </span>
            </MapNode>
          ))}
          {guests.map((guest) => {
            const point = layout.positions.get(guestId(guest));
            if (!point) return null;
            const running = guest.status === 'running';
            const live = !!netstats.get(guestId(guest));
            const mapped = systems.has(guestId(guest));
            const fwOff = guest.interfaces.some((iface) => !iface.firewall);
            return (
              <MapNode key={guestId(guest)} x={point.x} y={point.y} onClick={() => onSelect(guest)} title={`${guest.name} · ${guest.ips[0] ?? 'IP unbekannt'}`}>
                <span
                  className={cn(
                    'flex items-center gap-2 rounded-xl border bg-card px-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40',
                    running ? 'border-line/[0.12]' : 'border-line/[0.06] opacity-55',
                    live && 'border-ok/35',
                  )}
                  style={{ width: GUEST_W, height: GUEST_H }}
                >
                  <span className={cn('size-1.5 shrink-0 rounded-full', running ? 'bg-ok' : 'bg-faint')} />
                  {guest.type === 'lxc' ? <Container className="size-3.5 shrink-0 text-muted" /> : <Monitor className="size-3.5 shrink-0 text-muted" />}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium leading-tight">{guest.name ?? guest.vmid}</span>
                    <span className="block truncate font-mono text-[10px] leading-tight text-faint">{guest.ips[0] ?? '–'}</span>
                  </span>
                  {mapped && <Wifi className={cn('size-3 shrink-0', live ? 'text-ok' : 'text-faint')} />}
                  {fwOff && <span title="Netzwerkkarte ohne Firewall-Flag" className="size-1.5 shrink-0 rounded-full bg-bad" />}
                </span>
              </MapNode>
            );
          })}

          {/* LAN groups */}
          {devices.length > 0 && (
            <div className="absolute flex items-center gap-2 font-mono text-[11px] text-muted" style={{ left: layout.trunkX + 10, top: layout.lanY - 22 }}>
              <Network className="size-3.5" /> Lokales Netz{subnet ? ` · ${subnet}` : ''} · {devices.length} weitere Geräte
            </div>
          )}
          {layout.groupBoxes.map((box, index) => {
            const meta = DEVICE_KINDS[box.kind];
            return (
              <motion.div
                key={box.kind}
                className="absolute rounded-2xl border border-line/[0.08] bg-panel/40"
                style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: Math.min(index * 0.03, 0.3) }}
              >
                <p className="flex items-center gap-2 px-3 pt-2 text-[11.5px] font-medium">
                  <meta.icon className="size-3.5" style={{ color: meta.color }} /> {meta.plural} <span className="font-mono text-faint">{box.count}</span>
                </p>
              </motion.div>
            );
          })}
          {devices.map((device) => {
            const point = layout.devicePositions.get(device.ip);
            if (!point) return null;
            const meta = DEVICE_KINDS[device.kind];
            return (
              <MapNode key={device.ip} x={point.x} y={point.y} onClick={() => onSelectDevice(device)} title={`${device.hostname ?? device.ip}${device.vendor ? ` · ${device.vendor}` : ''}`}>
                <span
                  className={cn(
                    'flex items-center gap-2 rounded-xl border bg-card px-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-accent/40',
                    selectedDevice === device.ip ? 'border-accent/60 shadow-[0_0_0_3px_rgb(var(--accent)/0.15)]' : device.confidence === 'low' ? 'border-dashed border-line/[0.14]' : 'border-line/[0.12]',
                  )}
                  style={{ width: DEV_W, height: DEV_H }}
                >
                  <meta.icon className="size-3.5 shrink-0" style={{ color: meta.color }} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[11.5px] font-medium leading-tight">{deviceName(device)}</span>
                    <span className="block truncate font-mono text-[10px] leading-tight text-faint">{device.ip}</span>
                  </span>
                </span>
              </MapNode>
            );
          })}
        </>
      )}
    </div>
  );
}

/* ---------- single guest map ---------- */

function GuestMap({ guest, netstat, names, onBack }: { guest: GuestNetwork; netstat?: Netstat; names: Map<string, string>; onBack: () => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const peers = useMemo(() => summarizePeers(netstat, names), [names, netstat]);
  const local = peers.filter((peer) => peer.scope === 'local').slice(0, 12);
  const internet = peers.filter((peer) => peer.scope === 'internet').slice(0, 12);
  const rows = Math.max(local.length, internet.length, 3);
  const height = Math.max(420, rows * 58 + 120);
  const center = { x: width / 2, y: height / 2 };
  const leftX = Math.min(170, width * 0.18);
  const rightX = width - leftX;
  const yFor = (index: number, total: number) => center.y + (index - (total - 1) / 2) * 58;
  const listeningPorts = [...new Set((netstat?.listening ?? []).filter((entry) => scopeOf(entry.local.ip) !== 'loopback').map((entry) => entry.local.port).filter((port): port is number => port !== null))].sort((a, b) => a - b);

  const PeerChip = ({ peer }: { peer: PeerSummary }) => (
    <span className={cn('flex w-[200px] items-center gap-2 rounded-xl border bg-card px-3 py-2 text-left', peer.scope === 'internet' ? 'border-accent/30' : 'border-info/30')}>
      {peer.scope === 'internet' ? <Globe className="size-3.5 shrink-0 text-accent" /> : <Server className="size-3.5 shrink-0 text-info" />}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12px] font-medium">{peer.label}</span>
        <span className="block truncate font-mono text-[10.5px] text-faint">
          {peer.label !== peer.ip ? `${peer.ip} · ` : ''}
          {[...peer.inbound].map((port) => `→ ${port}`).concat([...peer.outbound].map((port) => `${port} →`)).join(', ')}
        </span>
      </span>
      {peer.count > 1 && <span className="font-mono text-[10.5px] text-muted">{peer.count}×</span>}
    </span>
  );

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-1.5 text-[12.5px] text-muted transition-colors hover:text-ink">
        <ArrowLeft className="size-3.5" /> Alle Verbindungen
      </button>
      <div ref={ref} className="relative w-full" style={{ height }}>
        {width > 0 && (
          <>
            <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden="true">
              {local.map((peer, index) => (
                <path key={peer.ip} className="sar-flow-slow" d={hcurve(leftX + 100, yFor(index, local.length), center.x - 110, center.y)} stroke="rgb(var(--info))" strokeOpacity="0.75" strokeWidth={Math.min(1.2 + peer.count * 0.4, 3.5)} fill="none" />
              ))}
              {internet.map((peer, index) => (
                <path key={peer.ip} className="sar-flow" d={hcurve(center.x + 110, center.y, rightX - 100, yFor(index, internet.length))} stroke="rgb(var(--accent))" strokeOpacity="0.85" strokeWidth={Math.min(1.2 + peer.count * 0.4, 3.5)} fill="none" />
              ))}
            </svg>

            <MapNode x={leftX} y={28}><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-info">Lokales Netz · {local.length}</span></MapNode>
            <MapNode x={rightX} y={28}><span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Internet · {internet.length}</span></MapNode>

            {local.map((peer, index) => <MapNode key={peer.ip} x={leftX} y={yFor(index, local.length)}><PeerChip peer={peer} /></MapNode>)}
            {internet.map((peer, index) => <MapNode key={peer.ip} x={rightX} y={yFor(index, internet.length)}><PeerChip peer={peer} /></MapNode>)}
            {local.length === 0 && <MapNode x={leftX} y={center.y}><span className="text-[12px] text-faint">keine lokalen Verbindungen</span></MapNode>}
            {internet.length === 0 && <MapNode x={rightX} y={center.y}><span className="text-[12px] text-faint">keine Internet-Verbindungen</span></MapNode>}

            <MapNode x={center.x} y={center.y}>
              <span className="flex w-[220px] flex-col items-center rounded-2xl border border-accent/30 bg-raised px-4 py-4 text-center shadow-[0_20px_50px_-20px_rgb(var(--accent)/0.6)]">
                <span className="mb-2 flex size-10 items-center justify-center rounded-xl border border-line/[0.10] bg-card text-accent">
                  {guest.type === 'lxc' ? <Container className="size-5" /> : <Monitor className="size-5" />}
                </span>
                <span className="text-[14px] font-semibold">{guest.name}</span>
                <span className="mt-0.5 font-mono text-[11px] text-muted">{guest.ips[0] ?? 'IP unbekannt'}</span>
                <span className="mt-0.5 font-mono text-[10.5px] text-faint">{guest.type === 'lxc' ? 'CT' : 'VM'} {guest.vmid} · {guest.node}</span>
                {listeningPorts.length > 0 && (
                  <span className="mt-3 flex flex-wrap justify-center gap-1">
                    {listeningPorts.slice(0, 8).map((port) => (
                      <span key={port} className="rounded-full border border-line/[0.10] px-1.5 py-0.5 font-mono text-[10px] text-muted" title="lauscht">{portLabel(port)}</span>
                    ))}
                  </span>
                )}
              </span>
            </MapNode>
          </>
        )}
      </div>
    </div>
  );
}

/* ---------- page ---------- */

export function NetworkPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const guestsQuery = useGuestNetworks();
  const connections = useConnections();
  const scan = useLanScan();
  const [onlyRunning, setOnlyRunning] = useState(false);
  const [showLan, setShowLan] = useState(true);
  const screen = useScreenFullscreen();

  const guests = useMemo(() => (guestsQuery.data ?? []).filter((guest) => !onlyRunning || guest.status === 'running'), [guestsQuery.data, onlyRunning]);
  const allGuests = useMemo(() => guestsQuery.data ?? [], [guestsQuery.data]);

  const systems = useMemo(() => {
    const map = new Map<string, Connection>();
    allGuests.forEach((guest) => {
      const system = systemForGuest(guest, connections.data ?? []);
      if (system) map.set(guestId(guest), system);
    });
    return map;
  }, [allGuests, connections.data]);

  const selectedKey = params.get('guest');
  const selected = allGuests.find((guest) => guestId(guest) === selectedKey) ?? null;

  // Live data for every mapped, running guest (read-only `ss` over SSH)
  const live = allGuests.filter((guest) => guest.status === 'running' && systems.has(guestId(guest)));
  const netstatQueries = useQueries({
    queries: live.map((guest) => {
      const system = systems.get(guestId(guest))!;
      return {
        queryKey: networkKeys.netstat(system.id),
        queryFn: () => networkApi.netstat(system.id),
        refetchInterval: selected && guestId(selected) === guestId(guest) ? 10_000 : 30_000,
        retry: false,
      };
    }),
  });
  const netstats = new Map<string, Netstat | undefined>();
  live.forEach((guest, index) => netstats.set(guestId(guest), netstatQueries[index]?.data));

  /* LAN scan: devices that are Proxmox guests or nodes are already on the map */
  const lastScan = scan.data?.last ?? null;
  const allDevices = useMemo(() => lastScan?.devices ?? [], [lastScan]);
  const guestByIp = useMemo(() => {
    const map = new Map<string, GuestNetwork>();
    allGuests.forEach((guest) => guest.ips.forEach((ip) => map.set(ip, guest)));
    return map;
  }, [allGuests]);
  const nodeNames = useMemo(() => [...new Set(allGuests.map((guest) => guest.node))], [allGuests]);
  const nodeOf = useCallback((device: ScanDevice) => nodeNames.find((node) => shortHost(device.hostname)?.toLowerCase() === node.toLowerCase()), [nodeNames]);
  const nodeIps = useMemo(() => {
    const map = new Map<string, string>();
    allDevices.forEach((device) => {
      const node = nodeOf(device);
      if (node) map.set(node, device.ip);
    });
    return map;
  }, [allDevices, nodeOf]);
  const gateway = allDevices.find((device) => device.kind === 'router');
  const lanDevices = useMemo(
    () => allDevices.filter((device) => device.kind !== 'router' && !guestByIp.has(device.ip) && !nodeOf(device)),
    [allDevices, guestByIp, nodeOf],
  );

  const deviceKey = params.get('device');
  const selectedDevice = allDevices.find((device) => device.ip === deviceKey) ?? null;

  const names = useMemo(() => {
    const map = new Map<string, string>();
    allDevices.forEach((device) => device.hostname && map.set(device.ip, shortHost(device.hostname)!));
    allGuests.forEach((guest) => guest.ips.forEach((ip) => map.set(ip, guest.name ?? String(guest.vmid))));
    (connections.data ?? []).forEach((connection) => map.set(connection.host, connection.name));
    return map;
  }, [allDevices, allGuests, connections.data]);

  const selectedSystem = selected ? systems.get(guestId(selected)) : undefined;
  const selectedNetstat = useNetstat(selected && selected.status === 'running' ? selectedSystem?.id : undefined, 10_000);

  const totals = { internet: 0, local: 0 };
  netstats.forEach((netstat) => {
    summarizePeers(netstat, new Map()).forEach((peer) => {
      if (peer.scope === 'internet') totals.internet += peer.count;
      else totals.local += peer.count;
    });
  });

  const select = (guest: GuestNetwork | null) => setParams(guest ? { guest: guestId(guest) } : {});
  const selectDevice = (device: ScanDevice | null) => {
    const guest = device ? guestByIp.get(device.ip) : undefined;
    if (guest && !screen.fullscreen) return select(guest);
    setParams(device ? { device: device.ip } : {});
  };

  const mapContent = guestsQuery.isLoading ? (
    <div className="flex h-80 items-center justify-center text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lade Netzwerk …</div>
  ) : guestsQuery.isError ? (
    <p className="py-16 text-center text-[13px] text-bad">Netzwerkdaten nicht verfügbar: {(guestsQuery.error as Error).message}</p>
  ) : (
    <AnimatePresence mode="wait">
      <motion.div key={selected ? guestId(selected) : 'all'} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
        {selected ? (
          <GuestMap guest={selected} netstat={selectedNetstat.data} names={names} onBack={() => select(null)} />
        ) : (
          <OverviewMap
            guests={guests}
            systems={systems}
            netstats={netstats}
            onSelect={select}
            devices={showLan ? lanDevices : []}
            gateway={gateway}
            subnet={lastScan?.subnet}
            nodeIps={nodeIps}
            selectedDevice={selectedDevice?.ip}
            onSelectDevice={selectDevice}
          />
        )}
      </motion.div>
    </AnimatePresence>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {!selected && (
        <>
          <button type="button" onClick={() => setOnlyRunning((value) => !value)} className={cn('rounded-full border px-3 py-1.5 text-[12px] transition-colors', onlyRunning ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line/[0.10] text-muted hover:text-ink')}>
            {onlyRunning ? 'Nur laufende Gäste' : 'Alle Gäste'}
          </button>
          <button type="button" onClick={() => setShowLan((value) => !value)} disabled={!allDevices.length} className={cn('rounded-full border px-3 py-1.5 text-[12px] transition-colors disabled:opacity-40', showLan && allDevices.length ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line/[0.10] text-muted hover:text-ink')}>
            LAN-Geräte {showLan ? 'an' : 'aus'}
          </button>
        </>
      )}
    </div>
  );

  return (
    <>
      <PageHeader
        section="Infrastruktur"
        title="Netzwerk"
        description="Das ganze Netz: Internet, Proxmox-Gäste, alle Geräte im LAN und wer mit wem spricht"
        actions={
          <>
            <button
              type="button"
              onClick={() => void guestsQuery.refetch()}
              className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] transition-all hover:border-accent/35 hover:bg-raised"
            >
              <RefreshCw className={cn('size-4', guestsQuery.isFetching && 'animate-spin')} /> Aktualisieren
            </button>
            <button
              type="button"
              onClick={() => screen.setFullscreen(true)}
              className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] transition-all hover:border-accent/35 hover:bg-raised"
            >
              <Maximize2 className="size-4" /> Vollbild
            </button>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[140px]" eyebrow="Proxmox" title="Gäste im Netz">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={allGuests.filter((guest) => guest.status === 'running').length} /><span className="ml-1 text-[18px] font-medium text-muted">/ {allGuests.length}</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">{allGuests.filter((guest) => guest.ips.length).length} mit bekannter IP · {live.length} live per SSH</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[140px]" eyebrow={lastScan ? `Scan ${formatRelative(lastScan.finishedAt ?? lastScan.startedAt)}` : 'nmap'} title="Geräte im LAN">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]">{lastScan ? <AnimatedNumber value={allDevices.length} /> : '–'}</p>
          <p className="mt-2 truncate text-[12.5px] text-muted">{lastScan ? `${lanDevices.length} außerhalb von Proxmox · ${lastScan.subnet}` : 'noch kein Scan · „Geräte finden“ starten'}</p>
        </NotchCard>
        <NotchCard index={2} className="min-h-[140px]" eyebrow="Jetzt" title="Ins Internet">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em] text-accent"><AnimatedNumber value={totals.internet} /></p>
          <p className="mt-2 text-[12.5px] text-muted">offene Verbindungen</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[140px]" eyebrow="Jetzt" title="Im lokalen Netz">
          <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em] text-info"><AnimatedNumber value={totals.local} /></p>
          <p className="mt-2 text-[12.5px] text-muted">offene Verbindungen</p>
        </NotchCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <NotchCard
          index={4}
          eyebrow={selected ? 'Einzelansicht' : 'Gesamtansicht'}
          title={selected ? `Verbindungen von ${selected.name}` : 'Netzwerk-Map'}
          bodyClassName="pt-4"
          actions={[
            { label: 'Vollbild (F11)', icon: <Maximize2 />, onClick: () => screen.setFullscreen(true) },
            ...(selected ? [{ label: 'Firewall dieses Gastes', icon: <BrickWall />, onClick: () => navigate(`/firewall?guest=${encodeURIComponent(guestId(selected))}`) }] : []),
          ]}
        >
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <ScanControls />
            {toolbar}
          </div>
          <div className="mb-4"><Legend /></div>
          <div className="grid-texture rounded-2xl border border-line/[0.06] p-4">{!screen.fullscreen ? mapContent : <p className="py-16 text-center text-[13px] text-muted">Läuft im Vollbild · Esc zum Zurückkehren</p>}</div>
        </NotchCard>

        <NotchCard
          index={5}
          eyebrow={selected ? 'Details' : selectedDevice ? 'Gerät' : 'Gäste'}
          title={selected ? selected.name ?? String(selected.vmid) : selectedDevice ? selectedDevice.hostname ?? selectedDevice.ip : 'Mit Live-Daten'}
          bodyClassName="pt-3"
        >
          {selected ? (
            <GuestDetails guest={selected} system={selectedSystem} netstat={selectedNetstat.data} loading={selectedNetstat.isLoading} error={selectedNetstat.error as Error | null} names={names} onManage={() => navigate('/systems')} />
          ) : selectedDevice ? (
            <>
              <DeviceDetails device={selectedDevice} guest={guestByIp.get(selectedDevice.ip)} />
              <button type="button" onClick={() => selectDevice(null)} className="mt-4 text-[12.5px] text-muted hover:text-ink">← Zurück zur Übersicht</button>
            </>
          ) : (
            <ul className="space-y-1">
              {[...allGuests].sort((a, b) => Number(systems.has(guestId(b))) - Number(systems.has(guestId(a)))).slice(0, 14).map((guest) => {
                const mapped = systems.has(guestId(guest));
                const peers = summarizePeers(netstats.get(guestId(guest)), new Map());
                return (
                  <li key={guestId(guest)}>
                    <button type="button" onClick={() => select(guest)} className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-hover/60">
                      <span className={cn('size-2 rounded-full', guest.status === 'running' ? 'bg-ok' : 'bg-faint')} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{guest.name}</span>
                        <span className="block truncate font-mono text-[11px] text-faint">{guest.ips[0] ?? 'IP unbekannt'}</span>
                      </span>
                      {mapped ? (
                        <span className="flex gap-1 font-mono text-[10.5px]">
                          <span className="rounded-full bg-info/10 px-1.5 text-info">{peers.filter((peer) => peer.scope === 'local').length}</span>
                          <span className="rounded-full bg-accent/10 px-1.5 text-accent">{peers.filter((peer) => peer.scope === 'internet').length}</span>
                        </span>
                      ) : (
                        <Unplug className="size-3.5 text-faint" />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </NotchCard>
      </div>

      <NotchCard index={6} className="mt-5" eyebrow={lastScan ? `${lastScan.mode === 'quick' ? 'Quick-Scan' : 'Gerätesuche'} · ${lastScan.subnet}` : 'nmap'} title="Geräte im lokalen Netz" bodyClassName="pt-4">
        {lastScan ? (
          <DeviceTable devices={allDevices} guestByIp={guestByIp} selected={selectedDevice?.ip} onSelect={(device) => selectDevice(device)} />
        ) : (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-line/[0.12] px-6 py-12 text-center">
            <Radar className="mb-3 size-6 text-muted" />
            <p className="text-[14px] font-medium">Noch kein Scan</p>
            <p className="mt-1 max-w-lg text-[12.5px] text-muted">„Geräte finden“ sucht alle Geräte im gewählten Netz (Ping-Sweep und ARP, ohne root). „Quick-Scan“ prüft zusätzlich die 100 häufigsten Ports und ordnet zu: Drucker, PC, Server, VM, Netzwerkgerät, Telefon …</p>
          </div>
        )}
      </NotchCard>

      {createPortal(
        <AnimatePresence>
          {screen.fullscreen && (
            <motion.div className="fixed inset-0 z-[200] flex flex-col bg-canvas" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
              <div className="flex flex-wrap items-center gap-3 border-b border-line/[0.07] bg-panel/80 px-5 py-3 backdrop-blur">
                <Network className="size-4 text-accent" />
                <p className="text-[14px] font-medium">{selected ? `Verbindungen von ${selected.name}` : 'Netzwerk-Map'}</p>
                <div className="mx-2 hidden xl:block"><Legend /></div>
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <ScanControls compact />
                  {toolbar}
                  <button type="button" onClick={() => screen.setFullscreen(false)} className="flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-3.5 text-[12.5px] hover:bg-raised">
                    <Minimize2 className="size-4" /> Schließen <span className="font-mono text-[10.5px] text-faint">Esc</span>
                  </button>
                </div>
              </div>
              <div className="relative min-h-0 flex-1">
                <div className="grid-texture absolute inset-0" />
                <PanZoom>
                  <div className="p-8" style={{ width: '100vw' }}>{mapContent}</div>
                </PanZoom>
                <AnimatePresence>
                  {(selectedDevice || selected) && (
                    <motion.aside
                      initial={{ opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 20 }}
                      className="panel-surface scroll-thin absolute right-4 top-4 max-h-[calc(100%-6rem)] w-[340px] overflow-y-auto rounded-3xl p-5 shadow-2xl"
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <p className="truncate text-[14px] font-medium">{selected ? selected.name : selectedDevice?.hostname ?? selectedDevice?.ip}</p>
                        <button type="button" aria-label="Schließen" onClick={() => setParams({})} className="flex size-7 items-center justify-center rounded-full text-muted hover:bg-raised hover:text-ink"><X className="size-4" /></button>
                      </div>
                      {selected ? (
                        <GuestDetails guest={selected} system={selectedSystem} netstat={selectedNetstat.data} loading={selectedNetstat.isLoading} error={selectedNetstat.error as Error | null} names={names} onManage={() => { screen.setFullscreen(false); navigate('/systems'); }} />
                      ) : selectedDevice ? (
                        <DeviceDetails device={selectedDevice} guest={guestByIp.get(selectedDevice.ip)} />
                      ) : null}
                    </motion.aside>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function GuestDetails({ guest, system, netstat, loading, error, names, onManage }: { guest: GuestNetwork; system?: Connection; netstat?: Netstat; loading: boolean; error: Error | null; names: Map<string, string>; onManage: () => void }) {
  const peers = summarizePeers(netstat, names);
  return (
    <div className="space-y-4 text-[12.5px]">
      <dl className="divide-y divide-line/[0.06] rounded-2xl border border-line/[0.07]">
        {[
          ['Typ', guest.type === 'lxc' ? 'Container (LXC)' : 'VM (QEMU)'],
          ['Node', guest.node],
          ['IP-Adressen', guest.ips.length ? guest.ips.slice(0, 4).join(', ') : 'unbekannt'],
          ['IP-Quelle', guest.ipSource === 'agent' ? 'Gast-Agent' : guest.ipSource === 'lxc' ? 'Proxmox (LXC)' : guest.ipSource === 'config' ? 'Konfiguration' : '–'],
          ...guest.interfaces.map((iface) => [iface.key, `${iface.bridge ?? '?'}${iface.tag ? ` · VLAN ${iface.tag}` : ''} · ${iface.firewall ? 'Firewall-Flag an' : 'ohne Firewall-Flag'}`]),
        ].map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3 px-3 py-2">
            <dt className="text-muted">{label}</dt>
            <dd className={cn('truncate text-right font-mono text-[11.5px]', String(value).includes('ohne Firewall') && 'text-bad')}>{value}</dd>
          </div>
        ))}
      </dl>

      {!system ? (
        <div className="rounded-2xl border border-line/[0.08] bg-raised/40 p-3.5 text-muted">
          <p className="flex items-center gap-2 text-ink/90"><Unplug className="size-4" /> Keine Live-Daten</p>
          <p className="mt-1.5">Für die Verbindungen dieses Gastes einen SSH-Zugang {guest.ips[0] ? <>mit der IP <span className="font-mono text-ink">{guest.ips[0]}</span> </> : ''}unter „Systeme“ anlegen.</p>
          <button type="button" onClick={onManage} className="mt-2 text-accent hover:underline">Zu „Systeme“ →</button>
        </div>
      ) : guest.status !== 'running' ? (
        <p className="text-muted">Gast läuft nicht.</p>
      ) : loading ? (
        <p className="flex items-center gap-2 text-muted"><Loader2 className="size-3.5 animate-spin" /> Lese Verbindungen über {system.name} …</p>
      ) : error ? (
        <p className="text-bad">SSH-Abfrage fehlgeschlagen: {error.message}</p>
      ) : (
        <>
          <p className="flex items-center gap-2 text-muted"><Network className="size-3.5" /> Live über <span className="text-ink">{system.name}</span> · alle 10 s</p>
          <ul className="space-y-1">
            {peers.map((peer) => (
              <li key={peer.ip} className="flex items-center gap-2 rounded-xl px-2 py-1.5 hover:bg-hover/50">
                <span className={cn('size-2 rounded-full', peer.scope === 'internet' ? 'bg-accent' : 'bg-info')} />
                <span className="min-w-0 flex-1 truncate">{peer.label}</span>
                <span className="font-mono text-[10.5px] text-faint">{[...peer.inbound].map(portLabel).concat([...peer.outbound].map(portLabel)).slice(0, 2).join(', ')}</span>
              </li>
            ))}
            {peers.length === 0 && <li className="text-muted">Gerade keine offenen Verbindungen.</li>}
          </ul>
        </>
      )}
    </div>
  );
}
