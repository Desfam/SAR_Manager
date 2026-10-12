import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import { ArrowUpRight, BellRing, Check, Cpu, HardDrive, MemoryStick, Plus, Settings2, SlidersHorizontal, Trash2, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber, PillBars } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { ThresholdEditor } from '@/components/alerts/ThresholdEditor';
import { NotificationSettings } from '@/components/alerts/NotificationSettings';
import { alertingKeys, useActiveAlerts, useAlertHistory, useAlertSettings, useNotificationLog, useThresholds } from '@/hooks/use-alerting';
import { useConnections } from '@/hooks/use-infrastructure';
import { alertingApi, type Alert, type Thresholds } from '@/services/alerting';

const TYPE_META: Record<string, { label: string; icon: typeof Cpu }> = {
  cpu: { label: 'CPU', icon: Cpu },
  memory: { label: 'Arbeitsspeicher', icon: MemoryStick },
  disk: { label: 'Festplatte', icon: HardDrive },
  offline: { label: 'Offline', icon: WifiOff },
  service: { label: 'Dienst', icon: Settings2 },
};

function StatusDot({ tone }: { tone: 'ok' | 'warn' | 'bad' }) {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      {tone === 'bad' && <span className="absolute inline-flex size-full animate-ping rounded-full bg-bad/50 [animation-duration:1.8s]" />}
      <span className={cn('relative size-2 rounded-full', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad' }[tone])} />
    </span>
  );
}

const since = (value?: string | null) => {
  if (!value) return '–';
  const minutes = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return 'gerade eben';
  if (minutes < 60) return `seit ${minutes} min`;
  if (minutes < 1440) return `seit ${Math.round(minutes / 60)} h`;
  return `seit ${Math.round(minutes / 1440)} T`;
};

const dateTime = (value?: string | null) => (value ? new Date(value).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');

function AlertRow({ alert, index, onResolve, onOpen }: { alert: Alert; index: number; onResolve: () => void; onOpen: () => void }) {
  const meta = TYPE_META[alert.type] ?? TYPE_META.service;
  const Icon = meta.icon;
  const critical = alert.severity === 'critical';
  const ratio = alert.value !== null && alert.type !== 'offline' ? Math.min(100, alert.value) : null;
  return (
    <motion.li layout initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20, height: 0 }} transition={{ delay: Math.min(index, 10) * 0.04 }} className={cn('flex items-center gap-3 rounded-2xl border px-3.5 py-3', critical ? 'border-bad/30 bg-bad/[0.04]' : 'border-warn/25 bg-warn/[0.03]')}>
      <StatusDot tone={critical ? 'bad' : 'warn'} />
      <Icon className={cn('size-4 shrink-0', critical ? 'text-bad' : 'text-warn')} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate text-[13.5px] font-medium">{alert.connectionName}</span>
          <span className="text-[11.5px] text-muted">{meta.label}</span>
          <span className="ml-auto shrink-0 text-[11px] text-faint">{since(alert.createdAt)}</span>
        </p>
        <p className="truncate text-[12px] text-muted" title={alert.message}>{alert.message}</p>
        {ratio !== null && (
          <div className="relative mt-1.5 h-1.5 overflow-hidden rounded-full bg-line/[0.07]">
            <motion.span className={cn('block h-full rounded-full', critical ? 'bg-bad' : 'bg-warn')} initial={{ width: 0 }} animate={{ width: `${ratio}%` }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }} />
            {alert.threshold !== null && <span className="absolute inset-y-0 w-px bg-ink/60" style={{ left: `${Math.min(100, alert.threshold)}%` }} title={`Schwelle ${alert.threshold} %`} />}
          </div>
        )}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <button type="button" onClick={onOpen} className="flex size-8 items-center justify-center rounded-full border border-line/[0.10] text-muted hover:text-ink" aria-label="System öffnen" title="System öffnen"><ArrowUpRight className="size-4" /></button>
        <button type="button" onClick={onResolve} className="flex size-8 items-center justify-center rounded-full border border-line/[0.10] text-muted hover:border-ok/40 hover:text-ok" aria-label="Als erledigt markieren" title="Als erledigt markieren"><Check className="size-4" /></button>
      </div>
    </motion.li>
  );
}

export function AlertsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const active = useActiveAlerts();
  const history = useAlertHistory(7);
  const log = useNotificationLog();
  const settings = useAlertSettings();
  const thresholds = useThresholds();
  const connections = useConnections();
  const [overrideHost, setOverrideHost] = useState<string>('');

  const resolve = useMutation({
    mutationFn: alertingApi.resolve,
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: alertingKeys.all }),
  });
  const saveGlobal = useMutation({
    mutationFn: (value: Thresholds) => alertingApi.saveGlobal(value),
    onSuccess: (value) => { queryClient.setQueryData(alertingKeys.thresholds, value); toast.success('Standard-Schwellenwerte gespeichert'); },
    onError: (error: Error) => toast.error('Nicht gespeichert', { description: error.message }),
  });
  const saveOverride = useMutation({
    mutationFn: ({ id, value }: { id: string; value: Thresholds }) => alertingApi.saveOverride(id, value),
    onSuccess: (value) => { queryClient.setQueryData(alertingKeys.thresholds, value); setOverrideHost(''); toast.success('Abweichung gespeichert'); },
    onError: (error: Error) => toast.error('Nicht gespeichert', { description: error.message }),
  });
  const removeOverride = useMutation({
    mutationFn: alertingApi.deleteOverride,
    onSuccess: (value) => queryClient.setQueryData(alertingKeys.thresholds, value),
  });

  const list = active.data ?? [];
  const critical = list.filter((alert) => alert.severity === 'critical').length;
  const warnings = list.length - critical;
  const week = useMemo(() => {
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (6 - index));
      return { start: date.getTime(), label: date.toLocaleDateString('de-DE', { weekday: 'short' }).replace('.', ''), count: 0 };
    });
    (history.data ?? []).forEach((alert) => {
      const time = new Date(alert.createdAt).getTime();
      const day = [...days].reverse().find((entry) => time >= entry.start);
      if (day) day.count += 1;
    });
    return days;
  }, [history.data]);
  const weekTotal = week.reduce((sum, day) => sum + day.count, 0);
  const peak = Math.max(...week.map((day) => day.count));
  const sentToday = (log.data ?? []).filter((entry) => Date.now() - new Date(entry.createdAt).getTime() < 86_400_000 && entry.kind !== 'test').length;
  const channelCount = settings.data ? Object.values(settings.data.channels).filter((channel) => channel.enabled).length : 0;
  const overrideIds = new Set((thresholds.data?.overrides ?? []).map((entry) => entry.connectionId));
  const candidates = (connections.data ?? []).filter((connection) => connection.type !== 'rdp' && !overrideIds.has(connection.id));

  return (
    <>
      <PageHeader
        section="Sicherheit"
        title="Alerts"
        description="Aktive Warnungen, Schwellenwerte und Benachrichtigungen bei Überschreitung"
        actions={
          <button type="button" onClick={() => document.getElementById('notification-settings')?.scrollIntoView({ behavior: 'smooth' })} className="flex h-10 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[13.5px] transition-all hover:border-accent/35 hover:bg-raised active:scale-[0.97]">
            <BellRing className="size-4" /> Benachrichtigungen
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-6 2xl:grid-cols-12">
        <NotchCard index={0} glow tone={critical ? 'bad' : undefined} className="min-h-[220px] lg:col-span-3 2xl:col-span-3" eyebrow="jetzt aktiv" title="Kritisch">
          <p className={cn('mt-4 text-[52px] font-bold leading-none tracking-[-0.04em]', critical ? 'text-bad' : 'text-ok')}><AnimatedNumber value={active.data ? critical : null} /></p>
          <p className="mt-3 text-[13px] text-muted">{critical ? 'sofort ansehen' : 'nichts Kritisches'}</p>
        </NotchCard>
        <NotchCard index={1} tone={warnings ? 'warn' : undefined} className="min-h-[220px] lg:col-span-3 2xl:col-span-3" eyebrow="jetzt aktiv" title="Warnungen">
          <p className={cn('mt-4 text-[52px] font-bold leading-none tracking-[-0.04em]', warnings ? 'text-warn' : 'text-ok')}><AnimatedNumber value={active.data ? warnings : null} /></p>
          <p className="mt-3 text-[13px] text-muted">über der Warnschwelle</p>
        </NotchCard>
        <NotchCard index={2} className="min-h-[220px] lg:col-span-3 2xl:col-span-3" eyebrow="letzte 7 Tage" title="Ausgelöst">
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={history.data ? weekTotal : null} /></p>
          <div className="mt-auto pt-4"><PillBars height={60} bars={week.map((day) => ({ label: day.label, value: day.count, highlight: peak > 0 && day.count === peak, title: `${day.count} Alerts` }))} /></div>
        </NotchCard>
        <NotchCard index={3} className="min-h-[220px] lg:col-span-3 2xl:col-span-3" eyebrow="letzte 24 h" title="Benachrichtigt" actions={[{ label: 'Einstellungen', icon: <SlidersHorizontal />, onClick: () => document.getElementById('notification-settings')?.scrollIntoView({ behavior: 'smooth' }) }]}>
          <p className="mt-4 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={log.data ? sentToday : null} /></p>
          <p className="mt-3 text-[13px] text-muted">{channelCount ? `${channelCount} Kanal${channelCount === 1 ? '' : 'e'} aktiv: ${Object.entries(settings.data?.channels ?? {}).filter(([, channel]) => channel.enabled).map(([name]) => ({ desktop: 'Desktop', ntfy: 'Handy', discord: 'Discord', webhook: 'Webhook' })[name]).join(', ')}` : 'kein Kanal aktiv'}</p>
        </NotchCard>

        <NotchCard index={4} className="min-h-[340px] lg:col-span-6 2xl:col-span-8" eyebrow="werden alle 30 s geprüft" title="Aktive Alerts">
          {!active.data ? (
            <div className="mt-3 space-y-2">{Array.from({ length: 4 }, (_, index) => <Shimmer key={index} className="h-16" />)}</div>
          ) : !list.length ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
              <motion.span initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 220, damping: 16 }} className="flex size-12 items-center justify-center rounded-full bg-ok/15"><Check className="size-6 text-ok" /></motion.span>
              <p className="text-[14px] font-medium">Alles im grünen Bereich</p>
              <p className="text-[12.5px] text-muted">Kein System über einer Schwelle, alle erreichbar.</p>
            </div>
          ) : (
            <ul className="mt-3 space-y-2">
              <AnimatePresence>
                {list.map((alert, index) => <AlertRow key={alert.id} alert={alert} index={index} onResolve={() => resolve.mutate(alert.id)} onOpen={() => navigate(`/systems/${encodeURIComponent(alert.connectionId)}`)} />)}
              </AnimatePresence>
            </ul>
          )}
        </NotchCard>

        <NotchCard index={5} className="min-h-[340px] lg:col-span-6 2xl:col-span-4" eyebrow="zuletzt gesendet" title="Benachrichtigungen">
          <ol className="relative mt-4 space-y-3.5">
            <span className="absolute bottom-2 left-[4px] top-2 w-px bg-gradient-to-b from-accent/50 via-line/10 to-transparent" aria-hidden="true" />
            {(log.data ?? []).slice(0, 8).map((entry, index) => (
              <motion.li key={entry.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 + index * 0.05 }} className="relative flex gap-3">
                <span className={cn('relative mt-1.5 size-[9px] shrink-0 rounded-full ring-4 ring-card', entry.kind === 'resolved' ? 'bg-ok' : entry.severity === 'critical' ? 'bg-bad' : entry.severity === 'warning' ? 'bg-warn' : 'bg-accent')} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">{entry.title}</p>
                  <p className="truncate text-[11.5px] text-muted">{entry.body}</p>
                  <p className="mt-0.5 flex flex-wrap gap-1">
                    {Object.entries(entry.channels).map(([channel, status]) => (
                      <span key={channel} title={status} className={cn('rounded-full border px-1.5 text-[10px]', status === 'ok' ? 'border-ok/30 text-ok' : 'border-bad/40 text-bad')}>{channel}</span>
                    ))}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-faint">{dateTime(entry.createdAt)}</span>
              </motion.li>
            ))}
            {log.data && !log.data.length && <li className="pl-6 text-[12.5px] text-muted">Noch keine Benachrichtigungen. Mit „Test senden“ prüfen, ob sie ankommen.</li>}
          </ol>
        </NotchCard>

        <NotchCard index={6} className="lg:col-span-6 2xl:col-span-6" eyebrow="gelten für alle Systeme ohne Abweichung" title="Schwellenwerte">
          <div className="mt-4">
            {thresholds.data ? <ThresholdEditor key={JSON.stringify(thresholds.data.global)} value={thresholds.data.global} saving={saveGlobal.isPending} onSave={(value) => saveGlobal.mutate(value)} /> : <Shimmer className="h-48 w-full" />}
          </div>
          <div className="mt-6 border-t border-line/[0.07] pt-4">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Abweichungen je System</p>
            <ul className="space-y-1.5">
              {(thresholds.data?.overrides ?? []).map((entry) => (
                <li key={entry.connectionId} className="flex items-center gap-3 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate font-medium">{entry.connectionName}</span>
                  <span className="font-mono text-[11px] text-muted">CPU {entry.cpuWarning}/{entry.cpuCritical} · RAM {entry.memoryWarning}/{entry.memoryCritical} · Disk {entry.diskWarning}/{entry.diskCritical}</span>
                  <button type="button" onClick={() => setOverrideHost(entry.connectionId)} className="text-[11.5px] text-accent hover:underline">Bearbeiten</button>
                  <button type="button" onClick={() => removeOverride.mutate(entry.connectionId)} className="text-muted hover:text-bad" aria-label="Abweichung entfernen"><Trash2 className="size-3.5" /></button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex items-center gap-2">
              <select value={overrideIds.has(overrideHost) ? '' : overrideHost} onChange={(event) => setOverrideHost(event.target.value)} className="h-9 min-w-0 flex-1 rounded-full border border-line/[0.12] bg-raised/60 px-3 text-[12.5px] outline-none">
                <option value="">System für eigene Schwellenwerte wählen …</option>
                {candidates.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}</option>)}
              </select>
              <Plus className="size-4 text-muted" />
            </div>
            <AnimatePresence>
              {overrideHost && thresholds.data && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mt-3 overflow-hidden rounded-2xl border border-accent/25 bg-accent/[0.04] p-3">
                  <p className="mb-3 text-[12.5px]">Eigene Werte für <span className="font-medium">{(connections.data ?? []).find((connection) => connection.id === overrideHost)?.name}</span>, z. B. für einen Server, der regelmäßig ausgelastet ist (Virenscan, Backup).</p>
                  <ThresholdEditor
                    key={overrideHost}
                    value={(thresholds.data.overrides.find((entry) => entry.connectionId === overrideHost) as Thresholds | undefined) ?? thresholds.data.global}
                    saving={saveOverride.isPending}
                    onSave={(value) => saveOverride.mutate({ id: overrideHost, value })}
                    actions={<button type="button" onClick={() => setOverrideHost('')} className="h-9 rounded-full border border-line/[0.12] px-4 text-[12.5px] text-muted hover:text-ink">Abbrechen</button>}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </NotchCard>

        <div id="notification-settings" className="lg:col-span-6 2xl:col-span-6">
          <NotchCard index={7} className="h-full" eyebrow="Kanäle und Regeln" title="Benachrichtigungen">
            <div className="mt-4">{settings.data ? <NotificationSettings key={JSON.stringify(settings.data)} settings={settings.data} /> : <Shimmer className="h-64 w-full" />}</div>
          </NotchCard>
        </div>

        <NotchCard index={8} className="lg:col-span-6 2xl:col-span-12" eyebrow="letzte 7 Tage" title="Verlauf">
          {history.data?.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead>
                  <tr className="border-b border-line/[0.08] text-left text-[10.5px] uppercase tracking-[0.08em] text-faint">
                    <th className="pb-1.5 pr-3 font-medium">Beginn</th><th className="pb-1.5 pr-3 font-medium">System</th><th className="pb-1.5 pr-3 font-medium">Art</th><th className="pb-1.5 pr-3 font-medium">Stufe</th><th className="pb-1.5 pr-3 font-medium">Meldung</th><th className="pb-1.5 font-medium">Behoben</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.slice(0, 60).map((alert) => (
                    <tr key={alert.id} className="border-b border-line/[0.04] hover:bg-hover/40">
                      <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-[11.5px] text-muted">{dateTime(alert.createdAt)}</td>
                      <td className="py-1.5 pr-3 font-medium">{alert.connectionName}</td>
                      <td className="py-1.5 pr-3 text-muted">{TYPE_META[alert.type]?.label ?? alert.type}</td>
                      <td className="py-1.5 pr-3"><span className={cn('rounded-full border px-2 py-px text-[10.5px]', alert.severity === 'critical' ? 'border-bad/40 text-bad' : 'border-warn/40 text-warn')}>{alert.severity === 'critical' ? 'Kritisch' : 'Warnung'}</span></td>
                      <td className="max-w-[520px] truncate py-1.5 pr-3 text-ink/85" title={alert.message}>{alert.message}</td>
                      <td className="whitespace-nowrap py-1.5 font-mono text-[11.5px] text-muted">{alert.resolved ? dateTime(alert.resolvedAt) : <span className="text-warn">aktiv</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="mt-3 text-[12.5px] text-muted">{history.data ? 'Keine Alerts in den letzten 7 Tagen.' : 'Lädt …'}</p>}
        </NotchCard>
      </div>
    </>
  );
}
