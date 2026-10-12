// Facts from inside a Linux guest for the security audit. Read-only: the command only lists state.
// Uses sudo non-interactively (-n) when the login is not root; without it some facts stay unknown.

export const GUEST_AUDIT_COMMAND = [
  'PATH="$PATH:/usr/sbin:/sbin"',
  'S=""; if [ "$(id -u)" != 0 ]; then if sudo -n true 2>/dev/null; then S="sudo -n"; else S="nosudo"; fi; fi',
  'echo "@@ID $(id -un) $(id -u) ${S:-root}"',
  '[ "$S" = nosudo ] && S=""',
  'echo "@@OS"; grep -E "^(ID|VERSION_ID|VERSION_CODENAME|PRETTY_NAME)=" /etc/os-release 2>/dev/null',
  'echo "@@KERNEL"; uname -r',
  'echo "@@VIRT"; systemd-detect-virt 2>/dev/null',
  'echo "@@UPGRADABLE"; apt list --upgradable 2>/dev/null | tail -n +2 | head -n 800',
  'echo "@@APTAGE"; stat -c %Y /var/lib/apt/lists 2>/dev/null; date +%s',
  'echo "@@REBOOT"; [ -f /var/run/reboot-required ] && echo yes',
  'echo "@@UNATTENDED"; dpkg-query -W -f="\\${Status}\\n" unattended-upgrades 2>/dev/null; grep -hE "Unattended-Upgrade|Update-Package-Lists" /etc/apt/apt.conf.d/20auto-upgrades /etc/apt/apt.conf.d/10periodic 2>/dev/null; echo "timer $(systemctl is-active apt-daily-upgrade.timer 2>/dev/null)"',
  'echo "@@SSHD"; $S sshd -T 2>/dev/null | grep -Ei "^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication|permitemptypasswords|x11forwarding|allowagentforwarding|maxauthtries|pubkeyauthentication|allowusers|allowgroups|port|logingracetime) "',
  'echo "@@UID0"; awk -F: \'$3==0{print $1}\' /etc/passwd',
  'echo "@@LOGINUSERS"; awk -F: \'($3==0 || $3>=1000) && $7 !~ /(nologin|false)$/ {print $1}\' /etc/passwd',
  'echo "@@GROUPS"; getent group sudo wheel docker admin 2>/dev/null',
  'echo "@@NOPASSWD"; $S grep -rhE "^[^#]*NOPASSWD" /etc/sudoers /etc/sudoers.d 2>/dev/null | head -n 30',
  'echo "@@AUTHKEYS"; for f in /root/.ssh/authorized_keys /home/*/.ssh/authorized_keys; do $S test -f "$f" && echo "$f $($S grep -cE "^(ssh-|ecdsa-|sk-)" "$f" 2>/dev/null)"; done',
  'echo "@@LISTEN"; $S ss -lntupH 2>/dev/null | head -n 200',
  'echo "@@FAILED"; systemctl --failed --no-legend --plain 2>/dev/null | awk \'{print $1}\'',
  'echo "@@DISK"; df -P -x tmpfs -x devtmpfs -x overlay -x squashfs -x fuse.lxcfs 2>/dev/null | tail -n +2',
  'echo "@@INODES"; df -Pi -x tmpfs -x devtmpfs -x overlay -x squashfs -x fuse.lxcfs 2>/dev/null | tail -n +2',
  'echo "@@SERVICES"; for s in wazuh-agent fail2ban crowdsec auditd apparmor docker podman chrony systemd-timesyncd ntp ntpsec; do echo "$s $(systemctl is-active $s 2>/dev/null)"; done',
  'echo "@@TIMESYNC"; timedatectl show -p NTPSynchronized --value 2>/dev/null',
  'echo "@@SYSCTL"; for k in kernel.randomize_va_space kernel.kptr_restrict kernel.dmesg_restrict fs.protected_hardlinks fs.protected_symlinks net.ipv4.ip_forward; do echo "$k $(sysctl -n $k 2>/dev/null)"; done',
  'echo "@@APPARMOR"; cat /sys/module/apparmor/parameters/enabled 2>/dev/null',
  'echo "@@DOCKER"; if command -v docker >/dev/null 2>&1; then $S docker ps -q 2>/dev/null | head -n 50 | xargs -r $S docker inspect --format "{{.Name}}|{{.HostConfig.Privileged}}|{{.HostConfig.NetworkMode}}|{{range .Mounts}}{{.Source}};{{end}}|{{.Config.User}}" 2>/dev/null; fi',
  'echo "@@HOST"; hostname -f 2>/dev/null || hostname; dpkg --print-architecture 2>/dev/null || uname -m; nproc 2>/dev/null; awk \'/MemTotal/{print $2}\' /proc/meminfo; cut -d" " -f1 /proc/uptime',
  'echo "@@WAZUH"; echo "version $(dpkg-query -W -f=\'${Version}\' wazuh-agent 2>/dev/null)"; echo "manager $($S grep -oE "<address>[^<]+" /var/ossec/etc/ossec.conf 2>/dev/null | head -n1 | cut -d">" -f2)"; $S grep -E "^(status|last_keepalive)=" /var/ossec/var/run/wazuh-agentd.state 2>/dev/null',
  'echo "@@END"',
].join('; ');

export interface GuestFacts {
  user: string;
  root: boolean;
  privilege: string; // root | sudo -n | nosudo
  os: { id?: string; version?: string; codename?: string; pretty?: string };
  kernel?: string;
  virt?: string;
  upgradable: Array<{ name: string; security: boolean }>;
  aptListsAgeDays?: number;
  rebootRequired: boolean;
  unattended: { installed: boolean; enabled: boolean | null; timer?: string };
  sshd: Record<string, string> | null; // null: not readable (no root)
  uid0: string[];
  loginUsers: string[];
  groups: Record<string, string[]>;
  nopasswd: string[] | null;
  authorizedKeys: Array<{ file: string; count: number }>;
  listening: Array<{ proto: string; address: string; port: number; process?: string }>;
  failedUnits: string[];
  disks: Array<{ mount: string; usedPercent: number }>;
  inodes: Array<{ mount: string; usedPercent: number }>;
  services: Record<string, string>;
  timeSynced: boolean | null;
  sysctl: Record<string, string>;
  apparmor: boolean | null;
  docker: Array<{ name: string; privileged: boolean; network: string; mounts: string[]; user: string }> | null;
  host: { hostname?: string; arch?: string; cpus?: number; memoryKb?: number; uptimeSeconds?: number };
  /** installed: package present · status/lastKeepalive from the agent state file (root only) */
  wazuh: { installed: boolean; version?: string; manager?: string; status?: string; lastKeepalive?: string };
}

function sections(stdout: string) {
  const result: Record<string, string[]> = {};
  let current = '';
  let id = '';
  for (const line of stdout.split('\n')) {
    const marker = /^@@(\w+)(?: (.*))?$/.exec(line);
    if (marker) {
      current = marker[1];
      if (current === 'ID') id = marker[2] ?? '';
      result[current] = [];
      continue;
    }
    if (current && line.trim()) result[current].push(line);
  }
  return { result, id };
}

const percent = (value: string) => Number(value.replace('%', '')) || 0;

export function parseGuestFacts(stdout: string): GuestFacts {
  const { result: s, id } = sections(stdout);
  const [user = '', uid = '', privilege = 'root'] = id.split(' ');
  const osPairs = Object.fromEntries((s.OS ?? []).map((line) => {
    const [key, ...rest] = line.split('=');
    return [key, rest.join('=').replace(/^"|"$/g, '')];
  }));
  const aptAge = s.APTAGE ?? [];
  const groups: Record<string, string[]> = {};
  for (const line of s.GROUPS ?? []) {
    const [name, , , members = ''] = line.split(':');
    groups[name] = members.split(',').filter(Boolean);
  }
  const sshdLines = s.SSHD ?? [];
  const unattendedLines = s.UNATTENDED ?? [];
  const enabledLine = unattendedLines.find((line) => /Unattended-Upgrade/.test(line));

  const hostLines = s.HOST ?? [];
  const wazuhLines = s.WAZUH ?? [];
  const wazuhValue = (prefix: string) => wazuhLines.find((line) => line.startsWith(prefix))?.slice(prefix.length).replace(/^'|'$/g, '').trim() || undefined;

  return {
    host: {
      hostname: hostLines[0],
      arch: hostLines[1],
      cpus: Number(hostLines[2]) || undefined,
      memoryKb: Number(hostLines[3]) || undefined,
      uptimeSeconds: Math.round(Number(hostLines[4])) || undefined,
    },
    wazuh: {
      installed: !!wazuhValue('version '),
      version: wazuhValue('version '),
      manager: wazuhValue('manager '),
      status: wazuhValue('status='),
      lastKeepalive: wazuhValue('last_keepalive='),
    },
    user,
    root: uid === '0',
    privilege: privilege === 'sudo' ? 'sudo -n' : privilege,
    os: { id: osPairs.ID, version: osPairs.VERSION_ID, codename: osPairs.VERSION_CODENAME, pretty: osPairs.PRETTY_NAME },
    kernel: s.KERNEL?.[0],
    virt: s.VIRT?.[0],
    upgradable: (s.UPGRADABLE ?? []).filter((line) => line.includes('/')).map((line) => ({ name: line.split('/')[0], security: /-security|security\./.test(line) })),
    aptListsAgeDays: aptAge.length === 2 ? Math.round((Number(aptAge[1]) - Number(aptAge[0])) / 86400) : undefined,
    rebootRequired: (s.REBOOT ?? []).includes('yes'),
    unattended: {
      installed: unattendedLines.some((line) => /install ok installed/.test(line)),
      enabled: enabledLine ? /"1"/.test(enabledLine) : null,
      timer: unattendedLines.find((line) => line.startsWith('timer '))?.slice(6),
    },
    sshd: sshdLines.length ? Object.fromEntries(sshdLines.map((line) => {
      const [key, ...rest] = line.trim().split(/\s+/);
      return [key.toLowerCase(), rest.join(' ')];
    })) : null,
    uid0: s.UID0 ?? [],
    loginUsers: s.LOGINUSERS ?? [],
    groups,
    nopasswd: privilege === 'nosudo' ? null : (s.NOPASSWD ?? []).map((line) => line.trim()),
    authorizedKeys: (s.AUTHKEYS ?? []).map((line) => {
      const [file, count] = line.split(' ');
      return { file, count: Number(count) || 0 };
    }),
    listening: (s.LISTEN ?? []).map((line) => {
      const cols = line.trim().split(/\s+/);
      const local = cols[4] ?? '';
      const match = /^(.*):(\d+)$/.exec(local);
      const processName = /users:\(\("([^"]+)"/.exec(line)?.[1];
      return { proto: cols[0], address: (match?.[1] ?? local).replace(/^\[|\]$/g, '').replace(/%\S+$/, ''), port: Number(match?.[2] ?? 0), process: processName };
    }).filter((entry) => entry.port > 0),
    failedUnits: s.FAILED ?? [],
    disks: (s.DISK ?? []).map((line) => {
      const cols = line.trim().split(/\s+/);
      return { mount: cols[5], usedPercent: percent(cols[4] ?? '0') };
    }).filter((entry) => entry.mount),
    inodes: (s.INODES ?? []).map((line) => {
      const cols = line.trim().split(/\s+/);
      return { mount: cols[5], usedPercent: percent(cols[4] ?? '0') };
    }).filter((entry) => entry.mount && entry.usedPercent >= 0),
    services: Object.fromEntries((s.SERVICES ?? []).map((line) => {
      const [name, state = ''] = line.trim().split(/\s+/);
      return [name, state];
    })),
    timeSynced: s.TIMESYNC?.[0] === 'yes' ? true : s.TIMESYNC?.[0] === 'no' ? false : null,
    sysctl: Object.fromEntries((s.SYSCTL ?? []).map((line) => {
      const [key, value = ''] = line.trim().split(/\s+/);
      return [key, value];
    }).filter(([, value]) => value !== '')),
    apparmor: s.APPARMOR?.[0] === 'Y' ? true : s.APPARMOR?.[0] === 'N' ? false : null,
    docker: s.DOCKER === undefined ? null : s.DOCKER.map((line) => {
      const [name, privileged, network, mounts = '', containerUser = ''] = line.split('|');
      return { name: name.replace(/^\//, ''), privileged: privileged === 'true', network, mounts: mounts.split(';').filter(Boolean), user: containerUser };
    }),
  };
}
