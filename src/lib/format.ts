import { formatDistanceToNowStrict } from 'date-fns';
import { de } from 'date-fns/locale';

const percentFormat = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return `${percentFormat.format(value)} %`;
}

export function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond === null || bytesPerSecond === undefined || !Number.isFinite(bytesPerSecond)) return '–';
  const units = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
  let value = bytesPerSecond;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat('de-DE', { maximumFractionDigits: value < 10 ? 1 : 0 }).format(value)} ${units[unit]}`;
}

/** Parses backend timestamps; SQLite's CURRENT_TIMESTAMP is UTC without a zone marker. */
export function parseBackendDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const normalized = /[zZ]|[+-]\d\d:?\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatRelative(value: string | null | undefined): string {
  const date = parseBackendDate(value);
  if (!date) return '–';
  return `vor ${formatDistanceToNowStrict(date, { locale: de })}`;
}

export function formatClock(value: string | number | Date | null | undefined): string {
  const date = typeof value === 'string' ? parseBackendDate(value) : value ? new Date(value) : null;
  if (!date) return '–';
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}
