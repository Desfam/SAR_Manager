import { useNavigate } from 'react-router-dom';
import { KeyRound, PlugZap, ShieldOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LiveReport, ScanResult } from '@/services/soc';
import { CheckTile, DataTable, Fact, Section, ShareBar } from './ui';

const ORDER = { bad: 0, warn: 1, info: 2, ok: 3 } as const;
const time = (value?: string) => (value ? new Date(value.replace(/([+-]\d{2})(\d{2})$/, '$1:$2')).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '–');
const PACKAGE_ACTION: Record<string, { label: string; className: string }> = {
  install: { label: 'installiert', className: 'text-ok' },
  installed: { label: 'installiert', className: 'text-ok' },
  upgrade: { label: 'aktualisiert', className: 'text-accent' },
  updated: { label: 'aktualisiert', className: 'text-accent' },
  remove: { label: 'entfernt', className: 'text-bad' },
  purge: { label: 'gelöscht', className: 'text-bad' },
  erased: { label: 'entfernt', className: 'text-bad' },
};

function IpCell({ ip, public: isPublic }: { ip: string; public: boolean }) {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate(`/wazuh/ioc?value=${encodeURIComponent(ip)}`)} className="font-mono text-[12px] hover:text-accent">
      {ip}{isPublic && <span className="ml-1.5 rounded-full border border-bad/40 px-1.5 text-[10px] text-bad">Internet</span>}
    </button>
  );
}

function Logins({ live }: { live: LiveReport }) {
  const failed = live.logs.sshFailed;
  const accepted = live.logs.sshAccepted;
  // SSH log lines were cut at 1500: non-zero counts are lower bounds
  const plus = (value: number) => (live.logs.truncated && value ? '+' : '');
  const maxFailed = Math.max(1, ...failed.sources.map((entry) => entry.count));
  const maxAccepted = Math.max(1, ...accepted.sources.map((entry) => entry.count));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section title="SSH-Fehlversuche" count={`${failed.total}${plus(failed.total)}`} hint={failed.invalidUsers ? `${failed.invalidUsers} mit unbekanntem Benutzer` : undefined} index={1}>
        <DataTable
          rows={failed.sources}
          empty="Keine fehlgeschlagenen Anmeldungen."
          columns={[
            { label: 'Quelle', render: (row) => <IpCell ip={row.ip} public={row.public} /> },
            { label: 'Anteil', render: (row) => <ShareBar value={row.count} max={maxFailed} tone="bad" />, className: 'w-[35%] pt-3' },
            { label: 'Versuche', align: 'right', render: (row) => row.count },
          ]}
        />
        {!!failed.users.length && <p className="mt-2 text-[11.5px] text-muted">Konten: <span className="font-mono text-ink/85">{failed.users.map((user) => `${user.name} (${user.count})`).join(', ')}</span></p>}
      </Section>
      <Section title="SSH-Anmeldungen erfolgreich" count={`${accepted.total}${plus(accepted.total)}`} hint={Object.entries(accepted.methods).map(([method, total]) => `${method} ${total}`).join(' · ')} index={2}>
        <DataTable
          rows={accepted.sources}
          empty="Keine erfolgreichen Anmeldungen im Zeitraum."
          columns={[
            { label: 'Quelle', render: (row) => <IpCell ip={row.ip} public={row.public} /> },
            { label: 'Anteil', render: (row) => <ShareBar value={row.count} max={maxAccepted} />, className: 'w-[35%] pt-3' },
            { label: 'Anmeldungen', align: 'right', render: (row) => row.count },
          ]}
        />
        {!!accepted.users.length && <p className="mt-2 text-[11.5px] text-muted">Konten: <span className="font-mono text-ink/85">{accepted.users.map((user) => `${user.name} (${user.count})`).join(', ')}</span></p>}
      </Section>
    </div>
  );
}

export function LivePanel({ live }: { live: ScanResult['live'] }) {
  if (!live) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-line/[0.08] bg-raised/25 p-4 text-[12.5px] text-muted">
        <PlugZap className="mt-0.5 size-4 shrink-0" />
        <p>Kein Live-Teil: Dieser Scan stammt von einem Windows-Host oder wurde vor der SSH-Erweiterung erstellt. Für Linux-Hosts mit einem SSH-System in SAR liest der Full Scan Logs und Zustand direkt vom System.</p>
      </div>
    );
  }
  if ('error' in live) {
    return (
      <div className="flex items-start gap-3 rounded-2xl border border-warn/35 bg-warn/[0.05] p-4 text-[12.5px]">
        <ShieldOff className="mt-0.5 size-4 shrink-0 text-warn" />
        <div>
          <p className="font-medium">Live-Abfrage per SSH nicht möglich</p>
          <p className="mt-0.5 text-muted">{live.error}{live.connection ? ` (System ${live.connection.name}, ${live.connection.host})` : ''}</p>
          <p className="mt-1 text-[11.5px] text-faint">Lege den Host unter „Systeme“ als SSH-Verbindung an (gleiche IP oder gleicher Name wie der Wazuh-Agent), dann liest der nächste Scan ihn mit.</p>
        </div>
      </div>
    );
  }

  const checks = [...live.checks].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const facts = live.facts;
  const logs = live.logs;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-line/[0.07] bg-raised/25 px-4 py-3 text-[12px] text-muted">
        {live.privilege === 'agent' ? (
          <span className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> vom SAR-Agenten auf <span className="font-mono text-ink">{live.connection.host}</span> (ohne SSH)</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5"><KeyRound className="size-3.5" /> SSH als <span className="font-mono text-ink">{live.connection.user}@{live.connection.host}</span></span>
            <span>Rechte: <span className={cn('text-ink', live.privilege === 'nosudo' && 'text-warn')}>{live.privilege === 'root' ? 'root' : live.privilege === 'sudo -n' ? 'sudo' : 'ohne sudo'}</span></span>
          </>
        )}
        <span>Zeitraum: letzte {live.hours} h</span>
        <span>gelesen {new Date(live.collectedAt).toLocaleString('de-DE')}</span>
        {!logs.canRead && <span className="text-warn">System-Logs nicht lesbar: Anmeldungen und Fehler unvollständig</span>}
      </div>

      <Section title="Prüfungen" count={checks.filter((check) => check.status === 'bad' || check.status === 'warn').length ? `${checks.filter((check) => check.status === 'bad' || check.status === 'warn').length} auffällig` : 'alles ok'} index={0}>
        <div className="grid gap-2 md:grid-cols-2 2xl:grid-cols-3">
          {checks.map((check, index) => <CheckTile key={check.id} index={index} status={check.status} label={check.label} value={check.value} detail={check.detail} />)}
        </div>
      </Section>

      <Section title="System" index={1}>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
          <Fact label="Betriebssystem">{facts.os}</Fact>
          <Fact label="Kernel" mono>{facts.kernel}</Fact>
          <Fact label="Laufzeit">{facts.uptimeDays !== undefined ? `${facts.uptimeDays} Tage` : '–'}</Fact>
          <Fact label="Updates">{facts.updates ? `${facts.updates} (${facts.securityUpdates} Sicherheit)` : 'aktuell'}</Fact>
          <Fact label="Anmeldefähige Konten" mono>{facts.loginUsers.join(', ') || '–'}</Fact>
          <Fact label="SSH-Schlüssel" mono>{facts.authorizedKeys.map((entry) => `${entry.file.replace('/authorized_keys', '')} (${entry.count})`).join(', ') || '–'}</Fact>
          <Fact label="SSH-Konfiguration">{facts.sshd ? `Root ${facts.sshd.permitrootlogin ?? '?'} · Passwort ${facts.sshd.passwordauthentication ?? '?'}` : 'nicht lesbar'}</Fact>
          <Fact label="Dienste">{Object.entries(facts.services).filter(([, state]) => state === 'active').map(([name]) => name).join(', ') || '–'}</Fact>
        </dl>
      </Section>

      <Logins live={live} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="sudo-Verlauf" count={logs.sudo.length} hint="neueste zuerst" index={3}>
          <DataTable
            rows={logs.sudo}
            max={12}
            empty={logs.canRead ? 'Keine sudo-Aufrufe im Zeitraum.' : 'Nicht lesbar ohne Root/sudo/adm.'}
            columns={[
              { label: 'Zeit', render: (row) => <span className="whitespace-nowrap font-mono text-[11.5px] text-muted">{time(row.time)}</span> },
              { label: 'Benutzer', render: (row) => <span className="font-mono text-[12px]">{row.user}{row.runAs && row.runAs !== 'root' ? ` → ${row.runAs}` : ''}</span> },
              { label: 'Befehl', render: (row) => <span className="break-all font-mono text-[11.5px]">{row.command}</span> },
            ]}
          />
        </Section>
        <Section title="Paketänderungen" count={logs.packages.length} hint="dpkg / yum" index={4}>
          <DataTable
            rows={logs.packages}
            max={12}
            empty="Keine Paketänderungen im Zeitraum."
            columns={[
              { label: 'Zeit', render: (row) => <span className="whitespace-nowrap font-mono text-[11.5px] text-muted">{row.time.slice(5, 16)}</span> },
              { label: 'Aktion', render: (row) => <span className={PACKAGE_ACTION[row.action]?.className}>{PACKAGE_ACTION[row.action]?.label ?? row.action}</span> },
              { label: 'Paket', render: (row) => <span className="font-mono text-[12px]">{row.name}</span> },
              { label: 'Version', render: (row) => <span className="font-mono text-[11px] text-muted">{row.version ?? ''}</span> },
            ]}
          />
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Fehler im System-Journal" count={logs.errors.length} hint="gleiche Meldungen zusammengefasst" index={5}>
          <DataTable
            rows={logs.errors}
            max={10}
            empty={logs.canRead ? 'Keine Fehler im Zeitraum.' : 'Nicht lesbar ohne Root/sudo/adm.'}
            columns={[
              { label: 'Zeit', render: (row) => <span className="whitespace-nowrap font-mono text-[11.5px] text-muted">{time(row.time)}</span> },
              { label: 'Quelle', render: (row) => <span className="font-mono text-[12px]">{row.unit}</span> },
              { label: 'Meldung', render: (row) => <span className="text-[12px] text-ink/85">{row.message}</span> },
            ]}
          />
          {!!logs.kernel.length && (
            <div className="mt-3 rounded-xl border border-warn/30 bg-warn/[0.05] p-2.5">
              <p className="mb-1 text-[11.5px] font-medium text-warn">Kernel-Meldungen</p>
              {logs.kernel.slice(0, 6).map((line) => <p key={line} className="truncate font-mono text-[11px] text-muted" title={line}>{line}</p>)}
            </div>
          )}
        </Section>
        <Section title="Letzte Anmeldungen am System" count={logs.lastLogins.length} hint="last" index={6}>
          {logs.lastLogins.length ? (
            <pre className="scroll-thin max-h-64 overflow-auto font-mono text-[11px] leading-relaxed text-ink/85">{logs.lastLogins.join('\n')}</pre>
          ) : <p className="text-[12.5px] text-muted">Keine Einträge.</p>}
          {!!logs.sessions.length && <p className="mt-2 text-[11.5px] text-muted">Gerade angemeldet: <span className="font-mono text-ink/85">{logs.sessions.map((line) => line.split(/\s+/)[0]).join(', ')}</span></p>}
        </Section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title="Geänderte Dateien in /etc" count={logs.etcChanges.length} index={7}>
          {logs.etcChanges.length ? (
            <ul className="scroll-thin max-h-56 space-y-0.5 overflow-y-auto font-mono text-[11.5px]">
              {logs.etcChanges.map((path) => <li key={path} className={cn('truncate', /passwd|shadow|sudoers|ssh\/|cron|pam\.d/.test(path) ? 'text-warn' : 'text-ink/85')} title={path}>{path}</li>)}
            </ul>
          ) : <p className="text-[12.5px] text-muted">Keine Änderungen im Zeitraum.</p>}
          <p className="mt-2 text-[11px] text-faint">Gelb: sicherheitsrelevante Pfade (Konten, sudo, SSH, Cron, PAM).</p>
        </Section>
        <Section title="Geplante Aufgaben (Cron)" count={logs.cron.length} index={8}>
          {logs.cron.length ? (
            <ul className="scroll-thin max-h-56 space-y-1 overflow-y-auto font-mono text-[11px]">
              {logs.cron.map((line) => {
                const [file, ...rest] = line.split(': ');
                return <li key={line} className="break-all"><span className="text-faint">{file.replace('/etc/cron.d/', '')}</span> <span className="text-ink/85">{rest.join(': ')}</span></li>;
              })}
            </ul>
          ) : <p className="text-[12.5px] text-muted">Keine Cron-Einträge.</p>}
        </Section>
        <Section title="Lauschende Ports" count={facts.listening.length} hint="ss -lntup" index={9}>
          <DataTable
            rows={facts.listening}
            max={12}
            empty="Keine Daten."
            columns={[
              { label: 'Port', render: (row) => <span className="font-mono">{row.port}/{row.proto}</span> },
              { label: 'Adresse', render: (row) => <span className={cn('font-mono text-[11.5px]', /^(0\.0\.0\.0|\*|\[::\]|::)$/.test(row.address) ? 'text-warn' : 'text-muted')}>{row.address}</span> },
              { label: 'Prozess', render: (row) => <span className="font-mono text-[11.5px]">{row.process ?? '–'}</span> },
            ]}
          />
        </Section>
      </div>

      <Section title="Aktivste Prozesse" hint="nach CPU, Momentaufnahme" index={10}>
        <DataTable
          rows={logs.processes}
          columns={[
            { label: 'Prozess', render: (row) => <span className="font-mono text-[12px]">{row.command}</span> },
            { label: 'Benutzer', render: (row) => <span className="font-mono text-[11.5px] text-muted">{row.user}</span> },
            { label: 'PID', align: 'right', render: (row) => <span className="font-mono text-[11.5px] text-muted">{row.pid}</span> },
            { label: 'CPU', align: 'right', render: (row) => `${row.cpu.toFixed(1)} %` },
            { label: 'RAM', align: 'right', render: (row) => `${row.memory.toFixed(1)} %` },
          ]}
        />
        {!!logs.tmpExecutables.length && (
          <p className="mt-3 text-[12px] text-warn">Ausführbare Dateien in /tmp: <span className="font-mono">{logs.tmpExecutables.slice(0, 8).join(', ')}</span></p>
        )}
      </Section>
    </div>
  );
}
