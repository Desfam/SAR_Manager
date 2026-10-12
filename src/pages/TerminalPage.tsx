import '@xterm/xterm/css/xterm.css';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import {
  Clock3,
  Eraser,
  Laptop,
  Maximize2,
  Minimize2,
  Minus,
  Monitor,
  Plus,
  RotateCw,
  Search,
  Server,
  SquareTerminal,
  X,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { AnimatedNumber, PillBars } from '@/components/ui/viz';
import { useConnections, type Connection } from '@/hooks/use-infrastructure';
import { terminalStore, type SessionStatus, type SessionTarget, type TerminalSession } from '@/lib/terminal-sessions';

/* ---------- store hook & helpers ---------- */

function useTerminalStore() {
  useSyncExternalStore(terminalStore.subscribe, terminalStore.getVersion);
  return {
    sessions: terminalStore.list(),
    activeId: terminalStore.activeId(),
    fontSize: terminalStore.fontSize(),
  };
}

const statusDot: Record<SessionStatus, string> = {
  connecting: 'bg-accent animate-pulse',
  connected: 'bg-ok',
  closed: 'bg-faint',
  error: 'bg-bad',
};

const statusText: Record<SessionStatus, string> = {
  connecting: 'Verbinde …',
  connected: 'Verbunden',
  closed: 'Getrennt',
  error: 'Fehler',
};

function targetFor(host: Connection): SessionTarget {
  return { connectionId: host.id, name: host.name, address: `${host.username}@${host.host}:${host.port}` };
}

const LOCAL_TARGET: SessionTarget = { name: 'Lokale Shell', address: 'Backend-Rechner' };

function formatDuration(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

/* ---------- stat cards (dashboard style) ---------- */

function StatCards({ sessions, hosts, onOpen, onFocusSearch, onManage }: { sessions: TerminalSession[]; hosts: Connection[]; onOpen: (target: SessionTarget) => void; onFocusSearch: () => void; onManage: () => void }) {
  const connected = sessions.filter((session) => session.status === 'connected');
  const now = useNow(connected.length > 0);
  const longest = connected.reduce<TerminalSession | null>((best, session) => (!best || (session.connectedAt ?? now) < (best.connectedAt ?? now) ? session : best), null);
  const online = hosts.filter((host) => host.status === 'online');
  const perHost = hosts.slice(0, 7).map((host) => ({
    label: host.name.slice(0, 3),
    value: sessions.filter((session) => session.target.connectionId === host.id && session.status !== 'closed').length,
    title: host.name,
  }));
  const peak = Math.max(0, ...perHost.map((bar) => bar.value));

  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
      <NotchCard
        index={0}
        glow
        className="min-h-[168px]"
        eyebrow="Jetzt aktiv"
        title="Sitzungen"
        actions={[{ label: 'Neue Sitzung', icon: <Plus />, onClick: onFocusSearch }]}
      >
        <div className="mt-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={connected.length} /></p>
            <p className="mt-2 text-[12.5px] text-muted">
              {sessions.length - connected.length > 0 ? `${sessions.length - connected.length} getrennt oder verbindend` : 'alle Tabs verbunden'}
            </p>
          </div>
          {perHost.some((bar) => bar.value > 0) && (
            <div className="w-[140px]">
              <PillBars height={46} bars={perHost.map((bar) => ({ ...bar, highlight: bar.value > 0 && bar.value === peak }))} />
            </div>
          )}
        </div>
      </NotchCard>

      <NotchCard index={1} className="min-h-[168px]" eyebrow="Erreichbar" title="SSH-Hosts" actions={[{ label: 'Systeme verwalten', icon: <Server />, onClick: onManage }]}>
        <p className="mt-3 text-[44px] font-bold leading-none tracking-[-0.03em]">
          <AnimatedNumber value={online.length} />
          <span className="ml-1 text-[20px] font-medium text-muted">/ {hosts.length}</span>
        </p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {hosts.slice(0, 8).map((host) => (
            <span key={host.id} title={host.name} className={cn('h-1.5 w-6 rounded-full', host.status === 'online' ? 'bg-ok/80' : 'bg-bad/80')} />
          ))}
        </div>
      </NotchCard>

      <NotchCard index={2} className="min-h-[168px]" eyebrow="Längste Sitzung" title={longest ? longest.target.name : 'Laufzeit'}>
        <p className="mt-3 font-mono text-[40px] font-semibold leading-none tracking-[-0.02em] tabular">
          {longest?.connectedAt ? formatDuration(now - longest.connectedAt) : '–'}
        </p>
        <p className="mt-2 flex items-center gap-1.5 text-[12.5px] text-muted">
          <Clock3 className="size-3.5" />
          {longest ? longest.target.address : 'Noch keine Sitzung verbunden'}
        </p>
      </NotchCard>

      <NotchCard index={3} className="min-h-[168px]" eyebrow="Schnellstart" title="Verbinden mit …" actions={[{ label: 'Lokale Shell', icon: <Laptop />, onClick: () => onOpen(LOCAL_TARGET) }]}>
        <div className="mt-3 flex flex-wrap gap-2">
          {online.slice(0, 4).map((host) => (
            <button
              key={host.id}
              type="button"
              onClick={() => onOpen(targetFor(host))}
              className="flex h-9 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/60 px-3.5 text-[13px] transition-all hover:-translate-y-0.5 hover:border-accent/40"
            >
              <Zap className="size-3.5 text-accent" /> {host.name}
            </button>
          ))}
          {online.length === 0 && <p className="text-[13px] text-muted">Kein SSH-Host online.</p>}
        </div>
      </NotchCard>
    </div>
  );
}

/* ---------- host list ---------- */

function HostList({ onOpen, sessions, searchRef }: { onOpen: (target: SessionTarget) => void; sessions: TerminalSession[]; searchRef: React.RefObject<HTMLInputElement> }) {
  const connections = useConnections();
  const [query, setQuery] = useState('');
  const hosts = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (connections.data ?? [])
      .filter((host) => host.type !== 'rdp')
      .filter((host) => !needle || `${host.name} ${host.host} ${host.username}`.toLowerCase().includes(needle))
      .sort((left, right) => (left.status === 'online' ? 0 : 1) - (right.status === 'online' ? 0 : 1) || left.name.localeCompare(right.name));
  }, [connections.data, query]);
  const openCount = (id: string) => sessions.filter((session) => session.target.connectionId === id && session.status !== 'closed').length;

  return (
    <NotchCard
      index={4}
      eyebrow="SSH"
      title="Systeme"
      className="min-h-0"
      bodyClassName="min-h-0 pt-3"
      actions={[{ label: 'Lokale Shell öffnen', icon: <Laptop />, onClick: () => onOpen(LOCAL_TARGET) }]}
    >
      <label className="flex h-10 items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 transition-colors focus-within:border-accent/40">
        <Search className="size-4 text-muted" />
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="System suchen …" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
      </label>
      <ul className="scroll-thin -mx-2 mt-3 flex-1 space-y-1 overflow-y-auto px-2">
        {hosts.map((host, index) => {
          const count = openCount(host.id);
          const online = host.status === 'online';
          return (
            <motion.li key={host.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + index * 0.04 }}>
              <button
                type="button"
                onClick={() => onOpen(targetFor(host))}
                title={online ? 'Neue Sitzung öffnen' : 'System ist offline, Verbindung wird trotzdem versucht'}
                className="group flex w-full items-center gap-3 rounded-2xl border border-transparent px-3 py-2.5 text-left transition-all hover:border-line/[0.08] hover:bg-hover/50"
              >
                <span className="relative flex size-2.5 shrink-0 items-center justify-center">
                  {online && <span className="absolute inline-flex size-full animate-ping rounded-full bg-ok/40 [animation-duration:2.4s]" />}
                  <span className={cn('relative size-2 rounded-full', online ? 'bg-ok' : 'bg-bad')} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-medium">{host.name}</p>
                  <p className="truncate font-mono text-[11px] text-muted">{host.username}@{host.host}</p>
                </div>
                {count > 0 && <span className="rounded-full border border-accent/30 bg-accent/10 px-2 font-mono text-[10.5px] text-accent">{count}</span>}
                <span className="flex size-7 items-center justify-center rounded-full border border-line/[0.08] text-faint opacity-0 transition-all group-hover:opacity-100 group-hover:text-accent">
                  <Plus className="size-3.5" />
                </span>
              </button>
            </motion.li>
          );
        })}
        {hosts.length === 0 && <li className="px-2 py-6 text-center text-[12.5px] text-muted">{connections.isLoading ? 'Lädt …' : 'Keine SSH-Systeme gefunden.'}</li>}
      </ul>
    </NotchCard>
  );
}

/* ---------- terminal ---------- */

function TerminalView({ session }: { session: TerminalSession }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    terminalStore.attach(session.id, element);
    session.terminal.focus();
    const observer = new ResizeObserver(() => terminalStore.fit(session.id));
    observer.observe(element);
    return () => observer.disconnect();
  }, [session.id, session.terminal]);
  return <div ref={container} className="h-full w-full" onMouseDown={() => session.terminal.focus()} />;
}

function Tabs({ sessions, activeId }: { sessions: TerminalSession[]; activeId: string | null }) {
  return (
    <div className="scroll-thin flex min-w-0 items-center gap-1.5 overflow-x-auto pb-1">
      <AnimatePresence initial={false}>
        {sessions.map((session) => {
          const isActive = session.id === activeId;
          return (
            <motion.div
              key={session.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ duration: 0.18 }}
              className={cn(
                'group relative flex h-9 shrink-0 items-center gap-2 rounded-full border pl-3.5 pr-1 text-[13px] transition-colors',
                isActive ? 'border-transparent text-ink' : 'border-line/[0.08] text-muted hover:border-line/[0.14] hover:text-ink',
              )}
            >
              {isActive && <motion.span layoutId="terminal-tab" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
              <button type="button" onClick={() => terminalStore.setActive(session.id)} className="relative flex items-center gap-2">
                <span className={cn('size-2 rounded-full', statusDot[session.status])} />
                <span className="max-w-[160px] truncate">{session.target.name}</span>
                {session.activity && !isActive && <span className="size-1.5 rounded-full bg-accent shadow-[0_0_6px_rgb(var(--accent))]" title="Neue Ausgabe" />}
              </button>
              <button
                type="button"
                onClick={() => terminalStore.close(session.id)}
                aria-label={`${session.target.name} schließen`}
                className="relative flex size-7 items-center justify-center rounded-full text-faint transition-colors hover:bg-hover hover:text-ink"
              >
                <X className="size-3.5" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

function StatusRow({ session, fontSize }: { session: TerminalSession; fontSize: number }) {
  const now = useNow(session.status === 'connected');
  const pill = 'flex h-8 items-center gap-2 rounded-full border border-line/[0.08] bg-raised/50 px-3 text-[12px]';
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-muted">
      <span className={pill}>
        <span className={cn('size-2 rounded-full', statusDot[session.status])} />
        <span className={session.status === 'error' ? 'text-bad' : 'text-ink/90'}>{statusText[session.status]}</span>
        {session.status === 'error' && session.message && <span className="max-w-[380px] truncate text-bad/80">· {session.message}</span>}
      </span>
      <span className={cn(pill, 'font-mono')}>{session.target.address}</span>
      {session.status === 'connected' && session.connectedAt && <span className={cn(pill, 'font-mono tabular')}><Clock3 className="size-3.5" />{formatDuration(now - session.connectedAt)}</span>}
      <span className={cn(pill, 'font-mono tabular')}>{session.cols}×{session.rows}</span>
      <div className="ml-auto flex items-center gap-1 rounded-full border border-line/[0.08] bg-raised/50 p-0.5">
        <button type="button" onClick={() => terminalStore.setFontSize(fontSize - 1)} aria-label="Schrift kleiner" className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-ink"><Minus className="size-3.5" /></button>
        <span className="w-12 text-center font-mono text-[11.5px]">{fontSize} px</span>
        <button type="button" onClick={() => terminalStore.setFontSize(fontSize + 1)} aria-label="Schrift größer" className="flex size-7 items-center justify-center rounded-full transition-colors hover:bg-hover hover:text-ink"><Plus className="size-3.5" /></button>
      </div>
      <span className="hidden text-[11.5px] text-faint 2xl:inline">Strg+Umschalt+C / V kopieren &amp; einfügen</span>
    </div>
  );
}

/* ---------- page ---------- */

export function TerminalPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const connections = useConnections();
  const { sessions, activeId, fontSize } = useTerminalStore();
  const [fullscreen, setFullscreen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const active = sessions.find((session) => session.id === activeId) ?? null;
  const sshHosts = (connections.data ?? []).filter((host) => host.type !== 'rdp');

  const open = (target: SessionTarget) => terminalStore.open(target);

  // Deep link: /terminal?host=<connectionId> focuses an open session or starts one.
  // Handled once per link: opening a session changes `sessions`, which must not trigger it again.
  const requestedHost = params.get('host');
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const handledHost = useRef<string | null>(null);
  useEffect(() => {
    if (!requestedHost) {
      handledHost.current = null;
      return;
    }
    if (!connections.data || handledHost.current === requestedHost) return;
    handledHost.current = requestedHost;
    const existing = sessionsRef.current.find((session) => session.target.connectionId === requestedHost && session.status !== 'closed');
    if (existing) terminalStore.setActive(existing.id);
    else {
      const host = connections.data.find((item) => item.id === requestedHost);
      if (host) terminalStore.open(targetFor(host));
    }
    setParams({}, { replace: true });
  }, [connections.data, requestedHost, setParams]);

  /* Fullscreen: the window itself goes fullscreen (Electron) or the document (browser) */
  const setScreenFullscreen = (value: boolean) => {
    const desktop = window.sarDesktop;
    if (desktop?.window.setFullScreen) void desktop.window.setFullScreen(value);
    else if (value) void document.documentElement.requestFullscreen?.().catch(() => undefined);
    else if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  };
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    setScreenFullscreen(next);
  };

  // Leaving fullscreen from outside (window manager, browser) also leaves the fullscreen view
  useEffect(() => {
    const unsubscribe = window.sarDesktop?.window.onFullScreenChange?.((value) => {
      if (!value) setFullscreen(false);
    });
    const onDocument = () => {
      if (!document.fullscreenElement && !window.sarDesktop) setFullscreen(false);
    };
    document.addEventListener('fullscreenchange', onDocument);
    return () => {
      unsubscribe?.();
      document.removeEventListener('fullscreenchange', onDocument);
    };
  }, []);

  // F11 toggles; Esc stays with the shell (vim, less, …)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'F11') return;
      event.preventDefault();
      event.stopPropagation();
      setFullscreen((value) => {
        setScreenFullscreen(!value);
        return !value;
      });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // Never leave the window stuck in fullscreen when navigating away
  useEffect(() => () => setScreenFullscreen(false), []);

  useEffect(() => {
    if (!active) return;
    const frame = requestAnimationFrame(() => terminalStore.fit(active.id));
    const late = window.setTimeout(() => terminalStore.fit(active.id), 350);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(late);
    };
  }, [active, fullscreen, fontSize]);

  const workspaceActions = [
    { label: 'Neu verbinden', icon: <RotateCw />, onClick: () => active && active.status !== 'connecting' && terminalStore.reconnect(active.id) },
    { label: 'Bildschirm leeren', icon: <Eraser />, onClick: () => active?.terminal.clear() },
    { label: 'Vollbild (F11)', icon: <Maximize2 />, onClick: toggleFullscreen },
  ];

  const screen = (
    <TerminalScreen active={active} hosts={sshHosts} onOpen={open} onManage={() => navigate('/systems')} />
  );

  return (
    <>
      <PageHeader section="Betrieb" title="Terminal" description="SSH-Sitzungen direkt in der App. Sitzungen laufen weiter, wenn du die Seite wechselst." />
      <StatCards sessions={sessions} hosts={sshHosts} onOpen={open} onFocusSearch={() => searchRef.current?.focus()} onManage={() => navigate('/systems')} />

      <div className="mt-5 grid h-[calc(100vh-200px)] min-h-[520px] grid-cols-[300px_minmax(0,1fr)] gap-5">
        <HostList onOpen={open} sessions={sessions} searchRef={searchRef} />

        <NotchCard
          index={5}
          glow={!!active && active.status === 'connected'}
          eyebrow={active ? (active.target.connectionId ? 'SSH-Sitzung' : 'Lokal') : 'Arbeitsbereich'}
          title={active ? active.target.name : 'Terminal'}
          className="min-h-0"
          bodyClassName="min-h-0 pt-3"
          actions={workspaceActions}
        >
          {sessions.length > 0 && <Tabs sessions={sessions} activeId={activeId} />}
          {/* The terminal sits inset in the card, like a screen in a bezel */}
          <div className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-2xl border border-line/[0.08] bg-[#0e0e0f] shadow-[inset_0_1px_0_rgb(255_255_255/0.04),inset_0_0_40px_rgb(0_0_0/0.5)]">
            {!fullscreen ? screen : <p className="flex h-full items-center justify-center text-[13px] text-[#9a9aa1]">Läuft im Vollbild · F11 zum Zurückkehren</p>}
          </div>
          {active && <StatusRow session={active} fontSize={fontSize} />}
        </NotchCard>
      </div>

      {createPortal(
        <AnimatePresence>
          {fullscreen && (
            <motion.div
              className="fixed inset-0 z-[60] flex flex-col bg-[#0b0b0c]"
              initial={{ opacity: 0, scale: 0.985 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.99 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] px-3">
                <div className="min-w-0 flex-1">{sessions.length > 0 && <Tabs sessions={sessions} activeId={activeId} />}</div>
                {active && (
                  <span className="hidden items-center gap-2 font-mono text-[11.5px] text-[#9a9aa1] lg:flex">
                    <span className={cn('size-1.5 rounded-full', statusDot[active.status])} />
                    {active.target.address} · {active.cols}×{active.rows}
                  </span>
                )}
                <div className="flex items-center gap-1">
                  <FullscreenButton label="Schrift kleiner" onClick={() => terminalStore.setFontSize(fontSize - 1)}><Minus className="size-4" /></FullscreenButton>
                  <span className="w-10 text-center font-mono text-[11px] text-[#9a9aa1]">{fontSize} px</span>
                  <FullscreenButton label="Schrift größer" onClick={() => terminalStore.setFontSize(fontSize + 1)}><Plus className="size-4" /></FullscreenButton>
                  <FullscreenButton label="Neu verbinden" onClick={() => active && active.status !== 'connecting' && terminalStore.reconnect(active.id)}><RotateCw className="size-4" /></FullscreenButton>
                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    className="ml-1 flex h-8 items-center gap-2 rounded-full border border-white/10 px-3 text-[12.5px] text-[#e6e6e8] transition-colors hover:border-accent/40"
                  >
                    <Minimize2 className="size-3.5" /> Vollbild verlassen <kbd className="font-mono text-[10px] text-[#9a9aa1]">F11</kbd>
                  </button>
                </div>
              </div>
              <div className="relative min-h-0 flex-1 bg-[#0e0e0f]">{screen}</div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </>
  );
}

function FullscreenButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className="flex size-8 items-center justify-center rounded-full text-[#9a9aa1] transition-colors hover:bg-white/[0.06] hover:text-[#e6e6e8]">
      {children}
    </button>
  );
}

/** The terminal itself, or the empty state; shown either in the card or fullscreen. */
function TerminalScreen({ active, hosts, onOpen, onManage }: { active: TerminalSession | null; hosts: Connection[]; onOpen: (target: SessionTarget) => void; onManage: () => void }) {
  if (!active) return <div className="h-full p-3"><EmptyWorkspace hosts={hosts} onOpen={onOpen} onManage={onManage} /></div>;
  return (
    <div className="sar-terminal relative h-full">
      <TerminalView key={active.id} session={active} />
      <AnimatePresence>
        {(active.status === 'closed' || active.status === 'error') && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            className="absolute bottom-5 left-1/2 flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/10 bg-[#161617]/95 py-1.5 pl-4 pr-1.5 text-[13px] shadow-2xl backdrop-blur"
          >
            <span className={active.status === 'error' ? 'text-bad' : 'text-[#9a9aa1]'}>
              {active.status === 'error' ? 'Verbindung fehlgeschlagen' : 'Sitzung beendet'}
            </span>
            <button
              type="button"
              onClick={() => terminalStore.reconnect(active.id)}
              className="flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-accent-strong to-accent px-3.5 font-medium text-accent-ink"
            >
              <RotateCw className="size-3.5" /> Neu verbinden
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyWorkspace({ hosts, onOpen, onManage }: { hosts: Connection[]; onOpen: (target: SessionTarget) => void; onManage: () => void }) {
  return (
    <div className="grid-texture flex h-full flex-col items-center justify-center rounded-xl text-center">
      <motion.span
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="mb-5 flex size-16 items-center justify-center rounded-2xl border border-white/10 bg-[#1c1c1e] text-accent shadow-[0_14px_40px_-14px_rgb(var(--accent)/0.7)]"
      >
        <SquareTerminal className="size-7" />
      </motion.span>
      <p className="text-[17px] font-semibold text-[#e6e6e8]">Keine offene Sitzung</p>
      <p className="mt-1.5 text-[13px] text-[#9a9aa1]">Wähle links ein System oder starte direkt hier:</p>
      <div className="mt-5 flex max-w-[560px] flex-wrap justify-center gap-2">
        {hosts.slice(0, 6).map((host) => (
          <button
            key={host.id}
            type="button"
            onClick={() => onOpen(targetFor(host))}
            className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-[#e6e6e8] transition-all hover:-translate-y-0.5 hover:border-accent/40"
          >
            <span className={cn('size-1.5 rounded-full', host.status === 'online' ? 'bg-ok' : 'bg-bad')} />
            {host.name}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onOpen(LOCAL_TARGET)}
          className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3.5 py-2 text-[13px] text-[#e6e6e8] transition-all hover:-translate-y-0.5 hover:border-accent/40"
        >
          <Laptop className="size-3.5" /> Lokale Shell
        </button>
        {hosts.length === 0 && (
          <button type="button" onClick={onManage} className="flex items-center gap-2 rounded-full border border-white/10 px-3.5 py-2 text-[13px] text-[#e6e6e8] hover:border-accent/40">
            <Monitor className="size-4" /> System anlegen
          </button>
        )}
      </div>
    </div>
  );
}
