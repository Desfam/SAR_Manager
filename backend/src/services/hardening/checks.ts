// Security checks per guest and for the Proxmox host. Each check explains why it matters and how to fix it;
// nothing is changed automatically.
import type { GuestFacts } from './guest-facts.js';
import type { GuestFirewallReport } from '../guest-firewall.js';

export type Category = 'isolation' | 'network' | 'system' | 'access' | 'services' | 'monitoring' | 'backup' | 'host';
export type Severity = 'critical' | 'high' | 'medium' | 'low';
export type Status = 'pass' | 'warn' | 'fail' | 'unknown';

export interface Finding {
  id: string;
  category: Category;
  title: string;
  status: Status;
  severity: Severity;
  detail: string;
  /** What to do, in plain words */
  fix?: string;
  /** Example commands; placeholders in <…> */
  commands?: string[];
}

export interface Profile {
  purpose?: string;
  exposure?: 'internal' | 'public' | 'lab';
  adminAccess?: string;
  expectedPorts?: string;
  sensitivity?: 'normal' | 'high';
  rto?: string;
  rpo?: string;
  owner?: string;
}

export interface GuestContext {
  vmid: number;
  name: string;
  node: string;
  type: 'qemu' | 'lxc';
  status?: string;
  config: Record<string, any>;
  firewallOptions: Record<string, any> | null;
  clusterFirewall: boolean;
  lastBackup: number | null; // unix seconds
  inBackupJob: boolean;
  system?: { id: string; name: string; username: string; authType: string };
  facts?: GuestFacts;
  factsError?: string;
  osFirewall?: GuestFirewallReport;
  profile?: Profile;
}

const WEIGHT: Record<Severity, number> = { critical: 10, high: 6, medium: 3, low: 1 };

export function score(findings: Finding[]) {
  let total = 0;
  let earned = 0;
  for (const finding of findings) {
    if (finding.status === 'unknown') continue;
    total += WEIGHT[finding.severity];
    if (finding.status === 'pass') earned += WEIGHT[finding.severity];
    else if (finding.status === 'warn') earned += WEIGHT[finding.severity] * 0.5;
  }
  return total ? Math.round((earned / total) * 100) : null;
}

const RISKY_PORTS: Record<number, string> = {
  2375: 'Docker-API ohne TLS',
  2376: 'Docker-API',
  3306: 'MySQL/MariaDB',
  5432: 'PostgreSQL',
  6379: 'Redis',
  11211: 'Memcached',
  27017: 'MongoDB',
  9200: 'Elasticsearch/OpenSearch',
  9300: 'Elasticsearch-Cluster',
  5984: 'CouchDB',
  8086: 'InfluxDB',
  5900: 'VNC',
  23: 'Telnet',
  21: 'FTP',
};

const isLoopback = (address: string) => address.startsWith('127.') || address === '::1' || address === 'localhost';
const isWildcard = (address: string) => address === '0.0.0.0' || address === '*' || address === '::' || address === '[::]';

function parseFeatures(value?: string) {
  return Object.fromEntries((value ?? '').split(',').filter(Boolean).map((part) => {
    const [key, val] = part.split('=');
    return [key, val ?? '1'];
  }));
}

/** Supported-release check for common distributions (state of 2026) */
function osSupport(facts: GuestFacts): { status: Status; detail: string } {
  const { id, version, pretty } = facts.os;
  const name = pretty ?? `${id} ${version}`;
  const major = Number((version ?? '').split('.')[0]);
  if (id === 'debian') {
    if (major >= 12) return { status: 'pass', detail: `${name} wird unterstützt` };
    if (major === 11) return { status: 'fail', detail: `${name}: Sicherheitsunterstützung (LTS) ist ausgelaufen` };
    return { status: 'fail', detail: `${name} bekommt keine Sicherheitsupdates mehr` };
  }
  if (id === 'ubuntu') {
    const [y, m] = (version ?? '').split('.').map(Number);
    if (m !== 4 || y % 2 !== 0) return { status: 'warn', detail: `${name} ist keine LTS-Version (kurze Unterstützung)` };
    if (y >= 24) return { status: 'pass', detail: `${name} wird unterstützt` };
    if (y === 22) return { status: 'pass', detail: `${name} wird bis April 2027 unterstützt` };
    return { status: 'fail', detail: `${name}: Standardunterstützung ausgelaufen` };
  }
  return { status: 'unknown', detail: `${name || 'Unbekanntes System'}: Unterstützungsstatus nicht bewertet` };
}

const SECRET_PATTERN = /(passw(or)?(t|d)|kennwort|\bpw\b|secret|api[_-]?key|token|_password)\s*[:=]/gi;

export function guestFindings(ctx: GuestContext): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const tool = ctx.type === 'lxc' ? 'pct' : 'qm';
  const { config, facts } = ctx;
  const profile = ctx.profile ?? {};

  /* ---------- isolation (Proxmox) ---------- */

  if (ctx.type === 'lxc') {
    const privileged = Number(config.unprivileged ?? 0) !== 1;
    add({
      id: 'lxc-unprivileged',
      category: 'isolation',
      title: 'Container läuft unprivilegiert',
      status: privileged ? 'fail' : 'pass',
      severity: 'critical',
      detail: privileged ? 'Root im Container ist Root auf dem Proxmox-Host (kein UID-Mapping).' : 'Root im Container ist auf eine unprivilegierte Host-UID abgebildet.',
      fix: privileged ? 'Nicht einfach umschalten: Dateibesitz muss zum UID-Mapping passen. Sichern und als unprivilegierten Container wiederherstellen, danach testen.' : undefined,
      commands: privileged ? [`vzdump ${ctx.vmid} --storage <backup-storage> --mode stop`, `pct restore <neue-ID> <pfad-zum-backup.tar.zst> --unprivileged 1 --storage <storage>`] : undefined,
    });

    const features = parseFeatures(config.features);
    const risky = Object.entries(features).filter(([key, value]) => value === '1' && ['keyctl', 'fuse', 'mknod'].includes(key)).map(([key]) => key);
    const mount = features.mount;
    const listed = [...risky, ...(mount ? [`mount=${mount}`] : [])];
    add({
      id: 'lxc-features',
      category: 'isolation',
      title: 'Nur nötige Container-Features',
      status: listed.length ? (privileged ? 'fail' : 'warn') : 'pass',
      severity: 'medium',
      detail: listed.length ? `Aktiv: ${listed.join(', ')}${features.nesting === '1' ? ' (zusätzlich nesting)' : ''}. Jedes Feature lockert die Isolation.` : `Keine zusätzlichen Features${features.nesting === '1' ? ' außer nesting (für aktuelle Systemd-Versionen oft nötig)' : ''}.`,
      fix: listed.length ? 'Nur behalten, was die Anwendung nachweislich braucht. Braucht sie immer mehr Rechte, ist sie in einer VM besser aufgehoben.' : undefined,
      commands: listed.length ? [`pct set ${ctx.vmid} --features ${features.nesting === '1' ? 'nesting=1' : '<nur-benötigte>'}`] : undefined,
    });

    const rawLxc: Array<[string, string]> = Array.isArray(config.lxc) ? config.lxc : [];
    const unconfined = rawLxc.some(([key, value]) => key === 'lxc.apparmor.profile' && value === 'unconfined');
    const capKeep = rawLxc.some(([key]) => key === 'lxc.cap.keep' || key === 'lxc.cap.drop');
    const devices = Object.keys(config).filter((key) => /^dev\d+$/.test(key)).length + rawLxc.filter(([key]) => key.startsWith('lxc.cgroup2.devices.allow') || key.startsWith('lxc.mount.entry')).length;
    add({
      id: 'lxc-apparmor',
      category: 'isolation',
      title: 'AppArmor-Profil aktiv, keine Sonderrechte',
      status: unconfined ? 'fail' : capKeep || devices ? 'warn' : 'pass',
      severity: 'high',
      detail: unconfined ? 'lxc.apparmor.profile: unconfined schaltet eine wichtige Schutzschicht ab.' : devices ? `${devices} Geräte- oder Mount-Freigaben über rohe LXC-Optionen oder devN.` : capKeep ? 'Capabilities werden manuell verändert.' : 'Standardprofil, keine durchgereichten Geräte.',
      fix: unconfined || devices || capKeep ? 'Rohe lxc.*-Zeilen in /etc/pve/lxc/<ID>.conf einzeln begründen und entfernen, was nicht gebraucht wird.' : undefined,
    });

    const mounts = Object.entries(config).filter(([key]) => /^mp\d+$/.test(key)).map(([key, value]) => ({ key, value: String(value) }));
    const bindMounts = mounts.filter((entry) => entry.value.startsWith('/'));
    const writable = bindMounts.filter((entry) => !/(^|,)ro=1(,|$)/.test(entry.value));
    add({
      id: 'lxc-bind-mounts',
      category: 'isolation',
      title: 'Bind-Mounts schreibgeschützt und eng gefasst',
      status: writable.length ? 'warn' : 'pass',
      severity: 'high',
      detail: bindMounts.length
        ? `${bindMounts.length} Host-Verzeichnis(se) eingebunden, davon ${writable.length} beschreibbar: ${writable.map((entry) => entry.value.split(',')[0]).join(', ') || '–'}. Eine kompromittierte Anwendung könnte diese Daten ändern oder verschlüsseln. Bind-Mounts sind nicht im Container-Backup enthalten.`
        : 'Keine Host-Verzeichnisse eingebunden.',
      fix: writable.length ? 'Nur den benötigten Unterordner einbinden und, wo möglich, nur lesend (ro=1). Inhalte separat sichern.' : undefined,
      commands: writable.map((entry) => `pct set ${ctx.vmid} -${entry.key} ${entry.value},ro=1`),
    });
  } else {
    const passthrough = Object.keys(config).filter((key) => /^(hostpci|usb)\d+$/.test(key));
    add({
      id: 'vm-passthrough',
      category: 'isolation',
      title: 'Kein unnötiges Geräte-Passthrough',
      status: passthrough.length ? 'warn' : 'pass',
      severity: 'medium',
      detail: passthrough.length ? `Durchgereicht: ${passthrough.join(', ')}. Direkter Hardwarezugriff schwächt die Trennung zum Host.` : 'Keine PCI- oder USB-Geräte durchgereicht.',
      fix: passthrough.length ? 'Prüfen, ob das Gerät noch gebraucht wird, sonst entfernen.' : undefined,
      commands: passthrough.map((key) => `qm set ${ctx.vmid} --delete ${key}`),
    });
    const isoMounted = Object.entries(config).filter(([key, value]) => /^(ide|sata|scsi)\d+$/.test(key) && /media=cdrom/.test(String(value)) && !/^none,/.test(String(value)) && !/cloudinit/.test(String(value)));
    const cloudinit = Object.entries(config).some(([, value]) => /cloudinit/.test(String(value)));
    add({
      id: 'vm-media',
      category: 'isolation',
      title: 'Keine alten Installationsmedien eingelegt',
      status: isoMounted.length ? 'warn' : 'pass',
      severity: 'low',
      detail: isoMounted.length ? `Eingelegt: ${isoMounted.map(([key, value]) => `${key}=${String(value).split(',')[0]}`).join(', ')}` : `Keine ISO eingelegt${cloudinit ? ' (Cloud-Init-Laufwerk vorhanden: enthält ggf. Zugangsdaten)' : ''}.`,
      commands: isoMounted.map(([key]) => `qm set ${ctx.vmid} --${key} none,media=cdrom`),
    });
    const agent = /^1|enabled=1/.test(String(config.agent ?? ''));
    add({
      id: 'vm-agent',
      category: 'isolation',
      title: 'QEMU Guest Agent aktiv',
      status: agent ? 'pass' : 'warn',
      severity: 'low',
      detail: agent ? 'Agent ist eingeschaltet (IP-Adressen, sauberes Herunterfahren, konsistente Backups).' : 'Ohne Agent kein sauberes Herunterfahren, keine IP-Anzeige und keine dateisystemkonsistenten Backups.',
      commands: agent ? undefined : [`qm set ${ctx.vmid} --agent enabled=1`, 'apt install qemu-guest-agent  # im Gast'],
    });
  }

  if (profile.exposure === 'public' && ctx.type === 'lxc') {
    add({
      id: 'public-in-lxc',
      category: 'isolation',
      title: 'Öffentlich erreichbarer Dienst in eigener VM',
      status: 'fail',
      severity: 'high',
      detail: 'Laut Sollprofil öffentlich erreichbar, läuft aber als LXC mit gemeinsamem Host-Kernel.',
      fix: 'Exponierte Dienste in eine eigene VM in einer DMZ verschieben.',
    });
  }
  if (facts && ctx.type === 'lxc' && (facts.services.docker === 'active' || facts.services.podman === 'active')) {
    add({
      id: 'docker-in-lxc',
      category: 'isolation',
      title: 'Docker besser in einer VM',
      status: 'warn',
      severity: 'medium',
      detail: 'Im Container läuft Docker. Proxmox empfiehlt Anwendungscontainer in einer QEMU-VM; im LXC braucht Docker zusätzliche Rechte (nesting, oft keyctl).',
      fix: 'Bei nächster Gelegenheit in eine VM umziehen, besonders wenn der Dienst exponiert ist.',
    });
  }

  const description = typeof config.description === 'string' ? config.description : '';
  const secretHits = description.match(SECRET_PATTERN)?.length ?? 0;
  add({
    id: 'secrets-in-notes',
    category: 'isolation',
    title: 'Keine Zugangsdaten in den Proxmox-Notizen',
    status: secretHits ? 'fail' : 'pass',
    severity: 'high',
    detail: secretHits ? `Die Notiz enthält ${secretHits} Stelle(n), die nach Passwort oder Token aussehen. Jeder mit Lesezugriff auf Proxmox oder auf Backups sieht sie.` : 'Keine passwortähnlichen Einträge in der Notiz gefunden.',
    fix: secretHits ? 'Zugangsdaten in einen Passwortmanager verschieben, aus der Notiz löschen und die betroffenen Passwörter ändern.' : undefined,
  });

  /* ---------- network ---------- */

  const nics = Object.entries(config).filter(([key]) => /^net\d+$/.test(key)).map(([key, value]) => ({ key, value: String(value) }));
  const missingFlag = nics.filter((nic) => !/(^|,)firewall=1(,|$)/.test(nic.value));
  const guestFw = Number(ctx.firewallOptions?.enable ?? 0) === 1;
  const effective = ctx.clusterFirewall && guestFw && !missingFlag.length;
  add({
    id: 'pve-firewall',
    category: 'network',
    title: 'Proxmox-Firewall greift für diesen Gast',
    status: effective ? 'pass' : 'fail',
    severity: 'high',
    detail: effective
      ? `Aktiv · eingehend ${ctx.firewallOptions?.policy_in ?? 'DROP'}, ausgehend ${ctx.firewallOptions?.policy_out ?? 'ACCEPT'}`
      : `Nicht wirksam: ${[!ctx.clusterFirewall && 'Rechenzentrum aus', !guestFw && 'Gast-Firewall aus', missingFlag.length && `${missingFlag.map((nic) => nic.key).join(', ')} ohne Firewall-Flag`].filter(Boolean).join(', ')}.`,
    fix: effective ? undefined : 'Zuerst die nötigen Regeln anlegen (Firewall-Tab), dann einschalten: sonst trennt die Standard-Policy DROP sofort Verbindungen.',
    commands: effective
      ? undefined
      : [
          ...missingFlag.map((nic) => `${tool} set ${ctx.vmid} --${nic.key} ${nic.value},firewall=1`),
          ...(!guestFw ? [`pvesh set /nodes/${ctx.node}/${ctx.type}/${ctx.vmid}/firewall/options --enable 1`] : []),
        ],
  });

  if (ctx.osFirewall || facts) {
    const report = ctx.osFirewall;
    let status: Status = 'unknown';
    let detail = 'Firewall im Gast konnte nicht gelesen werden.';
    if (report) {
      const ufw = report.ufw?.status === 'active';
      const firewalld = report.firewalld?.state === 'running';
      const nftDrop = (report.nftables?.tables ?? []).some((table) => table.chains.some((chain) => chain.type === 'filter' && chain.hook === 'input' && (/^(drop|reject)$/i.test(chain.policy ?? '') || chain.rules.some((rule) => /\b(drop|reject)\b/.test(rule)))));
      const iptDrop = (report.iptables?.tables ?? []).some((table) => table.name === 'filter' && table.chains.some((chain) => chain.name === 'INPUT' && (/^(DROP|REJECT)$/.test(chain.policy ?? '') || chain.rules.some((rule) => /-j (DROP|REJECT)/.test(rule)))));
      const readable = !(report.nftables?.error && report.iptables?.error && (!report.ufw || report.ufw.error));
      if (ufw || firewalld || nftDrop || iptDrop) {
        status = 'pass';
        detail = `Filtert eingehend über ${ufw ? 'ufw' : firewalld ? 'firewalld' : nftDrop ? 'nftables' : 'iptables'}.`;
      } else if (readable) {
        status = effective ? 'warn' : 'fail';
        detail = effective ? 'Im Gast wird nichts gefiltert; geschützt nur durch die Proxmox-Firewall.' : 'Weder Proxmox noch der Gast filtern eingehenden Verkehr.';
      }
    }
    add({
      id: 'guest-firewall',
      category: 'network',
      title: 'Firewall im Gast',
      status,
      severity: 'medium',
      detail,
      fix: status === 'fail' || status === 'warn' ? 'Entweder zentral über die Proxmox-Firewall oder im Gast (nftables/ufw) filtern, nicht unkoordiniert beides. IPv6 mitbedenken.' : undefined,
      commands: status === 'fail' || status === 'warn' ? ['apt install ufw', 'ufw allow from <admin-netz> to any port 22 proto tcp', 'ufw default deny incoming', 'ufw enable'] : undefined,
    });
  }

  /* ---------- system ---------- */

  if (facts) {
    const support = osSupport(facts);
    add({ id: 'os-supported', category: 'system', title: 'Unterstützte Distribution', status: support.status, severity: 'critical', detail: support.detail, fix: support.status === 'fail' ? 'Auf eine unterstützte Version aktualisieren (vorher Backup und Test).' : undefined });

    const security = facts.upgradable.filter((entry) => entry.security).length;
    add({
      id: 'updates',
      category: 'system',
      title: 'Sicherheitsupdates eingespielt',
      status: security > 0 ? (security > 10 ? 'fail' : 'warn') : facts.upgradable.length > 20 ? 'warn' : 'pass',
      severity: 'high',
      detail: `${facts.upgradable.length} Pakete aktualisierbar, davon ${security} Sicherheitsupdates${facts.aptListsAgeDays !== undefined ? ` · Paketlisten ${facts.aptListsAgeDays} Tag(e) alt` : ''}.`,
      fix: facts.upgradable.length ? 'Update planen, danach Dienste prüfen.' : undefined,
      commands: facts.upgradable.length ? ['apt update', 'apt list --upgradable', 'apt upgrade'] : undefined,
    });
    if (facts.aptListsAgeDays !== undefined && facts.aptListsAgeDays > 7) {
      add({ id: 'apt-stale', category: 'system', title: 'Paketlisten aktuell', status: 'warn', severity: 'low', detail: `Seit ${facts.aptListsAgeDays} Tagen kein apt update: die Update-Zahl oben ist vermutlich zu niedrig.`, commands: ['apt update'] });
    }

    const unattendedOk = facts.unattended.installed && facts.unattended.enabled === true && facts.unattended.timer === 'active';
    add({
      id: 'unattended',
      category: 'system',
      title: 'Automatische Sicherheitsupdates',
      status: unattendedOk ? 'pass' : 'warn',
      severity: 'medium',
      detail: !facts.unattended.installed ? 'unattended-upgrades ist nicht installiert.' : facts.unattended.enabled ? `Eingeschaltet, Timer ${facts.unattended.timer}.` : 'Installiert, aber nicht eingeschaltet.',
      fix: unattendedOk ? undefined : 'Einschalten und mit einem Probelauf prüfen, welche Quellen tatsächlich aktualisiert werden.',
      commands: unattendedOk ? undefined : ['apt install unattended-upgrades', 'dpkg-reconfigure -plow unattended-upgrades', 'unattended-upgrade --dry-run --debug'],
    });
    add({
      id: 'reboot',
      category: 'system',
      title: 'Kein ausstehender Neustart',
      status: facts.rebootRequired ? 'warn' : 'pass',
      severity: 'medium',
      detail: facts.rebootRequired ? 'Ein Update verlangt einen Neustart; bis dahin laufen alte Bibliotheken bzw. der alte Kernel.' : ctx.type === 'lxc' ? 'Kein Neustart nötig (Kernel kommt vom Host).' : 'Kein Neustart nötig.',
    });
    const fullDisks = facts.disks.filter((disk) => disk.usedPercent >= 90);
    const fullInodes = facts.inodes.filter((disk) => disk.usedPercent >= 90);
    add({
      id: 'disk',
      category: 'system',
      title: 'Genug freier Speicher',
      status: fullDisks.length || fullInodes.length ? 'warn' : 'pass',
      severity: 'medium',
      detail: fullDisks.length || fullInodes.length ? [...fullDisks.map((disk) => `${disk.mount} ${disk.usedPercent} %`), ...fullInodes.map((disk) => `${disk.mount} Inodes ${disk.usedPercent} %`)].join(', ') : facts.disks.map((disk) => `${disk.mount} ${disk.usedPercent} %`).join(', ') || 'keine Daten',
      commands: fullDisks.length ? ['df -h', 'du -xh --max-depth=1 / | sort -h | tail', 'journalctl --disk-usage'] : undefined,
    });
    add({
      id: 'failed-units',
      category: 'system',
      title: 'Keine fehlgeschlagenen Dienste',
      status: facts.failedUnits.length ? 'warn' : 'pass',
      severity: 'low',
      detail: facts.failedUnits.length ? facts.failedUnits.join(', ') : 'Alle Dienste laufen oder sind sauber beendet.',
      commands: facts.failedUnits.length ? ['systemctl --failed', `journalctl -u ${facts.failedUnits[0]} -n 50`] : undefined,
    });
    if (ctx.type === 'qemu') {
      const expected: Record<string, string> = { 'kernel.randomize_va_space': '2', 'kernel.kptr_restrict': '1', 'kernel.dmesg_restrict': '1', 'fs.protected_hardlinks': '1', 'fs.protected_symlinks': '1' };
      const off = Object.entries(expected).filter(([key, value]) => facts.sysctl[key] !== undefined && Number(facts.sysctl[key]) < Number(value));
      add({
        id: 'sysctl',
        category: 'system',
        title: 'Kernel-Schutzeinstellungen',
        status: off.length ? 'warn' : 'pass',
        severity: 'low',
        detail: off.length ? `Abweichend: ${off.map(([key]) => `${key}=${facts.sysctl[key]}`).join(', ')}` : 'ASLR, Kernel-Pointer- und Link-Schutz aktiv.',
        commands: off.length ? [`printf '%s\\n' ${off.map(([key, value]) => `'${key} = ${value}'`).join(' ')} > /etc/sysctl.d/60-hardening.conf`, 'sysctl --system'] : undefined,
      });
    }
  }

  /* ---------- access ---------- */

  if (ctx.system?.authType !== 'key' && ctx.system) {
    add({
      id: 'app-login',
      category: 'access',
      title: 'Die App meldet sich per Schlüssel an',
      status: 'warn',
      severity: 'medium',
      detail: `Der Zugang „${ctx.system.name}“ nutzt ein Passwort für ${ctx.system.username}. Solange das so ist, darf Passwort-Login auf dem Server nicht abgeschaltet werden.`,
      fix: 'Unter „Systeme“ den Public Key hinterlegen und den Zugang auf Schlüssel umstellen; danach SSH härten.',
    });
  }
  if (facts) {
    if (facts.sshd) {
      const sshd = facts.sshd;
      const issues: string[] = [];
      if (sshd.permitrootlogin === 'yes') issues.push('Root darf sich mit Passwort anmelden');
      if (sshd.passwordauthentication === 'yes') issues.push('Passwort-Login erlaubt');
      if (sshd.permitemptypasswords === 'yes') issues.push('leere Passwörter erlaubt');
      if (sshd.x11forwarding === 'yes') issues.push('X11-Forwarding an');
      if (Number(sshd.maxauthtries) > 4) issues.push(`MaxAuthTries ${sshd.maxauthtries}`);
      const severe = sshd.permitemptypasswords === 'yes' || (sshd.permitrootlogin === 'yes' && sshd.passwordauthentication === 'yes');
      const keyLogin = ctx.system?.authType === 'key';
      add({
        id: 'sshd',
        category: 'access',
        title: 'SSH nur mit Schlüssel, Root ohne Passwort',
        status: issues.length ? (severe ? 'fail' : 'warn') : 'pass',
        severity: 'high',
        detail: issues.length ? issues.join(' · ') : 'Schlüsselanmeldung, keine Root-Passwortanmeldung.',
        fix: issues.length
          ? `Reihenfolge: eigenes Konto + Schlüssel einrichten, Anmeldung testen, erst dann Passwort-Login abschalten. Bestehende Sitzung offen lassen.${keyLogin ? '' : ' Die App nutzt hier noch ein Passwort, also zuerst den Schlüssel hinterlegen.'} Bei sshd zählt der zuerst gelesene Wert, deshalb eine früh sortierte Datei verwenden.`
          : undefined,
        commands: issues.length
          ? [
              "cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'\nPermitRootLogin prohibit-password\nPasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitEmptyPasswords no\nX11Forwarding no\nMaxAuthTries 3\nLoginGraceTime 30\nEOF",
              'grep -i "^Include" /etc/ssh/sshd_config',
              'sshd -t && systemctl reload ssh',
            ]
          : undefined,
      });
    } else {
      add({ id: 'sshd', category: 'access', title: 'SSH nur mit Schlüssel, Root ohne Passwort', status: 'unknown', severity: 'high', detail: `sshd-Konfiguration nur mit root lesbar (angemeldet als ${facts.user}, sudo verlangt ein Passwort).` });
    }

    const extraRoot = facts.uid0.filter((user) => user !== 'root');
    add({
      id: 'uid0',
      category: 'access',
      title: 'Nur root hat UID 0',
      status: extraRoot.length ? 'fail' : 'pass',
      severity: 'critical',
      detail: extraRoot.length ? `Weitere Konten mit Root-Rechten: ${extraRoot.join(', ')}` : 'Kein zusätzliches Konto mit UID 0.',
      commands: extraRoot.length ? ['awk -F: \'$3==0\' /etc/passwd'] : undefined,
    });

    const dockerMembers = (facts.groups.docker ?? []).filter((user) => user !== 'root');
    const nopasswd = facts.nopasswd;
    add({
      id: 'privileges',
      category: 'access',
      title: 'Keine versteckten Root-Rechte',
      status: dockerMembers.length || (nopasswd && nopasswd.length) ? 'warn' : nopasswd === null ? 'unknown' : 'pass',
      severity: 'medium',
      detail: [
        dockerMembers.length ? `Gruppe docker (= praktisch root): ${dockerMembers.join(', ')}` : '',
        nopasswd?.length ? `NOPASSWD-Regeln: ${nopasswd.length}` : '',
        nopasswd === null ? 'sudoers nur mit root lesbar' : '',
      ].filter(Boolean).join(' · ') || `sudo: ${(facts.groups.sudo ?? []).join(', ') || 'niemand'}; keine NOPASSWD-Regeln.`,
      fix: dockerMembers.length || nopasswd?.length ? 'Passwortloses sudo nur für eng begrenzte Automatisierung; docker-Gruppe nur für Administratoren.' : undefined,
    });

    const keys = facts.authorizedKeys.reduce((sum, entry) => sum + entry.count, 0);
    add({
      id: 'authorized-keys',
      category: 'access',
      title: 'Überschaubare SSH-Schlüssel',
      status: keys > 5 ? 'warn' : 'pass',
      severity: 'low',
      detail: facts.authorizedKeys.length ? facts.authorizedKeys.map((entry) => `${entry.file}: ${entry.count}`).join(' · ') : 'Keine authorized_keys gefunden (oder nicht lesbar).',
      fix: keys > 5 ? 'Alte und unbekannte Schlüssel entfernen; jeder Schlüssel ist ein dauerhafter Zugang.' : undefined,
    });
  }

  /* ---------- services ---------- */

  if (facts) {
    const external = facts.listening.filter((entry) => !isLoopback(entry.address));
    const risky = external.filter((entry) => RISKY_PORTS[entry.port] && isWildcard(entry.address));
    const uniqueRisky = [...new Map(risky.map((entry) => [entry.port, entry])).values()];
    add({
      id: 'exposed-services',
      category: 'services',
      title: 'Datenbanken & Verwaltungsdienste nicht offen im Netz',
      status: uniqueRisky.length ? (uniqueRisky.some((entry) => [2375, 6379, 27017, 9200, 11211].includes(entry.port)) ? 'fail' : 'warn') : 'pass',
      severity: 'high',
      detail: uniqueRisky.length
        ? `Lauscht auf allen Adressen: ${uniqueRisky.map((entry) => `${entry.port} (${RISKY_PORTS[entry.port]}${entry.process ? `, ${entry.process}` : ''})`).join(', ')}`
        : 'Keine Datenbank- oder Verwaltungsports auf allen Adressen.',
      fix: uniqueRisky.length ? 'Auf 127.0.0.1 binden, wenn nur lokal gebraucht, sonst per Firewall auf die berechtigten Quellen begrenzen. Docker-Ports umgehen ufw: Port im Compose an 127.0.0.1 binden.' : undefined,
      commands: uniqueRisky.length ? ['ss -lntup', 'ports: ["127.0.0.1:9200:9200"]   # Beispiel docker-compose'] : undefined,
    });

    const expected = (profile.expectedPorts ?? '').split(/[\s,]+/).map(Number).filter(Boolean);
    if (expected.length) {
      const unexpected = [...new Set(external.map((entry) => entry.port))].filter((port) => !expected.includes(port));
      add({
        id: 'expected-ports',
        category: 'services',
        title: 'Nur die im Sollprofil vorgesehenen Ports',
        status: unexpected.length ? 'warn' : 'pass',
        severity: 'medium',
        detail: unexpected.length ? `Nicht vorgesehen: ${unexpected.sort((a, b) => a - b).join(', ')} (erwartet: ${expected.join(', ')})` : `Nur erwartete Ports offen (${expected.join(', ')}).`,
        fix: unexpected.length ? 'Unnötige Dienste abschalten oder das Sollprofil ergänzen, wenn der Port gewollt ist.' : undefined,
      });
    }

    if (facts.docker && facts.docker.length) {
      const privileged = facts.docker.filter((container) => container.privileged);
      const socket = facts.docker.filter((container) => container.mounts.some((mount) => mount.includes('docker.sock')));
      const hostNet = facts.docker.filter((container) => container.network === 'host');
      add({
        id: 'docker-containers',
        category: 'services',
        title: 'Docker-Container ohne Sonderrechte',
        status: privileged.length || socket.length ? 'fail' : hostNet.length ? 'warn' : 'pass',
        severity: 'high',
        detail: [
          privileged.length ? `privileged: ${privileged.map((container) => container.name).join(', ')}` : '',
          socket.length ? `Docker-Socket eingebunden: ${socket.map((container) => container.name).join(', ')}` : '',
          hostNet.length ? `Host-Netzwerk: ${hostNet.map((container) => container.name).join(', ')}` : '',
        ].filter(Boolean).join(' · ') || `${facts.docker.length} Container ohne privileged, Docker-Socket oder Host-Netzwerk.`,
        fix: privileged.length || socket.length ? 'privileged und /var/run/docker.sock nur, wenn zwingend nötig: beides entspricht Root auf dem Gast.' : undefined,
      });
    }
  }

  /* ---------- monitoring ---------- */

  if (facts) {
    const wazuhServer = (facts.docker ?? []).some((container) => /wazuh\.manager|wazuh-manager/.test(container.name));
    const agent = facts.services['wazuh-agent'] === 'active';
    const connected = facts.wazuh?.status ? facts.wazuh.status === 'connected' : agent;
    add({
      id: 'wazuh',
      category: 'monitoring',
      title: 'An Wazuh angebunden',
      status: wazuhServer || (agent && connected) ? 'pass' : agent ? 'warn' : 'fail',
      severity: 'medium',
      detail: wazuhServer
        ? 'Dies ist der Wazuh-Server.'
        : agent
          ? `wazuh-agent ${facts.wazuh?.version ?? ''} läuft${facts.wazuh?.status ? `, Status: ${facts.wazuh.status}` : ''}${facts.wazuh?.manager ? ` · Manager ${facts.wazuh.manager}` : ''}.`
          : facts.wazuh?.installed
            ? `wazuh-agent ${facts.wazuh.version} ist installiert, läuft aber nicht.`
            : 'Kein wazuh-agent: Anmeldungen, Datei- und Konfigurationsänderungen werden nicht zentral erfasst.',
      fix: agent || wazuhServer ? undefined : 'Agent installieren und beim Manager registrieren; FIM für /etc/ssh, /etc/sudoers*, /etc/passwd, /etc/systemd/system, /etc/cron.d aktivieren.',
      commands: agent || wazuhServer ? undefined : ['WAZUH_MANAGER="<wazuh-ip>" apt install wazuh-agent   # nach Einrichten des Wazuh-Repos', 'systemctl enable --now wazuh-agent'],
    });
    add({
      id: 'timesync',
      category: 'monitoring',
      title: 'Uhrzeit synchronisiert',
      status: facts.timeSynced === true ? 'pass' : facts.timeSynced === false ? 'warn' : 'unknown',
      severity: 'low',
      detail: facts.timeSynced === true ? 'Systemzeit ist synchronisiert (wichtig für Logs und Zertifikate).' : facts.timeSynced === false ? 'Systemzeit nicht synchronisiert.' : 'Status nicht ermittelbar.',
      commands: facts.timeSynced === false ? ['timedatectl set-ntp true', 'timedatectl'] : undefined,
    });
    const banning = ['fail2ban', 'crowdsec'].filter((service) => facts.services[service] === 'active');
    const sshOpen = facts.listening.some((entry) => entry.port === 22 && !isLoopback(entry.address));
    if (sshOpen) {
      add({
        id: 'bruteforce',
        category: 'monitoring',
        title: 'Schutz gegen Login-Durchprobieren',
        status: banning.length ? 'pass' : facts.sshd?.passwordauthentication === 'no' ? 'pass' : 'warn',
        severity: 'low',
        detail: banning.length ? `${banning.join(', ')} aktiv.` : facts.sshd?.passwordauthentication === 'no' ? 'Kein Passwort-Login, Durchprobieren ist wirkungslos.' : 'SSH mit Passwort offen, ohne fail2ban/CrowdSec.',
        commands: banning.length || facts.sshd?.passwordauthentication === 'no' ? undefined : ['apt install fail2ban', 'systemctl enable --now fail2ban'],
      });
    }
  }

  /* ---------- backup ---------- */

  const ageDays = ctx.lastBackup ? Math.floor((Date.now() / 1000 - ctx.lastBackup) / 86400) : null;
  add({
    id: 'backup',
    category: 'backup',
    title: 'Aktuelles Backup vorhanden',
    status: ageDays === null ? 'fail' : ageDays <= 2 ? 'pass' : ageDays <= 8 ? 'warn' : 'fail',
    severity: 'critical',
    detail: ageDays === null ? 'Kein Backup auf den Backup-Speichern gefunden.' : `Letztes Backup vor ${ageDays} Tag(en)${ctx.inBackupJob ? '' : ', in keinem Backup-Job enthalten'}.`,
    fix: ageDays === null || ageDays > 2 ? 'Automatischen Backup-Job einrichten (eigene Zugangsdaten, Kopie außerhalb des Produktivsystems) und eine Wiederherstellung testen.' : undefined,
    commands: ageDays === null || ageDays > 2 ? [`pvesh create /cluster/backup --schedule "daily 01:00" --storage <backup-storage> --vmid ${ctx.vmid} --mode snapshot --compress zstd`] : undefined,
  });

  return findings;
}

/* ---------- Proxmox host ---------- */

export interface HostContext {
  version?: string;
  nodes: Array<{ node: string; status?: string; updates: number | null; firewall: boolean }>;
  clusterFirewall: boolean;
  tfaUsers: number;
  token: { id: string; privsep: boolean | null; expire: number | null };
  backupJobs: number;
  offlineBackupStorages: string[];
}

export function hostFindings(ctx: HostContext): Finding[] {
  const findings: Finding[] = [];
  const add = (finding: Finding) => findings.push(finding);
  const major = Number((ctx.version ?? '').split('.')[0]);
  add({
    id: 'pve-version',
    category: 'host',
    title: 'Unterstützte Proxmox-Version',
    status: major >= 9 ? 'pass' : major === 8 ? 'warn' : ctx.version ? 'fail' : 'unknown',
    severity: 'high',
    detail: ctx.version ? `Proxmox VE ${ctx.version}` : 'Version nicht lesbar.',
  });
  const pending = ctx.nodes.filter((node) => (node.updates ?? 0) > 0);
  add({
    id: 'pve-updates',
    category: 'host',
    title: 'Hosts aktuell',
    status: pending.length ? (pending.some((node) => (node.updates ?? 0) > 50) ? 'fail' : 'warn') : 'pass',
    severity: 'high',
    detail: ctx.nodes.map((node) => `${node.node}: ${node.updates === null ? '?' : node.updates} Updates`).join(' · '),
    fix: pending.length ? 'Updates einspielen und nach Kernel-Updates geplant neu starten (Gäste vorher migrieren oder herunterfahren).' : undefined,
    commands: pending.length ? ['apt update', 'apt dist-upgrade'] : undefined,
  });
  add({
    id: 'pve-tfa',
    category: 'host',
    title: 'Zwei-Faktor-Anmeldung für die Weboberfläche',
    status: ctx.tfaUsers > 0 ? 'pass' : 'fail',
    severity: 'high',
    detail: ctx.tfaUsers > 0 ? `${ctx.tfaUsers} Benutzer mit zweitem Faktor.` : 'Kein Benutzer hat einen zweiten Faktor eingerichtet.',
    fix: ctx.tfaUsers > 0 ? undefined : 'Rechenzentrum → Berechtigungen → Zwei-Faktor: TOTP oder WebAuthn für jedes Admin-Konto. Wiederherstellungsschlüssel sicher ablegen.',
  });
  const tokenUser = ctx.token.id.split('!')[0];
  add({
    id: 'pve-token',
    category: 'host',
    title: 'API-Token dieser App mit begrenzten Rechten',
    status: tokenUser === 'root@pam' && ctx.token.privsep === false ? 'fail' : ctx.token.privsep === false ? 'warn' : ctx.token.privsep === null ? 'unknown' : 'pass',
    severity: 'high',
    detail: `${ctx.token.id.replace(/!.*/, '!…')}: ${ctx.token.privsep === false ? 'volle Rechte des Benutzers' : ctx.token.privsep ? 'eigene, getrennte Rechte' : 'unbekannt'}${ctx.token.expire === 0 ? ', läuft nie ab' : ''}. Wer das Token hat, kann alles, was es darf.`,
    fix: 'Eigenen Benutzer und Token nur mit den Rechten anlegen, die die App braucht (Lesen, Power, Firewall-Regeln), mit Ablaufdatum. Rechte je nach Proxmox-Version prüfen.',
    commands: [
      'pveum user add sar-app@pve',
      'pveum role add SARApp --privs "VM.Audit,VM.PowerMgmt,VM.Config.Network,VM.Monitor,Sys.Audit,Datastore.Audit"',
      'pveum acl modify / --users sar-app@pve --roles SARApp',
      'pveum user token add sar-app@pve app --privsep 0 --expire <unix-zeit>',
    ],
  });
  add({ id: 'pve-cluster-fw', category: 'host', title: 'Firewall im Rechenzentrum aktiv', status: ctx.clusterFirewall ? 'pass' : 'fail', severity: 'medium', detail: ctx.clusterFirewall ? 'Eingeschaltet.' : 'Aus: keine Proxmox-Regel wird angewendet.' });
  const nodeFwOff = ctx.nodes.filter((node) => !node.firewall);
  add({
    id: 'pve-node-fw',
    category: 'host',
    title: 'Verwaltung (8006, SSH) auf Admin-Netz begrenzt',
    status: nodeFwOff.length ? 'warn' : 'pass',
    severity: 'high',
    detail: nodeFwOff.length ? `Host-Firewall aus auf ${nodeFwOff.map((node) => node.node).join(', ')}: Weboberfläche und SSH sind aus jedem Netz erreichbar, das den Host erreicht.` : 'Host-Firewall auf allen Nodes aktiv.',
    fix: nodeFwOff.length ? 'Erst Regeln für 8006 und 22 aus dem Admin-Netz anlegen (Rechenzentrum → Firewall), dann die Node-Firewall einschalten. Konsolenzugang bereithalten.' : undefined,
  });
  add({
    id: 'pve-backup-jobs',
    category: 'host',
    title: 'Automatische Backup-Jobs',
    status: ctx.backupJobs > 0 ? 'pass' : 'fail',
    severity: 'critical',
    detail: ctx.backupJobs > 0 ? `${ctx.backupJobs} Backup-Job(s) eingerichtet.` : 'Kein Backup-Job im Rechenzentrum: Backups entstehen nur manuell.',
    fix: ctx.backupJobs > 0 ? undefined : 'Rechenzentrum → Backup → Hinzufügen; Zugangsdaten zum Backup-Ziel getrennt halten und Restore regelmäßig testen.',
  });
  if (ctx.offlineBackupStorages.length) {
    add({ id: 'pve-backup-storage', category: 'host', title: 'Backup-Speicher erreichbar', status: 'warn', severity: 'medium', detail: `Nicht online: ${ctx.offlineBackupStorages.join(', ')}` });
  }
  return findings;
}
