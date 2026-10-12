import { useEffect } from 'react';
import { Command } from 'cmdk';
import { AnimatePresence, motion } from 'motion/react';
import { CornerDownLeft, Monitor, Search, SquareTerminal } from 'lucide-react';
import { ALL_PAGES } from '@/lib/navigation';
import { useConnections } from '@/hooks/use-infrastructure';

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNavigate: (path: string) => void;
}

const itemClass =
  'flex h-11 cursor-pointer items-center gap-3 rounded-xl px-3 text-[13.5px] text-ink/85 data-[selected=true]:bg-hover data-[selected=true]:text-ink';

export function CommandPalette({ open, onOpenChange, onNavigate }: CommandPaletteProps) {
  const connections = useConnections();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
      if (event.key === 'Escape' && open) onOpenChange(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpenChange, open]);

  const go = (path: string) => {
    onOpenChange(false);
    onNavigate(path);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[14vh] backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && onOpenChange(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="panel-surface w-[620px] max-w-[92vw] overflow-hidden rounded-[22px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]"
          >
            <Command label="Befehlssuche" loop>
              <div className="flex items-center gap-3 border-b border-line/[0.07] px-4">
                <Search className="size-4 text-muted" />
                <Command.Input autoFocus placeholder="Seite, System oder Aktion suchen …" className="h-14 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-faint" />
                <kbd className="rounded-md border border-line/10 bg-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">Esc</kbd>
              </div>
              <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2">
                <Command.Empty className="px-3 py-8 text-center text-[13px] text-muted">Nichts gefunden.</Command.Empty>
                <Command.Group heading="Seiten" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-faint">
                  {ALL_PAGES.map((page) => {
                    const Icon = page.icon;
                    return (
                      <Command.Item key={page.path} value={`${page.label} ${page.description}`} onSelect={() => go(page.path)} className={itemClass}>
                        <Icon className="size-4 text-muted" />
                        <span className="flex-1">{page.label}</span>
                        <span className="truncate text-[12px] text-faint">{page.description}</span>
                      </Command.Item>
                    );
                  })}
                </Command.Group>
                {(connections.data?.length ?? 0) > 0 && (
                  <Command.Group heading="Systeme" className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-faint">
                    {connections.data?.map((host) => (
                      <Command.Item key={host.id} value={`${host.name} ${host.host}`} onSelect={() => go(`/systems?host=${encodeURIComponent(host.id)}`)} className={itemClass}>
                        {host.type === 'rdp' ? <Monitor className="size-4 text-muted" /> : <SquareTerminal className="size-4 text-muted" />}
                        <span className="flex-1">{host.name}</span>
                        <span className="font-mono text-[12px] text-faint">{host.host}</span>
                        <span className={host.status === 'online' ? 'size-1.5 rounded-full bg-ok' : 'size-1.5 rounded-full bg-bad'} />
                      </Command.Item>
                    ))}
                  </Command.Group>
                )}
              </Command.List>
              <div className="flex items-center gap-2 border-t border-line/[0.07] px-4 py-2.5 text-[11.5px] text-faint">
                <CornerDownLeft className="size-3.5" /> öffnen
              </div>
            </Command>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
