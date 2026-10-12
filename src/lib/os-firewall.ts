import type { GuestOsFirewall, OsChain } from '@/services/network';

export interface OsVerdict {
  /** filtering: something blocks incoming traffic · open: nothing does · unknown: could not read (no root) */
  state: 'filtering' | 'open' | 'unknown';
  tool?: 'ufw' | 'firewalld' | 'nftables' | 'iptables';
  title: string;
  detail: string;
}

const blocks = (policy?: string) => !!policy && /^(drop|reject)$/i.test(policy);

/** Base chains that filter traffic addressed to the guest itself */
export function nftInputChains(report: GuestOsFirewall): OsChain[] {
  return (report.nftables?.tables ?? []).flatMap((table) => table.chains.filter((chain) => chain.type === 'filter' && chain.hook === 'input'));
}

export function iptablesInput(report: GuestOsFirewall): OsChain | undefined {
  return report.iptables?.tables.find((table) => table.name === 'filter')?.chains.find((chain) => chain.name === 'INPUT');
}

export function osFirewallVerdict(report: GuestOsFirewall): OsVerdict {
  const { ufw, firewalld } = report;
  if (ufw?.status === 'active') {
    return {
      state: 'filtering',
      tool: 'ufw',
      title: 'ufw ist aktiv',
      detail: `eingehend Standard ${ufw.defaults?.incoming ?? '?'}, ausgehend ${ufw.defaults?.outgoing ?? '?'} · ${ufw.rules.length} Regeln`,
    };
  }
  if (firewalld?.state === 'running') {
    const zones = firewalld.zones.filter((zone) => zone.active);
    return {
      state: 'filtering',
      tool: 'firewalld',
      title: 'firewalld läuft',
      detail: zones.length ? `aktive Zonen: ${zones.map((zone) => zone.name).join(', ')}` : 'keine aktive Zone gefunden',
    };
  }

  const nftChains = nftInputChains(report);
  const nftBlocking = nftChains.filter((chain) => blocks(chain.policy) || chain.rules.some((rule) => /\b(drop|reject)\b/.test(rule)));
  if (nftBlocking.length) {
    const rules = nftChains.reduce((sum, chain) => sum + chain.rules.length, 0);
    return { state: 'filtering', tool: 'nftables', title: 'nftables filtert eingehend', detail: `${nftBlocking.map((chain) => `${chain.name}: policy ${chain.policy}`).join(', ')} · ${rules} Regeln` };
  }

  const input = iptablesInput(report);
  if (input && (blocks(input.policy) || input.rules.some((rule) => /-j (DROP|REJECT)\b/.test(rule)))) {
    return { state: 'filtering', tool: 'iptables', title: 'iptables filtert eingehend', detail: `INPUT policy ${input.policy ?? '?'} · ${input.rules.length} Regeln` };
  }

  const errors = [ufw?.error, firewalld?.error, report.nftables?.error, report.iptables?.error].filter(Boolean);
  if (errors.length && !nftChains.length && !input) {
    const running = Object.entries(report.services).filter(([, state]) => state === 'active').map(([name]) => name);
    return {
      state: 'unknown',
      title: 'Regeln nur mit root lesbar',
      detail: `Angemeldet als ${report.user}, sudo verlangt ein Passwort.${running.length ? ` Laut systemd läuft: ${running.join(', ')}.` : ''}`,
    };
  }

  return {
    state: 'open',
    title: 'Im Gast wird eingehend nichts gefiltert',
    detail: nftChains.length || input ? 'Die Eingangs-Ketten erlauben alles (Policy accept, keine Sperr-Regeln).' : 'Keine Firewall-Werkzeuge mit Regeln gefunden.',
  };
}

export const isWindowsGuest = (ostype?: string) => !!ostype && /^(win|w2k|wxp|wvista)/.test(ostype);
