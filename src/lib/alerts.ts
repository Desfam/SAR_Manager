import type { HostAlert } from '@/hooks/use-infrastructure';

export type AlertSeverity = 'critical' | 'warning' | 'info';

export const METRIC_LABELS: Record<string, string> = { cpu: 'CPU-Last', memory: 'Speicherauslastung', disk: 'Storage' };

export const SEVERITY_LABELS: Record<AlertSeverity, string> = { critical: 'Kritisch', warning: 'Warnung', info: 'Info' };

export const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1, info: 2 };

export function metricLabel(metric: string) {
  return METRIC_LABELS[metric] ?? metric;
}

export function isValidPercent(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 100.5;
}

/** One-line description of a host alert. Out-of-range readings come from a collection error and are not shown as a percentage. */
export function hostAlertMessage(alert: Pick<HostAlert, 'metric_type' | 'metric_value' | 'threshold'>) {
  const label = metricLabel(alert.metric_type);
  const threshold = Number.isFinite(alert.threshold) ? ` (Schwelle ${Math.round(alert.threshold)} %)` : '';
  if (isValidPercent(alert.metric_value)) return `${label} ${Math.round(alert.metric_value)} %${threshold}`;
  return `${label} über Schwellenwert${threshold} · Messwert ungültig`;
}
