import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { wazuhApi, type WazuhFilters } from '@/services/wazuh';

export const wazuhKeys = {
  status: ['infra', 'wazuh', 'status'] as const,
  summary: (filters: WazuhFilters) => ['infra', 'wazuh', 'summary', filters] as const,
  events: (filters: WazuhFilters) => ['infra', 'wazuh', 'events', filters] as const,
};

export function useWazuhStatus() {
  return useQuery({ queryKey: wazuhKeys.status, queryFn: wazuhApi.status, refetchInterval: 60_000, retry: false });
}

export function useWazuhSummary(filters: WazuhFilters, enabled = true) {
  return useQuery({ queryKey: wazuhKeys.summary(filters), queryFn: () => wazuhApi.summary(filters), refetchInterval: 30_000, placeholderData: keepPreviousData, enabled });
}

/** Newest events first, loaded page by page with the indexer's search_after cursor */
export function useWazuhEvents(filters: WazuhFilters, pageSize = 100, enabled = true) {
  return useInfiniteQuery({
    queryKey: wazuhKeys.events(filters),
    queryFn: ({ pageParam }) => wazuhApi.events(filters, pageSize, pageParam),
    initialPageParam: null as unknown[] | null,
    getNextPageParam: (last) => last.next,
    refetchInterval: 30_000,
    placeholderData: keepPreviousData,
    enabled,
  });
}
