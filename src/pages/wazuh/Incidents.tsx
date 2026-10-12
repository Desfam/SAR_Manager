import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Check, ClipboardList, FileSearch, Loader2, MessageSquarePlus, Pencil, Plus, Siren, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AnimatedNumber } from '@/components/ui/viz';
import { Shimmer } from '@/components/systems/fx';
import { SeverityBadge } from '@/components/soc/FindingCard';
import { IncidentFormDrawer } from '@/components/soc/IncidentForm';
import { EventDrawer } from '@/components/soc/EventDrawer';
import { socKeys, useEventContext, useFindings, useIncident, useIncidents } from '@/hooks/use-soc';
import { INCIDENT_STATUS, SEVERITY_STYLE, formatTime, type IncidentDraft } from '@/lib/soc';
import { socOps, type Incident, type Severity } from '@/services/soc';

const SEVERITIES: Severity[] = ['low', 'medium', 'high', 'critical'];
const STATUS_TONE: Record<Incident['status'], string> = {
  open: 'border-bad/40 text-bad',
  in_progress: 'border-accent/40 text-accent',
  resolved: 'border-ok/35 text-ok',
  closed: 'border-line/[0.14] text-muted',
};

const StatusBadge = ({ status }: { status: Incident['status'] }) => <span className={cn('inline-flex whitespace-nowrap rounded-full border px-2 py-px text-[10.5px]', STATUS_TONE[status])}>{INCIDENT_STATUS[status]}</span>;

function Detail({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  // after deleting, keep showing the cached incident while the drawer closes instead of refetching a 404
  const [deleted, setDeleted] = useState(false);
  const incident = useIncident(deleted ? null : id);
  const findings = useFindings({});
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [eventRef, setEventRef] = useState<{ index: string; id: string } | null>(null);
  const context = useEventContext(eventRef);

  const refresh = (data: Incident) => {
    queryClient.setQueryData([...socKeys.incidents, 'one', id], data);
    void queryClient.invalidateQueries({ queryKey: socKeys.incidents, predicate: (query) => query.queryKey[3] !== 'one' });
  };
  const update = useMutation({
    mutationFn: (input: Partial<Incident>) => socOps.updateIncident(id, input),
    onSuccess: (data) => { refresh(data); setEditing(false); },
    onError: (failure: Error) => toast.error('Nicht gespeichert', { description: failure.message }),
  });
  const addNote = useMutation({
    mutationFn: () => socOps.addNote(id, note.trim()),
    onSuccess: (data) => { refresh(data); setNote(''); },
    onError: (failure: Error) => toast.error('Notiz nicht gespeichert', { description: failure.message }),
  });
  const remove = useMutation({
    mutationFn: () => socOps.deleteIncident(id),
    onSuccess: () => {
      toast.success('Incident gelöscht');
      setDeleted(true);
      onDeleted();
      void queryClient.invalidateQueries({ queryKey: socKeys.incidents, predicate: (query) => query.queryKey[3] !== 'one' });
    },
    onError: (failure: Error) => toast.error('Nicht gelöscht', { description: failure.message }),
  });

  const d = incident.data ?? queryClient.getQueryData<Incident>([...socKeys.incidents, 'one', id]);
  if (incident.isError) return <p className="p-8 text-[13px] text-bad">{(incident.error as Error).message}</p>;
  if (!d) return <div className="space-y-3 p-7"><Shimmer className="h-8 w-2/3" /><Shimmer className="h-40" /></div>;
  const linkedFindings = (findings.data ?? []).filter((finding) => d.findingIds.includes(finding.id));

  return (
    <div className="space-y-6 px-7 pb-8 pt-7">
      <div className="pr-12">
        <p className="font-mono text-[12px] text-muted">Incident #{d.number} · angelegt {formatTime(d.createdAt, true)}{d.host ? ` · ${d.host}` : ''}</p>
        {editing ? (
          <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} className="mt-1 h-11 w-full rounded-2xl border border-line/[0.12] bg-raised/50 px-4 text-[18px] font-semibold outline-none focus:border-accent/45" />
        ) : (
          <h2 className="mt-1 text-[22px] font-semibold leading-tight">{d.title}</h2>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex rounded-full border border-line/[0.12] p-1">
          {(Object.keys(INCIDENT_STATUS) as Incident['status'][]).map((status) => (
            <button key={status} type="button" disabled={update.isPending} onClick={() => status !== d.status && update.mutate({ status })} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', d.status === status ? 'text-ink' : 'text-muted hover:text-ink')}>
              {d.status === status && <motion.span layoutId="incident-status" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
              <span className="relative">{INCIDENT_STATUS[status]}</span>
            </button>
          ))}
        </div>
        <select value={d.severity} onChange={(event) => update.mutate({ severity: event.target.value as Severity })} className="h-10 rounded-full border border-line/[0.12] bg-raised/60 px-3 text-[12.5px] outline-none" aria-label="Schwere">
          {SEVERITIES.map((severity) => <option key={severity} value={severity}>{SEVERITY_STYLE[severity].label}</option>)}
        </select>
        <div className="ml-auto flex gap-2">
          {editing ? (
            <>
              <button type="button" onClick={() => setEditing(false)} className="h-9 rounded-full border border-line/[0.12] px-4 text-[12.5px] hover:bg-raised">Abbrechen</button>
              <button type="button" disabled={!title.trim() || update.isPending} onClick={() => update.mutate({ title: title.trim(), description })} className="flex h-9 items-center gap-1.5 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[12.5px] font-medium text-accent-ink disabled:opacity-50"><Check className="size-4" /> Speichern</button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => { setTitle(d.title); setDescription(d.description); setEditing(true); }} className="flex h-9 items-center gap-1.5 rounded-full border border-line/[0.12] px-4 text-[12.5px] hover:bg-raised"><Pencil className="size-3.5" /> Bearbeiten</button>
              <button type="button" onClick={() => setConfirmDelete(true)} className="flex size-9 items-center justify-center rounded-full border border-bad/30 text-bad hover:bg-bad/10" aria-label="Löschen"><Trash2 className="size-4" /></button>
            </>
          )}
        </div>
      </div>

      <section>
        <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Beschreibung</p>
        {editing ? (
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={8} className="w-full rounded-2xl border border-line/[0.12] bg-raised/50 px-4 py-3 text-[13px] outline-none focus:border-accent/45" />
        ) : (
          <p className="whitespace-pre-wrap text-[13px] text-muted">{d.description || 'Keine Beschreibung.'}</p>
        )}
      </section>

      {!!d.checks.length && (
        <section>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Zu prüfen</p>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px]">{d.checks.map((check) => <li key={check}>{check}</li>)}</ul>
        </section>
      )}

      <section className="grid gap-5 md:grid-cols-2">
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Verknüpfte Events ({d.eventRefs.length})</p>
          {d.eventRefs.length ? (
            <ul className="space-y-1">
              {d.eventRefs.map((ref) => (
                <li key={`${ref.index}/${ref.id}`}>
                  <button type="button" onClick={() => setEventRef({ index: ref.index, id: ref.id })} className="flex w-full items-center gap-2 rounded-xl border border-line/[0.06] px-3 py-1.5 text-left text-[12px] hover:bg-hover/50">
                    {context.isFetching && eventRef?.id === ref.id ? <Loader2 className="size-3.5 animate-spin" /> : <FileSearch className="size-3.5 text-muted" />}
                    <span className="min-w-0 flex-1 truncate">{ref.description ?? ref.id}</span>
                    <span className="font-mono text-[10.5px] text-faint">{formatTime(ref.timestamp, true)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-muted">Keine.</p>}
          {(!!d.ruleIds.length || !!d.eventIds.length) && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {d.ruleIds.map((rule) => <button key={rule} type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(`rule:${rule}${d.host ? ` host:"${d.host}"` : ''}`)}`)} className="rounded-full border border-line/[0.10] px-2 py-0.5 font-mono text-[11px] hover:border-accent/40">Regel {rule}</button>)}
              {d.eventIds.map((eid) => <button key={eid} type="button" onClick={() => navigate(`/wazuh/investigation?q=${encodeURIComponent(`eid:${eid}${d.host ? ` host:"${d.host}"` : ''}`)}`)} className="rounded-full border border-line/[0.10] px-2 py-0.5 font-mono text-[11px] hover:border-accent/40">Event-ID {eid}</button>)}
            </div>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Verknüpfte Findings ({d.findingIds.length})</p>
          {linkedFindings.length ? (
            <ul className="space-y-1">
              {linkedFindings.map((finding) => (
                <li key={finding.id} className="flex items-center gap-2 rounded-xl border border-line/[0.06] px-3 py-1.5 text-[12px]">
                  <SeverityBadge severity={finding.severity} />
                  <span className="min-w-0 flex-1 truncate">{finding.title}</span>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-muted">{d.findingIds.length ? 'Findings nicht mehr vorhanden.' : 'Keine.'}</p>}
          {!!linkedFindings.length && <button type="button" onClick={() => navigate(`/wazuh/findings?status=all${d.host ? `&host=${encodeURIComponent(d.host)}` : ''}`)} className="mt-2 flex items-center gap-1.5 text-[12px] text-accent hover:underline"><ClipboardList className="size-3.5" /> Findings öffnen</button>}
        </div>
      </section>

      <section>
        <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-faint">Verlauf</p>
        <div className="mb-3 flex gap-2">
          <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} placeholder="Notiz: was wurde geprüft, was ist das Ergebnis?" className="min-w-0 flex-1 rounded-2xl border border-line/[0.12] bg-raised/50 px-4 py-2.5 text-[12.5px] outline-none focus:border-accent/45" />
          <button type="button" disabled={!note.trim() || addNote.isPending} onClick={() => addNote.mutate()} className="flex h-11 items-center gap-1.5 self-end rounded-full border border-accent/35 px-4 text-[12.5px] text-accent hover:bg-accent/10 disabled:opacity-50"><MessageSquarePlus className="size-4" /> Notiz</button>
        </div>
        <ol className="relative ml-2 border-l border-line/[0.10]">
          {(d.timeline ?? []).map((entry) => (
            <li key={entry.id} className="relative pb-3 pl-5">
              <span className={cn('absolute -left-[5px] top-1.5 size-[9px] rounded-full border-2 border-canvas', entry.kind === 'note' ? 'bg-accent' : 'bg-faint')} />
              <p className="font-mono text-[10.5px] text-faint">{formatTime(entry.createdAt, true)}{entry.kind === 'system' ? ' · System' : ''}</p>
              <p className={cn('whitespace-pre-wrap text-[12.5px]', entry.kind === 'system' && 'text-muted')}>{entry.text}</p>
            </li>
          ))}
        </ol>
      </section>

      <ConfirmDialog
        open={confirmDelete}
        tone="danger"
        icon={<Trash2 className="size-5" />}
        title={`Incident #${d.number} löschen?`}
        description="Incident und Verlauf werden endgültig entfernt. Verknüpfte Findings bleiben erhalten."
        confirmLabel="Löschen"
        onConfirm={() => { setConfirmDelete(false); remove.mutate(); }}
        onCancel={() => setConfirmDelete(false)}
      />
      <EventDrawer event={eventRef ? context.data?.event ?? null : null} onClose={() => setEventRef(null)} />
    </div>
  );
}

export function Incidents() {
  const [params, setParams] = useSearchParams();
  const status = params.get('status') ?? 'active';
  const selectedId = params.get('id');
  const incidents = useIncidents({});
  const [draft, setDraft] = useState<IncidentDraft | null>(null);
  const set = (entries: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(entries).forEach(([key, value]) => (value ? next.set(key, value) : next.delete(key)));
    setParams(next, { replace: true });
  };

  const all = useMemo(() => incidents.data ?? [], [incidents.data]);
  const list = all.filter((incident) => (status === 'all' ? true : status === 'active' ? incident.status === 'open' || incident.status === 'in_progress' : incident.status === status));
  const count = (key: Incident['status']) => all.filter((incident) => incident.status === key).length;

  return (
    <>
      <PageHeader
        section="Security Operations"
        title="Incidents"
        description="Sicherheitsfälle mit Status, Notizen und verknüpften Events und Findings"
        actions={<button type="button" onClick={() => setDraft({})} className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13px] font-medium text-accent-ink"><Plus className="size-4" /> Neuer Incident</button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {(Object.keys(INCIDENT_STATUS) as Incident['status'][]).map((key, index) => (
          <NotchCard key={key} index={index} eyebrow="Incidents" title={INCIDENT_STATUS[key]} tone={key === 'open' && count('open') ? 'bad' : undefined} onClick={() => set({ status: key })}>
            <p className="mt-2 text-[30px] font-bold leading-none tracking-[-0.03em]">{incidents.data ? <AnimatedNumber value={count(key)} /> : <Shimmer className="h-8 w-14" />}</p>
          </NotchCard>
        ))}
      </div>

      <div className="mt-5 flex flex-wrap gap-1.5">
        {[['active', 'Aktiv'], ...Object.entries(INCIDENT_STATUS), ['all', 'Alle']].map(([key, label]) => (
          <button key={key} type="button" onClick={() => set({ status: key === 'active' ? undefined : key })} className={cn('rounded-full border px-3 py-1 text-[12px]', status === key ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.10] text-muted hover:text-ink')}>{label}</button>
        ))}
      </div>

      <NotchCard index={4} className="mt-4" eyebrow={`${list.length} Fälle`} title="Liste" bodyClassName="pt-3">
        {incidents.isError ? (
          <p className="py-8 text-center text-[13px] text-bad">{(incidents.error as Error).message}</p>
        ) : !incidents.data ? (
          <div className="space-y-2">{Array.from({ length: 4 }, (_, index) => <Shimmer key={index} className="h-12" />)}</div>
        ) : !list.length ? (
          <div className="flex flex-col items-center gap-2 py-10 text-[13px] text-muted">
            <Siren className="size-6 text-faint" />
            Keine Incidents in dieser Ansicht. Anlegen über „Neuer Incident“, aus einem Event oder aus Findings.
          </div>
        ) : (
          <ul className="space-y-1">
            {list.map((incident, index) => (
              <motion.li key={incident.id} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index, 12) * 0.03 }}>
                <button type="button" onClick={() => set({ id: incident.id })} className={cn('grid w-full grid-cols-[52px_minmax(0,1fr)_140px_80px_110px_130px] items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[12.5px] hover:bg-hover/50', selectedId === incident.id && 'bg-accent/[0.08]')} style={{ boxShadow: `inset 3px 0 0 ${SEVERITY_STYLE[incident.severity].color}` }}>
                  <span className="font-mono text-muted">#{incident.number}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{incident.title}</span>
                    <span className="block truncate text-[11px] text-faint">{incident.eventRefs.length} Events · {incident.findingIds.length} Findings{incident.notes ? ` · ${incident.notes} Notizen` : ''}</span>
                  </span>
                  <span className="truncate font-mono text-[11.5px] text-muted">{incident.host ?? '–'}</span>
                  <SeverityBadge severity={incident.severity} />
                  <StatusBadge status={incident.status} />
                  <span className="text-right font-mono text-[11px] text-faint">{formatTime(incident.updatedAt, true)}</span>
                </button>
              </motion.li>
            ))}
          </ul>
        )}
      </NotchCard>

      <Drawer open={!!selectedId} onClose={() => set({ id: undefined })} label="Incident" width={820}>
        {selectedId && <Detail key={selectedId} id={selectedId} onDeleted={() => set({ id: undefined })} />}
      </Drawer>
      <IncidentFormDrawer draft={draft} onClose={() => setDraft(null)} />
    </>
  );
}
