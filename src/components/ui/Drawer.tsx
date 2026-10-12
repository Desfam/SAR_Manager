import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { X } from 'lucide-react';

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
  width?: number;
}

/** Slides in from the right; the page behind stays visible and clickable-to-close. */
export function Drawer({ open, onClose, children, label, width = 520 }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            onClick={onClose}
          />
          <motion.aside
            role="dialog"
            aria-modal="true"
            aria-label={label}
            className="panel-surface fixed bottom-3 right-3 top-3 z-50 flex flex-col overflow-hidden rounded-[22px] shadow-[0_30px_80px_-20px_rgb(0_0_0/0.75)]"
            style={{ width: `min(${width}px, calc(100vw - 24px))` }}
            initial={{ x: width + 40, opacity: 0.6 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: width + 40, opacity: 0.6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Schließen"
              className="absolute right-4 top-4 z-10 flex size-9 items-center justify-center rounded-full border border-line/[0.10] bg-raised/80 text-muted transition-colors hover:text-ink"
            >
              <X className="size-4" />
            </button>
            <div className="scroll-thin flex-1 overflow-y-auto">{children}</div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
