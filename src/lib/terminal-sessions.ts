import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { API_CONFIG } from '@/services/api-config';

export type SessionStatus = 'connecting' | 'connected' | 'closed' | 'error';

export interface SessionTarget {
  /** SSH connection id; absent for a local shell on the backend machine. */
  connectionId?: string;
  name: string;
  /** user@host:port, shown in the status bar */
  address?: string;
}

export interface TerminalSession {
  id: string;
  target: SessionTarget;
  status: SessionStatus;
  message?: string;
  startedAt: number;
  connectedAt?: number;
  cols: number;
  rows: number;
  terminal: Terminal;
  fit: FitAddon;
  socket: WebSocket | null;
  /** Unread output while the tab is in the background. */
  activity: boolean;
  /** Where to open the terminal once the font has loaded. */
  mountTarget?: HTMLElement;
}

/* Colours tuned to the app: near-black ground, warm accent cursor */
export const TERMINAL_THEME: ITheme = {
  background: '#0e0e0f',
  foreground: '#e6e6e8',
  cursor: '#f0883e',
  cursorAccent: '#0e0e0f',
  selectionBackground: 'rgba(240, 136, 62, 0.32)',
  black: '#1c1c1f',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#5c5c63',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa',
};

const FONT_KEY = 'sar.terminalFontSize';
const TERMINAL_FONT = '"JetBrains Mono Variable", "JetBrains Mono", ui-monospace, monospace';

/*
 * xterm measures the character cell once, when the terminal opens. If the web font is not loaded
 * by then it measures a fallback font and draws with the real one: wrong spacing and blurry
 * columns. The font is therefore loaded explicitly and terminals open only once it is there.
 */
let fontsReady = false;
const fontsLoaded: Promise<void> =
  typeof document === 'undefined'
    ? Promise.resolve()
    : Promise.all([
        document.fonts.load('400 14px "JetBrains Mono Variable"'),
        document.fonts.load('700 14px "JetBrains Mono Variable"'),
      ])
        .catch(() => undefined)
        .then(() => {
          fontsReady = true;
        });

function readFontSize() {
  try {
    const value = Number(localStorage.getItem(FONT_KEY));
    return value >= 10 && value <= 22 ? value : 13;
  } catch {
    return 13;
  }
}

/* ---------- store ---------- */

const sessions = new Map<string, TerminalSession>();
let order: string[] = [];
let activeId: string | null = null;
let fontSize = readFontSize();
const listeners = new Set<() => void>();
let version = 0;

function emit() {
  version += 1;
  listeners.forEach((listener) => listener());
}

function update(id: string, patch: Partial<TerminalSession>) {
  const session = sessions.get(id);
  if (!session) return;
  Object.assign(session, patch);
  emit();
}

export const terminalStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getVersion: () => version,
  list: () => order.map((id) => sessions.get(id)!).filter(Boolean),
  get: (id: string) => sessions.get(id),
  activeId: () => activeId,
  fontSize: () => fontSize,

  setActive(id: string) {
    const session = sessions.get(id);
    // No change, no update: avoids re-render loops in subscribers that call setActive from an effect
    if (activeId === id && !session?.activity) return;
    activeId = id;
    if (session) session.activity = false;
    emit();
  },

  open(target: SessionTarget): string {
    const id = crypto.randomUUID();
    const terminal = new Terminal({
      fontFamily: TERMINAL_FONT,
      fontSize,
      fontWeight: '400',
      fontWeightBold: '700',
      lineHeight: 1.2,
      letterSpacing: 0,
      drawBoldTextInBrightColors: true,
      rescaleOverlappingGlyphs: true,
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      allowProposedApi: true,
      smoothScrollDuration: 80,
      scrollback: 10_000,
      theme: TERMINAL_THEME,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')));

    const session: TerminalSession = {
      id,
      target,
      status: 'connecting',
      startedAt: Date.now(),
      cols: terminal.cols,
      rows: terminal.rows,
      terminal,
      fit,
      socket: null,
      activity: false,
    };
    sessions.set(id, session);
    order = [...order, id];
    activeId = id;

    // Copy/paste the way terminal users expect: Ctrl+Shift+C / Ctrl+Shift+V
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey) return true;
      if (event.code === 'KeyC') {
        const selection = terminal.getSelection();
        if (selection) void navigator.clipboard.writeText(selection);
        return false;
      }
      if (event.code === 'KeyV') {
        void navigator.clipboard.readText().then((text) => text && send(id, { type: 'input', data: text }));
        return false;
      }
      return true;
    });

    terminal.onData((data) => send(id, { type: 'input', data }));
    terminal.onResize(({ cols, rows }) => {
      update(id, { cols, rows });
      send(id, { type: 'resize', cols, rows });
    });

    connect(id);
    emit();
    return id;
  },

  reconnect(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    session.socket?.close();
    session.terminal.write('\r\n\x1b[2m── neu verbinden ──\x1b[0m\r\n');
    update(id, { status: 'connecting', message: undefined, startedAt: Date.now(), connectedAt: undefined });
    connect(id);
  },

  close(id: string) {
    const session = sessions.get(id);
    if (!session) return;
    if (session.socket && session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify({ type: 'disconnect' }));
    }
    session.socket?.close();
    session.socket = null;
    // Remove first, so a failing dispose can never leave a dead tab behind
    sessions.delete(id);
    const index = order.indexOf(id);
    order = order.filter((item) => item !== id);
    if (activeId === id) activeId = order[Math.min(index, order.length - 1)] ?? null;
    emit();
    try {
      session.terminal.dispose();
    } catch {
      // nothing left to clean up
    }
    session.terminal.element?.remove();
  },

  setFontSize(size: number) {
    fontSize = Math.max(10, Math.min(22, size));
    try {
      localStorage.setItem(FONT_KEY, String(fontSize));
    } catch {
      // ignore
    }
    sessions.forEach((session) => {
      session.terminal.options.fontSize = fontSize;
    });
    emit();
  },

  /**
   * Puts the session's terminal into `container`. xterm can only be opened once, so on later
   * mounts its existing element is moved instead; the scrollback and the shell stay intact.
   */
  attach(id: string, container: HTMLElement) {
    const session = sessions.get(id);
    if (!session) return;
    const { terminal } = session;
    if (terminal.element) {
      if (terminal.element.parentElement !== container) container.appendChild(terminal.element);
      fitSession(id);
      return;
    }
    session.mountTarget = container;
    const open = () => {
      const current = sessions.get(id);
      const target = current?.mountTarget;
      if (!current || current.terminal.element || !target?.isConnected) return;
      current.terminal.open(target);
      fitSession(id);
      current.terminal.focus();
      // Tell the server the real size measured with the real font
      send(id, { type: 'resize', cols: current.terminal.cols, rows: current.terminal.rows });
    };
    if (fontsReady) open();
    else void fontsLoaded.then(open);
  },

  fit: fitSession,
  send: (id: string, data: string) => send(id, { type: 'input', data }),
};

function fitSession(id: string) {
  const session = sessions.get(id);
  if (!session?.terminal.element?.isConnected) return;
  try {
    session.fit.fit();
  } catch {
    // container not measurable yet
  }
}

function send(id: string, message: Record<string, unknown>) {
  const socket = sessions.get(id)?.socket;
  if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

/** One socket per session, and no automatic reconnect: every reconnect would open a new SSH login. */
function connect(id: string) {
  const session = sessions.get(id);
  if (!session) return;
  const socket = new WebSocket(API_CONFIG.wsURL);
  session.socket = socket;
  let shellReady = false;

  socket.onopen = () => {
    socket.send(JSON.stringify(session.target.connectionId ? { type: 'connect-ssh', connectionId: session.target.connectionId } : { type: 'connect-local' }));
  };

  socket.onmessage = (event) => {
    if (sessions.get(id)?.socket !== socket) return;
    let message: { type: string; data?: string; message?: string };
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === 'output' && message.data) {
      session.terminal.write(message.data);
      if (activeId !== id && !session.activity) update(id, { activity: true });
    } else if (message.type === 'connected') {
      // The first "connected" only means the socket is ready; the shell is ready with the second one
      if (message.message === 'Terminal session ready') return;
      shellReady = true;
      update(id, { status: 'connected', connectedAt: Date.now(), message: message.message });
      fitSession(id);
      send(id, { type: 'resize', cols: session.terminal.cols, rows: session.terminal.rows });
    } else if (message.type === 'error') {
      session.terminal.write(`\r\n\x1b[31m✖ ${message.message ?? 'Fehler'}\x1b[0m\r\n`);
      update(id, { status: 'error', message: message.message });
    } else if (message.type === 'disconnected') {
      session.terminal.write(`\r\n\x1b[2m── ${message.message ?? 'Verbindung beendet'} ──\x1b[0m\r\n`);
      update(id, { status: 'closed', message: message.message });
    }
  };

  socket.onerror = () => {
    if (sessions.get(id)?.socket !== socket) return;
    update(id, { status: 'error', message: 'Backend nicht erreichbar' });
  };

  socket.onclose = () => {
    const current = sessions.get(id);
    if (!current || current.socket !== socket) return;
    if (current.status === 'connecting' || (current.status === 'connected' && shellReady)) {
      current.terminal.write('\r\n\x1b[2m── Verbindung getrennt ──\x1b[0m\r\n');
      update(id, { status: 'closed', message: 'Verbindung getrennt' });
    }
  };
}
