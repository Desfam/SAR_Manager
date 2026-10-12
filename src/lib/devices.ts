import { Box, CircleHelp, Cctv, Cpu, HardDrive, Laptop, Layers, Monitor, Network, Phone, Printer, Router, Server, Smartphone, type LucideIcon } from 'lucide-react';
import type { DeviceKind, ScanDevice } from '@/services/network';

export const DEVICE_KINDS: Record<DeviceKind, { label: string; plural: string; icon: LucideIcon; color: string }> = {
  router: { label: 'Router', plural: 'Router', icon: Router, color: 'rgb(var(--accent))' },
  network: { label: 'Netzwerkgerät', plural: 'Netzwerk', icon: Network, color: 'rgb(var(--info))' },
  hypervisor: { label: 'Hypervisor', plural: 'Hypervisor', icon: Layers, color: 'rgb(var(--accent))' },
  server: { label: 'Server', plural: 'Server', icon: Server, color: 'rgb(var(--ok))' },
  pc: { label: 'PC', plural: 'PCs', icon: Monitor, color: 'rgb(var(--info))' },
  printer: { label: 'Drucker', plural: 'Drucker', icon: Printer, color: 'rgb(var(--warn))' },
  nas: { label: 'NAS', plural: 'NAS', icon: HardDrive, color: 'rgb(var(--ok))' },
  camera: { label: 'Kamera', plural: 'Kameras', icon: Cctv, color: 'rgb(var(--bad))' },
  phone: { label: 'Telefon', plural: 'Telefone', icon: Phone, color: 'rgb(var(--warn))' },
  mobile: { label: 'Mobilgerät', plural: 'Mobilgeräte', icon: Smartphone, color: 'rgb(var(--muted))' },
  vm: { label: 'VM', plural: 'VMs außerhalb von Proxmox', icon: Box, color: 'rgb(var(--accent))' },
  iot: { label: 'IoT', plural: 'IoT', icon: Cpu, color: 'rgb(var(--muted))' },
  self: { label: 'Dieser PC', plural: 'Dieser PC', icon: Laptop, color: 'rgb(var(--accent))' },
  unknown: { label: 'Unbekannt', plural: 'Unbekannt', icon: CircleHelp, color: 'rgb(var(--faint))' },
};

/** Order of device groups on the map and in filters */
export const KIND_ORDER: DeviceKind[] = ['self', 'network', 'hypervisor', 'server', 'pc', 'printer', 'nas', 'phone', 'camera', 'mobile', 'iot', 'vm', 'unknown', 'router'];

export const CONFIDENCE_LABEL = { high: 'sicher', medium: 'wahrscheinlich', low: 'Vermutung' } as const;

export const shortHost = (hostname?: string) => hostname?.split('.')[0];
export const deviceName = (device: ScanDevice) => shortHost(device.hostname) ?? device.vendor?.split(/[ ,]/)[0] ?? device.ip;
