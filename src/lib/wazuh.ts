import type { Connection } from '@/hooks/use-infrastructure';
import type { GuestNetwork, ScanDevice } from '@/services/network';

/** Wazuh rule levels 0–15, grouped like the Wazuh dashboard */
export const SEVERITY = {
  low: { label: 'Niedrig', range: '0–6', color: 'rgb(var(--faint))', text: 'text-muted', pill: 'border-line/[0.12] text-muted' },
  medium: { label: 'Mittel', range: '7–11', color: 'rgb(var(--accent))', text: 'text-accent', pill: 'border-accent/40 bg-accent/10 text-accent' },
  high: { label: 'Hoch', range: '12–14', color: 'rgb(var(--bad))', text: 'text-bad', pill: 'border-bad/40 bg-bad/10 text-bad' },
  critical: { label: 'Kritisch', range: '15', color: 'rgb(var(--bad))', text: 'text-bad', pill: 'border-bad bg-bad/25 text-bad' },
} as const;

export type SeverityKey = keyof typeof SEVERITY;

export const severityOf = (level: number): SeverityKey => (level >= 15 ? 'critical' : level >= 12 ? 'high' : level >= 7 ? 'medium' : 'low');

export interface AgentMatch {
  connection?: Connection;
  guest?: GuestNetwork;
  /** Device from the last LAN scan with the agent's IP (PCs, Hyper-V VMs …) */
  device?: ScanDevice;
}

/** Assign a Wazuh agent to our systems and Proxmox guests: by IP first, then by name */
export function matchAgent(agent: { name?: string; ip?: string }, connections: Connection[], guests: GuestNetwork[], devices: ScanDevice[] = []): AgentMatch {
  const name = agent.name?.toLowerCase();
  const short = (value?: string) => value?.toLowerCase().split('.')[0];
  const guest =
    (agent.ip ? guests.find((entry) => entry.ips.includes(agent.ip!)) : undefined) ??
    guests.find((entry) => !!entry.name && (short(entry.name) === name || short(entry.name)?.replace(/^(vm|ct)-/, '') === name));
  const connection =
    (agent.ip ? connections.find((entry) => entry.host === agent.ip) : undefined) ??
    connections.find((entry) => entry.name.toLowerCase() === name) ??
    (guest ? connections.find((entry) => guest.ips.includes(entry.host) || entry.name.toLowerCase() === guest.name?.toLowerCase()) : undefined);
  const device = agent.ip ? devices.find((entry) => entry.ip === agent.ip) : undefined;
  return { connection, guest, device };
}

export function formatCount(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Mio.`;
  if (value >= 10_000) return `${Math.round(value / 1000).toLocaleString('de-DE')} Tsd.`;
  return value.toLocaleString('de-DE');
}
