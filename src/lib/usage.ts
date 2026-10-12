// Thresholds and formatting shared by every usage display

export type UsageTone = 'normal' | 'warn' | 'bad';

/** Warning from 80 %, critical from 90 %. */
export function usageTone(value: number | null | undefined): UsageTone {
  if (value === null || value === undefined) return 'normal';
  if (value >= 90) return 'bad';
  if (value >= 80) return 'warn';
  return 'normal';
}

// Normal load stays neutral so that orange only ever means "look here"
export const toneText: Record<UsageTone, string> = { normal: 'text-ink', warn: 'text-accent', bad: 'text-bad' };
export const toneBar: Record<UsageTone, string> = {
  normal: 'from-ink/25 to-ink/55',
  warn: 'from-accent/70 to-accent',
  bad: 'from-bad/70 to-bad',
};

export function formatUptime(seconds?: number) {
  if (!seconds) return '–';
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days} T ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}

