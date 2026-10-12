import { CheckCircle2, CircleAlert, CircleDashed, Loader2, RefreshCw, XCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer } from '@/components/systems/fx';
import { useSocTrust } from '@/hooks/use-soc';

const ICON = { ok: CheckCircle2, warn: CircleAlert, fail: XCircle, off: CircleDashed };
const TONE = { ok: 'text-ok', warn: 'text-accent', fail: 'text-bad', off: 'text-faint' };

/** Integration (connection settings) and Trust Center (are all parts working?) share one data source */
export function TrustCenter({ mode }: { mode: 'trust' | 'integration' }) {
  const trust = useSocTrust();
  const checks = trust.data?.checks ?? [];
  const shown = mode === 'integration' ? checks.filter((check) => ['indexer', 'pattern', 'recent', 'manager', 'manager-cert', 'agents', 'ai'].includes(check.id)) : checks;
  const failing = checks.filter((check) => check.status === 'fail').length;
  const warning = checks.filter((check) => check.status === 'warn').length;

  return (
    <>
      <PageHeader
        section={mode === 'trust' ? 'Administration' : 'Endpoint Security'}
        title={mode === 'trust' ? 'Trust Center' : 'Wazuh Integration'}
        description={mode === 'trust' ? 'Funktioniert alles? Backend, Indexer, Cluster, Index-Muster, Alerts, Manager, Zertifikate und Bewertung' : 'Verbindung zu Wazuh-Indexer und Manager: Einstellungen und Tests'}
        actions={
          <button type="button" onClick={() => void trust.refetch()} className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13px] hover:bg-raised">
            {trust.isFetching ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Erneut prüfen
          </button>
        }
      />

      {mode === 'trust' && trust.data && (
        <div className={cn('mb-5 flex items-center gap-3 rounded-2xl border p-4 text-[13.5px]', failing ? 'border-bad/35 bg-bad/[0.06]' : warning ? 'border-accent/35 bg-accent/[0.06]' : 'border-ok/35 bg-ok/[0.06]')}>
          {failing ? <XCircle className="size-5 text-bad" /> : warning ? <CircleAlert className="size-5 text-accent" /> : <CheckCircle2 className="size-5 text-ok" />}
          {failing ? `${failing} Prüfung(en) fehlgeschlagen` : warning ? `Alles erreichbar, ${warning} Hinweis(e)` : 'Alle Prüfungen bestanden'}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <NotchCard index={0} eyebrow={`${shown.length} Prüfungen`} title="Prüfungen" bodyClassName="pt-3">
          {!trust.data ? (
            <div className="space-y-2">{Array.from({ length: 6 }, (_, index) => <Shimmer key={index} className="h-12" />)}</div>
          ) : (
            <ul className="space-y-1.5">
              {shown.map((check, index) => {
                const Icon = ICON[check.status];
                return (
                  <motion.li key={check.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: index * 0.04 }} className="flex items-start gap-3 rounded-2xl border border-line/[0.06] px-3.5 py-2.5">
                    <Icon className={cn('mt-0.5 size-4 shrink-0', TONE[check.status])} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium">{check.label}</span>
                      <span className="block text-[12px] text-muted">{check.detail}</span>
                    </span>
                    {check.ms !== undefined && <span className="font-mono text-[11px] text-faint">{check.ms} ms</span>}
                  </motion.li>
                );
              })}
            </ul>
          )}
        </NotchCard>
        <NotchCard index={1} eyebrow="aus backend/.env" title="Konfiguration" bodyClassName="pt-3">
          <dl className="space-y-2 text-[12.5px]">
            {Object.entries(trust.data?.config ?? {}).map(([key, value]) => (
              <div key={key} className="flex justify-between gap-4 border-b border-line/[0.05] pb-2 last:border-0">
                <dt className="text-muted">{{ indexerUrl: 'Indexer-URL', indexerUser: 'Indexer-Benutzer', indexPattern: 'Index-Muster', managerUrl: 'Manager-URL', managerUser: 'Manager-Benutzer', passwords: 'Passwörter' }[key] ?? key}</dt>
                <dd className="truncate text-right font-mono text-[12px]">{value ?? '–'}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-[11.5px] text-faint">Geändert wird die Konfiguration in <span className="font-mono">backend/.env</span>; Zugangsdaten werden nie an die Oberfläche gegeben. Der Indexer wird gegen die Wazuh-CA geprüft (<span className="font-mono">certs/wazuh-root-ca.pem</span>), der Manager über den gepinnten Zertifikats-Fingerabdruck.</p>
        </NotchCard>
      </div>
    </>
  );
}
