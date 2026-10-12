import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Loader2, Siren } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Drawer } from '@/components/ui/Drawer';
import { socKeys } from '@/hooks/use-soc';
import { socOps, type Severity } from '@/services/soc';
import type { IncidentDraft } from '@/lib/soc';

const inputClass = 'h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 text-[13.5px] outline-none transition-colors placeholder:text-faint focus:border-accent/45';
const SEVERITIES: Array<[Severity, string]> = [['low', 'Niedrig'], ['medium', 'Mittel'], ['high', 'Hoch'], ['critical', 'Kritisch']];

function Form({ draft, onDone }: { draft: IncidentDraft; onDone: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [title, setTitle] = useState(draft.title ?? '');
  const [host, setHost] = useState(draft.host ?? '');
  const [severity, setSeverity] = useState<Severity>(draft.severity ?? 'medium');
  const [description, setDescription] = useState(draft.description ?? '');
  const [checks, setChecks] = useState((draft.checks ?? []).join('\n'));
  const create = useMutation({
    mutationFn: () =>
      socOps.createIncident({ ...draft, title: title.trim(), host: host.trim() || null, severity, description, checks: checks.split('\n').map((line) => line.trim()).filter(Boolean) }),
    onSuccess: (incident) => {
      toast.success(`Incident #${incident.number} angelegt`, { action: { label: 'Öffnen', onClick: () => navigate(`/wazuh/incidents?id=${incident.id}`) } });
      void queryClient.invalidateQueries({ queryKey: socKeys.incidents });
      void queryClient.invalidateQueries({ queryKey: socKeys.findings });
      onDone();
    },
    onError: (failure: Error) => toast.error('Incident nicht angelegt', { description: failure.message }),
  });
  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-4 px-7 pb-6 pt-7">
        <div>
          <p className="text-[12px] text-muted">Neuer Sicherheitsfall</p>
          <h2 className="mt-1 flex items-center gap-2 pr-12 text-[22px] font-semibold"><Siren className="size-5 text-accent" /> Incident anlegen</h2>
        </div>
        <input className={inputClass} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Titel, z. B. Wiederholte Administrator-Fehlanmeldungen" maxLength={200} />
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <input className={cn(inputClass, 'font-mono')} value={host} onChange={(event) => setHost(event.target.value)} placeholder="Host" />
          <div className="flex rounded-2xl border border-line/[0.10] bg-raised/50 p-1">
            {SEVERITIES.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setSeverity(value)} className={cn('h-9 rounded-xl px-3 text-[12.5px]', severity === value ? 'bg-accent/[0.14] text-ink' : 'text-muted hover:text-ink')}>{label}</button>
            ))}
          </div>
        </div>
        <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={6} placeholder="Was ist passiert? Was ist bekannt?" className="w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 py-3 text-[13px] outline-none focus:border-accent/45" />
        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium">Zu prüfen (eine Zeile pro Punkt)</span>
          <textarea value={checks} onChange={(event) => setChecks(event.target.value)} rows={4} className="w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 py-3 text-[12.5px] outline-none focus:border-accent/45" />
        </label>
        <p className="text-[12px] text-muted">
          Verknüpft: {draft.eventRefs?.length ?? 0} Events{draft.findingIds?.length ? ` · ${draft.findingIds.length} Findings` : ''}{draft.eventIds?.length ? ` · Event-IDs ${draft.eventIds.join(', ')}` : ''}{draft.ruleIds?.length ? ` · Regeln ${draft.ruleIds.join(', ')}` : ''}
        </p>
      </div>
      <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line/[0.07] bg-panel/95 px-7 py-4 backdrop-blur">
        <button type="button" onClick={onDone} className="h-11 rounded-full border border-line/[0.12] px-5 text-[13.5px] hover:bg-raised">Abbrechen</button>
        <button type="button" disabled={!title.trim() || create.isPending} onClick={() => create.mutate()} className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink disabled:opacity-50">
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Siren className="size-4" />} Anlegen
        </button>
      </div>
    </div>
  );
}

export function IncidentFormDrawer({ draft, onClose }: { draft: IncidentDraft | null; onClose: () => void }) {
  return (
    <Drawer open={!!draft} onClose={onClose} label="Incident anlegen" width={620}>
      {draft && <Form draft={draft} onDone={onClose} />}
    </Drawer>
  );
}
