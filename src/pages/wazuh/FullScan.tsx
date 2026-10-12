import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, History, Loader2, ScanSearch, Siren, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber } from '@/components/ui/viz';
import { Radar } from '@/components/systems/fx';
import { LivePanel } from '@/components/fullscan/LivePanel';
import { WazuhPanel } from '@/components/fullscan/WazuhPanel';
import { AiAnalysis } from '@/components/fullscan/AiAnalysis';
import { HostPicker } from '@/components/soc/HostPicker';
import { FindingCard, SeverityBadge } from '@/components/soc/FindingCard';
import { IncidentFormDrawer } from '@/components/soc/IncidentForm';
import { socKeys, useScan, useScans } from '@/hooks/use-soc';
import { SEVERITY_ORDER, SEVERITY_STYLE, formatTime, type IncidentDraft } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import { socOps, type LiveReport, type ScanResult, type Severity } from '@/services/soc';

const SPANS = [
  { hours: 24, label: '24 h' },
  { hours: 72, label: '3 T' },
  { hours: 24 * 7, label: '7 T' },
];

const MODULES = ['Events & Regeln', 'Anmeldungen', 'Dateiintegrität', 'Konfiguration (SCA)', 'Schwachstellen', 'MITRE', 'Netzwerk', 'Live per SSH: Logs', 'Live per SSH: System'];

const SCALE: Array<{ key: Severity; label: string }> = [
  { key: 'info', label: 'Info' },
  { key: 'low', label: 'Niedrig' },
  { key: 'medium', label: 'Mittel' },
  { key: 'high', label: 'Hoch' },
  { key: 'critical', label: 'Kritisch' },
];

function Stat({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: string }) {
  return (
    <div className="min-w-0 rounded-xl border border-line/[0.07] bg-panel/40 px-3 py-2.5">
      <p className="text-[11px] text-faint">{label}</p>
      <p className={cn('mt-0.5 text-[20px] font-semibold leading-tight tabular-nums', tone)}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Summary({ scan, live }: { scan: ScanResult; live: LiveReport | null }) {
  const worst = scan.summary.worst;
  const findings = [...scan.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const bySeverity = scan.summary.findings.bySeverity;
  const total = Math.max(1, scan.summary.findings.total);
  const liveIssues = live ? live.checks.filter((check) => check.status === 'bad' || check.status === 'warn').length : null;
  const criticalCves = scan.modules.vulnerabilities.bySeverity.Critical ?? 0;
  const liveError = scan.live && 'error' in scan.live ? scan.live.error : null;
  return (
    <NotchCard index={0} glow tone={worst === 'critical' || worst === 'high' ? 'bad' : worst === 'medium' ? 'warn' : undefined} eyebrow={`${scan.host} · letzte ${scan.hours} h · ${formatTime(scan.scannedAt, true)}`} title="Ergebnis">
      <div className="mt-3 grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_minmax(0,1fr)]">
        {/* verdict */}
        <div>
          <motion.p initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 18 }} className="text-[40px] font-bold leading-none tracking-[-0.03em]" style={{ color: SEVERITY_STYLE[worst].color }}>
            {SEVERITY_STYLE[worst].label}
          </motion.p>
          <p className="mt-1.5 text-[12px] text-muted">höchste Schwere der Befunde</p>
          <div className="mt-3 flex gap-1">
            {SCALE.map((step, index) => {
              const reached = SCALE.findIndex((entry) => entry.key === worst) >= index;
              return (
                <motion.span key={step.key} title={step.label} className="h-1.5 flex-1 rounded-full" initial={{ opacity: 0.2 }} animate={{ opacity: reached ? 1 : 0.18 }} transition={{ delay: 0.2 + index * 0.08 }} style={{ background: reached ? SEVERITY_STYLE[worst].color : 'rgb(var(--line) / 0.3)' }} />
              );
            })}
          </div>
          <div className="mt-4 space-y-1.5 text-[11.5px]">
            <p className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-ok" /> Wazuh-Indexer und Manager</p>
            {live ? (
              <p className="flex items-center gap-2"><CheckCircle2 className="size-3.5 text-ok" /> {live.privilege === 'agent' ? 'Live vom SAR-Agenten' : <>Live per SSH als <span className="font-mono">{live.connection.user}</span></>}{live.privilege === 'nosudo' && <span className="text-warn">(ohne sudo)</span>}</p>
            ) : (
              <p className="flex items-start gap-2 text-muted"><XCircle className="mt-px size-3.5 shrink-0 text-faint" /> {liveError ? `SSH: ${liveError}` : 'Kein Live-Teil (Windows oder älterer Scan)'}</p>
            )}
          </div>
        </div>

        {/* most important */}
        <div className="min-w-0">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Das Wichtigste</p>
          {findings.length ? (
            <ol className="space-y-2.5">
              {findings.slice(0, 4).map((finding, index) => (
                <motion.li key={finding.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 + index * 0.07 }} className="flex gap-2.5">
                  <span className="mt-1.5 size-2 shrink-0 rounded-full" style={{ background: SEVERITY_STYLE[finding.severity].color }} />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-snug">{finding.title}</p>
                    <p className="line-clamp-2 text-[12px] leading-snug text-muted">{finding.reason}</p>
                  </div>
                </motion.li>
              ))}
            </ol>
          ) : <p className="text-[13px] text-ok">Keine Auffälligkeiten im Zeitraum.</p>}
        </div>

        {/* numbers */}
        <div className="grid grid-cols-2 content-start gap-2">
          <Stat label="Events" value={<AnimatedNumber value={scan.summary.events} />} sub={`${formatCount(scan.summary.levels.high)} hoch · ${formatCount(scan.summary.levels.medium)} mittel`} />
          <div className="min-w-0 rounded-xl border border-line/[0.07] bg-panel/40 px-3 py-2.5">
            <p className="text-[11px] text-faint">Findings</p>
            <p className="mt-0.5 text-[20px] font-semibold leading-tight tabular-nums"><AnimatedNumber value={scan.summary.findings.total} /></p>
            <div className="mt-1.5 flex h-1.5 overflow-hidden rounded-full bg-line/[0.07]">
              {(['critical', 'high', 'medium', 'low'] as Severity[]).map((severity) => (
                <motion.span key={severity} style={{ background: SEVERITY_STYLE[severity].color }} initial={{ width: 0 }} animate={{ width: `${((bySeverity[severity] ?? 0) / total) * 100}%` }} transition={{ duration: 0.8, delay: 0.3 }} />
              ))}
            </div>
          </div>
          <Stat label="Fehlanmeldungen" value={formatCount(scan.modules.auth.failed + (live?.logs.sshFailed.total ?? 0))} tone={scan.modules.auth.failed ? 'text-bad' : undefined} sub={live ? `davon SSH live: ${live.logs.sshFailed.total}` : `${formatCount(scan.modules.auth.success)} erfolgreich`} />
          <Stat label="Kritische CVEs" value={formatCount(criticalCves)} tone={criticalCves ? 'text-bad' : 'text-ok'} sub="laut Wazuh" />
          <Stat label="Dateiänderungen" value={formatCount(scan.modules.fim.changes)} sub={`${scan.modules.fim.paths.filter((path) => path.sensitive).length} sensible Pfade`} />
          <Stat label="Live-Prüfungen" value={liveIssues === null ? '–' : liveIssues ? `${liveIssues} auffällig` : 'ok'} tone={liveIssues ? 'text-warn' : liveIssues === 0 ? 'text-ok' : undefined} sub={live ? `${live.checks.length} Prüfungen per SSH` : 'nicht verfügbar'} />
        </div>
      </div>
    </NotchCard>
  );
}

function Report({ scan, onIncident }: { scan: ScanResult; onIncident: (draft: IncidentDraft) => void }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'findings' | 'live' | 'wazuh'>('findings');
  const live = scan.live && !('error' in scan.live) ? scan.live : null;
  const findings = [...scan.findings].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const groups = SEVERITY_ORDER.map((severity) => ({ severity, items: findings.filter((finding) => finding.severity === severity) })).filter((group) => group.items.length);
  const liveIssues = live ? live.checks.filter((check) => check.status === 'bad' || check.status === 'warn').length : 0;
  const tabs = [
    { key: 'findings' as const, label: 'Findings', count: findings.length },
    { key: 'live' as const, label: 'Live per SSH', count: live ? liveIssues : scan.live ? '!' : '–' },
    { key: 'wazuh' as const, label: 'Wazuh-Daten', count: undefined },
  ];
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-5 space-y-5">
      <Summary scan={scan} live={live} />
      <AiAnalysis key={scan.id} scan={scan} />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex rounded-full border border-line/[0.12] p-1">
          {tabs.map((entry) => (
            <button key={entry.key} type="button" onClick={() => setTab(entry.key)} className={cn('relative flex h-8 items-center gap-2 rounded-full px-4 text-[13px]', tab === entry.key ? 'text-ink' : 'text-muted hover:text-ink')}>
              {tab === entry.key && <motion.span layoutId="scan-tab" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
              <span className="relative">{entry.label}</span>
              {entry.count !== undefined && <span className="relative rounded-full bg-line/[0.08] px-1.5 font-mono text-[10.5px]">{entry.count}</span>}
            </button>
          ))}
        </div>
        {tab === 'findings' && !!findings.length && (
          <div className="ml-auto flex gap-2">
            <button type="button" onClick={() => onIncident({ title: `Full Scan ${scan.host}: ${findings.length} Findings`, host: scan.host, severity: scan.summary.worst === 'info' ? 'low' : scan.summary.worst, description: findings.map((f) => `• ${f.title}\n  ${f.reason}`).join('\n\n'), checks: [...new Set(findings.flatMap((f) => f.checks))].slice(0, 12) })} className="flex h-9 items-center gap-1.5 rounded-full border border-accent/30 px-3.5 text-[12.5px] text-accent hover:bg-accent/10"><Siren className="size-3.5" /> Incident aus allen</button>
            <button type="button" onClick={() => navigate(`/wazuh/findings?host=${encodeURIComponent(scan.host)}`)} className="flex h-9 items-center gap-1.5 rounded-full border border-line/[0.12] px-3.5 text-[12.5px] text-muted hover:text-ink"><ClipboardList className="size-3.5" /> Findings-Liste</button>
          </div>
        )}
      </div>

      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2 }}>
          {tab === 'findings' && (
            findings.length ? (
              <div className="space-y-5">
                {groups.map((group) => (
                  <section key={group.severity}>
                    <p className="mb-2 flex items-center gap-2 text-[12px] font-semibold">
                      <span className="size-2 rounded-full" style={{ background: SEVERITY_STYLE[group.severity].color }} />
                      {SEVERITY_STYLE[group.severity].label}
                      <span className="font-mono text-[11px] font-normal text-faint">{group.items.length}</span>
                    </p>
                    <ul className="space-y-2">{group.items.map((finding, index) => <FindingCard key={finding.key} finding={finding} index={index} />)}</ul>
                  </section>
                ))}
                {scan.stored && <p className="text-[11.5px] text-faint">Gespeichert: {scan.stored.created} neu, {scan.stored.updated} aktualisiert (gleiche Befunde werden nicht doppelt angelegt).</p>}
              </div>
            ) : <p className="py-8 text-center text-[13px] text-ok">Keine Auffälligkeiten im Zeitraum.</p>
          )}
          {tab === 'live' && <LivePanel live={scan.live} />}
          {tab === 'wazuh' && <WazuhPanel scan={scan} />}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

export function FullScan() {
  const [params, setParams] = useSearchParams();
  const queryClient = useQueryClient();
  const host = params.get('host');
  const scanId = params.get('scan');
  const [hours, setHours] = useState(24);
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const [fresh, setFresh] = useState<ScanResult | null>(null);
  const history = useScans(host ?? undefined);
  const stored = useScan(scanId && scanId !== fresh?.id ? scanId : null);
  const scan = fresh && (!scanId || scanId === fresh.id) ? fresh : stored.data ?? null;
  const [step, setStep] = useState(0);

  const run = useMutation({
    mutationFn: () => socOps.scan(host!, hours),
    onSuccess: (result) => {
      setFresh(result);
      setParams({ host: result.host, scan: result.id }, { replace: true });
      void queryClient.invalidateQueries({ queryKey: socKeys.scans });
      void queryClient.invalidateQueries({ queryKey: socKeys.findings });
      toast.success(`Scan fertig: ${result.findings.length} Findings`);
    },
    onError: (failure: Error) => toast.error('Scan fehlgeschlagen', { description: failure.message }),
  });

  // cosmetic progress through the modules while the request runs
  useEffect(() => {
    if (!run.isPending) return;
    setStep(0);
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, MODULES.length - 1)), 700);
    return () => clearInterval(timer);
  }, [run.isPending]);

  return (
    <>
      <PageHeader section="Explore" title="Full Scan" description="Ausführliche, regelbasierte Auswertung eines Hosts aus allen Wazuh-Daten. Liest nur, ändert nichts am Host." />

      <NotchCard index={0} eyebrow="Ziel" title="Host prüfen" bodyClassName="pt-3">
        <div className="flex flex-wrap items-center gap-3">
          <HostPicker value={host} onChange={(name) => { setFresh(null); setParams({ host: name }, { replace: true }); }} />
          <div className="flex rounded-full border border-line/[0.12] p-1">
            {SPANS.map((span) => (
              <button key={span.hours} type="button" onClick={() => setHours(span.hours)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', hours === span.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                {hours === span.hours && <motion.span layoutId="scan-span" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{span.label}</span>
              </button>
            ))}
          </div>
          <button type="button" disabled={!host || run.isPending} onClick={() => run.mutate()} className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13px] font-medium text-accent-ink disabled:opacity-50">
            {run.isPending ? <Loader2 className="size-4 animate-spin" /> : <ScanSearch className="size-4" />} Scan starten
          </button>
        </div>
        <div className="mt-4 flex flex-wrap gap-1.5">
          {MODULES.map((module, index) => (
            <span key={module} className={cn('rounded-full border px-2.5 py-0.5 text-[11.5px] transition-colors', run.isPending && index === step ? 'border-accent/50 bg-accent/[0.12] text-ink' : run.isPending && index < step ? 'border-ok/30 text-ok' : 'border-line/[0.10] text-muted')}>{module}</span>
          ))}
        </div>
      </NotchCard>

      <AnimatePresence mode="wait">
        {run.isPending ? (
          <motion.div key="running" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="mt-10 flex flex-col items-center gap-4 text-[13px] text-muted">
            <Radar active size={96}><ScanSearch className="size-6 text-accent" /></Radar>
            Werte {MODULES[step]} für {host} aus …
          </motion.div>
        ) : scan ? (
          <Report key={scan.id} scan={scan} onIncident={setDraft} />
        ) : stored.isLoading ? (
          <p key="loading" className="mt-10 text-center text-[13px] text-muted">Lädt gespeicherten Scan …</p>
        ) : (
          <motion.p key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-10 text-center text-[13px] text-muted">{host ? 'Zeitraum wählen und Scan starten.' : 'Host wählen, um zu starten.'}</motion.p>
        )}
      </AnimatePresence>

      <NotchCard index={14} className="mt-5" eyebrow={host ?? 'alle Hosts'} title="Verlauf" bodyClassName="pt-3">
        {history.data?.length ? (
          <ul className="space-y-1">
            {history.data.map((entry) => (
              <li key={entry.id}>
                <button type="button" onClick={() => { setFresh(null); setParams({ host: entry.host, scan: entry.id }, { replace: true }); }} className={cn('grid w-full grid-cols-[18px_minmax(0,1fr)_90px_80px_150px] items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[12.5px] hover:bg-hover/50', scan?.id === entry.id && 'bg-accent/[0.08]')}>
                  <History className="size-3.5 text-faint" />
                  <span className="truncate font-medium">{entry.host}</span>
                  <SeverityBadge severity={entry.worst} />
                  <span className="font-mono text-[11.5px] text-muted">{entry.findings} Findings</span>
                  <span className="text-right font-mono text-[11px] text-faint">{formatTime(entry.createdAt, true)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : <p className="py-4 text-center text-[12.5px] text-muted">Noch keine Scans.</p>}
      </NotchCard>

      <IncidentFormDrawer draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}
