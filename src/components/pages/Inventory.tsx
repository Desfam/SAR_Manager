import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Boxes,
  Loader2,
  Network,
  Server,
  ShieldAlert,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { alertsAPI, agentsAPI, connectionAPI, dockerAPI, proxmoxAPI } from '@/services/api';
import type {
  AgentSecurityAlert,
  AgentSummary,
  InfrastructureAlert,
} from '@/services/api';
import type { DockerContainer, RDPConnection, SSHConnection } from '@/types/connection';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type Connection = SSHConnection | RDPConnection;

type InventoryAsset = {
  id: string;
  name: string;
  hostname: string;
  status: 'online' | 'offline' | 'degraded';
  access: string[];
  connectionIds: string[];
  hasAgent: boolean;
  dockerContainers: number;
  infraAlerts: number;
  agentAlerts: number;
  lastSeen: string | null;
  tags: string[];
};

function navigateTab(tab: string) {
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab } }));
}

function openAlertsForAsset(connectionIds: string[]) {
  const firstConnectionId = connectionIds.find(Boolean);
  if (firstConnectionId) {
    localStorage.setItem('alertsConnectionId', firstConnectionId);
  } else {
    localStorage.removeItem('alertsConnectionId');
  }
  navigateTab('alerts');
}

function normalizeKey(value?: string | null) {
  return (value || '').trim().toLowerCase();
}

function formatLastSeen(value: string | null) {
  if (!value) return 'Never';

  const now = Date.now();
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return 'Unknown';

  const diffMinutes = Math.floor((now - then) / 60000);
  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function mergeLastSeen(current: string | null, next?: string | null) {
  if (!next) return current;
  if (!current) return next;
  return new Date(next).getTime() > new Date(current).getTime() ? next : current;
}

function getConnectionAccess(connection: Connection) {
  if ('domain' in connection || (connection as any).type === 'rdp') {
    return 'RDP';
  }
  return 'SSH';
}

function computeAssetStatus(asset: InventoryAsset) {
  // Only mark as degraded if the host is actually reachable.
  // An offline host with stale alerts should remain 'offline'.
  if (asset.status !== 'online') return asset.status;
  const totalAlerts = asset.infraAlerts + asset.agentAlerts;
  if (totalAlerts > 0) return 'degraded';
  return 'online';
}

export const Inventory: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
  const [infraAlerts, setInfraAlerts] = useState<InfrastructureAlert[]>([]);
  const [agentAlerts, setAgentAlerts] = useState<AgentSecurityAlert[]>([]);
  const [proxmoxSummary, setProxmoxSummary] = useState<{
    connected: boolean;
    nodes: number;
    error?: string;
  }>({ connected: false, nodes: 0 });

  useEffect(() => {
    void loadInventory();
  }, []);

  const loadInventory = async () => {
    setLoading(true);
    try {
      const [
        connectionData,
        agentData,
        infraAlertData,
        agentAlertData,
        dockerData,
        proxmoxStatus,
      ] = await Promise.all([
        connectionAPI.getAll(),
        agentsAPI.getAll(),
        alertsAPI.getActive(),
        agentsAPI.getActiveAlerts(),
        dockerAPI.scanAll().catch(() => []),
        proxmoxAPI.getStatus().catch((error: Error) => ({ connected: false, error: error.message })),
      ]);

      setConnections(connectionData);
      setAgents(agentData);
      setInfraAlerts(infraAlertData);
      setAgentAlerts(agentAlertData.filter((alert) => !alert.is_resolved));
      setDockerContainers(dockerData);

      if (proxmoxStatus.connected) {
        const nodes = await proxmoxAPI.getNodes().catch(() => []);
        setProxmoxSummary({ connected: true, nodes: nodes.length });
      } else {
        setProxmoxSummary({ connected: false, nodes: 0, error: proxmoxStatus.error });
      }
    } catch (error: any) {
      toast({
        title: 'Inventory konnte nicht geladen werden',
        description: error.message || 'Die Bestandsdaten sind aktuell nicht erreichbar.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const assets = useMemo(() => {
    const dockerByConnection = new Map<string, number>();
    for (const container of dockerContainers) {
      dockerByConnection.set(container.hostId, (dockerByConnection.get(container.hostId) || 0) + 1);
    }

    const infraAlertsByConnection = new Map<string, number>();
    for (const alert of infraAlerts) {
      infraAlertsByConnection.set(
        alert.connection_id,
        (infraAlertsByConnection.get(alert.connection_id) || 0) + 1,
      );
    }

    const assetsMap = new Map<string, InventoryAsset>();

    for (const connection of connections) {
      const key = normalizeKey(connection.host || connection.name) || connection.id;
      const existing = assetsMap.get(key);
      const nextAccess = getConnectionAccess(connection);
      const tags = Array.isArray(connection.tags) ? connection.tags : [];

      assetsMap.set(key, {
        id: existing?.id || connection.id,
        name: existing?.name || connection.name,
        hostname: connection.host || existing?.hostname || connection.name,
        status: connection.status === 'online' ? 'online' : existing?.status || 'offline',
        access: Array.from(new Set([...(existing?.access || []), nextAccess])),
        connectionIds: [...(existing?.connectionIds || []), connection.id],
        hasAgent: existing?.hasAgent || false,
        dockerContainers: (existing?.dockerContainers || 0) + (dockerByConnection.get(connection.id) || 0),
        infraAlerts: (existing?.infraAlerts || 0) + (infraAlertsByConnection.get(connection.id) || 0),
        agentAlerts: existing?.agentAlerts || 0,
        lastSeen: mergeLastSeen(existing?.lastSeen || null, connection.last_seen || null),
        tags: Array.from(new Set([...(existing?.tags || []), ...tags])),
      });
    }

    for (const agent of agents) {
      const key = normalizeKey(agent.hostname || agent.name) || agent.id;
      const existing = assetsMap.get(key);
      const alertCount = agentAlerts.filter((alert) => alert.agent_id === agent.id).length;

      assetsMap.set(key, {
        id: existing?.id || agent.id,
        name: existing?.name || agent.name,
        hostname: existing?.hostname || agent.hostname || agent.name,
        status: agent.status === 'online' || existing?.status === 'online' ? 'online' : 'offline',
        access: existing?.access || [],
        connectionIds: existing?.connectionIds || [],
        hasAgent: true,
        dockerContainers: existing?.dockerContainers || 0,
        infraAlerts: existing?.infraAlerts || 0,
        agentAlerts: (existing?.agentAlerts || 0) + alertCount,
        lastSeen: mergeLastSeen(existing?.lastSeen || null, agent.last_seen || null),
        tags: Array.from(new Set([...(existing?.tags || []), ...(agent.tags || [])])),
      });
    }

    return [...assetsMap.values()]
      .map((asset) => ({ ...asset, status: computeAssetStatus(asset) }))
      .sort((left, right) => {
        const leftAlerts = left.infraAlerts + left.agentAlerts;
        const rightAlerts = right.infraAlerts + right.agentAlerts;
        if (leftAlerts !== rightAlerts) return rightAlerts - leftAlerts;
        if (left.status !== right.status) {
          if (left.status === 'degraded') return -1;
          if (right.status === 'degraded') return 1;
          if (left.status === 'online') return -1;
          if (right.status === 'online') return 1;
        }
        return left.name.localeCompare(right.name);
      });
  }, [agentAlerts, agents, connections, dockerContainers, infraAlerts]);

  const filteredAssets = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return assets;

    return assets.filter((asset) => {
      return [asset.name, asset.hostname, ...asset.access, ...asset.tags]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [assets, query]);

  const summary = useMemo(() => {
    const totalAlerts = infraAlerts.length + agentAlerts.length;
    return {
      totalAssets: assets.length,
      onlineAssets: assets.filter((asset) => asset.status === 'online').length,
      agentManaged: assets.filter((asset) => asset.hasAgent).length,
      dockerHosts: assets.filter((asset) => asset.dockerContainers > 0).length,
      totalAlerts,
    };
  }, [agentAlerts.length, assets, infraAlerts.length]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-muted-foreground">
            Zentrale Bestandsansicht fuer Hosts, Agenten, Docker-Abdeckung und Betriebszustand.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigateTab('hosts')}>
            <Server className="mr-2 h-4 w-4" />
            Hosts oeffnen
          </Button>
          <Button variant="outline" onClick={() => navigateTab('agents')}>
            <Bot className="mr-2 h-4 w-4" />
            Agents oeffnen
          </Button>
          <Button onClick={loadInventory} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Activity className="mr-2 h-4 w-4" />}
            Aktualisieren
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Assets</CardDescription>
            <CardTitle className="text-3xl">{summary.totalAssets}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Alle erkannten Systeme aus Zugang und Agenten.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Online</CardDescription>
            <CardTitle className="text-3xl">{summary.onlineAssets}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Aktuell erreichbare oder aktive Assets.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Agent Managed</CardDescription>
            <CardTitle className="text-3xl">{summary.agentManaged}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Assets mit aktivem Agenten-Kontext.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Docker Hosts</CardDescription>
            <CardTitle className="text-3xl">{summary.dockerHosts}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Hosts mit erkannten Containern.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Aktive Alerts</CardDescription>
            <CardTitle className="text-3xl">{summary.totalAlerts}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            <button
              type="button"
              onClick={() => openAlertsForAsset([])}
              className="underline underline-offset-4 hover:text-foreground"
            >
              Infra- und Agent-Warnungen im Bestand anzeigen.
            </button>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <CardHeader className="gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <CardTitle>Asset View</CardTitle>
              <CardDescription>Single source of truth fuer Betriebszustand und Zugriffspfad.</CardDescription>
            </div>
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Suche nach Host, Tag, Zugriff oder Adresse..."
              className="w-full lg:max-w-sm"
            />
          </CardHeader>
          <CardContent className="p-0">
            {loading ? (
              <div className="py-12 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Asset</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Access</TableHead>
                    <TableHead>Agent</TableHead>
                    <TableHead>Docker</TableHead>
                    <TableHead>Alerts</TableHead>
                    <TableHead>Last Seen</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAssets.map((asset) => {
                    const totalAlerts = asset.infraAlerts + asset.agentAlerts;
                    return (
                      <TableRow key={asset.id}>
                        <TableCell>
                          <div className="space-y-1">
                            <div className="font-medium">{asset.name}</div>
                            <div className="text-xs text-muted-foreground">{asset.hostname}</div>
                            {asset.tags.length > 0 ? (
                              <div className="flex flex-wrap gap-1">
                                {asset.tags.slice(0, 3).map((tag) => (
                                  <Badge key={tag} variant="secondary" className="text-[10px]">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            className={cn(
                              asset.status === 'online' && 'bg-emerald-500/10 text-emerald-600',
                              asset.status === 'offline' && 'bg-muted text-muted-foreground',
                              asset.status === 'degraded' && 'bg-amber-500/10 text-amber-600',
                            )}
                          >
                            {asset.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {asset.access.length > 0 ? asset.access.map((entry) => (
                              <Badge key={entry} variant="outline">{entry}</Badge>
                            )) : <span className="text-xs text-muted-foreground">No direct access</span>}
                          </div>
                        </TableCell>
                        <TableCell>
                          {asset.hasAgent ? (
                            <Badge className="bg-sky-500/10 text-sky-600">Managed</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {asset.dockerContainers > 0 ? (
                            <Badge className="bg-violet-500/10 text-violet-600">{asset.dockerContainers} containers</Badge>
                          ) : (
                            <span className="text-xs text-muted-foreground">None</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {totalAlerts > 0 ? (
                            <button
                              type="button"
                              onClick={() => openAlertsForAsset(asset.connectionIds)}
                              className="rounded"
                            >
                              <Badge className="bg-rose-500/10 text-rose-600 hover:bg-rose-500/20">{totalAlerts} active</Badge>
                            </button>
                          ) : (
                            <span className="text-xs text-muted-foreground">Clear</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{formatLastSeen(asset.lastSeen)}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Network className="h-4 w-4" />
                Proxmox Coverage
              </CardTitle>
              <CardDescription>Cluster-Kontext fuer die Infrastruktur-Ebene.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Status</span>
                <Badge variant={proxmoxSummary.connected ? 'default' : 'secondary'}>
                  {proxmoxSummary.connected ? 'Connected' : 'Not connected'}
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Nodes</span>
                <span className="font-medium">{proxmoxSummary.nodes}</span>
              </div>
              {proxmoxSummary.error ? (
                <p className="text-xs text-muted-foreground">{proxmoxSummary.error}</p>
              ) : null}
              <Button variant="outline" className="w-full" onClick={() => navigateTab('proxmox')}>
                <Boxes className="mr-2 h-4 w-4" />
                Proxmox oeffnen
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-4 w-4" />
                Betriebslage
              </CardTitle>
              <CardDescription>Wo gerade Aufmerksamkeit noetig ist.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Degraded Assets</span>
                <span className="font-medium">{assets.filter((asset) => asset.status === 'degraded').length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Offline Assets</span>
                <span className="font-medium">{assets.filter((asset) => asset.status === 'offline').length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Agent Alerts</span>
                <span className="font-medium">{agentAlerts.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Infra Alerts</span>
                <span className="font-medium">{infraAlerts.length}</span>
              </div>
              <Button variant="outline" className="w-full" onClick={() => navigateTab('alerts')}>
                <AlertTriangle className="mr-2 h-4 w-4" />
                Alerts oeffnen
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};