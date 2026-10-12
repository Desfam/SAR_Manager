import { Hammer } from 'lucide-react';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import type { NavItem } from '@/lib/navigation';

export function ComingSoon({ page, section }: { page: NavItem; section?: string }) {
  const Icon = page.icon;
  return (
    <>
      <PageHeader section={section} title={page.label} description={page.description} />
      <NotchCard className="min-h-[260px]" bodyClassName="items-center justify-center text-center">
        <span className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-line/[0.08] bg-raised text-accent shadow-[0_10px_30px_-12px_rgb(var(--accent)/0.6)]">
          <Icon className="size-6" />
        </span>
        <p className="text-[15px] font-semibold">{page.soon ? 'Kommt in der nächsten Runde' : 'Diese Seite wird als Nächstes neu gebaut'}</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted">
          <Hammer className="size-3.5" /> {page.soon ? 'Geplant, aber noch nicht gebaut: weder Oberfläche noch Auswertung.' : 'Die Oberfläche fehlt noch.'}
        </p>
      </NotchCard>
    </>
  );
}
