import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { motion } from 'motion/react';
import { toast } from 'sonner';
import { Loader2, Radar, Save } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Ring } from '@/components/ui/viz';
import { FindingList } from '@/components/security/FindingList';
import { hardeningKeys } from '@/hooks/use-hardening';
import { hardeningApi, type AuditedGuest, type Profile } from '@/services/hardening';
import { CATEGORIES, SSH_STATE_LABEL, categoryStatus, scoreTone, STATUS_STYLE } from '@/lib/hardening';
import { PORT_NAMES } from '@/lib/net';

const inputClass = 'h-10 w-full rounded-xl border border-line/[0.10] bg-raised/50 px-3 text-[12.5px] outline-none transition-colors placeholder:text-faint focus:border-accent/45';

/** Target profile (section 1 of the guide): what the machine is for and what it may do */
function ProfileForm({ guest }: { guest: AuditedGuest }) {
  const queryClient = useQueryClient();
  const [profile, setProfile] = useState<Profile>(guest.profile ?? {});
  const set = <K extends keyof Profile>(key: K, value: Profile[K]) => setProfile((current) => ({ ...current, [key]: value }));
  const save = useMutation({
    mutationFn: () => hardeningApi.saveProfile(guest.key, profile),
    onSuccess: () => {
      toast.success('Sollprofil gespeichert', { description: 'Fließt bei der nächsten Prüfung in die Bewertung ein.' });
      void queryClient.invalidateQueries({ queryKey: hardeningKeys.audit });
    },
    onError: (failure: Error) => toast.error('Speichern fehlgeschlagen', { description: failure.message }),
  });

  return (
    <div className="space-y-3">
      <p className="text-[12px] text-muted">Was soll das System dürfen? Alles, was dafür nicht nötig ist, wird nicht freigegeben. Erwartete Ports werden mit den tatsächlich offenen verglichen.</p>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="mb-1 block text-[11.5px] text-muted">Aufgabe</span>
          <input className={inputClass} value={profile.purpose ?? ''} onChange={(event) => set('purpose', event.target.value)} placeholder="z. B. interne Webanwendung" />
        </label>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-[11.5px] text-muted">Erreichbarkeit</span>
          <div className="flex rounded-xl border border-line/[0.10] bg-raised/50 p-1">
            {([['internal', 'Intern'], ['public', 'Öffentlich'], ['lab', 'Labor/Test']] as const).map(([value, label]) => (
              <button key={value} type="button" onClick={() => set('exposure', value)} className={cn('relative h-8 flex-1 rounded-lg text-[12.5px]', profile.exposure === value ? 'text-ink' : 'text-muted hover:text-ink')}>
                {profile.exposure === value && <motion.span layoutId={`exp-${guest.key}`} className="absolute inset-0 rounded-lg border border-accent/30 bg-accent/[0.12]" />}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </div>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Erwartete eingehende Ports</span>
          <input className={cn(inputClass, 'font-mono')} value={profile.expectedPorts ?? ''} onChange={(event) => set('expectedPorts', event.target.value.replace(/[^\d,\s]/g, ''))} placeholder="22, 443" />
        </label>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Administration über</span>
          <input className={inputClass} value={profile.adminAccess ?? ''} onChange={(event) => set('adminAccess', event.target.value)} placeholder="z. B. VPN, Admin-Netz" />
        </label>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Tolerierbarer Ausfall (RTO)</span>
          <input className={inputClass} value={profile.rto ?? ''} onChange={(event) => set('rto', event.target.value)} placeholder="z. B. 2 Stunden" />
        </label>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Tolerierbarer Datenverlust (RPO)</span>
          <input className={inputClass} value={profile.rpo ?? ''} onChange={(event) => set('rpo', event.target.value)} placeholder="z. B. 1 Arbeitstag" />
        </label>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Schutzbedarf der Daten</span>
          <select className={inputClass} value={profile.sensitivity ?? ''} onChange={(event) => set('sensitivity', (event.target.value || undefined) as Profile['sensitivity'])}>
            <option value="">nicht festgelegt</option>
            <option value="normal">normal</option>
            <option value="high">hoch</option>
          </select>
        </label>
        <label>
          <span className="mb-1 block text-[11.5px] text-muted">Verantwortlich für Updates</span>
          <input className={inputClass} value={profile.owner ?? ''} onChange={(event) => set('owner', event.target.value)} placeholder="Name oder Team" />
        </label>
      </div>
      <div className="flex justify-end">
        <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="flex h-9 items-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] px-4 text-[12.5px] text-accent hover:bg-accent/[0.14] disabled:opacity-50">
          {save.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Sollprofil speichern
        </button>
      </div>
    </div>
  );
}

/** Section 21: what is actually reachable from here (TCP connect to common ports) */
function ReachCheck({ guest }: { guest: AuditedGuest }) {
  const ip = guest.ips[0];
  const check = useMutation({ mutationFn: () => hardeningApi.reach(ip) });
  const expected = (guest.profile?.expectedPorts ?? '').split(/[\s,]+/).map(Number).filter(Boolean);
  if (!ip) return <p className="text-[12.5px] text-muted">Keine IP bekannt.</p>;
  return (
    <div>
      <div className="flex items-center gap-3">
        <p className="flex-1 text-[12px] text-muted">Prüft von diesem Rechner aus 49 häufige TCP-Ports auf <span className="font-mono text-ink">{ip}</span>. Nur ein Blick aus diesem Netz: aus anderen Netzen kann das Ergebnis anders sein.</p>
        <button type="button" onClick={() => check.mutate()} disabled={check.isPending} className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-line/[0.12] px-3.5 text-[12.5px] hover:bg-raised disabled:opacity-50">
          {check.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Radar className="size-3.5" />} Von hier aus prüfen
        </button>
      </div>
      {check.isError && <p className="mt-2 text-[12.5px] text-bad">{(check.error as Error).message}</p>}
      {check.data && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {check.data.open.length === 0 && <span className="text-[12.5px] text-muted">Keiner der geprüften Ports ist erreichbar.</span>}
          {check.data.open.map((entry) => {
            const unexpected = expected.length > 0 && !expected.includes(entry.port);
            return (
              <span key={entry.port} className={cn('rounded-xl border px-2.5 py-1 font-mono text-[11.5px]', unexpected ? 'border-bad/40 bg-bad/[0.08] text-bad' : 'border-line/[0.10]')} title={unexpected ? 'nicht im Sollprofil' : undefined}>
                {entry.port} <span className="font-sans text-muted">{PORT_NAMES[entry.port] ?? entry.service}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function GuestAudit({ guest }: { guest: AuditedGuest }) {
  const [tab, setTab] = useState<'findings' | 'profile' | 'reach'>('findings');
  const problems = guest.findings.filter((finding) => finding.status === 'fail' || finding.status === 'warn').length;
  return (
    <div className="px-7 pb-8 pt-7">
      <div className="flex items-start gap-5">
        <Ring value={guest.score} size={86} stroke={8}>
          <span className={cn('text-[22px] font-bold', scoreTone(guest.score))}>{guest.score ?? '–'}</span>
        </Ring>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-muted">{guest.type === 'external' ? 'System außerhalb von Proxmox' : `${guest.type === 'lxc' ? 'Container' : 'VM'} ${guest.vmid} · ${guest.node}`}</p>
          <h2 className="mt-0.5 truncate pr-10 text-[24px] font-semibold tracking-[-0.02em]">{guest.name}</h2>
          <p className="mt-0.5 text-[12px] text-muted">{guest.os ?? guest.ostype ?? ''}{guest.ips[0] ? ` · ${guest.ips[0]}` : ''}</p>
          <p className={cn('mt-1 text-[11.5px]', guest.sshState === 'ok' ? 'text-faint' : 'text-accent')}>{SSH_STATE_LABEL[guest.sshState]}{guest.sshError ? `: ${guest.sshError}` : ''}</p>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-7 gap-1">
        {CATEGORIES.map((category) => {
          const status = categoryStatus(guest.findings, category.id);
          return (
            <div key={category.id} className={cn('flex flex-col items-center gap-1 rounded-xl border px-1 py-2', status ? STATUS_STYLE[status].cell : 'border-line/[0.06] text-faint')} title={category.label}>
              <category.icon className="size-3.5" />
              <span className="truncate text-[10px]">{category.short}</span>
            </div>
          );
        })}
      </div>

      <div className="mt-5 flex gap-1 border-b border-line/[0.07]">
        {([['findings', `Befunde (${problems})`], ['profile', 'Sollprofil'], ['reach', 'Erreichbarkeit']] as const).map(([value, label]) => (
          <button key={value} type="button" onClick={() => setTab(value)} className={cn('relative px-3 pb-2.5 pt-1 text-[13px]', tab === value ? 'text-ink' : 'text-muted hover:text-ink')}>
            {label}
            {tab === value && <motion.span layoutId="guest-audit-tab" className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-accent" />}
          </button>
        ))}
      </div>
      <div className="mt-4">
        {tab === 'findings' && (
          <div className="space-y-5">
            {CATEGORIES.map((category) => {
              const list = guest.findings.filter((finding) => finding.category === category.id);
              if (!list.length) return null;
              return (
                <section key={category.id}>
                  <p className="mb-2 flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-muted"><category.icon className="size-3.5" /> {category.label}</p>
                  <FindingList findings={list} />
                </section>
              );
            })}
          </div>
        )}
        {tab === 'profile' && <ProfileForm key={guest.key} guest={guest} />}
        {tab === 'reach' && <ReachCheck guest={guest} />}
      </div>
    </div>
  );
}
