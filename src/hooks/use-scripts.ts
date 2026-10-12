import { useQuery } from '@tanstack/react-query';
import { scriptsApi } from '@/services/scripts';

export const scriptKeys = {
  // shared with useScripts() in use-infrastructure (dashboard)
  list: ['infra', 'scripts'] as const,
  runs: (scriptId?: string) => ['infra', 'script-runs', scriptId ?? 'all'] as const,
  run: (runId: string) => ['infra', 'script-run', runId] as const,
};

export function useScriptLibrary() {
  return useQuery({ queryKey: scriptKeys.list, queryFn: scriptsApi.list });
}

export function useScriptRuns(scriptId?: string) {
  return useQuery({
    queryKey: scriptKeys.runs(scriptId),
    queryFn: () => scriptsApi.runs(scriptId),
    refetchInterval: (query) => (query.state.data?.some((run) => !run.finishedAt) ? 2000 : 30_000),
  });
}

/** A run with live output: polled every second until it is finished */
export function useScriptRun(runId: string | null) {
  return useQuery({
    queryKey: scriptKeys.run(runId ?? ''),
    queryFn: () => scriptsApi.getRun(runId!),
    enabled: !!runId,
    refetchInterval: (query) => (query.state.data && !query.state.data.finishedAt ? 1000 : false),
  });
}
