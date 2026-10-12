import { useNavigate } from 'react-router-dom';
import { Radar } from 'lucide-react';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer, SplitBar } from '@/components/systems/fx';
import { EventList } from '@/components/wazuh/EventList';
import { useWazuhEvents, useWazuhStatus, useWazuhSummary } from '@/hooks/use-wazuh';
import { SEVERITY, formatCount } from '@/lib/wazuh';

/** Wazuh events of one system (matched by agent IP) for the server overview */
export function WazuhEventsCard({ index, ip }: { index: number; ip: string }) {
  const navigate = useNavigate();
  const status = useWazuhStatus();
  const ready = status.data?.configured === true;
  const filters = { hours: 24, agentIp: ip };
  const summary = useWazuhSummary(filters, ready);
  const events = useWazuhEvents(filters, 8, ready);
  if (!ready) return null;

  const s = summary.data;
  const agent = s?.agents[0];
  const list = events.data?.pages[0]?.events ?? [];
  const serious = s ? s.severity.medium + s.severity.high + s.severity.critical : 0;

  return (
    <NotchCard
      index={index}
      eyebrow={agent ? `Agent ${agent.name} · letzte 24 h` : 'Wazuh · letzte 24 h'}
      title="Wazuh-Events"
      tone={s && s.severity.high + s.severity.critical > 0 ? 'bad' : undefined}
      bodyClassName="pt-3"
      actions={agent ? [{ label: 'Im Wazuh-Tab öffnen', icon: <Radar />, onClick: () => navigate(`/wazuh/analytics?agent=${encodeURIComponent(agent.name)}`) }] : []}
    >
      {!s ? (
        <div className="space-y-2"><Shimmer className="h-8 w-40" /><Shimmer className="h-2 w-full" /></div>
      ) : s.total === 0 ? (
        <p className="text-[12.5px] text-muted">Keine Events von {ip} in den letzten 24 Stunden{agent ? '' : ' (kein Wazuh-Agent mit dieser IP)'}.</p>
      ) : (
        <>
          <div className="flex items-end gap-6">
            <p className="text-[32px] font-bold leading-none tracking-[-0.03em]">{formatCount(s.total)}</p>
            <p className="pb-1 text-[12.5px] text-muted">{serious ? <><span className="text-accent">{serious}</span> ab Level 7</> : 'nur niedrige Level'}</p>
          </div>
          <div className="mt-3">
            <SplitBar
              parts={[
                { value: s.severity.critical + s.severity.high, color: SEVERITY.high.color, label: 'Hoch/Kritisch' },
                { value: s.severity.medium, color: SEVERITY.medium.color, label: 'Mittel' },
                { value: s.severity.low, color: 'rgb(var(--line) / 0.25)', label: 'Niedrig' },
              ]}
            />
          </div>
          <div className="mt-4">{events.data ? <EventList events={list} compact /> : <Shimmer className="h-24 w-full" />}</div>
        </>
      )}
    </NotchCard>
  );
}
