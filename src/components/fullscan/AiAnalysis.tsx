import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Shimmer } from '@/components/systems/fx';
import { Markdown } from '@/components/investigation/Markdown';
import { socKeys, useClaudeStatus } from '@/hooks/use-soc';
import { socOps, type Explanation, type ScanResult } from '@/services/soc';

const RISK_TONE: Record<string, string> = {
  kritisch: 'border-bad bg-bad/15 text-bad',
  hoch: 'border-bad/50 bg-bad/[0.08] text-bad',
  mittel: 'border-accent/45 bg-accent/[0.08] text-accent',
  niedrig: 'border-ok/40 bg-ok/[0.08] text-ok',
};

/** First word after "## Gesamtrisiko", e.g. "Hoch" */
function overallRisk(text: string) {
  const match = /##\s*Gesamtrisiko[^\n]*\n+\s*\**\s*(Niedrig|Mittel|Hoch|Kritisch)/i.exec(text);
  return match?.[1];
}

/** Claude's evaluation of all findings of a scan; runs only after confirmation */
export function AiAnalysis({ scan }: { scan: ScanResult }) {
  const queryClient = useQueryClient();
  const status = useClaudeStatus();
  const [result, setResult] = useState<Explanation | null>(scan.ai ?? null);
  const [confirm, setConfirm] = useState(false);
  const [web, setWeb] = useState(true);
  const analyze = useMutation({
    mutationFn: () => socOps.analyzeScan(scan.id, web),
    onSuccess: (value) => {
      setResult(value);
      void queryClient.invalidateQueries({ queryKey: socKeys.scans });
    },
  });
  const ready = status.data?.loggedIn;
  const risk = result ? overallRisk(result.text) : undefined;
  const liveIncluded = !!scan.live && !('error' in scan.live);

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-[22px] border border-accent/25 bg-accent/[0.04] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-5 text-accent" />
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold">KI-Auswertung</h2>
          <p className="text-[12px] text-muted">Claude bewertet alle Befunde dieses Scans, schätzt das Risiko ein und fasst zusammen</p>
        </div>
        {risk && <span className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold ${RISK_TONE[risk.toLowerCase()] ?? ''}`}>Gesamtrisiko: {risk}</span>}
        <button
          type="button"
          disabled={!ready || analyze.isPending}
          onClick={() => setConfirm(true)}
          className={result ? 'ml-auto flex h-9 items-center gap-1.5 rounded-full border border-line/[0.12] px-3.5 text-[12.5px] text-muted hover:text-ink disabled:opacity-45' : 'ml-auto flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13px] font-medium text-accent-ink disabled:opacity-45'}
        >
          {analyze.isPending ? <Loader2 className="size-4 animate-spin" /> : result ? <RefreshCw className="size-3.5" /> : <Sparkles className="size-4" />}
          {analyze.isPending ? 'Claude wertet aus …' : result ? 'Neu auswerten' : 'Mit Claude auswerten'}
        </button>
      </div>
      {status.data && !ready && <p className="mt-3 break-all text-[12px] text-muted">{status.data.hint}</p>}

      <AnimatePresence mode="wait">
        {analyze.isPending ? (
          <motion.div key="pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-4 space-y-2">
            <p className="text-[12px] text-muted">{web ? 'Claude liest die Befunde und schlägt Risiken online nach. Das dauert meist 30 bis 90 Sekunden.' : 'Claude liest die Befunde. Das dauert meist 15 bis 30 Sekunden.'}</p>
            <Shimmer className="h-3 w-3/4" /><Shimmer className="h-3 w-2/3" /><Shimmer className="h-3 w-4/5" /><Shimmer className="h-3 w-1/2" />
          </motion.div>
        ) : result ? (
          <motion.div key={result.createdAt} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-4 max-w-[980px]">
            <Markdown text={result.text} />
            <p className="mt-4 text-[10.5px] text-faint">
              {result.model}{result.durationMs ? ` · ${Math.round(result.durationMs / 1000)} s` : ''}{result.costUsd ? ` · ${result.costUsd.toFixed(3)} $` : ''}{result.web ? ' · mit Websuche' : ' · ohne Websuche'} · erstellt {new Date(result.createdAt).toLocaleString('de-DE')} · KI kann sich irren, Belege prüfen
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {analyze.isError && <p className="mt-3 text-[12.5px] text-bad">{(analyze.error as Error).message}</p>}

      <ConfirmDialog
        open={confirm}
        icon={<Sparkles className="size-5" />}
        title="Scan mit Claude auswerten?"
        confirmLabel="Auswerten"
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          analyze.mutate();
        }}
        description={
          <div className="space-y-2.5 text-left">
            <p>An Claude (Anthropic, Modell Haiku) gehen für <span className="font-mono">{scan.host}</span>:</p>
            <ul className="list-disc space-y-0.5 pl-5 text-[12.5px]">
              <li>alle {scan.findings.length} Befunde mit Begründung und Belegen</li>
              <li>Kennzahlen: Anmeldungen, Schwachstellen, Konfigurationsprüfung, MITRE, Ports</li>
              {liveIncluded && <li>Live-Daten: Prüfungen, Ausschnitte aus Logs (IP-Adressen, Benutzernamen, sudo-Befehle, Paketnamen)</li>}
            </ul>
            <label className="flex items-start gap-2 text-[12.5px]">
              <input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} className="mt-0.5 accent-[rgb(var(--accent))]" />
              <span>Risiken online nachschlagen (z. B. ob CVEs aktiv ausgenutzt werden). Genauer, aber teurer: ca. 5–15 Cent statt 1–3 Cent.</span>
            </label>
            <p className="text-[11.5px] text-faint">Das Ergebnis wird mit dem Scan gespeichert.</p>
          </div>
        }
      />
    </motion.section>
  );
}
