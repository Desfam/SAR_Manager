// Live part of the full scan: reads logs and state of a Linux host over SSH, using the system saved in SAR.
// Strictly read-only: every command below only lists or reads (journalctl, last, find, ss, df …); sudo only with -n.
import { connectionDb } from '../database.js';
import { SSHService } from '../ssh.js';
import { GUEST_AUDIT_COMMAND, parseGuestFacts, type GuestFacts } from '../hardening/guest-facts.js';

const isPrivate = (ip: string) => /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fe80:|fc|fd)/i.test(ip);

/** Log reader; H = hours to look back */
const liveLogCommand = (hours: number) =>
  [
    'PATH="$PATH:/usr/sbin:/sbin"',
    `H=${hours}`,
    'S=""; if [ "$(id -u)" != 0 ]; then if sudo -n true 2>/dev/null; then S="sudo -n"; fi; fi',
    // can this login read system logs? root, sudo -n, or member of adm / systemd-journal
    'echo "@@ACCESS"; echo "uid=$(id -u) sudo=${S:-none} groups=$(id -nG 2>/dev/null | sed "s/ /,/g")"',
    'J="$S journalctl --since \\"$H hours ago\\" --no-pager -o short-iso"',
    // SSH: journal first, auth.log / secure as fallback
    'echo "@@SSH"; { eval "$J _COMM=sshd _COMM=sshd-session" 2>/dev/null; } | grep -E "Failed password|Invalid user|Accepted (password|publickey|keyboard-interactive)|authentication failure|Connection closed by invalid user" | tail -n 1500',
    'echo "@@SSHFILE"; for f in /var/log/auth.log /var/log/secure; do $S test -r "$f" && $S grep -hE "sshd.*(Failed password|Invalid user|Accepted )" "$f" 2>/dev/null | tail -n 1500; done',
    'echo "@@SUDO"; { eval "$J _COMM=sudo" 2>/dev/null; } | grep "COMMAND=" | tail -n 200',
    'echo "@@LAST"; last -n 25 -i -w 2>/dev/null | grep -vE "^(wtmp|$)" | head -n 25',
    'echo "@@LASTB"; $S lastb -n 25 -i -w 2>/dev/null | grep -vE "^(btmp|$)" | head -n 25',
    'echo "@@WHO"; who 2>/dev/null',
    'echo "@@ETCMOD"; $S find /etc -xdev -type f -mmin -$((H*60)) 2>/dev/null | head -n 80',
    'echo "@@CRON"; for f in /etc/crontab /etc/cron.d/*; do [ -f "$f" ] && $S grep -hvE "^\\s*(#|$|[A-Z_]+=)" "$f" 2>/dev/null | sed "s|^|$f: |"; done | head -n 40; $S ls /var/spool/cron/crontabs /var/spool/cron 2>/dev/null | grep -vE "^(/|$|crontabs)" | sed "s|^|user-crontab: |" | head -n 20',
    'echo "@@ERRORS"; { eval "$J -p err" 2>/dev/null; } | grep -vE "^-- " | tail -n 80',
    'echo "@@KERNEL"; { eval "$J -k" 2>/dev/null; } | grep -iE "out of memory|oom-kill|killed process|segfault|i/o error|ext4-fs error|blk_update_request" | tail -n 30',
    'echo "@@PKGS"; since=$(date -d "-$H hours" "+%Y-%m-%d %H:%M:%S" 2>/dev/null); for f in /var/log/dpkg.log; do [ -r "$f" ] && awk -v s="$since" \'($1" "$2)>=s && ($3=="install"||$3=="upgrade"||$3=="remove"||$3=="purge")\' "$f" | tail -n 120; done; [ -r /var/log/yum.log ] && tail -n 60 /var/log/yum.log',
    'echo "@@PROCS"; ps -eo user:20,pid,pcpu,pmem,etimes,comm --sort=-pcpu 2>/dev/null | head -n 13',
    'echo "@@TMPEXEC"; $S find /tmp /var/tmp /dev/shm -xdev -type f -perm -u+x 2>/dev/null | head -n 40',
    'echo "@@END"',
  ].join('; ');

export interface LiveCheck {
  id: string;
  label: string;
  status: 'ok' | 'warn' | 'bad' | 'info';
  value: string;
  detail?: string;
}

export interface LiveReport {
  connection: { id: string; name: string; host: string; user: string };
  privilege: string;
  collectedAt: string;
  hours: number;
  facts: {
    os?: string;
    kernel?: string;
    uptimeDays?: number;
    updates: number;
    securityUpdates: number;
    rebootRequired: boolean;
    failedUnits: string[];
    disks: Array<{ mount: string; usedPercent: number }>;
    listening: Array<{ proto: string; address: string; port: number; process?: string }>;
    loginUsers: string[];
    uid0: string[];
    authorizedKeys: Array<{ file: string; count: number }>;
    sshd: Record<string, string> | null;
    services: Record<string, string>;
  };
  logs: {
    /** false: the login may not read system logs, SSH/sudo/error lists are incomplete */
    canRead: boolean;
    /** SSH lines were cut at 1500: counts are lower bounds */
    truncated: boolean;
    sshFailed: { total: number; sources: Array<{ ip: string; count: number; public: boolean }>; users: Array<{ name: string; count: number }>; invalidUsers: number };
    sshAccepted: { total: number; sources: Array<{ ip: string; count: number; public: boolean }>; users: Array<{ name: string; count: number }>; methods: Record<string, number> };
    sudo: Array<{ time?: string; user: string; runAs?: string; command: string }>;
    lastLogins: string[];
    lastFailed: string[];
    sessions: string[];
    etcChanges: string[];
    cron: string[];
    errors: Array<{ time?: string; unit: string; message: string }>;
    kernel: string[];
    packages: Array<{ time: string; action: string; name: string; version?: string }>;
    processes: Array<{ user: string; pid: number; cpu: number; memory: number; command: string }>;
    tmpExecutables: string[];
  };
  checks: LiveCheck[];
}

/* ---------- finding the SSH system ---------- */

export function connectionForAgent(agent: { name: string; ip?: string; hostname?: string }) {
  const all = (connectionDb.getAll() as any[]).filter((connection) => connection.type !== 'rdp');
  const lower = (value?: string) => (value ?? '').toLowerCase();
  const short = (value?: string) => lower(value).split('.')[0];
  return (
    all.find((connection) => agent.ip && connection.host === agent.ip) ??
    all.find((connection) => [lower(agent.name), lower(agent.hostname)].filter(Boolean).includes(lower(connection.host))) ??
    all.find((connection) => [short(agent.name), short(agent.hostname)].filter(Boolean).includes(short(connection.name))) ??
    null
  );
}

const toConfig = (connection: any) => ({
  id: connection.id,
  name: connection.name,
  host: connection.host,
  port: connection.port,
  username: connection.username,
  authType: connection.auth_type || 'password',
  password: connection.password,
  privateKeyPath: connection.private_key_path,
});

/* ---------- parsing ---------- */

function sections(stdout: string) {
  const result: Record<string, string[]> = {};
  let current = '';
  for (const line of stdout.split('\n')) {
    const marker = /^@@(\w+)$/.exec(line.trim());
    if (marker) {
      current = marker[1];
      result[current] = [];
    } else if (current && line.trim()) result[current].push(line);
  }
  return result;
}

const count = (values: string[]) => {
  const map = new Map<string, number>();
  values.forEach((value) => map.set(value, (map.get(value) ?? 0) + 1));
  return [...map.entries()].sort((a, b) => b[1] - a[1]);
};

const isoTime = (line: string) => /^(\d{4}-\d{2}-\d{2}T[\d:]+[+-]\d{2}:?\d{2})/.exec(line)?.[1];

function parseLogs(stdout: string) {
  const s = sections(stdout);
  // journal lines, or auth.log lines when the journal had none
  const ssh = (s.SSH?.length ? s.SSH : s.SSHFILE) ?? [];
  const failed: Array<{ ip: string; user: string }> = [];
  const accepted: Array<{ ip: string; user: string; method: string }> = [];
  let invalidUsers = 0;
  ssh.forEach((line) => {
    const fail = /Failed password for (?:invalid user )?(\S+) from (\S+)/.exec(line);
    if (fail) failed.push({ user: fail[1], ip: fail[2] });
    else if (/Invalid user (\S+) from (\S+)/.test(line)) {
      const match = /Invalid user (\S+) from (\S+)/.exec(line)!;
      invalidUsers += 1;
      failed.push({ user: match[1], ip: match[2] });
    }
    const ok = /Accepted (\S+) for (\S+) from (\S+)/.exec(line);
    if (ok) accepted.push({ method: ok[1], user: ok[2], ip: ok[3] });
  });
  const sources = (list: Array<{ ip: string }>) => count(list.map((entry) => entry.ip)).slice(0, 8).map(([ip, total]) => ({ ip, count: total, public: !isPrivate(ip) }));
  const users = (list: Array<{ user: string }>) => count(list.map((entry) => entry.user)).slice(0, 8).map(([name, total]) => ({ name, count: total }));

  const sudo = (s.SUDO ?? []).map((line) => {
    const user = /sudo(?:\[\d+\])?:\s+(\S+)\s+:/.exec(line)?.[1];
    const command = /COMMAND=(.*)$/.exec(line)?.[1];
    return user && command ? { time: isoTime(line), user, runAs: /USER=([^\s;]+)/.exec(line)?.[1], command: command.trim().slice(0, 300) } : null;
  }).filter((entry): entry is NonNullable<typeof entry> => !!entry && entry.command !== '/usr/bin/true').slice(-40).reverse();

  // our own permission probe (sudo -n true) logs "a password is required": not a finding
  const errors = (s.ERRORS ?? []).filter((line) => !/COMMAND=\/usr\/bin\/true/.test(line)).map((line) => {
    const match = /^\S+\s+\S+\s+([^:[]+)(?:\[\d+\])?:\s*(.*)$/.exec(line);
    return { time: isoTime(line), unit: match?.[1]?.trim() ?? '?', message: (match?.[2] ?? line).slice(0, 240) };
  });
  // group identical messages, newest first
  const errorGroups = new Map<string, { time?: string; unit: string; message: string; count: number }>();
  errors.forEach((error) => {
    const keyText = `${error.unit}|${error.message.replace(/\d+/g, '#')}`;
    const existing = errorGroups.get(keyText);
    errorGroups.set(keyText, { ...error, count: (existing?.count ?? 0) + 1 });
  });

  const packages = (s.PKGS ?? []).map((line) => {
    const dpkg = /^(\S+ \S+) (install|upgrade|remove|purge) (\S+) \S+ (\S+)/.exec(line);
    if (dpkg) return { time: dpkg[1], action: dpkg[2], name: dpkg[3].split(':')[0], version: dpkg[4] === '<none>' ? undefined : dpkg[4] };
    const yum = /^(\w{3} \d+ [\d:]+) (Installed|Updated|Erased): (\S+)/.exec(line);
    return yum ? { time: yum[1], action: yum[2].toLowerCase(), name: yum[3] } : null;
  }).filter((entry): entry is NonNullable<typeof entry> => !!entry).reverse();

  const processes = (s.PROCS ?? []).slice(1).map((line) => {
    const [user, pid, cpu, memory, , ...command] = line.trim().split(/\s+/);
    return { user, pid: Number(pid), cpu: Number(cpu), memory: Number(memory), command: command.join(' ') };
  }).filter((entry) => entry.pid);

  const access = (s.ACCESS ?? [])[0] ?? '';
  const canRead = /uid=0\b/.test(access) || /sudo=sudo/.test(access) || /groups=.*\b(adm|systemd-journal|wheel)\b/.test(access);
  return {
    canRead,
    truncated: ssh.length >= 1500,
    sshFailed: { total: failed.length, sources: sources(failed), users: users(failed), invalidUsers },
    sshAccepted: { total: accepted.length, sources: sources(accepted), users: users(accepted), methods: Object.fromEntries(count(accepted.map((entry) => entry.method))) },
    sudo,
    lastLogins: (s.LAST ?? []).slice(0, 20),
    lastFailed: (s.LASTB ?? []).slice(0, 20),
    sessions: s.WHO ?? [],
    etcChanges: s.ETCMOD ?? [],
    cron: s.CRON ?? [],
    errors: [...errorGroups.values()].reverse().slice(0, 25).map((entry) => ({ time: entry.time, unit: entry.unit, message: entry.count > 1 ? `${entry.message} (${entry.count}×)` : entry.message })),
    kernel: s.KERNEL ?? [],
    packages: packages.slice(0, 60),
    processes,
    tmpExecutables: s.TMPEXEC ?? [],
  };
}

/* ---------- checks ---------- */

function buildChecks(facts: GuestFacts, logs: LiveReport['logs']): LiveCheck[] {
  const checks: LiveCheck[] = [];
  const push = (check: LiveCheck) => checks.push(check);
  const security = facts.upgradable.filter((entry) => entry.security).length;
  push({ id: 'updates', label: 'Updates', status: security ? 'bad' : facts.upgradable.length > 20 ? 'warn' : facts.upgradable.length ? 'info' : 'ok', value: facts.upgradable.length ? `${facts.upgradable.length} ausstehend, ${security} Sicherheit` : 'aktuell', detail: facts.upgradable.slice(0, 8).map((entry) => entry.name).join(', ') || undefined });
  push({ id: 'reboot', label: 'Neustart', status: facts.rebootRequired ? 'warn' : 'ok', value: facts.rebootRequired ? 'erforderlich' : 'nicht nötig', detail: facts.rebootRequired ? 'Ein Update (oft Kernel) wird erst nach Neustart wirksam.' : undefined });
  if (facts.sshd) {
    const root = facts.sshd.permitrootlogin;
    const password = facts.sshd.passwordauthentication;
    push({ id: 'ssh-root', label: 'SSH Root-Login', status: root === 'yes' ? 'bad' : root === 'no' ? 'ok' : 'info', value: root ?? '?', detail: root === 'yes' ? 'Root darf sich per Passwort anmelden.' : undefined });
    push({ id: 'ssh-password', label: 'SSH Passwort-Login', status: password === 'yes' ? (logs.sshFailed.total ? 'warn' : 'info') : 'ok', value: password ?? '?', detail: password === 'yes' ? 'Passwörter erlaubt: anfällig für Passwort-Raten, Schlüssel sind sicherer.' : undefined });
  }
  const extraRoot = facts.uid0.filter((name) => name !== 'root');
  push({ id: 'uid0', label: 'Konten mit UID 0', status: extraRoot.length ? 'bad' : 'ok', value: facts.uid0.join(', ') || '–', detail: extraRoot.length ? 'Weitere Konten mit Root-Rechten sind ein klassisches Zeichen für eine Hintertür.' : undefined });
  if (facts.nopasswd?.length) push({ id: 'nopasswd', label: 'sudo ohne Passwort', status: 'warn', value: `${facts.nopasswd.length} Regel(n)`, detail: facts.nopasswd.slice(0, 3).join(' · ') });
  const fullDisk = facts.disks.filter((disk) => disk.usedPercent >= 80);
  push({ id: 'disk', label: 'Speicherplatz', status: fullDisk.some((disk) => disk.usedPercent >= 90) ? 'bad' : fullDisk.length ? 'warn' : 'ok', value: facts.disks.map((disk) => `${disk.mount} ${disk.usedPercent}%`).slice(0, 4).join(' · ') || '–' });
  push({ id: 'units', label: 'Fehlgeschlagene Dienste', status: facts.failedUnits.length ? 'warn' : 'ok', value: facts.failedUnits.length ? facts.failedUnits.join(', ') : 'keine' });
  push({ id: 'time', label: 'Zeitsynchronisation', status: facts.timeSynced === false ? 'warn' : facts.timeSynced ? 'ok' : 'info', value: facts.timeSynced === null ? 'unbekannt' : facts.timeSynced ? 'synchron' : 'nicht synchron', detail: facts.timeSynced === false ? 'Falsche Uhrzeit verfälscht Logs und Zertifikatsprüfungen.' : undefined });
  const protection = ['fail2ban', 'crowdsec'].filter((name) => facts.services[name] === 'active');
  push({ id: 'bruteforce', label: 'Schutz gegen Passwort-Raten', status: protection.length ? 'ok' : logs.sshFailed.total > 20 ? 'warn' : 'info', value: protection.length ? protection.join(', ') : 'kein fail2ban/crowdsec', detail: !protection.length && logs.sshFailed.total ? `${logs.sshFailed.total} Fehlversuche im Zeitraum` : undefined });
  push({ id: 'wazuh', label: 'Wazuh-Agent', status: facts.services['wazuh-agent'] === 'active' ? 'ok' : 'warn', value: facts.services['wazuh-agent'] ?? 'unbekannt' });
  if (!logs.canRead) {
    push({ id: 'log-access', label: 'System-Logs', status: 'info', value: 'nicht lesbar', detail: 'Der SSH-Benutzer hat weder Root noch sudo ohne Passwort noch die Gruppe adm/systemd-journal. SSH-Anmeldungen, sudo-Verlauf und Fehler sind deshalb unvollständig.' });
    return [...checks, ...tailChecks(logs)];
  }
  const publicFailed = logs.sshFailed.sources.filter((source) => source.public);
  push({ id: 'ssh-failed', label: 'SSH-Fehlversuche', status: publicFailed.length ? 'bad' : logs.sshFailed.total > 20 ? 'warn' : logs.sshFailed.total ? 'info' : 'ok', value: `${logs.sshFailed.total}${logs.sshFailed.invalidUsers ? `, ${logs.sshFailed.invalidUsers} unbekannte Benutzer` : ''}`, detail: logs.sshFailed.sources.slice(0, 4).map((source) => `${source.ip} (${source.count})`).join(', ') || undefined });
  const publicAccepted = logs.sshAccepted.sources.filter((source) => source.public);
  push({ id: 'ssh-accepted', label: 'SSH-Anmeldungen', status: publicAccepted.length ? 'warn' : 'info', value: `${logs.sshAccepted.total}${logs.truncated ? '+' : ''} erfolgreich`, detail: publicAccepted.length ? `aus dem Internet: ${publicAccepted.map((source) => source.ip).join(', ')}` : logs.sshAccepted.sources.slice(0, 4).map((source) => `${source.ip} (${source.count})`).join(', ') || undefined });
  return [...checks, ...tailChecks(logs)];
}

/** Checks that work without log access */
function tailChecks(logs: LiveReport['logs']): LiveCheck[] {
  const checks: LiveCheck[] = [];
  const push = (check: LiveCheck) => checks.push(check);
  push({ id: 'tmp', label: 'Ausführbare Dateien in /tmp', status: logs.tmpExecutables.length ? 'warn' : 'ok', value: logs.tmpExecutables.length ? `${logs.tmpExecutables.length}` : 'keine', detail: logs.tmpExecutables.slice(0, 4).join(', ') || undefined });
  push({ id: 'kernel', label: 'Kernel-Meldungen (OOM, Segfault, I/O)', status: logs.kernel.length ? 'warn' : 'ok', value: logs.kernel.length ? `${logs.kernel.length}` : 'keine' });
  push({ id: 'etc', label: 'Geänderte Dateien in /etc', status: logs.etcChanges.length ? 'info' : 'ok', value: `${logs.etcChanges.length}`, detail: logs.etcChanges.slice(0, 5).join(', ') || undefined });
  return checks;
}

/* ---------- run ---------- */

export async function liveScan(agent: { name: string; ip?: string; hostname?: string }, hours: number): Promise<LiveReport | { error: string; connection?: { id: string; name: string; host: string } }> {
  const connection = connectionForAgent(agent);
  if (!connection) return { error: 'Kein passendes SSH-System in SAR gefunden (gleiche IP oder gleicher Name wie der Agent).' };
  const ref = { id: connection.id, name: connection.name, host: connection.host };
  const lookback = Math.min(Math.max(Math.round(hours), 1), 24 * 30);
  const [factsResult, logsResult] = await Promise.all([
    SSHService.executeCommand(toConfig(connection) as any, GUEST_AUDIT_COMMAND),
    SSHService.executeCommand(toConfig(connection) as any, liveLogCommand(lookback)),
  ]);
  const factsOut = factsResult.data?.stdout ?? '';
  if (!factsOut.includes('@@ID')) return { error: factsResult.error || factsResult.message || 'SSH-Abfrage fehlgeschlagen', connection: ref };
  const facts = parseGuestFacts(factsOut);
  const logs = parseLogs(String(logsResult.data?.stdout ?? ''));
  return {
    connection: { ...ref, user: connection.username },
    privilege: facts.privilege,
    collectedAt: new Date().toISOString(),
    hours: lookback,
    facts: {
      os: facts.os.pretty,
      kernel: facts.kernel,
      uptimeDays: facts.host.uptimeSeconds ? Math.round(facts.host.uptimeSeconds / 86_400) : undefined,
      updates: facts.upgradable.length,
      securityUpdates: facts.upgradable.filter((entry) => entry.security).length,
      rebootRequired: facts.rebootRequired,
      failedUnits: facts.failedUnits,
      disks: facts.disks,
      listening: facts.listening.slice(0, 60),
      loginUsers: facts.loginUsers,
      uid0: facts.uid0,
      authorizedKeys: facts.authorizedKeys,
      sshd: facts.sshd,
      services: facts.services,
    },
    logs,
    checks: buildChecks(facts, logs),
  };
}

const CHECK_REASON: Record<string, string> = {
  updates: 'Ausstehende Updates schließen bekannte Sicherheitslücken nicht, solange sie nicht eingespielt sind.',
  reboot: 'Ein eingespieltes Update (oft der Kernel) wird erst nach einem Neustart wirksam; bis dahin läuft die alte, angreifbare Version.',
  'ssh-root': 'Root darf sich direkt per SSH anmelden. Ein erratenes Passwort gibt sofort volle Kontrolle über das System.',
  'ssh-password': 'SSH erlaubt Passwörter. Das macht Passwort-Raten möglich; Schlüssel sind deutlich sicherer.',
  uid0: 'Neben root haben weitere Konten Root-Rechte (UID 0). Das ist ein klassisches Zeichen für eine Hintertür.',
  nopasswd: 'sudo ohne Passwort: Wer das Konto übernimmt, hat sofort Root-Rechte.',
  disk: 'Ein fast volles Dateisystem stoppt Logs, Datenbanken und Updates.',
  units: 'Mindestens ein Dienst ist fehlgeschlagen und läuft nicht.',
  time: 'Die Uhrzeit ist nicht synchronisiert; das verfälscht Logs und kann Zertifikatsprüfungen stören.',
  bruteforce: 'Es gibt SSH-Fehlversuche, aber keinen automatischen Schutz (fail2ban/crowdsec), der wiederholte Versuche sperrt.',
  wazuh: 'Der Wazuh-Agent läuft nicht: Ereignisse dieses Systems kommen nicht mehr in Wazuh an.',
  'ssh-failed': 'Fehlgeschlagene SSH-Anmeldungen, zum Teil aus dem Internet: typisch für Passwort-Raten.',
  'ssh-accepted': 'Erfolgreiche SSH-Anmeldungen aus dem Internet. Erwartet bei VPN oder Fernwartung, sonst ein Warnsignal.',
  tmp: 'Ausführbare Dateien in /tmp sind ungewöhnlich und ein häufiger Ablageort für Schadsoftware.',
  kernel: 'Der Kernel meldet Speichermangel, Abstürze oder Festplattenfehler.',
};

/** Findings for the central list from the live checks */
const CHECK_ADVICE: Record<string, string[]> = {
  updates: ['Updates einspielen (apt upgrade), Sicherheitsupdates zuerst'],
  reboot: ['Neustart in einem Wartungsfenster planen'],
  'ssh-root': ['PermitRootLogin auf "no" oder "prohibit-password" setzen'],
  'ssh-password': ['SSH-Schlüssel nutzen und PasswordAuthentication auf "no" setzen'],
  uid0: ['Unbekannte Konten mit UID 0 sofort prüfen', 'Wer hat das Konto angelegt (Logs, /etc/passwd-Änderung)?'],
  nopasswd: ['NOPASSWD-Regeln auf das Nötigste beschränken'],
  disk: ['Speicher aufräumen oder erweitern, volle Dateisysteme stoppen Logs und Dienste'],
  units: ['systemctl status <dienst> und journalctl -u <dienst> prüfen'],
  time: ['chrony oder systemd-timesyncd aktivieren'],
  bruteforce: ['fail2ban oder crowdsec installieren, SSH nur aus internen Netzen erlauben'],
  wazuh: ['Wazuh-Agent prüfen: systemctl status wazuh-agent'],
  'ssh-failed': ['Quellen prüfen und ggf. per Firewall sperren', 'Gab es danach erfolgreiche Anmeldungen derselben Quelle?'],
  'ssh-accepted': ['Sind die Anmeldungen aus dem Internet erwartet (VPN, Admin)?'],
  tmp: ['Dateien in /tmp prüfen: Herkunft, Inhalt, laufende Prozesse'],
  kernel: ['Kernel-Log prüfen (journalctl -k): Speicher, Festplatte, Abstürze'],
};

export function liveFindings(report: LiveReport) {
  return report.checks
    .filter((check) => check.status === 'bad' || check.status === 'warn')
    .map((check) => ({
      key: ['live', check.id],
      category: 'Live (SSH)',
      title: `${check.label}: ${check.value}`,
      severity: (check.status === 'bad' ? (check.id === 'uid0' ? 'high' : 'medium') : 'low') as 'high' | 'medium' | 'low',
      reason: CHECK_REASON[check.id] ?? check.detail ?? `Live per SSH auf ${report.connection.name} gelesen.`,
      evidence: [`gelesen per SSH als ${report.connection.user} (${report.privilege}) am ${new Date(report.collectedAt).toLocaleString('de-DE')}`, ...(check.detail ? [check.detail] : [])],
      checks: CHECK_ADVICE[check.id] ?? [],
      eventCount: 0,
    }));
}
