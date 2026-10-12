import { CheckCircle2, ListChecks, Scale } from 'lucide-react';
import type { SocEvent } from '@/services/soc';
import { CONFIDENCE } from '@/lib/soc';
import { RiskBadge, VerdictBadge } from './badges';

/** Rule-based assessment of one event: verdict, risk, why it matters, evidence, next steps */
export function AssessmentCard({ event }: { event: SocEvent }) {
  const assessment = event.assessment;
  return (
    <div className="space-y-4">
      <div>
        <p className="truncate text-[15px] font-semibold">{event.rule.description}</p>
        <p className="font-mono text-[11.5px] text-muted">{event.agent.name} · Regel {event.rule.id}{event.eventId ? ` · Event ${event.eventId}` : ''}</p>
      </div>
      <dl className="grid grid-cols-2 gap-2 text-[12px]">
        {[
          ['Verdict', <VerdictBadge key="v" verdict={assessment.verdict} />],
          ['Risiko', <RiskBadge key="r" risk={assessment.risk} />],
          ['Sicherheit', CONFIDENCE[assessment.confidence]],
          ['Quelle', <span key="s" title="Feste Regeln, keine KI">regelbasiert</span>],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-xl border border-line/[0.07] px-3 py-2">
            <dt className="text-[11px] text-muted">{label}</dt>
            <dd className="mt-0.5">{value}</dd>
          </div>
        ))}
      </dl>
      <div>
        <p className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint"><Scale className="size-3.5" /> Warum relevant · {assessment.category}</p>
        <p className="text-[12.5px] leading-[19px] text-ink/90">{assessment.why}</p>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint"><CheckCircle2 className="size-3.5" /> Belege</p>
        <ul className="space-y-1">
          {assessment.evidence.map((entry) => (
            <li key={entry} className="flex gap-2 text-[12px] text-ink/85"><span className="mt-1.5 size-1 shrink-0 rounded-full bg-accent" /> {entry}</li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium uppercase tracking-[0.08em] text-faint"><ListChecks className="size-3.5" /> Nächste Schritte</p>
        <ol className="space-y-1">
          {assessment.nextSteps.map((step, index) => (
            <li key={step} className="flex gap-2 text-[12px] text-ink/85"><span className="w-4 shrink-0 font-mono text-faint">{index + 1}.</span> {step}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}
