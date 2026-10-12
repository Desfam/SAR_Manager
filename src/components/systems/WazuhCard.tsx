import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleAlert, CircleDashed, Download, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { motion } from 'motion/react';
import { Radar } from '@/components/systems/fx';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { useWazuhJob } from '@/hooks/use-hardening';
import { systemApi, type SystemFacts } from '@/services/hardening';

const DEFAULTS = { manager: '172.21.5.91', version: '4.14.5' };
const read = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
};

const inputClass = 'h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 font-mono text-[13px] outline-none transition-colors placeholder:font-sans placeholder:text-faint focus:border-accent/45';

function InstallPanel({ connectionId, systemName, defaultName, onClose }: { connectionId: string; systemName: string; defaultName: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [manager, setManager] = useState(read('sar.wazuhManager', DEFAULTS.manager));
  const [version, setVersion] = useState(read('sar.wazuhVersion', DEFAULTS.version));
  const [agentName, setAgentName] = useState(defaultName);
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useWazuhJob(jobId);
  const outputRef = useRef<HTMLPreElement>(null);

  const start = useMutation({
    mutationFn: () => systemApi.installWazuh(connectionId, { manager: manager.trim(), version: version.trim(), agentName: agentName.trim() || undefined }),
    onSuccess: (result) => {
      remember('sar.wazuhManager', manager.trim());
      remember('sar.wazuhVersion', version.trim());
      setJobId(result.id);
    },
    onError: (failure: Error) => toast.error('Installation nicht gestartet', { description: failure.message }),
  });

  const status = job.data?.status;
  useEffect(() => {
    if (status === 'success') {
      toast.success(`Wazuh-Agent auf ${systemName} installiert`);
      void queryClient.invalidateQueries({ queryKey: ['infra', 'system-facts', connectionId] });
    } else if (status === 'failed') toast.error('Installation fehlgeschlagen', { description: job.data?.error });
  }, [status, systemName, connectionId, queryClient, job.data?.error]);
  useLayoutEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [job.data?.output]);

  const invalid = !/^[A-Za-z0-9.-]{1,253}$/.test(manager.trim()) ? 'Manager als IP oder Hostname' : !/^\d+\.\d+\.\d+$/.test(version.trim()) ? 'Version wie 4.14.5' : agentName.trim() && !/^[A-Za-z0-9._-]{1,64}$/.test(agentName.trim()) ? 'Agent-Name: Buchstaben, Ziffern, . _ -' : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 px-7 pb-6 pt-7">
        <div>
          <p className="text-[12px] text-muted">Wazuh-Agent installieren</p>
          <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{systemName}</h2>
        </div>
        {!jobId ? (
          <>
            <p className="text-[12.5px] text-muted">Lädt das Agent-Paket (DEB, amd64 oder arm64 je nach System) von packages.wazuh.com, installiert es mit dem Manager und startet den Dienst. Nur Debian/Ubuntu; braucht root oder sudo ohne Passwort.</p>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium">Wazuh-Manager</span>
              <input className={inputClass} value={manager} onChange={(event) => setManager(event.target.value)} placeholder="172.21.5.91" />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium">Agent-Version</span>
              <input className={inputClass} value={version} onChange={(event) => setVersion(event.target.value)} placeholder="4.14.5" />
              <span className="mt-1 block text-[11.5px] text-faint">Sollte nicht neuer sein als der Manager.</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[12.5px] font-medium">Agent-Name</span>
              <input className={inputClass} value={agentName} onChange={(event) => setAgentName(event.target.value)} placeholder="leer = Hostname des Servers" />
              <span className="mt-1 block text-[11.5px] text-accent">Muss eindeutig sein und lässt sich nach der Registrierung nicht mehr ändern.</span>
            </label>
            {invalid && <p className="text-[12.5px] text-bad">{invalid}</p>}
          </>
        ) : (
          <>
            <p className={cn('flex items-center gap-2 text-[13px]', status === 'success' ? 'text-ok' : status === 'failed' ? 'text-bad' : 'text-muted')}>
              {status === 'running' || !status ? <Loader2 className="size-4 animate-spin" /> : status === 'success' ? <CheckCircle2 className="size-4" /> : <CircleAlert className="size-4" />}
              {status === 'success' ? 'Installiert und gestartet' : status === 'failed' ? job.data?.error ?? 'Fehlgeschlagen' : 'Installiere …'}
            </p>
            <pre ref={outputRef} className="scroll-thin h-80 overflow-auto whitespace-pre-wrap break-all rounded-2xl bg-canvas p-4 font-mono text-[11.5px] leading-[18px] text-ink/85">
              {job.data?.output || 'Verbinde …'}
            </pre>
          </>
        )}
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line/[0.07] bg-panel/95 px-7 py-4 backdrop-blur">
        <button type="button" onClick={onClose} className="h-11 rounded-full border border-line/[0.12] px-5 text-[13.5px] hover:bg-raised">{jobId ? 'Schließen' : 'Abbrechen'}</button>
        {!jobId && (
          <button
            type="button"
            disabled={!!invalid || start.isPending}
            onClick={() => start.mutate()}
            className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
          >
            {start.isPending ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Agent installieren
          </button>
        )}
      </div>
    </div>
  );
}

export function WazuhCard({ index, connectionId, systemName, facts, loading, error, isWazuhServer }: { index: number; connectionId?: string; systemName: string; facts?: SystemFacts; loading: boolean; error?: string; isWazuhServer?: boolean }) {
  const [installing, setInstalling] = useState(false);
  const wazuh = facts?.wazuh;
  const active = facts?.services['wazuh-agent'] === 'active';
  const connected = wazuh?.status === 'connected';
  const state = isWazuhServer
    ? { label: 'Wazuh-Server', tone: 'text-ok', icon: <CheckCircle2 className="size-5" /> }
    : !connectionId
      ? { label: 'Nur im System einsehbar', tone: 'text-muted', icon: <CircleDashed className="size-5" /> }
    : !facts
      ? { label: loading ? 'Prüfe …' : 'Unbekannt', tone: 'text-muted', icon: loading ? <Loader2 className="size-5 animate-spin" /> : <CircleDashed className="size-5" /> }
      : active && (connected || !wazuh?.status)
        ? { label: connected ? 'Verbunden' : 'Läuft', tone: 'text-ok', icon: <CheckCircle2 className="size-5" /> }
        : wazuh?.installed
          ? { label: active ? `Läuft, Status ${wazuh.status}` : 'Installiert, läuft nicht', tone: 'text-accent', icon: <CircleAlert className="size-5" /> }
          : { label: 'Nicht installiert', tone: 'text-bad', icon: <CircleAlert className="size-5" /> };

  return (
    <>
      <NotchCard index={index} eyebrow="Überwachung" title="Wazuh-Agent" tone={facts && !wazuh?.installed && !isWazuhServer ? 'warn' : undefined}>
        <div className="mt-3 flex items-center gap-4">
          <Radar active={state.tone === 'text-ok'} size={64}>
            {state.tone === 'text-ok' ? (
              <ShieldCheck className="size-6 text-ok" />
            ) : state.tone === 'text-bad' ? (
              <motion.span animate={{ scale: [1, 1.12, 1], opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.8, repeat: Infinity }}>
                <ShieldOff className="size-6 text-bad" />
              </motion.span>
            ) : (
              <span className={state.tone}>{state.icon}</span>
            )}
          </Radar>
          <div className={cn('text-[17px] font-semibold leading-tight', state.tone)}>{state.label}</div>
        </div>
        {error && !facts && <p className="mt-2 text-[12px] text-bad">{error}</p>}
        {wazuh?.installed && (
          <dl className="mt-3 space-y-1 text-[12px]">
            <div className="flex justify-between gap-3"><dt className="text-muted">Version</dt><dd className="font-mono">{wazuh.version}</dd></div>
            {wazuh.manager && <div className="flex justify-between gap-3"><dt className="text-muted">Manager</dt><dd className="font-mono">{wazuh.manager}</dd></div>}
            {wazuh.lastKeepalive && <div className="flex justify-between gap-3"><dt className="text-muted">Letzter Kontakt</dt><dd className="font-mono">{wazuh.lastKeepalive}</dd></div>}
            {!wazuh.status && <p className="text-[11.5px] text-faint">Verbindungsstatus nur mit root lesbar.</p>}
          </dl>
        )}
        {facts && !wazuh?.installed && !isWazuhServer && connectionId && (
          <>
            <p className="mt-2 text-[12px] text-muted">Ohne Agent werden Anmeldungen, sudo und Änderungen an SSH, Benutzern und Diensten nicht zentral erfasst.</p>
            <button type="button" onClick={() => setInstalling(true)} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent text-[13px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)]">
              <Download className="size-4" /> Agent installieren
            </button>
          </>
        )}
      </NotchCard>
      <Drawer open={installing} onClose={() => setInstalling(false)} label="Wazuh-Agent installieren" width={620}>
        {installing && connectionId && <InstallPanel connectionId={connectionId} systemName={systemName} defaultName={(facts?.host.hostname ?? systemName).split('.')[0]} onClose={() => setInstalling(false)} />}
      </Drawer>
    </>
  );
}
