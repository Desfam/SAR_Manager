import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Server,
  Monitor,
  Bot,
  AlertTriangle,
  Activity,
  Clock,
  Loader2,
  HardDrive,
  Cpu,
  Database,
  RefreshCw,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { connectionAPI, auditAPI, alertsAPI, agentsAPI, systemAPI, AgentSummary } from '@/services/api';
import { cn } from '@/lib/utils';
import { SSHConnection, RDPConnection, AuditLog } from '@/types/connection';
import { VulnerabilityOverview } from '@/components/widgets/VulnerabilityOverview';

// ── Stat Card ────────────────────────────────────────────────────────────────
const StatCard: React.FC<{
  title: string;
  value: string | number;
  sub?: string;
  subType?: 'positive' | 'negative' | 'neutral' | 'warning';
  icon: React.ReactNode;
  iconBg: string;
}> = ({ title, value, sub, subType = 'neutral', icon, iconBg }) => (
  <Card className="gradient-border">
    <CardContent className="pt-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
          {sub && (
            <p className={cn(
              'text-sm mt-1.5',
              subType === 'positive' && 'text-success',
              subType === 'negative' && 'text-destructive',
              subType === 'warning' && 'text-warning',
              subType === 'neutral' && 'text-muted-foreground',
            )}>
              {sub}
            </p>
          )}
        </div>
        <div className={cn('p-3 rounded-lg', iconBg)}>{icon}</div>
      </div>
    </CardContent>
  </Card>
);

// ── Connection Row ────────────────────────────────────────────────────────────
const ConnectionItem: React.FC<{
  name: string;
  host: string;
  status: string;
  type: 'ssh' | 'rdp';
}> = ({ name, host, status, type }) => (
  <div className="flex items-center justify-between py-2.5 border-b border-border last:border-0">
    <div className="flex items-center gap-3">
      <div className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
        type === 'ssh' ? 'bg-primary/10' : 'bg-accent/10'
      )}>
        {type === 'ssh'
          ? <Server className="w-4 h-4 text-primary" />
          : <Monitor className="w-4 h-4 text-accent" />}
      </div>
      <div className="min-w-0">
        <p className="font-medium text-sm truncate">{name}</p>
        <p className="text-xs text-muted-foreground font-mono truncate">{host}</p>
      </div>
    </div>
    <div className="flex items-center gap-1.5 flex-shrink-0 ml-3">
      {status === 'online' ? (
        <>
          <div className="w-2 h-2 rounded-full bg-success pulse-online" />
          <span className="text-xs text-success font-medium">Online</span>
        </>
      ) : (
        <>
          <div className="w-2 h-2 rounded-full bg-muted-foreground" />
          <span className="text-xs text-muted-foreground">Offline</span>
        </>
      )}
    </div>
  </div>
);

// ── Resource Bar ──────────────────────────────────────────────────────────────
const ResourceBar: React.FC<{
  label: string;
  pct: number;
  detail: string;
  icon: React.ReactNode;
}> = ({ label, pct, detail, icon }) => {
  const capped = Math.min(Math.max(pct, 0), 100);
  const color: string =
    capped > 85 ? 'text-destructive' : capped > 65 ? 'text-warning' : 'text-success';
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-medium flex items-center gap-1.5 text-muted-foreground">
          {icon}
          {label}
        </span>
        <span className={cn('text-sm font-semibold tabular-nums', color)}>{detail}</span>
      </div>
      <Progress value={capped} className="h-1.5" />
    </div>
  );
};

// ── Helpers ───────────────────────────────────────────────────────────────────
const RECENT_ONLINE_WINDOW_MS = 24 * 60 * 60 * 1000;

function fmtBytes(bytes: number): string {
  if (bytes >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`;
  return `${bytes} B`;
}

function fmtAction(action: string): string {
  return action.replace(/_/g, ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

function parseDate(value?: string | null): number {
  if (!value) return 0;
  const normalized = value.includes('T') ? value : value.replace(' ', 'T');
  const parsed = new Date(normalized).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getConnectionLastActivity(conn: SSHConnection | RDPConnection): number {
  return Math.max(parseDate((conn as any).last_connected), parseDate((conn as any).last_seen));
}

function getConnectionDisplayStatus(conn: SSHConnection | RDPConnection): 'online' | 'offline' {
  if (conn.status !== 'online') return 'offline';
  const lastActivity = getConnectionLastActivity(conn);
  if (!lastActivity) return 'online';
  return Date.now() - lastActivity <= RECENT_ONLINE_WINDOW_MS ? 'online' : 'offline';
}

interface SysMetrics {
  cpu: number;
  memUsed: number;
  memTotal: number;
  memPct: number;
  diskPct: number;
  diskUsed: number;
  diskTotal: number;
  uptime: string;
}

interface HealthStatus {
  api: boolean;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export const Dashboard: React.FC = () => {
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [alertCount, setAlertCount] = useState(0);
  const [sysMetrics, setSysMetrics] = useState<SysMetrics | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const loadData = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    try {
      const [connRes, agentRes, logRes, alertRes, cpuRes, memRes, diskRes, uptimeRes, healthRes] =
        await Promise.allSettled([
          connectionAPI.getAll(),
          agentsAPI.getAll(),
          auditAPI.getAll({ limit: 8 }),
          alertsAPI.getActive(),
          systemAPI.getCpu(),
          systemAPI.getMemory(),
          systemAPI.getDisk(),
          systemAPI.getUptime(),
          fetch('/health').then((r) => r.json()).catch(() => null),
        ]);

      if (connRes.status === 'fulfilled') setConnections(connRes.value);
      if (agentRes.status === 'fulfilled') setAgents(agentRes.value);
      if (logRes.status === 'fulfilled') setLogs(logRes.value);
      if (alertRes.status === 'fulfilled') setAlertCount((alertRes.value as any[]).length);

      if (healthRes.status === 'fulfilled' && healthRes.value) {
        setHealth({ api: healthRes.value.status === 'ok' });
      }

      const cpu = cpuRes.status === 'fulfilled' ? cpuRes.value : null;
      const mem = memRes.status === 'fulfilled' ? memRes.value : null;
      const disk = diskRes.status === 'fulfilled' ? diskRes.value : null;
      const uptime = uptimeRes.status === 'fulfilled' ? uptimeRes.value : null;

      if (cpu || mem || disk) {
        const root = Array.isArray(disk)
          ? (disk.find((d: any) => d.mount === '/') ?? disk[0])
          : null;
        setSysMetrics({
          cpu: Math.round(cpu?.currentLoad ?? 0),
          memUsed: mem?.used ?? 0,
          memTotal: mem?.total ?? 0,
          memPct: mem?.total ? Math.round((mem.used / mem.total) * 100) : 0,
          diskPct: Math.round(root?.use ?? 0),
          diskUsed: root?.used ?? 0,
          diskTotal: root?.size ?? 0,
          uptime: uptime?.uptimeFormatted ?? '—',
        });
      }

      setLastRefreshed(new Date());
    } catch (err) {
      console.error('Dashboard load failed:', err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(() => loadData(), 30_000);
    return () => clearInterval(interval);
  }, [loadData]);

  const sortedConnections = useMemo(
    () => [...connections].sort((a, b) => getConnectionLastActivity(b) - getConnectionLastActivity(a)),
    [connections]
  );

  const onlineConnections = sortedConnections.filter((c) => getConnectionDisplayStatus(c) === 'online');
  const onlineAgents = agents.filter((a) => a.status === 'online');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Overview of your remote access infrastructure
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">
            Updated {lastRefreshed.toLocaleTimeString()}
          </span>
          <Button variant="outline" size="sm" onClick={() => loadData(true)} disabled={refreshing}>
            <RefreshCw className={cn('w-4 h-4 mr-1.5', refreshing && 'animate-spin')} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Stat Cards ── */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Connections"
          value={connections.length}
          sub={`${onlineConnections.length} online`}
          subType={onlineConnections.length > 0 ? 'positive' : 'neutral'}
          icon={<Server className="w-6 h-6 text-primary" />}
          iconBg="bg-primary/10"
        />
        <StatCard
          title="Agents Online"
          value={onlineAgents.length}
          sub={agents.length > 0 ? `of ${agents.length} registered` : 'No agents yet'}
          subType={agents.length > 0 && onlineAgents.length === agents.length ? 'positive' : 'neutral'}
          icon={<Bot className="w-6 h-6 text-accent" />}
          iconBg="bg-accent/10"
        />
        <StatCard
          title="Active Alerts"
          value={alertCount > 999 ? '999+' : alertCount}
          sub={alertCount > 0 ? 'Needs attention' : 'All clear'}
          subType={alertCount > 0 ? 'warning' : 'positive'}
          icon={<AlertTriangle className={cn('w-6 h-6', alertCount > 0 ? 'text-warning' : 'text-success')} />}
          iconBg={alertCount > 0 ? 'bg-warning/10' : 'bg-success/10'}
        />
        <StatCard
          title="Server Uptime"
          value={sysMetrics?.uptime ?? '—'}
          sub="Management server"
          subType="neutral"
          icon={<Activity className="w-6 h-6 text-primary" />}
          iconBg="bg-primary/10"
        />
      </div>

      {/* ── Row 2: Connections list + Server Resources + Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connections list */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-lg">Connections</CardTitle>
              <CardDescription>
                {onlineConnections.length} of {connections.length} currently online
              </CardDescription>
            </div>
            <Badge
              variant="outline"
              className={cn(
                onlineConnections.length > 0
                  ? 'border-success text-success'
                  : 'border-muted-foreground text-muted-foreground'
              )}
            >
              {onlineConnections.length} online
            </Badge>
          </CardHeader>
          <CardContent>
            {connections.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Server className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No connections configured yet</p>
              </div>
            ) : (
              <div>
                {connections.slice(0, 8).map((conn) => (
                  <ConnectionItem
                    key={conn.id}
                    name={conn.name}
                    host={conn.host}
                    status={getConnectionDisplayStatus(conn)}
                    type={conn.type as 'ssh' | 'rdp'}
                  />
                ))}
                {connections.length > 8 && (
                  <p className="text-xs text-center text-muted-foreground pt-3">
                    +{connections.length - 8} more connections
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column: Resources + Health stacked */}
        <div className="flex flex-col gap-6">
          <Card className="flex-1">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">Server Resources</CardTitle>
              <CardDescription>Management server · live</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {sysMetrics ? (
                <>
                  <ResourceBar
                    label="CPU"
                    pct={sysMetrics.cpu}
                    detail={`${sysMetrics.cpu}%`}
                    icon={<Cpu className="w-3.5 h-3.5" />}
                  />
                  <ResourceBar
                    label="Memory"
                    pct={sysMetrics.memPct}
                    detail={`${sysMetrics.memPct}% · ${fmtBytes(sysMetrics.memUsed)} / ${fmtBytes(sysMetrics.memTotal)}`}
                    icon={<Database className="w-3.5 h-3.5" />}
                  />
                  <ResourceBar
                    label="Disk ( / )"
                    pct={sysMetrics.diskPct}
                    detail={`${sysMetrics.diskPct}% · ${fmtBytes(sysMetrics.diskUsed)} / ${fmtBytes(sysMetrics.diskTotal)}`}
                    icon={<HardDrive className="w-3.5 h-3.5" />}
                  />
                  <div className="pt-2 border-t border-border">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Activity className="w-3.5 h-3.5" /> Uptime
                      </span>
                      <span className="font-semibold">{sysMetrics.uptime}</span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Metrics unavailable</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="w-4 h-4 text-success" />
                System Health
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {[
                { label: 'Backend API',    ok: health?.api ?? false },
                { label: 'Connections DB', ok: connections.length >= 0 },
                { label: 'Agents DB',      ok: agents.length >= 0 },
                { label: 'Audit Logs',     ok: logs.length >= 0 },
              ].map(({ label, ok }) => (
                <div key={label} className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{label}</span>
                  <span className={cn('flex items-center gap-1 font-medium', ok ? 'text-success' : 'text-destructive')}>
                    {ok
                      ? <><CheckCircle2 className="w-3.5 h-3.5" /> OK</>
                      : <><XCircle className="w-3.5 h-3.5" /> Error</>}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Row 3: Vulnerability + Recent Activity ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <VulnerabilityOverview />

        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest audit log entries</CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-10 text-muted-foreground">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No recent activity</p>
              </div>
            ) : (
              <div>
                {logs.map((log) => (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 py-2.5 border-b border-border last:border-0"
                  >
                    <div
                      className={cn(
                        'mt-1.5 w-2 h-2 rounded-full flex-shrink-0',
                        log.status === 'success' ? 'bg-success' : 'bg-destructive'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium">{fmtAction(log.action)}</p>
                        <Badge
                          variant="outline"
                          className={cn(
                            'text-xs px-1.5 py-0',
                            log.status === 'success'
                              ? 'border-success/50 text-success'
                              : 'border-destructive/50 text-destructive'
                          )}
                        >
                          {log.status}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{log.target}</p>
                      {log.details && (
                        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">{log.details}</p>
                      )}
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.timestamp).toLocaleString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
