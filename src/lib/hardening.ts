import { Archive, Boxes, Cpu, KeyRound, Network, Radar, Server, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { Category, Finding, Severity, Status } from '@/services/hardening';

export const CATEGORIES: Array<{ id: Exclude<Category, 'host'>; label: string; short: string; icon: LucideIcon }> = [
  { id: 'isolation', label: 'Isolation & Proxmox', short: 'Isolation', icon: Boxes },
  { id: 'network', label: 'Netzwerk & Firewall', short: 'Netzwerk', icon: Network },
  { id: 'system', label: 'System & Updates', short: 'System', icon: Cpu },
  { id: 'access', label: 'Zugänge & SSH', short: 'Zugänge', icon: KeyRound },
  { id: 'services', label: 'Dienste & Ports', short: 'Dienste', icon: Server },
  { id: 'monitoring', label: 'Überwachung', short: 'Überwachung', icon: Radar },
  { id: 'backup', label: 'Backup', short: 'Backup', icon: Archive },
];

export const HOST_ICON = ShieldCheck;

export const STATUS_STYLE: Record<Status, { label: string; cell: string; text: string; dot: string }> = {
  pass: { label: 'OK', cell: 'bg-ok/15 border-ok/30 text-ok', text: 'text-ok', dot: 'bg-ok' },
  warn: { label: 'Prüfen', cell: 'bg-accent/15 border-accent/35 text-accent', text: 'text-accent', dot: 'bg-accent' },
  fail: { label: 'Mangel', cell: 'bg-bad/15 border-bad/35 text-bad', text: 'text-bad', dot: 'bg-bad' },
  unknown: { label: 'Unbekannt', cell: 'bg-line/[0.05] border-line/[0.10] text-faint', text: 'text-faint', dot: 'bg-faint' },
};

export const SEVERITY_LABEL: Record<Severity, string> = { critical: 'kritisch', high: 'hoch', medium: 'mittel', low: 'gering' };
export const SEVERITY_RANK: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const STATUS_RANK: Record<Status, number> = { fail: 3, warn: 2, pass: 1, unknown: 0 };

/** Worst status within a category (unknown only if nothing else is known) */
export function categoryStatus(findings: Finding[], category: Category): Status | null {
  const list = findings.filter((finding) => finding.category === category);
  if (!list.length) return null;
  return list.reduce<Status>((worst, finding) => (STATUS_RANK[finding.status] > STATUS_RANK[worst] ? finding.status : worst), 'unknown');
}

export function scoreTone(score: number | null) {
  if (score === null) return 'text-faint';
  if (score >= 80) return 'text-ok';
  if (score >= 55) return 'text-accent';
  return 'text-bad';
}

export const SSH_STATE_LABEL = {
  ok: 'per SSH geprüft',
  error: 'SSH-Abfrage fehlgeschlagen',
  'no-access': 'kein SSH-Zugang: nur Proxmox-Ebene geprüft',
  'not-running': 'ausgeschaltet: nur Proxmox-Ebene geprüft',
  windows: 'Windows: nur Proxmox-Ebene geprüft',
} as const;
