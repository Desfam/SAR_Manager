import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LevelPill } from '@/components/wazuh/EventList';
import type { SocEvent } from '@/services/soc';
import { eventKey, formatTime } from '@/lib/soc';
import { RiskBadge, VerdictBadge } from './badges';

const GRID = 'grid-cols-[86px_minmax(90px,0.8fr)_minmax(80px,0.7fr)_64px_42px_minmax(160px,2fr)_120px_76px]';

/** TIME · HOST · USER · RULE · LEVEL · EVENT · VERDICT · RISK */
export function EventTable({
  events,
  selected,
  onSelect,
  onLoadMore,
  loadingMore,
  maxHeight = 560,
  showDate,
}: {
  events: SocEvent[];
  selected?: string | null;
  onSelect: (event: SocEvent) => void;
  onLoadMore?: () => void;
  loadingMore?: boolean;
  maxHeight?: number;
  showDate?: boolean;
}) {
  return (
    <div className="overflow-x-auto">
      <div className="min-w-[860px]">
        <div className={cn('grid gap-3 border-b border-line/[0.07] px-3 pb-2 text-[10.5px] uppercase tracking-[0.1em] text-faint', GRID)}>
          <span>Zeit</span><span>Host</span><span>User</span><span>Rule</span><span>Level</span><span>Event</span><span>Verdict</span><span>Risk</span>
        </div>
        <ul className="scroll-thin overflow-y-auto" style={{ maxHeight }}>
          {events.map((event) => {
            const key = eventKey(event);
            const active = selected === key;
            const serious = event.assessment.risk === 'high' || event.assessment.risk === 'critical';
            return (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => onSelect(event)}
                  className={cn(
                    'grid w-full items-center gap-3 border-b border-line/[0.04] px-3 py-2 text-left text-[12.5px] transition-colors',
                    GRID,
                    active ? 'bg-accent/[0.10]' : serious ? 'bg-bad/[0.04] hover:bg-bad/[0.08]' : 'hover:bg-hover/50',
                  )}
                >
                  <span className="font-mono text-[11px] text-muted">{formatTime(event.timestamp, showDate)}</span>
                  <span className="truncate font-medium">{event.agent.name}</span>
                  <span className="truncate font-mono text-[11.5px] text-muted">{event.user ?? '–'}</span>
                  <span className="font-mono text-[11.5px]">{event.eventId ?? event.rule.id}</span>
                  <LevelPill level={event.rule.level} />
                  <span className="truncate" title={event.rule.description}>{event.rule.description}</span>
                  <span><VerdictBadge verdict={event.assessment.verdict} /></span>
                  <RiskBadge risk={event.assessment.risk} />
                </button>
              </li>
            );
          })}
          {events.length === 0 && <li className="px-3 py-10 text-center text-[13px] text-muted">Keine Events.</li>}
        </ul>
        {onLoadMore && (
          <button type="button" onClick={onLoadMore} disabled={loadingMore} className="mx-auto mt-3 flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[12.5px] hover:bg-raised disabled:opacity-50">
            {loadingMore && <Loader2 className="size-3.5 animate-spin" />} Weitere laden
          </button>
        )}
      </div>
    </div>
  );
}
