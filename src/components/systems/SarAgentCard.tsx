import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { Bot, Download, KeyRound, Loader2, ScrollText, Trash2, TriangleAlert } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NotchCard } from '@/components/ui/NotchCard';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Drawer } from '@/components/ui/Drawer';
import { Beacon, Shimmer } from '@/components/systems/fx';
import { sarAgentApi, type SarAgentEvent } from '@/services/sar-agent';

const KIND: Record<SarAgentEvent['kind'], { label: string; className: string }> = {
  ssh_failed: { label: 'SSH fehlgeschlagen', className: 'border-bad/40 text-bad' },
  ssh_invalid_user: { label: 'unbekannter Benutzer', className: 'border-bad/40 text-bad' },
  ssh_accepted: { label: 'SSH-Anmeldung', className: 'border-ok/35 text-ok' },
  sudo: { label: 'sudo', className: 'border-accent/40 text-accent' },
  error: { label: 'Fehler', className: 'border-warn/40 text-warn' },
  kernel: { label: 'Kernel', className: 'border-bad/40 text-bad' },
};

const ago = (value?: string | null) => {
  if (!value) return '–';
  const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1000));
  return seconds < 90 ? `vor ${seconds} s` : seconds < 5400 ? `vor ${Math.round(seconds / 60)} min` : `vor ${Math.round(seconds / 3600)} h`;
};

function EventsDrawer({ connectionId, open, onClose }: { connectionId: string; open: boolean; onClose: () => void }) {
  const events = useQuery({ queryKey: ['infra', 'sar-agent', connectionId, 'events'], queryFn: () => sarAgentApi.events(connectionId, 24), enabled: open, refetchInterval: open ? 30_000 : false });
  return (
    <Drawer open={open} onClose={onClose} label="Agent-Ereignisse" width={760}>
      <div className="px-7 pb-8 pt-7">
        <p className="text-[12px] text-muted">vom SAR-Agenten, letzte 24 Stunden</p>
        <h2 className="mt-1 text-[20px] font-semibold">Ereignisse</h2>
        {!events.data ? (
          <div className="mt-5 space-y-2">{Array.from({ length: 6 }, (_, index) => <Shimmer key={index} className="h-9" />)}</div>
        ) : !events.data.length ? (
          <p className="mt-6 text-[13px] text-muted">Keine Anmeldungen, sudo-Aufrufe oder Fehler in den letzten 24 Stunden.</p>
        ) : (
          <ul className="mt-5 space-y-1">
            {events.data.map((event, index) => (
              <motion.li key={`${event.time}-${index}`} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: Math.min(index, 20) * 0.015 }} className="grid grid-cols-[92px_150px_minmax(0,1fr)] items-start gap-3 border-b border-line/[0.05] py-1.5 text-[12.5px]">
                <span className="font-mono text-[11px] text-faint">{new Date(event.time).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                <span><span className={cn('rounded-full border px-2 py-px text-[10.5px]', KIND[event.kind]?.className)}>{KIND[event.kind]?.label ?? event.kind}</span></span>
                <span className="min-w-0">
                  {event.kind === 'sudo' ? (
                    <><span className="font-mono">{event.user}</span>: <span className="break-all font-mono text-[11.5px] text-ink/85">{event.command}</span></>
                  ) : event.kind.startsWith('ssh') ? (
                    <><span className="font-mono">{event.user}</span> von <span className="font-mono">{event.ip}</span>{event.method ? <span className="text-faint"> · {event.method}</span> : null}</>
                  ) : (
                    <><span className="text-faint">{event.source}: </span><span className="text-ink/85">{event.message}</span></>
                  )}
                </span>
              </motion.li>
            ))}
          </ul>
        )}
      </div>
    </Drawer>
  );
}

/** SAR agent on this system: status, install/remove, events */
export function SarAgentCard({ index, connectionId, systemName }: { index: number; connectionId?: string; systemName: string }) {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<'install' | 'uninstall' | null>(null);
  const [showEvents, setShowEvents] = useState(false);
  const status = useQuery({ queryKey: ['infra', 'sar-agent', connectionId], queryFn: () => sarAgentApi.status(connectionId!), enabled: !!connectionId, refetchInterval: 15_000 });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['infra', 'sar-agent', connectionId] });
  const install = useMutation({
    mutationFn: () => sarAgentApi.install(connectionId!),
    onSuccess: (result) => { toast.success('SAR-Agent installiert', { description: result.steps.join(' · ') }); void refresh(); },
    onError: (error: Error) => toast.error('Installation fehlgeschlagen', { description: error.message, duration: 12_000 }),
  });
  const uninstall = useMutation({
    mutationFn: () => sarAgentApi.uninstall(connectionId!),
    onSuccess: () => { toast.success('SAR-Agent entfernt'); void refresh(); },
    onError: (error: Error) => toast.error('Entfernen fehlgeschlagen', { description: error.message }),
  });

  const d = status.data;
  const busy = install.isPending || uninstall.isPending;
  const outdated = d?.installed && d.version && d.version !== d.latestVersion;

  return (
    <NotchCard
      index={index}
      className="min-h-[200px]"
      eyebrow="ohne SSH-Anmeldungen"
      title="SAR-Agent"
      tone={d?.installed && !d.online ? 'warn' : undefined}
      actions={d?.installed ? [{ label: 'Ereignisse', icon: <ScrollText />, onClick: () => setShowEvents(true) }] : []}
    >
      {!connectionId ? (
        <p className="mt-3 text-[12.5px] text-muted">Nur für Linux-Systeme mit SSH-Zugang.</p>
      ) : !d ? (
        <div className="mt-4 space-y-2"><Shimmer className="h-6 w-28" /><Shimmer className="h-3 w-40" /></div>
      ) : (
        <AnimatePresence mode="wait">
          {busy ? (
            <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 flex items-center gap-2 text-[12.5px] text-muted">
              <Loader2 className="size-4 animate-spin" /> {install.isPending ? 'Installiere über eine SSH-Sitzung …' : 'Entferne …'}
            </motion.div>
          ) : d.installed ? (
            <motion.div key="installed" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-1 flex-col">
              <p className={cn('flex items-center gap-2 text-[20px] font-semibold', d.online ? 'text-ok' : 'text-warn')}>
                <Beacon tone={d.online ? 'ok' : 'warn'} size={8} /> {d.online ? 'verbunden' : 'getrennt'}
              </p>
              <p className="mt-1 text-[12px] text-muted">
                v{d.version}{outdated ? <span className="text-accent"> · Update auf v{d.latestVersion} verfügbar</span> : ''} · Metriken {ago(d.lastMetricsAt)}
              </p>
              <div className="mt-3 grid grid-cols-4 gap-1.5 text-center">
                {([['Anmeldungen', d.last24h.accepted, ''], ['Fehlversuche', d.last24h.failed, d.last24h.failed ? 'text-bad' : ''], ['sudo', d.last24h.sudo, ''], ['Fehler', d.last24h.errors, d.last24h.errors ? 'text-warn' : '']] as const).map(([label, value, tone]) => (
                  <button key={label} type="button" onClick={() => setShowEvents(true)} className="rounded-xl border border-line/[0.07] py-1.5 hover:border-accent/35">
                    <p className={cn('text-[16px] font-bold tabular-nums', tone)}>{value}</p>
                    <p className="text-[10px] text-faint">{label} 24 h</p>
                  </button>
                ))}
              </div>
              {d.logsReadable === false && <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-warn"><TriangleAlert className="size-3.5" /> Logs nicht vollständig lesbar</p>}
              <div className="mt-auto flex gap-2 pt-3">
                {outdated && <button type="button" onClick={() => setConfirm('install')} className="flex h-8 items-center gap-1.5 rounded-full border border-accent/35 px-3 text-[12px] text-accent hover:bg-accent/10"><Download className="size-3.5" /> Aktualisieren</button>}
                <button type="button" onClick={() => setConfirm('uninstall')} className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:border-bad/40 hover:text-bad"><Trash2 className="size-3.5" /> Entfernen</button>
              </div>
            </motion.div>
          ) : (
            <motion.div key="missing" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3 flex flex-1 flex-col">
              <p className="flex items-center gap-2 text-[15px] font-semibold text-muted"><Bot className="size-4" /> nicht installiert</p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">Der Agent meldet Metriken, SSH-Anmeldungen, sudo und Fehler selbst an SAR. Die App muss sich dann nicht mehr per SSH anmelden.</p>
              <button type="button" onClick={() => setConfirm('install')} className="mt-auto flex h-9 items-center justify-center gap-2 self-start rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[12.5px] font-medium text-accent-ink"><Download className="size-4" /> Agent installieren</button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
      {(install.isError || uninstall.isError) && <p className="mt-2 text-[11.5px] text-bad">{((install.error ?? uninstall.error) as Error).message}</p>}

      <ConfirmDialog
        open={confirm === 'install'}
        icon={<Download className="size-5" />}
        title={`SAR-Agent auf ${systemName} ${d?.installed ? 'aktualisieren' : 'installieren'}?`}
        confirmLabel={d?.installed ? 'Aktualisieren' : 'Installieren'}
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); install.mutate(); }}
        description={
          <div className="space-y-2 text-left text-[12.5px]">
            <p>Über eine einzige SSH-Sitzung wird auf <span className="font-mono">{systemName}</span>:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              <li>der Benutzer <span className="font-mono">sar-agent</span> angelegt, ohne Login, nur mit Leserechten für Logs (Gruppen adm, systemd-journal)</li>
              <li>das Programm nach <span className="font-mono">/usr/local/bin/sar-agent</span> kopiert, Konfiguration in <span className="font-mono">/etc/sar-agent</span></li>
              <li>der Dienst <span className="font-mono">sar-agent</span> eingerichtet und gestartet (systemd, abgeschottet)</li>
            </ul>
            <p className="flex items-start gap-1.5"><KeyRound className="mt-0.5 size-3.5 shrink-0" /> Der Agent bekommt ein eigenes Token und verbindet sich zu <span className="break-all font-mono">{d?.serverUrl}</span>. Befehle ausführen kann er nicht.</p>
            <p className="text-[11.5px] text-faint">Braucht Root oder sudo ohne Passwort. Daten kommen nur an, solange SAR Manager auf diesem Rechner läuft.</p>
          </div>
        }
      />
      <ConfirmDialog
        open={confirm === 'uninstall'}
        tone="danger"
        icon={<Trash2 className="size-5" />}
        title={`SAR-Agent von ${systemName} entfernen?`}
        confirmLabel="Entfernen"
        onCancel={() => setConfirm(null)}
        onConfirm={() => { setConfirm(null); uninstall.mutate(); }}
        description="Dienst, Programm, Konfiguration und Benutzer sar-agent werden gelöscht, das Token gesperrt. Danach fragt SAR das System wieder per SSH ab."
      />
      {connectionId && <EventsDrawer connectionId={connectionId} open={showEvents} onClose={() => setShowEvents(false)} />}
    </NotchCard>
  );
}
