import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { investigationApi, socApi, socOps, type InvestigationFilter } from '@/services/soc';

const key = (...parts: unknown[]) => ['infra', 'soc', ...parts] as const;

export const useSocWindow = (q: string, window: { from: string; to: string }, minLevel?: number) =>
  useQuery({ queryKey: key('window', q, window.from, window.to, minLevel), queryFn: () => socApi.search(q, 24, 'asc', 400, null, minLevel, window), placeholderData: keepPreviousData });

export const useSocDashboard = (hours: number, minLevel?: number, live = true) =>
  useQuery({ queryKey: key('dashboard', hours, minLevel), queryFn: () => socApi.dashboard(hours, minLevel), refetchInterval: live ? 15_000 : false, placeholderData: keepPreviousData });

export const useSocSearch = (q: string, hours: number, order: 'asc' | 'desc', pageSize = 100, minLevel?: number, enabled = true) =>
  useInfiniteQuery({
    queryKey: key('search', q, hours, order, pageSize, minLevel),
    queryFn: ({ pageParam }) => socApi.search(q, hours, order, pageSize, pageParam, minLevel),
    initialPageParam: null as unknown[] | null,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
    enabled,
  });

export const useEventContext = (event: { index: string; id: string } | null) =>
  useQuery({ queryKey: key('context', event?.index, event?.id), queryFn: () => socApi.context(event!.index, event!.id), enabled: !!event, staleTime: 60_000 });

export const useSocHosts = (hours: number) => useQuery({ queryKey: key('hosts', hours), queryFn: () => socApi.hosts(hours), refetchInterval: 60_000, placeholderData: keepPreviousData });
export const useSocHost = (name: string | null, hours: number) => useQuery({ queryKey: key('host', name, hours), queryFn: () => socApi.host(name!, hours), enabled: !!name });
export const useSocUser = (user: string | null, hours: number) => useQuery({ queryKey: key('user', user, hours), queryFn: () => socApi.user(user!, hours), enabled: !!user });
export const useSocLinux = (hours: number, category?: string) => useQuery({ queryKey: key('linux', hours, category), queryFn: () => socApi.linux(hours, category), refetchInterval: 60_000, placeholderData: keepPreviousData });
export const useSocMitre = (hours: number) => useQuery({ queryKey: key('mitre', hours), queryFn: () => socApi.mitre(hours), placeholderData: keepPreviousData });
export const useSocVulnerabilities = (filters: { severity?: string; host?: string; q?: string }) =>
  useQuery({ queryKey: key('vulns', filters), queryFn: () => socApi.vulnerabilities(filters), placeholderData: keepPreviousData });
export const useSocIoc = (value: string | null, hours: number) => useQuery({ queryKey: key('ioc', value, hours), queryFn: () => socApi.ioc(value!, hours), enabled: !!value });
export const useSocTrust = () => useQuery({ queryKey: key('trust'), queryFn: socApi.trust, refetchInterval: 60_000 });
export const useSocFleet = () => useQuery({ queryKey: key('fleet'), queryFn: socApi.fleet, refetchInterval: 60_000, retry: false });

/* ---------- round 2 ---------- */

export const socKeys = {
  findings: ['infra', 'soc', 'findings'] as const,
  incidents: ['infra', 'soc', 'incidents'] as const,
  scans: ['infra', 'soc', 'scans'] as const,
};

export const useFindings = (filters: { host?: string; status?: string; severity?: string; category?: string }) =>
  useQuery({ queryKey: [...socKeys.findings, filters], queryFn: () => socOps.findings(filters), placeholderData: keepPreviousData });
export const useIncidents = (filters: { status?: string; host?: string }) =>
  useQuery({ queryKey: [...socKeys.incidents, filters], queryFn: () => socOps.incidents(filters), placeholderData: keepPreviousData });
export const useIncident = (id: string | null) => useQuery({ queryKey: [...socKeys.incidents, 'one', id], queryFn: () => socOps.incident(id!), enabled: !!id });
export const useScans = (host?: string) => useQuery({ queryKey: [...socKeys.scans, host ?? 'all'], queryFn: () => socOps.scans(host) });
export const useScan = (id: string | null) => useQuery({ queryKey: [...socKeys.scans, 'one', id], queryFn: () => socOps.getScan(id!), enabled: !!id, staleTime: Infinity });
export const useBaseline = (host: string | null, days: number) => useQuery({ queryKey: key('baseline', host, days), queryFn: () => socOps.baseline(host!, days), enabled: !!host });
export const useEventMap = (hours: number, minLevel: number) => useQuery({ queryKey: key('event-map', hours, minLevel), queryFn: () => socOps.eventMap(hours, minLevel), placeholderData: keepPreviousData });
export const useExposure = (hours: number) => useQuery({ queryKey: key('exposure', hours), queryFn: () => socOps.exposure(hours), placeholderData: keepPreviousData });
export const useHealth = () => useQuery({ queryKey: key('health'), queryFn: socOps.health, refetchInterval: 30_000 });

/** Newest serious events (for the dashboard highlight) */
export const useSocSerious = (hours: number, minLevel = 10, live = true) =>
  useQuery({ queryKey: key('serious', hours, minLevel), queryFn: () => socApi.search('', hours, 'desc', 8, null, minLevel), refetchInterval: live ? 30_000 : false, placeholderData: keepPreviousData });

/* ---------- investigation ---------- */

export const useInvestigationEvents = (filter: InvestigationFilter, pageSize = 100) =>
  useInfiniteQuery({
    queryKey: key('inv-events', filter, pageSize),
    queryFn: ({ pageParam }) => investigationApi.events(filter, pageSize, pageParam),
    initialPageParam: null as unknown[] | null,
    getNextPageParam: (last) => last.next,
    placeholderData: keepPreviousData,
  });
export const useInvestigationHosts = (filter: InvestigationFilter) => useQuery({ queryKey: key('inv-hosts', filter), queryFn: () => investigationApi.hosts(filter), placeholderData: keepPreviousData });
export const useRawEvent = (event: { index: string; id: string } | null) =>
  useQuery({ queryKey: key('raw', event?.index, event?.id), queryFn: () => investigationApi.raw(event!.index, event!.id), enabled: !!event, staleTime: Infinity });
export const useClaudeStatus = () => useQuery({ queryKey: key('claude-status'), queryFn: investigationApi.claudeStatus, refetchInterval: (query) => (query.state.data?.loggedIn ? 300_000 : 20_000), retry: false });
