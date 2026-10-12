import { useQuery } from '@tanstack/react-query';
import { proxmoxDetails, type Timeframe } from '@/services/proxmox';
import { getProxmoxTarget } from '@/hooks/use-infrastructure';

interface GuestRef {
  node: string;
  type: 'qemu' | 'lxc';
  vmid: number;
}

export function useGuestStatus(guest: GuestRef | null) {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'guest', guest?.node, guest?.vmid],
    queryFn: () => proxmoxDetails.guestStatus(guest!.node, guest!.type, guest!.vmid, getProxmoxTarget()),
    enabled: !!guest,
    refetchInterval: 5_000,
  });
}

export function useGuestRrd(guest: GuestRef | null, timeframe: Timeframe) {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'guest-rrd', guest?.node, guest?.vmid, timeframe],
    queryFn: () => proxmoxDetails.guestRrd(guest!.node, guest!.type, guest!.vmid, timeframe, getProxmoxTarget()),
    enabled: !!guest,
    refetchInterval: 60_000,
  });
}

export function useNodeStatus(node: string | null) {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'node', node],
    queryFn: () => proxmoxDetails.nodeStatus(node!, getProxmoxTarget()),
    enabled: !!node,
    refetchInterval: 10_000,
  });
}

export function useNodeRrd(node: string | null, timeframe: Timeframe) {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'node-rrd', node, timeframe],
    queryFn: () => proxmoxDetails.nodeRrd(node!, timeframe, getProxmoxTarget()),
    enabled: !!node,
    refetchInterval: 60_000,
  });
}

export function useStorage() {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'storage'],
    queryFn: () => proxmoxDetails.storage(getProxmoxTarget()),
    refetchInterval: 60_000,
  });
}

export function useNodeUpdates(node: string | null) {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'node-updates', node],
    queryFn: () => proxmoxDetails.nodeUpdates(node!, getProxmoxTarget()),
    enabled: !!node,
    staleTime: 5 * 60_000,
  });
}

export function useClusterStatus() {
  return useQuery({
    queryKey: ['infra', 'proxmox', 'cluster'],
    queryFn: () => proxmoxDetails.cluster(getProxmoxTarget()),
    refetchInterval: 30_000,
  });
}
