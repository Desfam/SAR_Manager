import type { Finding, Incident, Risk, Severity, SocEvent, Verdict } from '@/services/soc';

export const VERDICT: Record<Verdict, { label: string; className: string }> = {
  informational: { label: 'Info', className: 'border-line/[0.12] text-muted' },
  likely_benign: { label: 'Vermutlich harmlos', className: 'border-ok/30 text-ok' },
  review: { label: 'Prüfen', className: 'border-accent/40 bg-accent/[0.08] text-accent' },
  suspicious: { label: 'Auffällig', className: 'border-bad/40 bg-bad/[0.08] text-bad' },
  critical: { label: 'Kritisch', className: 'border-bad bg-bad/20 text-bad' },
};

export const RISK: Record<Risk, { label: string; className: string; dot: string }> = {
  info: { label: 'info', className: 'text-faint', dot: 'bg-faint' },
  low: { label: 'niedrig', className: 'text-muted', dot: 'bg-muted' },
  medium: { label: 'mittel', className: 'text-accent', dot: 'bg-accent' },
  high: { label: 'hoch', className: 'text-bad', dot: 'bg-bad' },
  critical: { label: 'kritisch', className: 'text-bad font-semibold', dot: 'bg-bad' },
};

export const CONFIDENCE = { low: 'gering', medium: 'mittel', high: 'hoch' } as const;

export const RANGES = [
  { hours: 1, label: '1 h' },
  { hours: 24, label: '24 h' },
  { hours: 24 * 7, label: '7 T' },
  { hours: 24 * 30, label: '30 T' },
];

export const eventKey = (event: { index: string; id: string }) => `${event.index}/${event.id}`;

export function formatTime(value?: string, withDate = false) {
  if (!value) return '–';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const today = new Date().toDateString() === date.toDateString();
  return date.toLocaleString('de-DE', withDate || !today ? { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const SEVERITY_STYLE: Record<Severity, { label: string; className: string; color: string }> = {
  info: { label: 'Info', className: 'border-line/[0.12] text-muted', color: 'rgb(var(--faint))' },
  low: { label: 'Niedrig', className: 'border-line/[0.16] text-muted', color: 'rgb(var(--muted))' },
  medium: { label: 'Mittel', className: 'border-accent/40 bg-accent/[0.08] text-accent', color: 'rgb(var(--accent))' },
  high: { label: 'Hoch', className: 'border-bad/40 bg-bad/[0.08] text-bad', color: 'rgb(var(--bad))' },
  critical: { label: 'Kritisch', className: 'border-bad bg-bad/20 text-bad font-semibold', color: 'rgb(var(--bad))' },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export const FINDING_STATUS: Record<Finding['status'], string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  resolved: 'Behoben',
  false_positive: 'Fehlalarm',
};

export const INCIDENT_STATUS: Record<Incident['status'], string> = {
  open: 'Offen',
  in_progress: 'In Bearbeitung',
  resolved: 'Gelöst',
  closed: 'Geschlossen',
};

export type IncidentDraft = Partial<Pick<Incident, 'title' | 'host' | 'severity' | 'description' | 'eventRefs' | 'ruleIds' | 'eventIds' | 'checks' | 'findingIds'>>;

const riskToSeverity = (risk: Risk): Severity => (risk === 'info' ? 'low' : risk);

export const draftFromEvent = (event: SocEvent): IncidentDraft => ({
  title: `${event.rule.description ?? 'Event'} auf ${event.agent.name}`,
  host: event.agent.name ?? null,
  severity: riskToSeverity(event.assessment.risk),
  description: [event.assessment.why, '', 'Belege:', ...event.assessment.evidence.map((entry) => `- ${entry}`)].join('\n'),
  eventRefs: [{ index: event.index, id: event.id, description: event.rule.description, timestamp: event.timestamp }],
  ruleIds: event.rule.id ? [event.rule.id] : [],
  eventIds: event.eventId ? [event.eventId] : [],
  checks: event.assessment.nextSteps,
});

export const draftFromFindings = (findings: Finding[]): IncidentDraft => {
  const hosts = [...new Set(findings.map((finding) => finding.host))];
  const worst = SEVERITY_ORDER.find((severity) => findings.some((finding) => finding.severity === severity)) ?? 'medium';
  return {
    title: findings.length === 1 ? `${findings[0].title} auf ${findings[0].host}` : `${findings.length} Findings auf ${hosts.join(', ')}`,
    host: hosts.length === 1 ? hosts[0] : null,
    severity: worst === 'info' ? 'low' : worst,
    description: findings.map((finding) => `• ${finding.title} (${finding.host})\n  ${finding.reason}`).join('\n\n'),
    findingIds: findings.map((finding) => finding.id),
    checks: [...new Set(findings.flatMap((finding) => finding.checks))].slice(0, 12),
  };
};
