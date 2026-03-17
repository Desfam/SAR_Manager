import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Cpu, MemoryStick, HardDrive, Activity, ArrowUpDown, Search, RefreshCw, Zap, Thermometer, Network, AlertCircle, CheckCircle, XCircle, Clock, Server, Wifi, BarChart3, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';
import { MetricsCharts } from './MetricsCharts';
import { ExpandedSystemDetails } from './ExpandedSystemDetails';

interface Connection {
  id: string;
  name: string;
  status: string;
  os: string;
}

interface SystemMetrics {
  timestamp: string;
  systemInfo: {
    hostname: string;
    uptime: string;
    uptimeSeconds: number;
    os: string;
    kernel: string;
  } | null;
  cpu: {
    count: number;
    usage: number;
    user: number;
    system: number;
  } | null;
  memory: {
    total: number;
    used: number;
    available: number;
    percentUsed: number;
  } | null;
  disk: {
    total: number;
    used: number;
    available: number;
    percentUsed: number;
    path: string;
  } | null;
  loadAverage: {
    one: number;
    five: number;
    fifteen: number;
  } | null;
  network: Array<{
    name: string;
    rxBytes: number;
    txBytes: number;
  }> | null;
  services: Array<{
    name: string;
    status: 'running' | 'stopped';
  }> | null;
  listeningPorts: Array<{
    port: number;
    service: string;
  }> | null;
  processes: Array<{
    pid: number;
    user: string;
    cpu: number;
    mem: number;
    vsz: string;
    rss: string;
    stat: string;
    time: string;
    command: string;
  }> | null;
  nodeExporter?: {
    enabled: boolean;
    url: string | null;
    detected: boolean;
    working: boolean;
    usedForMetrics: boolean;
    status: 'working' | 'found_not_working' | 'not_found' | 'disabled' | 'unknown';
    message: string;
  };
}

type NodeExporterStatusInfo = NonNullable<SystemMetrics['nodeExporter']>;

const NODE_EXPORTER_STATUS_CACHE_KEY = 'nodeExporterStatusCache';

function loadNodeExporterStatusCache(): Record<string, NodeExporterStatusInfo> {
  try {
    const raw = localStorage.getItem(NODE_EXPORTER_STATUS_CACHE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveNodeExporterStatusCache(cache: Record<string, NodeExporterStatusInfo>) {
  try {
    localStorage.setItem(NODE_EXPORTER_STATUS_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // ignore cache write errors
  }
}

export const SystemMonitorReal: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandDetails, setExpandDetails] = useState(false);
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid'>('cpu');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const [refreshInterval, setRefreshInterval] = useState(5000); // 5 seconds
  const [nodeExporterStatusCache, setNodeExporterStatusCache] = useState<Record<string, NodeExporterStatusInfo>>(
    () => loadNodeExporterStatusCache()
  );

  // Fetch connections
  useEffect(() => {
    const fetchConnections = async () => {
      try {
        const response = await fetch(`${API_CONFIG.baseURL}/connections`);
        const data = await response.json();
        const onlineConns = (data || []).filter((c: Connection) => c.status === 'online');
        setConnections(onlineConns);
        if (onlineConns.length > 0 && !selectedConnectionId) {
          const preferredConnectionId = localStorage.getItem('preferredConnectionId');
          const preferredConnectionExists = preferredConnectionId
            ? onlineConns.some((conn: Connection) => conn.id === preferredConnectionId)
            : false;

          setSelectedConnectionId(preferredConnectionExists ? preferredConnectionId! : onlineConns[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch connections:', err);
      }
    };

    fetchConnections();
  }, []);

  // Fetch metrics
  useEffect(() => {
    if (!selectedConnectionId) return;

    const fetchMetrics = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`${API_CONFIG.baseURL}/connections/${selectedConnectionId}/system-metrics`);
        
        if (!response.ok) {
          throw new Error(response.status === 503 ? 'Connection is offline' : 'Failed to fetch metrics');
        }

        const data = await response.json();
        setMetrics(data);

        const nextNodeExporter = data?.nodeExporter as NodeExporterStatusInfo | undefined;
        if (nextNodeExporter && selectedConnectionId) {
          setNodeExporterStatusCache((previous) => {
            const current = previous[selectedConnectionId];
            const didStatusChange = current?.status !== nextNodeExporter.status;

            if (!didStatusChange) {
              return previous;
            }

            const updated = { ...previous, [selectedConnectionId]: nextNodeExporter };
            saveNodeExporterStatusCache(updated);
            return updated;
          });
        }
      } catch (err: any) {
        setError(err.message || 'Failed to fetch system metrics');
        setMetrics(null);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    const interval = setInterval(fetchMetrics, refreshInterval);
    return () => clearInterval(interval);
  }, [selectedConnectionId, refreshInterval]);

  const selectedConnection = connections.find(c => c.id === selectedConnectionId);

  const selectedNodeExporterStatus = selectedConnectionId
    ? nodeExporterStatusCache[selectedConnectionId]
    : undefined;

  const getNodeExporterIndicator = (status?: NodeExporterStatusInfo) => {
    if (!status || status.status === 'unknown') {
      return {
        icon: <Clock className="w-3 h-3 text-muted-foreground" />,
        label: 'Node Exporter status pending',
      };
    }

    if (status.status === 'working') {
      return {
        icon: <CheckCircle className="w-3 h-3 text-emerald-500" />,
        label: `Node Exporter working${status.url ? ` (${status.url})` : ''}`,
      };
    }

    if (status.status === 'found_not_working') {
      return {
        icon: <AlertCircle className="w-3 h-3 text-amber-500" />,
        label: 'Node Exporter found but not working (SSH fallback)',
      };
    }

    if (status.status === 'not_found') {
      return {
        icon: <XCircle className="w-3 h-3 text-red-500" />,
        label: 'Node Exporter not found (SSH fallback)',
      };
    }

    if (status.status === 'disabled') {
      return {
        icon: <AlertCircle className="w-3 h-3 text-amber-500" />,
        label: 'Node Exporter disabled',
      };
    }

    return {
      icon: <Clock className="w-3 h-3 text-muted-foreground" />,
      label: 'Node Exporter status unknown',
    };
  };

  const getCpuColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 50) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getMemColor = (val: number) => {
    if (val > 85) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getDiskColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-purple-500';
  };

  const sorted = (metrics?.processes || [])
    .filter(p => !filter || p.command.toLowerCase().includes(filter.toLowerCase()) || p.user.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const mul = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'cpu') return mul * (a.cpu - b.cpu);
      if (sortBy === 'mem') return mul * (a.mem - b.mem);
      return mul * (a.pid - b.pid);
    });

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Monitor</h1>
            <p className="text-sm text-muted-foreground">Real-time system metrics from your virtual machines</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
            <SelectTrigger className="w-[260px] bg-card border-border">
              {selectedConnection ? (
                <span className="flex items-center gap-2 text-sm min-w-0">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="truncate">{selectedConnection.name}</span>
                  <span
                    className="inline-flex items-center"
                    title={getNodeExporterIndicator(selectedNodeExporterStatus).label}
                  >
                    {getNodeExporterIndicator(selectedNodeExporterStatus).icon}
                  </span>
                </span>
              ) : (
                <SelectValue placeholder="Select host" />
              )}
            </SelectTrigger>
            <SelectContent>
              {connections.map(c => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    {c.name}
                    <span
                      className="inline-flex items-center"
                      title={getNodeExporterIndicator(nodeExporterStatusCache[c.id]).label}
                    >
                      {getNodeExporterIndicator(nodeExporterStatusCache[c.id]).icon}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => setSelectedConnectionId(selectedConnectionId)}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {connections.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-6 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No online connections available. Go to Connections tab to connect to a system.</p>
          </CardContent>
        </Card>
      ) : error ? (
        <Card className="bg-card border-border">
          <CardContent className="p-6">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className="font-semibold text-red-500">Error</p>
                <p className="text-sm text-muted-foreground">{error}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : loading && !metrics ? (
        <Card className="bg-card border-border">
          <CardContent className="p-6 text-center">
            <div className="inline-flex items-center gap-2 text-muted-foreground">
              <RefreshCw className="w-4 h-4 animate-spin" />
              <span>Loading system metrics...</span>
            </div>
          </CardContent>
        </Card>
      ) : metrics && selectedConnection ? (
        <Tabs defaultValue="metrics" className="w-full">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="metrics" className="flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Metrics
            </TabsTrigger>
            <TabsTrigger value="charts" className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4" />
              Charts
            </TabsTrigger>
            <TabsTrigger value="details" className="flex items-center gap-2">
              <Server className="w-4 h-4" />
              Details
            </TabsTrigger>
          </TabsList>

          {/* Metrics Tab */}
          <TabsContent value="metrics" className="space-y-4">
        <>
          {/* System Info Card */}
          {metrics.systemInfo && (
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">Hostname</p>
                    <p className="text-sm font-mono text-foreground mt-1">{metrics.systemInfo.hostname}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">Uptime</p>
                    <p className="text-sm font-mono text-foreground mt-1">{metrics.systemInfo.uptime}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">OS</p>
                    <p className="text-sm text-foreground mt-1 truncate">{metrics.systemInfo.os}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-semibold">Kernel</p>
                    <p className="text-sm font-mono text-foreground mt-1">{metrics.systemInfo.kernel}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Cpu className="w-4 h-4 text-emerald-400" />
                  <span className="text-sm font-semibold text-foreground">CPU Usage</span>
                </div>
                {metrics.cpu ? (
                  <>
                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden mb-1">
                      <div className={cn('h-full rounded-full transition-all', getCpuColor(metrics.cpu.usage))} style={{ width: `${metrics.cpu.usage}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{metrics.cpu.count} cores</span>
                      <span className="font-bold">{metrics.cpu.usage.toFixed(1)}%</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No data</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MemoryStick className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-foreground">Memory</span>
                </div>
                {metrics.memory ? (
                  <>
                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden mb-1">
                      <div className={cn('h-full rounded-full transition-all', getMemColor(metrics.memory.percentUsed))} style={{ width: `${metrics.memory.percentUsed}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(metrics.memory.used)} / {formatBytes(metrics.memory.total)}</span>
                      <span className="font-bold">{metrics.memory.percentUsed.toFixed(1)}%</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No data</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-semibold text-foreground">Disk</span>
                </div>
                {metrics.disk ? (
                  <>
                    <div className="h-3 bg-muted/30 rounded-full overflow-hidden mb-1">
                      <div className={cn('h-full rounded-full transition-all', getDiskColor(metrics.disk.percentUsed))} style={{ width: `${metrics.disk.percentUsed}%` }} />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground">
                      <span>{formatBytes(metrics.disk.used)} / {formatBytes(metrics.disk.total)}</span>
                      <span className="font-bold">{metrics.disk.percentUsed.toFixed(1)}%</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No data</p>
                )}
              </CardContent>
            </Card>

            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Thermometer className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-semibold text-foreground">Load Average</span>
                </div>
                {metrics.loadAverage ? (
                  <>
                    <div className="text-sm font-mono font-bold text-foreground">
                      {metrics.loadAverage.one.toFixed(2)} {metrics.loadAverage.five.toFixed(2)} {metrics.loadAverage.fifteen.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1">1m 5m 15m</div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">No data</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Processes Table */}
          {metrics.processes && metrics.processes.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Top Processes by CPU</CardTitle>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="text"
                        placeholder="Filter..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="bg-muted/30 text-muted-foreground">
                        <th className="text-left px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('pid'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                          PID {sortBy === 'pid' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                        </th>
                        <th className="text-left px-3 py-2">USER</th>
                        <th className="text-left px-3 py-2">VIRT</th>
                        <th className="text-left px-3 py-2">RES</th>
                        <th className="text-left px-3 py-2">S</th>
                        <th className="text-right px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('cpu'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                          CPU% {sortBy === 'cpu' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                        </th>
                        <th className="text-right px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('mem'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                          MEM% {sortBy === 'mem' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                        </th>
                        <th className="text-left px-3 py-2">TIME</th>
                        <th className="text-left px-3 py-2">Command</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sorted.map((p) => (
                        <tr key={p.pid} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-1.5 text-primary">{p.pid}</td>
                          <td className="px-3 py-1.5">
                            <span className={cn(p.user === 'root' ? 'text-red-400' : 'text-foreground')}>
                              {p.user}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.vsz}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.rss}</td>
                          <td className="px-3 py-1.5">
                            <span className={cn(p.stat.includes('R') ? 'text-emerald-400' : 'text-muted-foreground')}>
                              {p.stat}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-12 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', getCpuColor(p.cpu))} style={{ width: `${Math.min(100, p.cpu)}%` }} />
                              </div>
                              <span className={cn(p.cpu > 10 ? 'text-red-400 font-bold' : p.cpu > 5 ? 'text-yellow-400' : 'text-foreground')}>
                                {p.cpu.toFixed(1)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-12 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                                <div className={cn('h-full rounded-full', getMemColor(p.mem))} style={{ width: `${Math.min(100, p.mem)}%` }} />
                              </div>
                              <span className={cn(p.mem > 10 ? 'text-blue-400 font-bold' : 'text-foreground')}>
                                {p.mem.toFixed(1)}
                              </span>
                            </div>
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{p.time}</td>
                          <td className="px-3 py-1.5 text-foreground max-w-[300px] truncate">{p.command}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Services Status */}
          {metrics.services && metrics.services.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-4 h-4" />
                  Services Status
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {metrics.services.map((service) => (
                    <div
                      key={service.name}
                      className="flex items-center gap-2 p-2 rounded-lg border border-border/50 bg-muted/20"
                    >
                      {service.status === 'running' ? (
                        <CheckCircle className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                      )}
                      <span className="text-sm font-medium">{service.name}</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          'ml-auto text-[10px]',
                          service.status === 'running'
                            ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/30'
                            : 'bg-red-500/10 text-red-500 border-red-500/30'
                        )}
                      >
                        {service.status}
                      </Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Network Interfaces */}
          {metrics.network && metrics.network.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Wifi className="w-4 h-4" />
                  Network Interfaces
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {metrics.network.map((iface) => (
                    <div key={iface.name} className="p-3 rounded-lg border border-border/50 bg-muted/20">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-semibold text-sm">{iface.name}</span>
                        <span className="text-xs text-muted-foreground">
                          RX: {formatBytes(iface.rxBytes)} / TX: {formatBytes(iface.txBytes)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Listening Ports */}
          {metrics.listeningPorts && metrics.listeningPorts.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Network className="w-4 h-4" />
                  Listening Ports ({metrics.listeningPorts.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {metrics.listeningPorts.slice(0, 20).map((port, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded-lg border border-border/50 bg-muted/20 text-center"
                    >
                      <p className="text-xs text-muted-foreground">Port</p>
                      <p className="text-sm font-mono font-bold text-foreground">{port.port}</p>
                      <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{port.service}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
          </TabsContent>

          {/* Charts Tab */}
          <TabsContent value="charts" className="space-y-4">
            <MetricsCharts 
              connectionId={selectedConnectionId} 
              connectionName={selectedConnection.name} 
            />
          </TabsContent>

          {/* Advanced Details Tab */}
          <TabsContent value="details" className="space-y-4">
            {metrics && <ExpandedSystemDetails data={metrics} />}
          </TabsContent>
        </Tabs>
      ) : null}
    </div>
  );
};
