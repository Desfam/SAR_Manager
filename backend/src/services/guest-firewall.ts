// Reads the firewall configured inside a Linux guest (ufw, firewalld, nftables, iptables).
// Read-only: the command below only lists state, it never changes anything.

/**
 * Fixed command, no user input. Uses sudo only non-interactively (-n) when the login is not root.
 * Each tool's output is introduced by an @@ marker so the parser can split it.
 */
export const GUEST_FIREWALL_COMMAND = [
  'PATH="$PATH:/usr/sbin:/sbin"',
  'S=""; if [ "$(id -u)" != 0 ]; then if sudo -n true 2>/dev/null; then S="sudo -n"; else S="nosudo"; fi; fi',
  'echo "@@ID $(id -un) $(id -u) ${S:-root}"',
  '[ "$S" = nosudo ] && S=""',
  'echo "@@OS"; (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME")',
  'echo "@@SERVICES"; for s in ufw firewalld nftables netfilter-persistent iptables; do r=$(systemctl is-active "$s" 2>/dev/null); echo "$s ${r:-unknown}"; done',
  'if command -v ufw >/dev/null 2>&1; then echo "@@UFW"; $S ufw status verbose 2>&1 | head -n 500; fi',
  'if command -v firewall-cmd >/dev/null 2>&1; then echo "@@FIREWALLD"; $S firewall-cmd --state 2>&1; for z in $($S firewall-cmd --get-active-zones 2>/dev/null | grep -v "^ "); do $S firewall-cmd --zone="$z" --list-all 2>&1; done; fi',
  'if command -v nft >/dev/null 2>&1; then echo "@@NFT"; $S nft list ruleset 2>&1 | head -n 3000; fi',
  'if command -v iptables-save >/dev/null 2>&1; then echo "@@IPTABLES"; $S iptables-save 2>&1 | head -n 3000; fi',
  'echo "@@END"',
].join('; ');

export interface UfwRule {
  to: string;
  action: string;
  from: string;
  comment?: string;
}

export interface FirewalldZone {
  name: string;
  active: boolean;
  target?: string;
  interfaces: string[];
  sources: string[];
  services: string[];
  ports: string[];
  richRules: string[];
}

export interface Chain {
  name: string;
  /** nftables chain type: filter, nat, route */
  type?: string;
  hook?: string;
  policy?: string;
  rules: string[];
}

export interface RuleTable {
  family?: string;
  name: string;
  chains: Chain[];
}

export interface GuestFirewallReport {
  user: string;
  root: boolean;
  /** "root", "sudo -n" or "nosudo" (not root and no passwordless sudo: rule lists will be empty or denied) */
  privilege: string;
  os?: string;
  services: Record<string, string>;
  ufw?: { status: string; defaults?: { incoming?: string; outgoing?: string; routed?: string }; logging?: string; rules: UfwRule[]; error?: string };
  firewalld?: { state: string; zones: FirewalldZone[]; error?: string };
  nftables?: { tables: RuleTable[]; error?: string };
  iptables?: { tables: RuleTable[]; error?: string };
  raw: Record<string, string>;
}

const DENIED = /permission denied|operation not permitted|must be root|need to be root|you need to be root|not permitted|are you root/i;

function sections(stdout: string) {
  const result: Record<string, string> = {};
  let current = '';
  let id = '';
  for (const line of stdout.split('\n')) {
    const marker = /^@@(\w+)(?: (.*))?$/.exec(line);
    if (marker) {
      current = marker[1];
      if (current === 'ID') id = marker[2] ?? '';
      result[current] = '';
      continue;
    }
    if (current) result[current] += `${line}\n`;
  }
  return { result, id };
}

function parseUfw(text: string): GuestFirewallReport['ufw'] {
  const status = /Status:\s*(\w+)/.exec(text)?.[1] ?? 'unknown';
  const defaultsLine = /Default:\s*(.+)/.exec(text)?.[1] ?? '';
  const defaults: { incoming?: string; outgoing?: string; routed?: string } = {};
  for (const part of defaultsLine.split(',')) {
    const match = /(\w+)\s*\((\w+)\)/.exec(part.trim());
    if (match) defaults[match[2] as 'incoming' | 'outgoing' | 'routed'] = match[1];
  }
  const logging = /Logging:\s*(.+)/.exec(text)?.[1]?.trim();
  const rules: UfwRule[] = [];
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^-{2,}\s+-{2,}/.test(line.trim()));
  if (start >= 0) {
    for (const line of lines.slice(start + 1)) {
      if (!line.trim()) continue;
      const [main, ...commentParts] = line.split(/\s+#\s?/);
      const cols = main.trim().split(/\s{2,}/);
      if (cols.length < 3) continue;
      rules.push({ to: cols[0], action: cols[1], from: cols.slice(2).join(' '), comment: commentParts.join(' # ') || undefined });
    }
  }
  const error = status === 'unknown' && DENIED.test(text) ? text.trim().split('\n')[0] : undefined;
  return { status, defaults: defaultsLine ? defaults : undefined, logging, rules, error };
}

function parseFirewalld(text: string): GuestFirewallReport['firewalld'] {
  const lines = text.split('\n');
  const state = (lines[0] ?? '').trim() || 'unknown';
  const zones: FirewalldZone[] = [];
  let zone: FirewalldZone | null = null;
  const list = (value: string) => value.trim().split(/\s+/).filter(Boolean);
  for (const line of lines.slice(1)) {
    const header = /^(\S+)(\s+\(([^)]*)\))?\s*$/.exec(line);
    if (header && !line.startsWith(' ')) {
      zone = { name: header[1], active: (header[3] ?? '').includes('active'), interfaces: [], sources: [], services: [], ports: [], richRules: [] };
      zones.push(zone);
      continue;
    }
    if (!zone) continue;
    const field = /^\s+([\w-]+):\s*(.*)$/.exec(line);
    if (field) {
      const [, key, value] = field;
      if (key === 'target') zone.target = value.trim();
      else if (key === 'interfaces') zone.interfaces = list(value);
      else if (key === 'sources') zone.sources = list(value);
      else if (key === 'services') zone.services = list(value);
      else if (key === 'ports') zone.ports = list(value);
      else if (key === 'rich rules' || key === 'rich') zone.richRules = value.trim() ? [value.trim()] : [];
    } else if (line.trim().startsWith('rule ')) {
      zone.richRules.push(line.trim());
    }
  }
  return { state, zones, error: DENIED.test(state) ? state : undefined };
}

function parseNft(text: string): GuestFirewallReport['nftables'] {
  const tables: RuleTable[] = [];
  let table: RuleTable | null = null;
  let chain: Chain | null = null;
  let depth = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const tableMatch = /^table (\S+) (\S+) \{$/.exec(line);
    if (tableMatch) {
      table = { family: tableMatch[1], name: tableMatch[2], chains: [] };
      tables.push(table);
      depth = 1;
      continue;
    }
    const chainMatch = /^chain (\S+) \{$/.exec(line);
    if (chainMatch && table) {
      chain = { name: chainMatch[1], rules: [] };
      table.chains.push(chain);
      depth = 2;
      continue;
    }
    if (line.endsWith('{')) {
      depth += 1; // sets, maps, flowtables
      continue;
    }
    if (line === '}') {
      depth -= 1;
      if (depth < 2) chain = null;
      if (depth < 1) table = null;
      continue;
    }
    if (chain && depth === 2) {
      const hook = /type (\w+) hook (\w+) priority [^;]+;(?: policy (\w+);)?/.exec(line);
      if (hook) {
        chain.type = hook[1];
        chain.hook = hook[2];
        chain.policy = hook[3] ?? 'accept';
      } else {
        chain.rules.push(line);
      }
    }
  }
  const error = tables.length === 0 && DENIED.test(text) ? text.trim().split('\n')[0] : undefined;
  return { tables, error };
}

function parseIptables(text: string): GuestFirewallReport['iptables'] {
  const tables: RuleTable[] = [];
  let table: RuleTable | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('*')) {
      table = { name: line.slice(1), chains: [] };
      tables.push(table);
    } else if (line.startsWith(':') && table) {
      const [name, policy] = line.slice(1).split(/\s+/);
      table.chains.push({ name, policy: policy === '-' ? undefined : policy, rules: [] });
    } else if (line.startsWith('-A ') && table) {
      const name = line.split(/\s+/)[1];
      let chain = table.chains.find((entry) => entry.name === name);
      if (!chain) {
        chain = { name, rules: [] };
        table.chains.push(chain);
      }
      chain.rules.push(line.slice(3 + name.length).trim());
    }
  }
  const error = tables.length === 0 && DENIED.test(text) ? text.trim().split('\n')[0] : undefined;
  return { tables, error };
}

export function parseGuestFirewall(stdout: string): GuestFirewallReport {
  const { result, id } = sections(stdout);
  const [user = '', uid = '', privilege = ''] = id.split(' ');
  const services: Record<string, string> = {};
  for (const line of (result.SERVICES ?? '').split('\n')) {
    const [name, state] = line.trim().split(/\s+/);
    if (name && state) services[name] = state;
  }
  const raw: Record<string, string> = {};
  for (const key of ['UFW', 'FIREWALLD', 'NFT', 'IPTABLES']) {
    if (result[key] !== undefined) raw[key.toLowerCase()] = result[key].slice(0, 200_000);
  }
  return {
    user,
    root: uid === '0',
    privilege: privilege === 'sudo' ? 'sudo -n' : privilege,
    os: result.OS?.trim() || undefined,
    services,
    ufw: result.UFW !== undefined ? parseUfw(result.UFW) : undefined,
    firewalld: result.FIREWALLD !== undefined ? parseFirewalld(result.FIREWALLD) : undefined,
    nftables: result.NFT !== undefined ? parseNft(result.NFT) : undefined,
    iptables: result.IPTABLES !== undefined ? parseIptables(result.IPTABLES) : undefined,
    raw,
  };
}
