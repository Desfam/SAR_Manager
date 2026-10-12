import { useQuery } from '@tanstack/react-query';
import { hardeningApi, systemApi } from '@/services/hardening';

export const hardeningKeys = { audit: ['infra', 'hardening-audit'] as const };

/** Last audit plus progress; polled while an audit runs */
export function useHardeningAudit() {
  return useQuery({
    queryKey: hardeningKeys.audit,
    queryFn: hardeningApi.state,
    refetchInterval: (query) => (query.state.data?.running ? 1500 : false),
  });
}

export function useSystemFacts(connectionId: string | undefined) {
  return useQuery({
    queryKey: ['infra', 'system-facts', connectionId ?? ''],
    queryFn: () => systemApi.facts(connectionId!),
    enabled: !!connectionId,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
    retry: false,
  });
}

export function useWazuhJob(jobId: string | null) {
  return useQuery({
    queryKey: ['infra', 'wazuh-job', jobId ?? ''],
    queryFn: () => systemApi.wazuhJob(jobId!),
    enabled: !!jobId,
    refetchInterval: (query) => (query.state.data?.status === 'running' || !query.state.data ? 1000 : false),
  });
}
