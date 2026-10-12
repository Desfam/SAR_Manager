import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, BellRing, Globe, Loader2, MessageSquare, Monitor, Send, Smartphone, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { alertingKeys } from '@/hooks/use-alerting';
import { alertingApi, type AlertSettings, type AlertType } from '@/services/alerting';

const TYPES: Array<[AlertType, string]> = [['cpu', 'CPU'], ['memory', 'RAM'], ['disk', 'Festplatte'], ['offline', 'Offline']];
const inputClass = 'h-9 w-full rounded-xl border border-line/[0.10] bg-raised/50 px-3 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/45';

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)} className={cn('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-line/20')}>
      <span className={cn('absolute top-0.5 size-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  );
}

function Channel({ icon: Icon, title, hint, enabled, onToggle, children }: { icon: typeof Bell; title: string; hint: string; enabled: boolean; onToggle: (value: boolean) => void; children?: React.ReactNode }) {
  return (
    <div className={cn('rounded-2xl border p-3 transition-colors', enabled ? 'border-accent/25 bg-accent/[0.04]' : 'border-line/[0.08] bg-raised/25')}>
      <div className="flex items-center gap-3">
        <Icon className={cn('size-4', enabled ? 'text-accent' : 'text-muted')} />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-medium">{title}</p>
          <p className="text-[11.5px] text-muted">{hint}</p>
        </div>
        <Toggle checked={enabled} onChange={onToggle} label={title} />
      </div>
      {enabled && children && <div className="mt-3 space-y-2">{children}</div>}
    </div>
  );
}

export function NotificationSettings({ settings }: { settings: AlertSettings }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(settings);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const set = (update: (current: AlertSettings) => AlertSettings) => setDraft((current) => update(structuredClone(current)));

  const save = useMutation({
    mutationFn: () => alertingApi.saveSettings(draft),
    onSuccess: (value) => {
      queryClient.setQueryData(alertingKeys.settings, value);
      setDraft(value);
      toast.success('Benachrichtigungen gespeichert');
    },
    onError: (error: Error) => toast.error('Nicht gespeichert', { description: error.message }),
  });
  const test = useMutation({
    mutationFn: alertingApi.test,
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: alertingKeys.notifications });
      const failed = Object.entries(result.channels).filter(([, status]) => status !== 'ok');
      if (failed.length) toast.error('Test teilweise fehlgeschlagen', { description: failed.map(([channel, status]) => `${channel}: ${status}`).join(' · ') });
      else toast.success('Test gesendet', { description: Object.keys(result.channels).join(', ') || 'kein Kanal aktiv' });
    },
    onError: (error: Error) => toast.error('Test fehlgeschlagen', { description: error.message }),
  });

  return (
    <div className="space-y-5">
      {/* when */}
      <section className="space-y-3">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Wann</p>
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <span className="text-muted">Benachrichtigen ab</span>
          <div className="flex rounded-full border border-line/[0.12] p-0.5">
            {(['warning', 'critical'] as const).map((level) => (
              <button key={level} type="button" onClick={() => set((current) => ({ ...current, notify: { ...current.notify, minSeverity: level } }))} className={cn('h-7 rounded-full px-3', draft.notify.minSeverity === level ? 'bg-accent/[0.14] text-ink' : 'text-muted hover:text-ink')}>
                {level === 'warning' ? 'Warnung' : 'nur Kritisch'}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map(([type, label]) => (
            <button key={type} type="button" onClick={() => set((current) => ({ ...current, notify: { ...current.notify, types: { ...current.notify.types, [type]: !current.notify.types[type] } } }))} className={cn('rounded-full border px-3 py-1 text-[12px]', draft.notify.types[type] ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.10] text-muted line-through')}>
              {label}
            </button>
          ))}
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-2 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
            <span><span className="block">Spike-Filter</span><span className="text-[11px] text-muted">CPU/RAM erst nach N Messungen in Folge (je 30 s)</span></span>
            <input type="number" min={1} max={20} value={draft.sustainChecks} onChange={(event) => set((current) => ({ ...current, sustainChecks: Number(event.target.value) }))} className="h-8 w-14 rounded-lg border border-line/[0.10] bg-raised/50 text-center font-mono outline-none" />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
            <span><span className="block">Offline nach</span><span className="text-[11px] text-muted">fehlgeschlagenen Prüfungen in Folge</span></span>
            <input type="number" min={1} max={20} value={draft.offline.afterChecks} onChange={(event) => set((current) => ({ ...current, offline: { ...current.offline, afterChecks: Number(event.target.value) } }))} className="h-8 w-14 rounded-lg border border-line/[0.10] bg-raised/50 text-center font-mono outline-none" />
          </label>
          <label className="flex items-center justify-between gap-2 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
            <span><span className="block">Ruhezeit</span><span className="text-[11px] text-muted">Minuten bis zur Wiederholung je System</span></span>
            <input type="number" min={0} max={1440} value={draft.notify.cooldownMinutes} onChange={(event) => set((current) => ({ ...current, notify: { ...current.notify, cooldownMinutes: Number(event.target.value) } }))} className="h-8 w-16 rounded-lg border border-line/[0.10] bg-raised/50 text-center font-mono outline-none" />
          </label>
          <div className="flex items-center justify-between gap-2 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
            <span><span className="block">Auch bei „Behoben“</span><span className="text-[11px] text-muted">Meldung, wenn der Wert wieder normal ist</span></span>
            <Toggle checked={draft.notify.onResolve} label="Auch bei Behoben" onChange={(value) => set((current) => ({ ...current, notify: { ...current.notify, onResolve: value } }))} />
          </div>
        </div>
      </section>

      {/* where */}
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-faint">Wohin</p>
        <Channel icon={Monitor} title="Desktop" hint="Systembenachrichtigung von Ubuntu, auch wenn das Fenster minimiert ist" enabled={draft.channels.desktop.enabled} onToggle={(value) => set((current) => ({ ...current, channels: { ...current.channels, desktop: { ...current.channels.desktop, enabled: value } } }))}>
          <label className="flex items-center gap-2 text-[12.5px]"><Volume2 className="size-3.5 text-muted" /> Ton abspielen <span className="ml-auto"><Toggle checked={draft.channels.desktop.sound} label="Ton" onChange={(value) => set((current) => ({ ...current, channels: { ...current.channels, desktop: { ...current.channels.desktop, sound: value } } }))} /></span></label>
        </Channel>
        <Channel icon={Smartphone} title="Handy (ntfy)" hint="Push aufs Handy über die kostenlose App ntfy: Thema abonnieren, fertig" enabled={draft.channels.ntfy.enabled} onToggle={(value) => set((current) => ({ ...current, channels: { ...current.channels, ntfy: { ...current.channels.ntfy, enabled: value } } }))}>
          <div className="grid gap-2 sm:grid-cols-2">
            <input className={inputClass} value={draft.channels.ntfy.server} onChange={(event) => set((current) => ({ ...current, channels: { ...current.channels, ntfy: { ...current.channels.ntfy, server: event.target.value } } }))} placeholder="https://ntfy.sh" />
            <input className={cn(inputClass, 'font-mono')} value={draft.channels.ntfy.topic} onChange={(event) => set((current) => ({ ...current, channels: { ...current.channels, ntfy: { ...current.channels.ntfy, topic: event.target.value } } }))} placeholder="Thema, z. B. sar-alerts-x7k2p" />
          </div>
          <input className={inputClass} type="password" value={draft.channels.ntfy.token} onChange={(event) => set((current) => ({ ...current, channels: { ...current.channels, ntfy: { ...current.channels.ntfy, token: event.target.value } } }))} placeholder="Zugangstoken (optional, nur bei eigenem/geschütztem Server)" />
          <p className="text-[11px] text-faint">Auf ntfy.sh ist ein Thema öffentlich lesbar, wer den Namen kennt: einen schwer erratbaren Namen wählen. Gesendet werden Systemname, Messwert und Schwelle.</p>
        </Channel>
        <Channel icon={MessageSquare} title="Discord" hint="Nachricht in einen Discord-Kanal per Webhook" enabled={draft.channels.discord.enabled} onToggle={(value) => set((current) => ({ ...current, channels: { ...current.channels, discord: { ...current.channels.discord, enabled: value } } }))}>
          <input className={cn(inputClass, 'font-mono')} type="password" value={draft.channels.discord.webhookUrl} onChange={(event) => set((current) => ({ ...current, channels: { ...current.channels, discord: { ...current.channels.discord, webhookUrl: event.target.value } } }))} placeholder="https://discord.com/api/webhooks/…" />
        </Channel>
        <Channel icon={Globe} title="Webhook" hint="JSON per POST an eine eigene Adresse (Home Assistant, n8n, Teams-Workflow …)" enabled={draft.channels.webhook.enabled} onToggle={(value) => set((current) => ({ ...current, channels: { ...current.channels, webhook: { ...current.channels.webhook, enabled: value } } }))}>
          <input className={cn(inputClass, 'font-mono')} type="password" value={draft.channels.webhook.url} onChange={(event) => set((current) => ({ ...current, channels: { ...current.channels, webhook: { ...current.channels.webhook, url: event.target.value } } }))} placeholder="https://…" />
        </Channel>
      </section>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={test.isPending || dirty} onClick={() => test.mutate()} title={dirty ? 'Erst speichern' : undefined} className="flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-4 text-[12.5px] text-muted hover:text-ink disabled:opacity-40">
          {test.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Send className="size-3.5" />} Test senden
        </button>
        {dirty && <span className="text-[11.5px] text-warn">Ungespeicherte Änderungen</span>}
        <button type="button" disabled={!dirty || save.isPending} onClick={() => save.mutate()} className="ml-auto flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[12.5px] font-medium text-accent-ink disabled:opacity-40">
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <BellRing className="size-3.5" />} Speichern
        </button>
      </div>
    </div>
  );
}
