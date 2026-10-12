import { cn } from '@/lib/utils';
import type { Risk, Verdict } from '@/services/soc';
import { RISK, VERDICT } from '@/lib/soc';

export function VerdictBadge({ verdict, className }: { verdict: Verdict; className?: string }) {
  const meta = VERDICT[verdict];
  return <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-px text-[11px]', meta.className, className)}>{meta.label}</span>;
}

export function RiskBadge({ risk }: { risk: Risk }) {
  const meta = RISK[risk];
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap text-[11.5px]', meta.className)}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} /> {meta.label}
    </span>
  );
}
