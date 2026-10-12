import { useMemo, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Beacon } from '@/components/systems/fx';
import { useSocHosts } from '@/hooks/use-soc';

/** Choose a Wazuh agent by name (searchable list, sorted by risk) */
export function HostPicker({ value, onChange }: { value: string | null; onChange: (host: string) => void }) {
  const hosts = useSocHosts(24);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (hosts.data ?? []).filter((host) => !needle || `${host.name} ${host.ip ?? ''} ${host.os ?? ''}`.toLowerCase().includes(needle)).slice(0, 80);
  }, [hosts.data, query]);
  return (
    <div className="relative w-80">
      <button type="button" onClick={() => setOpen(!open)} className="flex h-10 w-full items-center gap-2 rounded-full border border-line/[0.12] bg-raised/50 px-4 text-left text-[13px] hover:border-accent/35">
        <span className={cn('flex-1 truncate', !value && 'text-faint')}>{value ?? 'Host wählen …'}</span>
        <ChevronDown className={cn('size-4 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="panel-surface absolute left-0 top-12 z-30 w-[360px] rounded-2xl p-2 shadow-2xl">
          <label className="mb-2 flex h-9 items-center gap-2 rounded-full border border-line/[0.10] bg-raised/50 px-3">
            <Search className="size-3.5 text-muted" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, IP, System …" className="h-full min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
          </label>
          <ul className="scroll-thin max-h-80 overflow-y-auto">
            {list.map((host) => (
              <li key={host.name}>
                <button type="button" onClick={() => { onChange(host.name); setOpen(false); }} className={cn('flex w-full items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-left text-[12.5px] hover:bg-hover/60', value === host.name && 'bg-accent/[0.10]')}>
                  <Beacon tone={host.status === 'active' ? 'ok' : host.status === 'disconnected' ? 'bad' : 'muted'} size={6} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{host.name}</span>
                    <span className="block truncate text-[10.5px] text-faint">{host.ip} · {host.os ?? '–'}</span>
                  </span>
                  <span className="font-mono text-[10.5px] text-faint">Risiko {host.risk}</span>
                </button>
              </li>
            ))}
            {hosts.isLoading && <li className="px-3 py-4 text-center text-[12px] text-muted">Lädt …</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
