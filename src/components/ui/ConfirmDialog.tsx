import { useEffect, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  tone?: 'default' | 'danger';
  icon?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({ open, title, description, confirmLabel, tone = 'default', icon, onConfirm, onCancel }: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
      if (event.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && onCancel()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirm-title"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="panel-surface w-[440px] max-w-[92vw] rounded-[22px] p-6 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]"
          >
            {icon && (
              <span
                className={cn(
                  'mb-4 flex size-11 items-center justify-center rounded-2xl border [&>svg]:size-5',
                  tone === 'danger' ? 'border-bad/30 bg-bad/10 text-bad' : 'border-accent/30 bg-accent/10 text-accent',
                )}
              >
                {icon}
              </span>
            )}
            <h2 id="confirm-title" className="text-[17px] font-semibold tracking-[-0.01em]">{title}</h2>
            <div className="mt-2 text-[13.5px] leading-relaxed text-muted">{description}</div>
            <div className="mt-6 flex justify-end gap-2.5">
              <button
                type="button"
                onClick={onCancel}
                className="h-10 rounded-full border border-line/[0.12] px-4 text-[13.5px] text-ink/90 transition-colors hover:bg-raised"
              >
                Abbrechen
              </button>
              <button
                type="button"
                autoFocus
                onClick={onConfirm}
                className={cn(
                  'h-10 rounded-full px-4 text-[13.5px] font-medium transition-all active:scale-[0.97]',
                  tone === 'danger'
                    ? 'bg-bad text-white hover:brightness-110'
                    : 'bg-gradient-to-r from-accent-strong to-accent text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] hover:brightness-105',
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
