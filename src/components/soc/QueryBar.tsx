import { useState } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';

const QUERY_HELP = [
  { example: 'host:dc02', text: 'Host/Agent' },
  { example: 'user:Administrator', text: 'Benutzer' },
  { example: 'eid:4625', text: 'Windows-Event-ID' },
  { example: 'rule:5710', text: 'Rule-ID' },
  { example: 'ip:172.21.5.10', text: 'Quell-/Agent-IP' },
  { example: 'level:>=7', text: 'Level' },
  { example: 'group:sshd', text: 'Regel-Gruppe' },
  { example: 'process:powershell', text: 'Prozess' },
  { example: 'mitre:T1110', text: 'MITRE' },
];

/** Search input for the query language, with clickable examples */
export function QueryBar({ value, onSubmit, placeholder }: { value: string; onSubmit: (value: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  return (
    <div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft.trim());
        }}
        className="flex h-11 items-center gap-2.5 rounded-2xl border border-line/[0.12] bg-raised/50 px-4 focus-within:border-accent/45"
      >
        <Search className="size-4 text-muted" />
        <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder ?? 'z. B. host:dc02 eid:4625 level:>=5 Administrator'} className="h-full min-w-0 flex-1 bg-transparent font-mono text-[13px] outline-none placeholder:font-sans placeholder:text-faint" />
        <button type="submit" className="h-8 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[12.5px] font-medium text-accent-ink">Suchen</button>
      </form>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUERY_HELP.map((entry) => (
          <button
            key={entry.example}
            type="button"
            onClick={() => setDraft((current) => `${current.trim()} ${entry.example}`.trim())}
            className={cn('rounded-full border border-line/[0.08] px-2.5 py-0.5 text-[11px] text-muted transition-colors hover:border-accent/30 hover:text-ink')}
            title={entry.text}
          >
            <span className="font-mono">{entry.example}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
