import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { BookOpen, ChevronDown, Copy, ExternalLink, GitCommitVertical, Loader2, RefreshCw, SendHorizontal, Siren, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Shimmer } from '@/components/systems/fx';
import { LevelPill } from '@/components/wazuh/EventList';
import { RiskBadge, VerdictBadge } from '@/components/soc/badges';
import { IncidentFormDrawer } from '@/components/soc/IncidentForm';
import { useClaudeStatus, useRawEvent } from '@/hooks/use-soc';
import { CONFIDENCE, draftFromEvent, type IncidentDraft } from '@/lib/soc';
import { KERBEROS_FAILURE, LOGON_FAILURE, LOGON_TYPE, WINDOWS_EVENT_TITLE, lookupLinks } from '@/lib/event-knowledge';
import { investigationApi, type Explanation, type SocEvent } from '@/services/soc';
import { Markdown } from './Markdown';

const Label = ({ children }: { children: React.ReactNode }) => <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">{children}</p>;

function Fact({ label, value, sub, mono, onClick }: { label: string; value?: React.ReactNode; sub?: React.ReactNode; mono?: boolean; onClick?: () => void }) {
  if (value === undefined || value === null || value === '' || value === '-') return null;
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cn('min-w-0 rounded-xl border border-line/[0.07] bg-raised/30 px-3 py-2 text-left', onClick && 'hover:border-accent/35')}>
      <p className="text-[10.5px] text-faint">{label}</p>
      <p className={cn('truncate text-[13px] font-medium', mono && 'font-mono text-[12.5px]')} title={typeof value === 'string' ? value : undefined}>{value}</p>
      {sub && <p className="mt-0.5 text-[11px] leading-snug text-muted">{sub}</p>}
    </Tag>
  );
}

const lower = (value: unknown) => (typeof value === 'string' ? value.toLowerCase() : undefined);

interface ChatEntry {
  role: 'user' | 'assistant';
  text: string;
  meta?: Explanation;
}

/** Conversations per event for this app session, so switching events and back keeps them */
const conversations = new Map<string, { result: Explanation | null; chat: ChatEntry[] }>();

const SUGGESTIONS = ['Ist das gefährlich?', 'Wie prüfe ich das konkret?', 'Welche Befehle helfen mir?', 'Was wäre normal, was nicht?'];

const Meta = ({ meta }: { meta: Explanation }) => (
  <p className="mt-2 text-[10.5px] text-faint">
    {meta.model}{meta.durationMs ? ` · ${Math.round(meta.durationMs / 1000)} s` : ''}{meta.costUsd ? ` · ${meta.costUsd.toFixed(3)} $` : ''}{meta.web ? ' · mit Websuche' : ' · ohne Websuche'}{meta.cached ? ' · aus Zwischenspeicher' : ''}
  </p>
);

/** AI explanation through the local Claude Code CLI, with follow-up questions */
function ClaudeExplain({ event }: { event: SocEvent }) {
  const key = `${event.index}/${event.id}`;
  const status = useClaudeStatus();
  const [result, setResultState] = useState<Explanation | null>(() => conversations.get(key)?.result ?? null);
  const [chat, setChatState] = useState<ChatEntry[]>(() => conversations.get(key)?.chat ?? []);
  const [question, setQuestion] = useState('');
  const [web, setWeb] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const save = (nextResult: Explanation | null, nextChat: ChatEntry[]) => {
    conversations.set(key, { result: nextResult, chat: nextChat });
    setResultState(nextResult);
    setChatState(nextChat);
  };
  const explain = useMutation({
    mutationFn: (refresh: boolean) => investigationApi.explain(event.index, event.id, refresh, web),
    onSuccess: (value) => save(value, []),
  });
  const ask = useMutation({
    mutationFn: (text: string) => {
      const history = [{ role: 'assistant' as const, text: result?.text ?? '' }, ...chat.map(({ role, text: entry }) => ({ role, text: entry }))];
      return investigationApi.ask(event.index, event.id, history, text, web);
    },
    onMutate: (text) => {
      const next: ChatEntry[] = [...chat, { role: 'user', text }];
      save(result, next);
      setQuestion('');
      return next;
    },
    onSuccess: (value, _text, pending) => save(result, [...(pending ?? chat), { role: 'assistant', text: value.text, meta: value }]),
    // take the unanswered question back into the input field
    onError: (_error, text, pending) => {
      save(result, (pending ?? chat).slice(0, -1));
      setQuestion(text);
    },
  });
  useEffect(() => bottomRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), [chat.length, ask.isPending]);

  const send = (text: string) => {
    if (text.trim() && !ask.isPending) ask.mutate(text.trim());
  };
  const ready = status.data?.loggedIn;
  const busy = explain.isPending || ask.isPending;
  return (
    <section className="rounded-2xl border border-accent/25 bg-accent/[0.04] p-3.5">
      <div className="flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        <p className="text-[13px] font-semibold">KI-Erklärung</p>
        <label className="flex items-center gap-1.5 text-[11px] text-muted" title="Mit Websuche genauer bei unbekannten Events, kostet aber deutlich mehr">
          <input type="checkbox" checked={web} onChange={(change) => setWeb(change.target.checked)} className="accent-[rgb(var(--accent))]" /> mit Websuche
        </label>
        {!result && (
          <button type="button" disabled={!ready || busy} onClick={() => explain.mutate(false)} className="ml-auto flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-accent-strong to-accent px-3.5 text-[12px] font-medium text-accent-ink disabled:opacity-45">
            {explain.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} {explain.isPending ? 'Claude denkt …' : 'KI erklären'}
          </button>
        )}
        {result && (
          <button type="button" disabled={busy} onClick={() => explain.mutate(true)} className="ml-auto flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:text-ink disabled:opacity-45" title="Neu erklären lassen (beginnt das Gespräch neu)">
            {explain.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Neu
          </button>
        )}
      </div>
      {status.data && !ready && <p className="mt-2 break-all text-[11.5px] text-muted">{status.data.hint}</p>}
      {status.isError && <p className="mt-2 text-[11.5px] text-bad">Status der Claude-CLI nicht abrufbar.</p>}
      {explain.isPending && (
        <div className="mt-3 space-y-2">
          <p className="text-[11.5px] text-muted">{web ? 'Claude liest das Event und sucht online nach Erklärungen. Das dauert meist 20 bis 60 Sekunden.' : 'Claude liest das Event. Das dauert meist 5 bis 15 Sekunden.'}</p>
          <Shimmer className="h-3 w-4/5" /><Shimmer className="h-3 w-3/5" /><Shimmer className="h-3 w-2/3" />
        </div>
      )}
      {explain.isError && <p className="mt-2 text-[12px] text-bad">{(explain.error as Error).message}</p>}

      {result && !explain.isPending && (
        <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="mt-3">
          <Markdown text={result.text} />
          <Meta meta={result} />

          {/* follow-up conversation */}
          <div className="mt-3 space-y-2.5 border-t border-accent/15 pt-3">
            <AnimatePresence initial={false}>
              {chat.map((entry, index) => (
                <motion.div key={index} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={entry.role === 'user' ? 'flex justify-end' : ''}>
                  {entry.role === 'user' ? (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent/[0.16] px-3 py-2 text-[12.5px]">{entry.text}</p>
                  ) : (
                    <div className="rounded-2xl rounded-bl-md border border-line/[0.08] bg-panel/60 px-3 py-2.5">
                      <Markdown text={entry.text} />
                      {entry.meta && <Meta meta={entry.meta} />}
                    </div>
                  )}
                </motion.div>
              ))}
            </AnimatePresence>
            {ask.isPending && (
              <div className="flex items-center gap-2 text-[12px] text-muted"><Loader2 className="size-3.5 animate-spin" /> Claude antwortet …</div>
            )}
            {ask.isError && <p className="text-[12px] text-bad">{(ask.error as Error).message}</p>}
            {!chat.length && !ask.isPending && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button key={suggestion} type="button" onClick={() => send(suggestion)} className="rounded-full border border-line/[0.12] px-2.5 py-1 text-[11.5px] text-muted hover:border-accent/40 hover:text-ink">{suggestion}</button>
                ))}
              </div>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={question}
                onChange={(change) => setQuestion(change.target.value)}
                onKeyDown={(keyEvent) => {
                  // Enter sends, Shift+Enter makes a new line; keep arrow keys from switching the event
                  keyEvent.stopPropagation();
                  if (keyEvent.key === 'Enter' && !keyEvent.shiftKey) {
                    keyEvent.preventDefault();
                    send(question);
                  }
                }}
                rows={1}
                maxLength={1500}
                placeholder="Frage zu diesem Event stellen …"
                className="max-h-32 min-h-[38px] flex-1 resize-y rounded-2xl border border-line/[0.12] bg-raised/50 px-3.5 py-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/45"
              />
              <button type="button" disabled={!question.trim() || ask.isPending} onClick={() => send(question)} className="flex size-[38px] shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-accent-strong to-accent text-accent-ink disabled:opacity-45" aria-label="Frage senden">
                {ask.isPending ? <Loader2 className="size-4 animate-spin" /> : <SendHorizontal className="size-4" />}
              </button>
            </div>
            <div ref={bottomRef} />
            <p className="text-[10.5px] text-faint">Jede Frage schickt das Event und das bisherige Gespräch an Claude. KI kann sich irren, Belege prüfen.</p>
          </div>
        </motion.div>
      )}
      {!result && !explain.isPending && ready && <p className="mt-2 text-[11px] text-faint">Sendet dieses eine Event (Regel, Felder, Log-Zeile) an Claude Haiku (Anthropic). Ohne Websuche günstig (ca. 1 Cent), mit Websuche genauer, aber teurer. Danach kannst du Rückfragen stellen.</p>}
    </section>
  );
}

export function EventDetail({ event }: { event: SocEvent | null }) {
  const navigate = useNavigate();
  const raw = useRawEvent(event);
  const [showFields, setShowFields] = useState(false);
  const [draft, setDraft] = useState<IncidentDraft | null>(null);

  if (!event) return <div className="flex flex-1 items-center justify-center text-[12.5px] text-muted">Event links auswählen</div>;

  const data = raw.data?.raw?.data ?? {};
  const win = data.win ?? {};
  const eventdata: Record<string, string> = win.eventdata ?? {};
  const isWindows = event.platform === 'windows';
  const logonType = event.logonType ?? eventdata.logonType;
  const sourceIp = event.sourceIp ?? (eventdata.ipAddress && eventdata.ipAddress !== '-' ? eventdata.ipAddress : undefined) ?? data.srcip;
  const workstation = eventdata.workstationName && eventdata.workstationName !== '-' ? eventdata.workstationName : undefined;
  const failureCode = lower(eventdata.subStatus) && lower(eventdata.subStatus) !== '0x0' ? lower(eventdata.subStatus) : lower(eventdata.status);
  const failure = failureCode ? LOGON_FAILURE[failureCode] ?? KERBEROS_FAILURE[failureCode] : undefined;
  const title = event.eventId ? WINDOWS_EVENT_TITLE[event.eventId] : undefined;
  const links = lookupLinks(event);
  const shownFields = new Set(['logonType', 'ipAddress', 'workstationName', 'status', 'subStatus', 'targetUserName']);
  const extraFields = Object.entries(eventdata).filter(([field, value]) => !shownFields.has(field) && value && value !== '-' && value !== '0x0');
  const a = event.assessment;

  return (
    <motion.div key={`${event.index}/${event.id}`} initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.3 }} className="space-y-4">
      {/* name */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <LevelPill level={event.rule.level} />
          <VerdictBadge verdict={a.verdict} />
          <RiskBadge risk={a.risk} />
          <span className="ml-auto font-mono text-[11px] text-faint">{new Date(event.timestamp).toLocaleString('de-DE')}</span>
        </div>
        <p className="mt-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-faint">Event-Name</p>
        <h2 className="text-[17px] font-semibold leading-snug">{event.rule.description ?? 'Ohne Beschreibung'}</h2>
        {title && <p className="mt-0.5 text-[12px] italic text-muted">Microsoft: „{title}“</p>}
      </div>

      {/* key facts */}
      <div className="grid grid-cols-2 gap-2">
        <Fact label={isWindows ? 'Event-ID' : 'Regel-ID'} value={isWindows && event.eventId ? event.eventId : event.rule.id} sub={isWindows && event.eventId ? `Wazuh-Regel ${event.rule.id} · ${win.system?.channel ?? ''}` : event.decoder ? `Decoder ${event.decoder}` : undefined} mono />
        <Fact label="Logon Type" value={logonType ? `${logonType} · ${LOGON_TYPE[logonType]?.name ?? 'unbekannt'}` : undefined} sub={logonType ? LOGON_TYPE[logonType]?.meaning : undefined} />
        <Fact label="Quell-IP" value={sourceIp} sub={workstation ? `Arbeitsstation ${workstation}` : 'In allen Events suchen'} mono onClick={sourceIp ? () => navigate(`/wazuh/ioc?value=${encodeURIComponent(sourceIp)}`) : undefined} />
        <Fact label="Benutzer" value={event.user} mono onClick={event.user ? () => navigate(`/wazuh/ioc?value=${encodeURIComponent(event.user!)}`) : undefined} />
        <Fact label="Fehlergrund" value={failure} sub={failureCode} />
        <Fact label="Rechner" value={event.agent.name} sub={event.agent.ip} />
        <Fact label="Programm" value={event.program ?? (eventdata.processName && eventdata.processName !== '-' ? eventdata.processName.split('\\').pop() : undefined)} mono />
        {!!event.rule.mitre.ids.length && <Fact label="MITRE ATT&CK" value={event.rule.mitre.ids.join(', ')} sub={event.rule.mitre.techniques.join(', ')} mono />}
      </div>

      {/* explanation */}
      <section>
        <Label>Erklärung · regelbasiert</Label>
        <p className="text-[12.5px] leading-relaxed">{a.why}</p>
        {!!a.evidence.length && (
          <ul className="mt-2 space-y-0.5 text-[12px] text-muted">
            {a.evidence.map((entry) => <li key={entry} className="flex gap-2"><span className="text-accent">•</span>{entry}</li>)}
          </ul>
        )}
        {!!a.nextSteps.length && (
          <>
            <p className="mb-1 mt-3 text-[11.5px] font-medium">Was prüfen</p>
            <ol className="list-decimal space-y-0.5 pl-5 text-[12px]">{a.nextSteps.map((step) => <li key={step}>{step}</li>)}</ol>
          </>
        )}
        <p className="mt-2 text-[10.5px] text-faint">Kategorie {a.category} · Sicherheit der Bewertung {CONFIDENCE[a.confidence]}</p>
      </section>

      <ClaudeExplain key={`${event.index}/${event.id}`} event={event} />

      {/* online lookup */}
      <section>
        <Label>Online nachschlagen</Label>
        <div className="flex flex-wrap gap-1.5">
          {links.map((link) => (
            <a key={link.url} href={link.url} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-full border border-line/[0.12] px-2.5 py-1 text-[11.5px] text-muted hover:border-accent/40 hover:text-ink">
              <BookOpen className="size-3" /> {link.label} <ExternalLink className="size-3 text-faint" />
            </a>
          ))}
        </div>
      </section>

      {/* all fields */}
      <section>
        <button type="button" onClick={() => setShowFields(!showFields)} className="flex w-full items-center gap-2 text-left">
          <Label>Alle Felder {raw.isLoading && <Loader2 className="ml-1 inline size-3 animate-spin" />}</Label>
          <ChevronDown className={cn('mb-1.5 ml-auto size-4 text-muted transition-transform', showFields && 'rotate-180')} />
        </button>
        {showFields && (
          <div className="space-y-2">
            {!!extraFields.length && (
              <dl className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] gap-x-3 gap-y-0.5 text-[11.5px]">
                {extraFields.map(([field, value]) => (
                  <div key={field} className="contents"><dt className="truncate text-muted">{field}</dt><dd className="break-all font-mono">{String(value)}</dd></div>
                ))}
              </dl>
            )}
            {event.fullLog && <pre className="scroll-thin max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-raised/50 p-2.5 font-mono text-[11px]">{event.fullLog}</pre>}
            {raw.data && (
              <button type="button" onClick={() => { void navigator.clipboard.writeText(JSON.stringify(raw.data.raw, null, 2)); toast.success('JSON kopiert'); }} className="flex items-center gap-1.5 text-[11.5px] text-muted hover:text-ink"><Copy className="size-3" /> Rohdaten als JSON kopieren</button>
            )}
          </div>
        )}
      </section>

      {/* actions */}
      <div className="flex flex-wrap gap-2 border-t border-line/[0.07] pt-3">
        <button type="button" onClick={() => setDraft(draftFromEvent(event))} className="flex h-8 items-center gap-1.5 rounded-full border border-accent/30 px-3 text-[12px] text-accent hover:bg-accent/10"><Siren className="size-3.5" /> Incident anlegen</button>
        <button type="button" onClick={() => navigate(`/wazuh/timeline?q=${encodeURIComponent(`host:"${event.agent.name}"`)}&at=${encodeURIComponent(event.timestamp)}`)} className="flex h-8 items-center gap-1.5 rounded-full border border-line/[0.12] px-3 text-[12px] text-muted hover:text-ink"><GitCommitVertical className="size-3.5" /> Timeline</button>
      </div>
      <IncidentFormDrawer draft={draft} onClose={() => setDraft(null)} />
    </motion.div>
  );
}
