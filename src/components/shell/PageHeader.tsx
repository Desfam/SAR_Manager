import type { ReactNode } from 'react';
import { ChevronRight, Home } from 'lucide-react';
import { motion } from 'motion/react';

interface PageHeaderProps {
  section?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}

export function PageHeader({ section, title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        <nav aria-label="Pfad" className="mb-3 flex items-center gap-2 text-[13px] text-muted">
          <Home className="size-4" />
          {section && (
            <>
              <ChevronRight className="size-3.5 text-faint" />
              <span>{section}</span>
            </>
          )}
          <ChevronRight className="size-3.5 text-faint" />
          <span className="text-ink">{title}</span>
        </nav>
        <motion.h1
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="text-[26px] font-semibold tracking-[-0.025em]"
        >
          {title}
        </motion.h1>
        <p className="mt-1.5 text-[14.5px] text-muted">{description}</p>
      </div>
      {actions && <div className="flex items-center gap-2.5">{actions}</div>}
    </header>
  );
}
