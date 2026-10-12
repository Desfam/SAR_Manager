// Address classification for the network map

export type PeerScope = 'local' | 'internet' | 'loopback';

function toNumber(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function inRange(ip: number, base: string, bits: number) {
  const start = toNumber(base)!;
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  return (ip & mask) >>> 0 === (start & mask) >>> 0;
}

/** RFC 1918 private ranges, CGNAT, link-local and loopback count as local; everything else is internet. */
export function scopeOf(ip: string): PeerScope {
  if (ip === '::1' || ip.startsWith('127.')) return 'loopback';
  if (ip.includes(':')) {
    const lower = ip.toLowerCase();
    return lower.startsWith('fe80') || lower.startsWith('fc') || lower.startsWith('fd') ? 'local' : 'internet';
  }
  const value = toNumber(ip);
  if (value === null) return 'local';
  const local = [
    ['10.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
    ['169.254.0.0', 16],
  ] as const;
  return local.some(([base, bits]) => inRange(value, base, bits)) ? 'local' : 'internet';
}

/** Well-known ports for labels and for matching listening ports against firewall macros. */
export const PORT_NAMES: Record<number, string> = {
  20: 'FTP-Data', 21: 'FTP', 22: 'SSH', 25: 'SMTP', 53: 'DNS', 67: 'DHCP', 68: 'DHCP', 80: 'HTTP', 110: 'POP3', 123: 'NTP', 137: 'NetBIOS', 139: 'SMB',
  143: 'IMAP', 161: 'SNMP', 389: 'LDAP', 443: 'HTTPS', 445: 'SMB', 465: 'SMTPS', 514: 'Syslog', 587: 'Submission', 636: 'LDAPS', 993: 'IMAPS',
  995: 'POP3S', 1433: 'MSSQL', 1514: 'Wazuh', 1515: 'Wazuh', 3000: 'Web-App', 3001: 'Web-App', 3306: 'MySQL', 3389: 'RDP', 5432: 'PostgreSQL',
  5900: 'VNC', 6379: 'Redis', 8006: 'Proxmox', 8080: 'HTTP-Alt', 8443: 'HTTPS-Alt', 9100: 'node_exporter', 9200: 'Elasticsearch', 55000: 'Wazuh-API',
};

/** Ports covered by the common Proxmox firewall macros. */
export const MACRO_PORTS: Record<string, number[]> = {
  SSH: [22], HTTP: [80], HTTPS: [443], Web: [80, 443], RDP: [3389], DNS: [53], SMB: [139, 445], MySQL: [3306], MSSQL: [1433],
  PostgreSQL: [5432], NTP: [123], SMTP: [25], SMTPS: [465], IMAP: [143], IMAPS: [993], POP3: [110], POP3S: [995], LDAP: [389], LDAPS: [636],
  FTP: [21], VNC: [5900], Syslog: [514], SNMP: [161], DHCPfwd: [67, 68], Rsync: [873], Telnet: [23], Ping: [],
};

/** Whether a firewall rule applies to a destination port; 'unknown' for macros without a port table. */
export function ruleCoversPort(rule: { macro?: string; dport?: string; proto?: string }, port: number): boolean | 'unknown' {
  if (rule.macro) {
    const ports = MACRO_PORTS[rule.macro];
    return ports ? ports.includes(port) : 'unknown';
  }
  if (rule.proto === 'icmp' || rule.proto === 'ipv6-icmp') return false;
  if (!rule.dport) return true;
  return rule.dport.split(',').some((part) => {
    const [from, to] = part.split(':').map(Number);
    return to ? port >= from && port <= to : port === from;
  });
}
