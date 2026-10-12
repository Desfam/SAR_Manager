import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { LevelPill } from '@/components/wazuh/EventList';
import { formatCount } from '@/lib/wazuh';
import type { ScanResult } from '@/services/soc';
import { DataTable, Fact, Section, ShareBar } from './ui';

const SEVERITY_ORDER = ['Critical', 'High', 'Medium', 'Low', 'Unbewertet'];
const SEVERITY_LABEL: Record<string, { label: string; className: string }> = {
  Critical: { label: 'Kritisch', className: 'border-bad bg-bad/15 text-bad' },
  High: { label: 'Hoch', className: 'border-bad/40 text-bad' },
  Medium: { label: 'Mittel', className: 'border-accent/40 text-accent' },
  Low: { label: 'Niedrig', className: 'border-line/[0.16] text-muted' },
  Unbewertet: { label: 'Ohne Bewertung', className: 'border-line/[0.12] text-faint' },
};

const cvssClass = (score?: number) => (score === undefined ? 'text-faint' : score >= 9 ? 'text-bad font-semibold' : score >= 7 ? 'text-bad' : score >= 4 ? 'text-accent' : 'text-muted');

export function WazuhPanel({ scan }: { scan: ScanResult }) {
  const navigate = useNavigate();
  const m = scan.modules;
  // old scans stored "-" and "" separately
  const severities = Object.entries(m.vulnerabilities.bySeverity).reduce<Record<string, number>>((all, [key, value]) => {
    const name = !key || key === '-' || key === '–' ? 'Unbewertet' : key;
    all[name] = (all[name] ?? 0) + value;
    return all;
  }, {});
  const vulnTotal = Object.values(severities).reduce((sum, value) => sum + value, 0);
  const loginTotal = m.auth.failed + m.auth.success;
  const maxFim = Math.max(1, ...m.fim.paths.map((path) => path.count));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Section title="System (Wazuh-Inventar)" index={0}>
          {m.system ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
              <Fact label="Betriebssystem">{m.system.os}</Fact>
              <Fact label="Version" mono>{m.system.version}</Fact>
              <Fact label="Hostname" mono>{m.system.hostname}</Fact>
              <Fact label="Architektur" mono>{m.system.architecture}</Fact>
            </dl>
          ) : <p className="text-[12.5px] text-muted">Kein Inventar im Indexer.</p>}
        </Section>
        <Section title="Anmeldungen (Wazuh-Events)" index={1}>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-[11px] text-faint">Fehlgeschlagen</p>
              <p className={cn('text-[22px] font-semibold tabular-nums', m.auth.failed ? 'text-bad' : 'text-ok')}>{formatCount(m.auth.failed)}</p>
              <ShareBar value={m.auth.failed} max={loginTotal} tone="bad" />
            </div>
            <div>
              <p className="text-[11px] text-faint">Erfolgreich</p>
              <p className="text-[22px] font-semibold tabular-nums">{formatCount(m.auth.success)}</p>
              <ShareBar value={m.auth.success} max={loginTotal} tone="ok" />
            </div>
          </div>
          {!!m.auth.failedUsers.length && <p className="mt-3 text-[11.5px] text-muted">Konten mit Fehlanmeldungen: <span className="font-mono text-ink/85">{m.auth.failedUsers.map((user) => `${user.name} (${user.count})`).join(', ')}</span></p>}
        </Section>
      </div>

      <Section title="Schwachstellen" count={formatCount(vulnTotal)} hint="aus dem Wazuh-Schwachstellen-Index" index={2}>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {SEVERITY_ORDER.filter((key) => severities[key]).map((key) => (
            <span key={key} className={cn('rounded-full border px-2.5 py-0.5 text-[11.5px]', SEVERITY_LABEL[key].className)}>
              {SEVERITY_LABEL[key].label} <span className="font-mono">{formatCount(severities[key])}</span>
            </span>
          ))}
          {!vulnTotal && <span className="text-[12.5px] text-ok">Keine bekannten Schwachstellen.</span>}
        </div>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="mb-1.5 text-[11.5px] font-medium text-muted">Kritische CVEs</p>
            <DataTable
              rows={m.vulnerabilities.critical}
              max={10}
              empty="Keine kritischen CVEs."
              columns={[
                { label: 'CVE', render: (row) => <a href={`https://nvd.nist.gov/vuln/detail/${row.cve}`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-bad hover:underline">{row.cve}</a> },
                { label: 'Paket', render: (row) => <span className="font-mono text-[11.5px] text-ink/85">{row.package ?? '–'}</span> },
                { label: 'CVSS', align: 'right', render: (row) => <span className={cn('font-mono', cvssClass(row.score))}>{row.score === undefined ? '–' : row.score.toFixed(1)}</span> },
              ]}
            />
          </div>
          {!!m.vulnerabilities.packages?.length && (
            <div>
              <p className="mb-1.5 text-[11.5px] font-medium text-muted">Pakete mit den meisten Einträgen</p>
              <DataTable
                rows={m.vulnerabilities.packages}
                max={8}
                columns={[
                  { label: 'Paket', render: (row) => <span className="font-mono text-[11.5px]">{row.name}</span> },
                  { label: 'Einträge', align: 'right', render: (row) => formatCount(row.count) },
                ]}
              />
              <p className="mt-2 text-[11px] text-faint">Viele Einträge bei alten Kernel-Paketen (linux-image-…) verschwinden, wenn nicht mehr genutzte Kernel entfernt werden (apt autoremove).</p>
            </div>
          )}
        </div>
        <button type="button" onClick={() => navigate(`/wazuh/vulnerabilities?host=${encodeURIComponent(scan.host)}`)} className="mt-3 text-[12px] text-accent hover:underline">Alle Schwachstellen dieses Hosts öffnen</button>
      </Section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Dateiintegrität" count={formatCount(m.fim.changes)} hint={`${m.fim.paths.filter((path) => path.sensitive).length} sensible Pfade`} index={3}>
          <DataTable
            rows={m.fim.paths}
            max={12}
            empty="Keine Änderungen."
            columns={[
              { label: 'Pfad', render: (row) => <span className={cn('break-all font-mono text-[11.5px]', row.sensitive ? 'text-bad' : 'text-ink/85')}>{row.path}</span> },
              { label: '', render: (row) => <ShareBar value={row.count} max={maxFim} tone={row.sensitive ? 'bad' : 'accent'} />, className: 'w-[22%] pt-3' },
              { label: 'Änderungen', align: 'right', render: (row) => row.count },
            ]}
          />
        </Section>
        <Section title="Konfigurationsprüfung (SCA)" count={m.sca.length} index={4}>
          {m.sca.length ? (
            <ul className="space-y-3">
              {m.sca.map((policy) => (
                <li key={policy.policy}>
                  <p className="flex items-baseline justify-between gap-3 text-[12.5px]">
                    <span className="min-w-0 truncate" title={policy.policy}>{policy.policy}</span>
                    <span className={cn('font-mono font-semibold', policy.score < 60 ? 'text-bad' : policy.score < 80 ? 'text-accent' : 'text-ok')}>{policy.score} %</span>
                  </p>
                  <div className="mt-1"><ShareBar value={policy.score} max={100} tone={policy.score < 60 ? 'bad' : policy.score < 80 ? 'warn' : 'ok'} /></div>
                  <p className="mt-1 text-[11px] text-faint">{policy.passed} bestanden · {policy.failed} nicht bestanden · {policy.total} Prüfungen</p>
                </li>
              ))}
            </ul>
          ) : <p className="text-[12.5px] text-muted">Kein SCA-Ergebnis im Zeitraum.</p>}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="MITRE ATT&CK" count={m.mitre.length} index={5} className="lg:col-span-2">
          <DataTable
            rows={m.mitre}
            max={10}
            empty="Keine Techniken zugeordnet."
            columns={[
              { label: 'ID', render: (row) => <span className="font-mono text-[11.5px] text-muted">{row.id ?? '–'}</span> },
              { label: 'Technik', render: (row) => row.technique },
              { label: 'Events', align: 'right', render: (row) => formatCount(row.count) },
              { label: 'Level', align: 'right', render: (row) => <LevelPill level={row.maxLevel} /> },
            ]}
          />
        </Section>
        <Section title="Netzwerk (Inventar)" index={6}>
          <p className="mb-1.5 text-[11px] text-faint">Lauscht auf allen Adressen</p>
          <div className="mb-3 flex flex-wrap gap-1">
            {m.network.listening.slice(0, 24).map((port) => <span key={`${port.protocol}-${port.port}`} title={port.process} className="rounded-md border border-line/[0.10] px-1.5 py-px font-mono text-[11px]">{port.port}/{port.protocol ?? 'tcp'}</span>)}
            {!m.network.listening.length && <span className="text-[12.5px] text-muted">–</span>}
          </div>
          <p className="mb-1.5 text-[11px] text-faint">Externe Verbindungen</p>
          {m.network.outbound.length ? m.network.outbound.slice(0, 6).map((connection) => (
            <p key={`${connection.ip}:${connection.port}`} className="flex justify-between gap-2 font-mono text-[11.5px]"><span>{connection.ip}:{connection.port}</span><span className="truncate text-muted">{connection.process}</span></p>
          )) : <p className="text-[12.5px] text-muted">Keine im Inventar.</p>}
          <p className="mb-1.5 mt-3 text-[11px] text-faint">Öffentliche Quell-IPs in Events</p>
          {m.threatIntel.publicSources.length ? m.threatIntel.publicSources.slice(0, 6).map((source) => (
            <button key={source.ip} type="button" onClick={() => navigate(`/wazuh/ioc?value=${encodeURIComponent(source.ip)}`)} className="flex w-full justify-between font-mono text-[11.5px] hover:text-accent"><span>{source.ip}</span><span className="text-muted">{source.count}</span></button>
          )) : <p className="text-[12.5px] text-muted">Keine.</p>}
        </Section>
      </div>
    </div>
  );
}
