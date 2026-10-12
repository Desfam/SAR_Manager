import { useState } from 'react';
import { ScrollText } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFirewallLog } from '@/hooks/use-network';
import type { GuestFirewall, GuestNetwork } from '@/services/network';

/** Guest firewall options as Proxmox stores them; `fallback` is what applies when the option is not set. */
const OPTIONS: Array<{ key: string; label: string; kind: 'bool' | 'policy' | 'log'; fallback?: string }> = [
  { key: 'enable', label: 'Firewall', kind: 'bool', fallback: '0' },
  { key: 'policy_in', label: 'Eingehend Standard', kind: 'policy', fallback: 'DROP' },
  { key: 'policy_out', label: 'Ausgehend Standard', kind: 'policy', fallback: 'ACCEPT' },
  { key: 'log_level_in', label: 'Log eingehend', kind: 'log', fallback: 'nolog' },
  { key: 'log_level_out', label: 'Log ausgehend', kind: 'log', fallback: 'nolog' },
  { key: 'macfilter', label: 'MAC-Filter', kind: 'bool', fallback: '1' },
  { key: 'ipfilter', label: 'IP-Filter', kind: 'bool' },
  { key: 'dhcp', label: 'DHCP', kind: 'bool' },
  { key: 'ndp', label: 'NDP (IPv6)', kind: 'bool' },
  { key: 'radv', label: 'Router-Advertisement', kind: 'bool' },
];

function optionValue(option: (typeof OPTIONS)[number], raw: unknown) {
  const set = raw !== undefined && raw !== null && raw !== '';
  const value = set ? String(raw) : option.fallback;
  if (value === undefined) return { text: 'Standard', className: 'text-muted', set };
  if (option.kind === 'bool') return { text: value === '1' ? 'an' : 'aus', className: value === '1' ? 'text-ok' : 'text-muted', set };
  if (option.kind === 'policy') return { text: value, className: value === 'ACCEPT' ? 'text-ok' : 'text-bad', set };
  return { text: value === 'nolog' ? 'aus' : value, className: value === 'nolog' ? 'text-muted' : 'text-ink', set };
}

function FirewallLog({ guest, logging }: { guest: GuestNetwork; logging: boolean }) {
  const [open, setOpen] = useState(false);
  const log = useFirewallLog(guest, open);
  const lines = (log.data ?? []).filter((line) => line.t && line.t !== 'no content');

  return (
    <details className="rounded-2xl border border-line/[0.07] px-4 py-3" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary className="flex cursor-pointer items-center gap-2 text-[13px] font-medium">
        <ScrollText className="size-4 text-muted" /> Firewall-Log
        <span className="font-normal text-muted">· letzte 100 Einträge, alle 15 s aktualisiert</span>
      </summary>
      <div className="mt-3">
        {!logging && <p className="mb-2 text-[12px] text-faint">Logging ist für diesen Gast aus (Log-Level „nolog“). Einträge entstehen erst, wenn in Proxmox ein Log-Level gesetzt ist.</p>}
        {log.isLoading ? (
          <p className="text-[12.5px] text-muted">Lädt …</p>
        ) : log.isError ? (
          <p className="text-[12.5px] text-bad">{(log.error as Error).message}</p>
        ) : lines.length === 0 ? (
          <p className="text-[12.5px] text-muted">Keine Einträge.</p>
        ) : (
          <pre className="scroll-thin max-h-80 overflow-auto rounded-xl bg-canvas p-3 font-mono text-[11.5px] leading-5 text-ink/85">
            {lines.map((line) => (
              <span key={line.n} className={cn('block', /DROP|REJECT/.test(line.t) ? 'text-bad' : /ACCEPT/.test(line.t) ? 'text-ok/90' : '')}>{line.t}</span>
            ))}
          </pre>
        )}
      </div>
    </details>
  );
}

export function ProxmoxConfig({ guest, data }: { guest: GuestNetwork; data?: GuestFirewall }) {
  const options = data?.options ?? {};
  const aliases = data?.aliases ?? [];
  const ipsets = data?.ipsets ?? [];
  const logging = [options.log_level_in, options.log_level_out].some((value) => value && value !== 'nolog');

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-line/[0.07] bg-raised/25 p-4">
        <p className="mb-3 text-[13px] font-medium">Optionen <span className="font-normal text-muted">· grau = nicht gesetzt, Proxmox-Standard</span></p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 2xl:grid-cols-5">
          {OPTIONS.map((option) => {
            const value = optionValue(option, options[option.key]);
            return (
              <div key={option.key} className="rounded-xl border border-line/[0.07] px-3 py-2">
                <p className="truncate text-[11px] text-muted">{option.label}</p>
                <p className={cn('font-mono text-[12.5px]', value.className, !value.set && 'opacity-60')}>{value.text}</p>
              </div>
            );
          })}
        </div>

        <p className="mb-2 mt-4 text-[12px] text-muted">Netzwerkkarten</p>
        <div className="flex flex-wrap gap-2">
          {guest.interfaces.map((iface) => (
            <span key={iface.key} className={cn('flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-[11.5px]', iface.firewall ? 'border-ok/30' : 'border-bad/35 bg-bad/[0.06]')}>
              <span className="text-ink">{iface.key}</span>
              <span className="text-muted">{iface.bridge}{iface.tag ? ` · VLAN ${iface.tag}` : ''}</span>
              <span className={iface.firewall ? 'text-ok' : 'text-bad'}>firewall={iface.firewall ? 1 : 0}</span>
            </span>
          ))}
        </div>
      </div>

      {(aliases.length > 0 || ipsets.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {aliases.length > 0 && (
            <div className="rounded-2xl border border-line/[0.07] p-4">
              <p className="mb-2 text-[13px] font-medium">Aliase ({aliases.length})</p>
              <ul className="space-y-1">
                {aliases.map((alias) => (
                  <li key={alias.name} className="flex gap-3 text-[12px]"><span className="font-mono">{alias.name}</span><span className="font-mono text-muted">{alias.cidr}</span>{alias.comment && <span className="truncate text-faint">{alias.comment}</span>}</li>
                ))}
              </ul>
            </div>
          )}
          {ipsets.length > 0 && (
            <div className="rounded-2xl border border-line/[0.07] p-4">
              <p className="mb-2 text-[13px] font-medium">IP-Sets ({ipsets.length})</p>
              <ul className="space-y-2">
                {ipsets.map((set) => (
                  <li key={set.name} className="text-[12px]">
                    <p><span className="font-mono">+{set.name}</span>{set.comment && <span className="text-faint"> · {set.comment}</span>}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {set.entries.length ? set.entries.map((entry) => (
                        <span key={entry.cidr} className={cn('rounded-md border border-line/[0.08] px-1.5 py-px font-mono text-[11px]', entry.nomatch && 'text-bad line-through')}>{entry.cidr}</span>
                      )) : <span className="text-faint">leer</span>}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <FirewallLog guest={guest} logging={logging} />
    </div>
  );
}
