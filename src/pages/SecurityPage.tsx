import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Box, Container, Loader2, Monitor, Search, ShieldCheck, ShieldHalf, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { AnimatedNumber, Ring } from '@/components/ui/viz';
import { FindingList } from '@/components/security/FindingList';
import { GuestAudit } from '@/components/security/GuestAudit';
import { getProxmoxTarget } from '@/hooks/use-infrastructure';
import { hardeningKeys, useHardeningAudit } from '@/hooks/use-hardening';
import { hardeningApi, type AuditedGuest, type Finding } from '@/services/hardening';
import { CATEGORIES, SEVERITY_LABEL, SEVERITY_RANK, STATUS_STYLE, categoryStatus, scoreTone } from '@/lib/hardening';
import { formatRelative } from '@/lib/format';

type Filter = 'all' | 'problems' | 'lxc' | 'qemu' | 'external';

function TypeIcon({ guest }: { guest: AuditedGuest }) {
  if (guest.type === 'lxc') return <Container className="size-3.5 text-muted" />;
  if (guest.type === 'external') return <Box className="size-3.5 text-muted" />;
  return <Monitor className="size-3.5 text-muted" />;
}

export function SecurityPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const audit = useHardeningAudit();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [findingFilter, setFindingFilter] = useState<string | null>(null);

  const result = audit.data?.last ?? null;
  const running = audit.data?.running ?? null;
  const guests = useMemo(() => result?.guests ?? [], [result]);
  const selected = guests.find((guest) => guest.key === params.get('guest')) ?? null;

  const start = useMutation({
    mutationFn: () => hardeningApi.start(getProxmoxTarget()),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: hardeningKeys.audit }),
    onError: (failure: Error) => toast.error('Prüfung nicht gestartet', { description: failure.message }),
  });

  /* Aggregates */
  const scored = guests.filter((guest) => guest.score !== null);
  const average = scored.length ? Math.round(scored.reduce((sum, guest) => sum + (guest.score ?? 0), 0) / scored.length) : null;
  const allFindings = guests.flatMap((guest) => guest.findings.map((finding) => ({ guest, finding })));
  const critical = allFindings.filter(({ finding }) => finding.status === 'fail' && finding.severity === 'critical').length + (result?.host.findings.filter((finding) => finding.status === 'fail' && finding.severity === 'critical').length ?? 0);
  const sshChecked = guests.filter((guest) => guest.sshState === 'ok').length;

  // Most common problems across all systems, weighted by severity
  const topActions = useMemo(() => {
    const map = new Map<string, { finding: Finding; guests: AuditedGuest[]; fails: number }>();
    guests.forEach((guest) => guest.findings.forEach((finding) => {
      if (finding.status !== 'fail' && finding.status !== 'warn') return;
      const entry = map.get(finding.id) ?? { finding, guests: [], fails: 0 };
      entry.guests.push(guest);
      if (finding.status === 'fail') entry.fails += 1;
      map.set(finding.id, entry);
    }));
    return [...map.values()].sort((a, b) => SEVERITY_RANK[b.finding.severity] * (b.fails * 2 + b.guests.length) - SEVERITY_RANK[a.finding.severity] * (a.fails * 2 + a.guests.length)).slice(0, 8);
  }, [guests]);

  const needle = query.trim().toLowerCase();
  const visible = guests.filter((guest) => {
    if (needle && !`${guest.name} ${guest.vmid ?? ''} ${guest.ips.join(' ')} ${guest.os ?? ''}`.toLowerCase().includes(needle)) return false;
    if (findingFilter && !guest.findings.some((finding) => finding.id === findingFilter && (finding.status === 'fail' || finding.status === 'warn'))) return false;
    if (filter === 'problems') return guest.findings.some((finding) => finding.status === 'fail');
    if (filter === 'lxc' || filter === 'qemu' || filter === 'external') return guest.type === filter;
    return true;
  });
  const filterTitle = findingFilter ? topActions.find((entry) => entry.finding.id === findingFilter)?.finding.title : null;

  return (
    <>
      <PageHeader
        section="Sicherheit"
        title="Security"
        description="Absicherung Schicht für Schicht: Proxmox-Host, Isolation, Netzwerk, System, Zugänge, Dienste, Überwachung und Backup. Nur lesend, mit konkreten Schritten zur Behebung."
        actions={
          running ? (
            <div className="flex h-10 min-w-[260px] items-center gap-3 rounded-full border border-line/[0.12] px-4">
              <Loader2 className="size-4 animate-spin text-accent" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] text-muted">{running.step}</p>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/[0.08]"><div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${running.progress}%` }} /></div>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => start.mutate()}
              disabled={start.isPending}
              className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
            >
              <ShieldHalf className="size-4" /> {result ? 'Erneut prüfen' : 'Prüfung starten'}
            </button>
          )
        }
      />

      {!result && !audit.isLoading ? (
        <NotchCard index={0} glow eyebrow="Noch keine Prüfung" title="Wie sicher sind deine Systeme?">
          <div className="flex flex-col items-center py-10 text-center">
            <ShieldCheck className="mb-3 size-8 text-accent" />
            <p className="max-w-xl text-[13px] text-muted">
              Die Prüfung liest den Proxmox-Host, die Konfiguration jedes Gastes, Firewall und Backups. Auf Systemen mit SSH-Zugang wird zusätzlich ein fester, nur lesender Befehl ausgeführt (Updates, SSH, Benutzer, offene Ports, Docker, Wazuh). Es wird nichts verändert.
            </p>
            <button type="button" onClick={() => start.mutate()} disabled={start.isPending || !!running} className="mt-5 flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink disabled:opacity-50">
              {running ? <Loader2 className="size-4 animate-spin" /> : <ShieldHalf className="size-4" />} {running ? running.step : 'Prüfung starten'}
            </button>
          </div>
        </NotchCard>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
            <NotchCard index={0} glow className="min-h-[150px]" eyebrow={result?.finishedAt ? `Geprüft ${formatRelative(result.finishedAt)}` : 'Gesamt'} title="Durchschnitt aller Systeme">
              <div className="mt-2 flex items-center gap-4">
                <Ring value={average} size={84} stroke={8}><span className={cn('text-[24px] font-bold', scoreTone(average))}>{average ?? '–'}</span></Ring>
                <p className="text-[12.5px] text-muted">von 100 Punkten · gewichtet nach Schwere der Mängel</p>
              </div>
            </NotchCard>
            <NotchCard index={1} className="min-h-[150px]" tone={(result?.host.score ?? 100) < 55 ? 'bad' : undefined} eyebrow="Proxmox" title="Host & Rechenzentrum">
              <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', scoreTone(result?.host.score ?? null))}>{result?.host.score ?? '–'}</p>
              <p className="mt-2 text-[12.5px] text-muted">{result?.host.findings.filter((finding) => finding.status === 'fail').length ?? 0} Mängel am Host</p>
            </NotchCard>
            <NotchCard index={2} className="min-h-[150px]" tone={critical ? 'bad' : undefined} eyebrow="Sofort angehen" title="Kritische Mängel">
              <p className={cn('mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]', critical ? 'text-bad' : 'text-ok')}><AnimatedNumber value={critical} /></p>
              <p className="mt-2 text-[12.5px] text-muted">kein Backup, privilegierte Container, veraltete Systeme …</p>
            </NotchCard>
            <NotchCard index={3} className="min-h-[150px]" eyebrow="Abdeckung" title="Von innen geprüft">
              <p className="mt-3 text-[40px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={sshChecked} /><span className="ml-1 text-[18px] font-medium text-muted">/ {guests.length}</span></p>
              <p className="mt-2 text-[12.5px] text-muted">übrige nur auf Proxmox-Ebene (Windows, aus, ohne SSH)</p>
            </NotchCard>
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
            <NotchCard index={4} eyebrow="Über alle Systeme" title="Wichtigste Maßnahmen" bodyClassName="pt-3">
              <ul className="space-y-1.5">
                {topActions.map((entry) => {
                  const active = findingFilter === entry.finding.id;
                  return (
                    <li key={entry.finding.id}>
                      <button
                        type="button"
                        onClick={() => setFindingFilter(active ? null : entry.finding.id)}
                        className={cn('flex w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-colors', active ? 'border-accent/40 bg-accent/[0.08]' : 'border-line/[0.06] hover:border-line/[0.14]')}
                      >
                        <span className={cn('size-2 shrink-0 rounded-full', entry.fails ? 'bg-bad' : 'bg-accent')} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">{entry.finding.title}</span>
                          <span className="block truncate text-[11.5px] text-faint">{entry.guests.slice(0, 5).map((guest) => guest.name).join(', ')}{entry.guests.length > 5 ? ' …' : ''}</span>
                        </span>
                        <span className={cn('rounded-full px-1.5 py-px text-[10.5px]', SEVERITY_RANK[entry.finding.severity] >= 3 ? 'bg-bad/10 text-bad' : 'bg-line/[0.06] text-muted')}>{SEVERITY_LABEL[entry.finding.severity]}</span>
                        <span className="w-14 text-right font-mono text-[12px] text-muted">{entry.guests.length}×</span>
                      </button>
                    </li>
                  );
                })}
                {topActions.length === 0 && <li className="py-6 text-center text-[13px] text-muted">Keine offenen Maßnahmen.</li>}
              </ul>
            </NotchCard>

            <NotchCard index={5} eyebrow="Proxmox" title="Host & Rechenzentrum" bodyClassName="pt-3">
              <FindingList findings={result?.host.findings ?? []} />
            </NotchCard>
          </div>

          <NotchCard index={6} className="mt-5" eyebrow={`${visible.length} von ${guests.length}`} title="Systeme nach Schicht" bodyClassName="pt-3">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {([['all', 'Alle'], ['problems', 'Mit Mängeln'], ['lxc', 'LXC'], ['qemu', 'VMs'], ['external', 'Außerhalb Proxmox']] as Array<[Filter, string]>).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setFilter(value)} className={cn('rounded-full border px-3 py-1 text-[12px]', filter === value ? 'border-accent/40 bg-accent/[0.10] text-ink' : 'border-line/[0.08] text-muted hover:text-ink')}>
                  {label}
                </button>
              ))}
              {filterTitle && (
                <button type="button" onClick={() => setFindingFilter(null)} className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/[0.10] px-3 py-1 text-[12px]">
                  {filterTitle} <X className="size-3" />
                </button>
              )}
              <label className="ml-auto flex h-8 w-56 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3 focus-within:border-accent/40">
                <Search className="size-3.5 text-muted" />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, IP, System …" className="h-full min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-faint" />
              </label>
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[860px]">
                <div className="grid grid-cols-[minmax(200px,1.4fr)_64px_repeat(7,minmax(70px,1fr))] gap-1.5 px-2 pb-2 text-[10.5px] uppercase tracking-[0.08em] text-faint">
                  <span>System</span>
                  <span className="text-center">Score</span>
                  {CATEGORIES.map((category) => <span key={category.id} className="truncate text-center">{category.short}</span>)}
                </div>
                <ul className="space-y-1">
                  {visible.map((guest, index) => (
                    <motion.li key={guest.key} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: Math.min(index * 0.015, 0.3) }}>
                      <button
                        type="button"
                        onClick={() => setParams({ guest: guest.key }, { replace: true })}
                        className="grid w-full grid-cols-[minmax(200px,1.4fr)_64px_repeat(7,minmax(70px,1fr))] items-center gap-1.5 rounded-2xl border border-line/[0.05] px-2 py-1.5 text-left transition-colors hover:border-line/[0.14] hover:bg-hover/40"
                      >
                        <span className="flex min-w-0 items-center gap-2.5 pl-1">
                          <TypeIcon guest={guest} />
                          <span className="min-w-0">
                            <span className="block truncate text-[13px] font-medium">{guest.name}</span>
                            <span className="block truncate text-[10.5px] text-faint">{guest.vmid ? `${guest.vmid} · ` : ''}{guest.os ?? (guest.sshState === 'windows' ? 'Windows' : guest.sshState === 'not-running' ? 'ausgeschaltet' : guest.sshState === 'no-access' ? 'ohne SSH-Zugang' : guest.sshState === 'error' ? 'SSH fehlgeschlagen' : '')}</span>
                          </span>
                        </span>
                        <span className={cn('text-center font-mono text-[15px] font-semibold', scoreTone(guest.score))}>{guest.score ?? '–'}</span>
                        {CATEGORIES.map((category) => {
                          const status = categoryStatus(guest.findings, category.id);
                          const issues = guest.findings.filter((finding) => finding.category === category.id && (finding.status === 'fail' || finding.status === 'warn')).length;
                          return (
                            <span key={category.id} className={cn('flex h-8 items-center justify-center rounded-lg border text-[11px]', status ? STATUS_STYLE[status].cell : 'border-dashed border-line/[0.08] text-faint')}>
                              {status ? (issues ? issues : STATUS_STYLE[status].label) : '–'}
                            </span>
                          );
                        })}
                      </button>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-3 text-[11.5px] text-faint">Zahl im Feld = offene Punkte in dieser Schicht. Ohne SSH-Zugang (Windows, ausgeschaltet) werden nur die Proxmox-Schichten bewertet; der Score ist dann nicht direkt vergleichbar.</p>
          </NotchCard>
        </>
      )}

      <Drawer open={!!selected} onClose={() => setParams({}, { replace: true })} label="Sicherheitsprüfung" width={760}>
        {selected && <GuestAudit key={selected.key} guest={selected} />}
      </Drawer>
    </>
  );
}
