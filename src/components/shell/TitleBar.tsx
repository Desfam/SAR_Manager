import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { Bell, Copy, Menu, Minus, Moon, Radar, Search, Square, SquareTerminal, Sun, X } from 'lucide-react';
import type { Workspace } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useTheme } from '@/hooks/use-theme';
import { useBackendHealth } from '@/hooks/use-infrastructure';

interface TitleBarProps {
  onToggleSidebar: () => void;
  onOpenPalette: () => void;
  onNavigate: (path: string) => void;
  alertCount: number;
  workspace: Workspace;
  onToggleWorkspace: () => void;
}

function PillButton({ children, onClick, label, className }: { children: React.ReactNode; onClick: () => void; label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'no-drag flex h-9 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/60 px-3.5 text-[13px] text-ink/90 transition-all duration-200 ease-out',
        'hover:border-accent/35 hover:bg-raised hover:text-ink active:scale-[0.97]',
        className,
      )}
    >
      {children}
    </button>
  );
}

function CircleButton({ children, onClick, label, badge }: { children: React.ReactNode; onClick: () => void; label: string; badge?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="no-drag relative flex size-9 items-center justify-center rounded-full border border-line/[0.10] bg-raised/60 text-muted transition-all duration-200 hover:border-accent/35 hover:text-ink active:scale-95"
    >
      {children}
      {badge && <span className="absolute right-[9px] top-[8px] size-1.5 rounded-full bg-accent shadow-[0_0_8px_rgb(var(--accent))]" />}
    </button>
  );
}

function WindowControls() {
  const desktop = window.sarDesktop;
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!desktop) return;
    desktop.window.isMaximized().then(setMaximized);
    return desktop.window.onMaximizeChange(setMaximized);
  }, [desktop]);

  if (!desktop) return null;
  const control = 'no-drag flex size-8 items-center justify-center rounded-full text-muted transition-colors duration-150 hover:bg-hover hover:text-ink';
  return (
    <div className="ml-1 flex items-center gap-1 border-l border-line/[0.08] pl-3">
      <button type="button" className={control} onClick={desktop.window.minimize} aria-label="Minimieren"><Minus className="size-4" /></button>
      <button type="button" className={control} onClick={desktop.window.toggleMaximize} aria-label={maximized ? 'Wiederherstellen' : 'Maximieren'}>
        {maximized ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
      </button>
      <button type="button" className={cn(control, 'hover:bg-bad hover:text-white')} onClick={desktop.window.close} aria-label="Schließen"><X className="size-4" /></button>
    </div>
  );
}

export function TitleBar({ onToggleSidebar, onOpenPalette, onNavigate, alertCount, workspace, onToggleWorkspace }: TitleBarProps) {
  const { theme, toggle } = useTheme();
  const health = useBackendHealth();
  const online = health.data?.ok ?? false;

  return (
    <header
      className="panel-surface drag-region mx-3 mt-3 flex h-[62px] shrink-0 items-center gap-3 rounded-panel px-3"
      onDoubleClick={(event) => {
        if (event.target === event.currentTarget) window.sarDesktop?.window.toggleMaximize();
      }}
    >
      <CircleButton onClick={onToggleSidebar} label="Seitenleiste ein-/ausblenden"><Menu className="size-4" /></CircleButton>

      <div className="flex items-center gap-2.5 pl-1">
        <span className="relative flex size-8 items-center justify-center rounded-[10px] bg-gradient-to-br from-accent-strong to-accent text-accent-ink shadow-[0_6px_20px_-6px_rgb(var(--accent)/0.8)]">
          <SquareTerminal className="size-[17px]" strokeWidth={2.2} />
        </span>
        <span className="text-[16px] font-semibold tracking-[-0.02em]">SAR<span className="text-muted">·</span>Manager</span>
      </div>

      {/* Workspace switch: the whole UI changes to the Wazuh SOC workspace and back */}
      <button
        type="button"
        onClick={onToggleWorkspace}
        aria-pressed={workspace === 'wazuh'}
        title={workspace === 'wazuh' ? 'Zurück zum SAR-Manager' : 'Zum Wazuh-Bereich wechseln'}
        className={cn(
          'no-drag relative ml-1 flex h-9 items-center gap-2 overflow-hidden rounded-full border px-3.5 text-[13px] font-medium transition-colors',
          workspace === 'wazuh' ? 'border-accent/50 text-accent-ink' : 'border-line/[0.12] text-ink/85 hover:border-accent/40 hover:text-ink',
        )}
      >
        {workspace === 'wazuh' && (
          <motion.span layoutId="workspace-switch" className="absolute inset-0 bg-gradient-to-r from-accent-strong to-accent" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />
        )}
        <Radar className="relative size-4" />
        <span className="relative">Wazuh</span>
      </button>

      <div className="ml-auto flex items-center gap-2.5">
        <PillButton onClick={() => onNavigate('/terminal')} label="Terminal öffnen">
          <SquareTerminal className="size-4" /> Terminal öffnen
        </PillButton>

        <button
          type="button"
          onClick={onOpenPalette}
          className="no-drag flex h-9 w-[240px] items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/60 pl-3.5 pr-2 text-[13px] text-muted transition-all duration-200 hover:border-accent/35 hover:text-ink xl:w-[300px]"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Suchen …</span>
          <kbd className="rounded-md border border-line/10 bg-hover px-1.5 py-0.5 font-mono text-[10px]">Strg K</kbd>
        </button>

        <span
          className={cn(
            'no-drag flex h-9 items-center gap-2 rounded-full border px-3 text-[12.5px]',
            online ? 'border-line/[0.10] bg-raised/60 text-muted' : 'border-bad/40 bg-bad/10 text-bad',
          )}
          title={online ? `Backend erreichbar · ${health.data?.latencyMs} ms` : 'Backend nicht erreichbar'}
        >
          <span className={cn('size-2 rounded-full', online ? 'bg-ok shadow-[0_0_8px_rgb(var(--ok))]' : 'bg-bad')} />
          {online ? <span className="font-mono tabular">{health.data?.latencyMs} ms</span> : 'Offline'}
        </span>

        <CircleButton onClick={toggle} label={theme === 'dark' ? 'Helles Design' : 'Dunkles Design'}>
          {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </CircleButton>
        <CircleButton onClick={() => onNavigate('/alerts')} label={`${alertCount} aktive Alerts`} badge={alertCount > 0}>
          <Bell className="size-4" />
        </CircleButton>

        <WindowControls />
      </div>
    </header>
  );
}
