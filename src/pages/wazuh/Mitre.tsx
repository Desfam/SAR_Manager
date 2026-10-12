import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { useSocMitre } from '@/hooks/use-soc';
import { RANGES } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';

export function Mitre() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24 * 7);
  const mitre = useSocMitre(hours);
  const d = mitre.data;
  const maxTechnique = Math.max(1, ...(d?.tactics ?? []).flatMap((tactic) => tactic.techniques.map((technique) => technique.count)));

  return (
    <>
      <PageHeader
        section="Threat Intelligence"
        title="MITRE ATT&CK"
        description="Welche Angriffstaktiken und -techniken Wazuh in den Events erkennt, auf welchen Hosts"
        actions={
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {RANGES.map((range) => (
              <button key={range.hours} type="button" onClick={() => setHours(range.hours)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                {hours === range.hours && <motion.span layoutId="mitre-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{range.label}</span>
              </button>
            ))}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[
          ['Events mit MITRE-Bezug', d?.total],
          ['Betroffene Hosts', d?.hosts],
          ['Taktiken', d?.tactics.length],
        ].map(([label, value], index) => (
          <NotchCard key={label as string} index={index} className="min-h-[118px]" eyebrow="MITRE" title={label as string}>
            <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{d ? <AnimatedNumber value={(value as number) ?? 0} /> : <Shimmer className="h-8 w-20" />}</p>
          </NotchCard>
        ))}
      </div>

      <p className="mt-5 text-[12px] text-faint">Viele Treffer kommen von Regeln für normale Anmeldungen (z. B. „Valid Accounts“). Entscheidend sind seltene Techniken mit hohem Level. Klick auf eine Technik öffnet die Events in der Investigation.</p>

      <div className="mt-3 overflow-x-auto pb-2">
        <div className="flex min-w-max gap-3">
          {!d && Array.from({ length: 5 }, (_, index) => <Shimmer key={index} className="h-96 w-64" />)}
          {d?.tactics.map((tactic, column) => (
            <motion.div key={tactic.name} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: column * 0.04 }} className="panel-surface w-64 shrink-0 rounded-2xl p-3">
              <p className="text-[13px] font-semibold">{tactic.name}</p>
              <p className="mb-3 font-mono text-[11px] text-faint">{formatCount(tactic.count)} Events</p>
              <ul className="space-y-1.5">
                {tactic.techniques.map((technique) => (
                  <li key={technique.name}>
                    <button
                      type="button"
                      onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(`mitre:${technique.id ?? technique.name}`)}&hours=${hours}`)}
                      className="relative w-full overflow-hidden rounded-xl border border-line/[0.07] px-2.5 py-2 text-left transition-colors hover:border-accent/35"
                      title={technique.rules.join('\n')}
                    >
                      <span className="absolute inset-y-0 left-0 bg-accent/[0.10]" style={{ width: `${Math.max(4, (Math.log10(technique.count + 1) / Math.log10(maxTechnique + 1)) * 100)}%` }} />
                      <span className="relative flex items-center gap-2">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{technique.name}</span>
                          <span className="block truncate font-mono text-[10.5px] text-faint">{technique.id} · {technique.hostCount} Hosts · {formatCount(technique.count)}</span>
                        </span>
                        <LevelPill level={technique.maxLevel} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </>
  );
}
