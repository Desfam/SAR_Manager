import { useQuery } from '@tanstack/react-query';
import { networkApi, scanApi, type GuestNetwork } from '@/services/network';
import { getProxmoxTarget, type Connection } from '@/hooks/use-infrastructure';

export const networkKeys = {
  guests: ['infra', 'proxmox', 'network-guests'] as const,
  netstat: (id: string) => ['infra', 'netstat', id] as const,
  firewallStatus: ['infra', 'proxmox', 'firewall-status'] as const,
  macros: ['infra', 'proxmox', 'firewall-macros'] as const,
  guestFirewall: (node: string, vmid: number) => ['infra', 'proxmox', 'guest-firewall', node, vmid] as const,
  firewallLog: (node: string, vmid: number) => ['infra', 'proxmox', 'firewall-log', node, vmid] as const,
  osFirewall: (id: string) => ['infra', 'os-firewall', id] as const,
  scan: ['infra', 'lan-scan'] as const,
  interfaces: ['infra', 'lan-interfaces'] as const,
};

export function useGuestNetworks() {
  return useQuery({ queryKey: networkKeys.guests, queryFn: () => networkApi.guests(getProxmoxTarget()), refetchInterval: 60_000 });
}

export function useNetstat(connectionId: string | undefined, refetchInterval = 30_000) {
  return useQuery({
    queryKey: networkKeys.netstat(connectionId ?? ''),
    queryFn: () => networkApi.netstat(connectionId!),
    enabled: !!connectionId,
    refetchInterval,
    retry: false,
  });
}

export function useFirewallStatus() {
  return useQuery({ queryKey: networkKeys.firewallStatus, queryFn: () => networkApi.firewallStatus(getProxmoxTarget()), refetchInterval: 60_000 });
}

export function useFirewallMacros() {
  return useQuery({ queryKey: networkKeys.macros, queryFn: () => networkApi.macros(getProxmoxTarget()), staleTime: Infinity });
}

export function useGuestFirewall(guest: { node: string; type: string; vmid: number } | null) {
  return useQuery({
    queryKey: networkKeys.guestFirewall(guest?.node ?? '', guest?.vmid ?? 0),
    queryFn: () => networkApi.guestFirewall(guest!, getProxmoxTarget()),
    enabled: !!guest,
    refetchInterval: 30_000,
  });
}

export function useFirewallLog(guest: { node: string; type: string; vmid: number } | null, enabled = true) {
  return useQuery({
    queryKey: networkKeys.firewallLog(guest?.node ?? '', guest?.vmid ?? 0),
    queryFn: () => networkApi.firewallLog(guest!, 100, getProxmoxTarget()),
    enabled: !!guest && enabled,
    refetchInterval: 15_000,
  });
}

/** Firewall inside the guest OS, read over SSH. Slow (one SSH login), so it is not polled often. */
export function useGuestOsFirewall(connectionId: string | undefined) {
  return useQuery({
    queryKey: networkKeys.osFirewall(connectionId ?? ''),
    queryFn: () => networkApi.guestOsFirewall(connectionId!),
    enabled: !!connectionId,
    staleTime: 60_000,
    refetchInterval: 120_000,
    retry: false,
  });
}

/** nmap scan state: polled quickly while a scan runs */
export function useLanScan() {
  return useQuery({
    queryKey: networkKeys.scan,
    queryFn: scanApi.state,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });
}

export function useLanInterfaces() {
  return useQuery({ queryKey: networkKeys.interfaces, queryFn: scanApi.interfaces, staleTime: 5 * 60_000 });
}

/** The SSH system that belongs to a guest: same IP, otherwise the same name. */
export function systemForGuest(guest: GuestNetwork, connections: Connection[]): Connection | undefined {
  const ssh = connections.filter((connection) => connection.type !== 'rdp');
  return (
    ssh.find((connection) => guest.ips.includes(connection.host)) ??
    ssh.find((connection) => !!guest.name && connection.name.toLowerCase() === guest.name.toLowerCase())
  );
}

export const guestId = (guest: { node: string; vmid: number }) => `${guest.node}/${guest.vmid}`;
