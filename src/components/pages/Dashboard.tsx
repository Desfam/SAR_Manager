import React, { useEffect, useState } from 'react';
import {
  Server,
  Monitor,
  Wifi,
  WifiOff,
  AlertTriangle,
  Shield,
  Container,
  Activity,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { connectionAPI, dockerAPI, auditAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { SSHConnection, RDPConnection, DockerContainer, AuditLog } from '@/types/connection';
import { VulnerabilityOverview } from '@/components/widgets/VulnerabilityOverview';

const StatCard: React.FC<{
  title: string;
  value: string | number;
  change?: string;
  changeType?: 'positive' | 'negative' | 'neutral';
  icon: React.ReactNode;
  iconBg: string;
}> = ({ title, value, change, changeType, icon, iconBg }) => (
  <Card className="gradient-border">
    <CardContent className="pt-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <p className="text-3xl font-bold mt-1">{value}</p>
          {change && (
            <div className="flex items-center gap-1 mt-2">
              {changeType === 'positive' ? (
                <ArrowUpRight className="w-4 h-4 text-success" />
              ) : changeType === 'negative' ? (
                <ArrowDownRight className="w-4 h-4 text-destructive" />
              ) : null}
              <span
                className={cn(
                  'text-sm',
                  changeType === 'positive' && 'text-success',
                  changeType === 'negative' && 'text-destructive',
                  changeType === 'neutral' && 'text-muted-foreground'
                )}
              >
                {change}
              </span>
            </div>
          )}
        </div>
        <div className={cn('p-3 rounded-lg', iconBg)}>{icon}</div>
      </div>
    </CardContent>
  </Card>
);

const ConnectionItem: React.FC<{
  name: string;
  host: string;
  status: string;
  type: 'ssh' | 'rdp';
}> = ({ name, host, status, type }) => (
  <div className="flex items-center justify-between py-3 border-b border-border last:border-0">
    <div className="flex items-center gap-3">
      <div
        className={cn(
          'w-10 h-10 rounded-lg flex items-center justify-center',
          type === 'ssh' ? 'bg-primary/10' : 'bg-accent/10'
        )}
      >
        {type === 'ssh' ? (
          <Server className="w-5 h-5 text-primary" />
        ) : (
          <Monitor className="w-5 h-5 text-accent" />
        )}
      </div>
      <div>
        <p className="font-medium text-sm">{name}</p>
        <p className="text-xs text-muted-foreground font-mono">{host}</p>
      </div>
    </div>
    <div className="flex items-center gap-2">
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

export const Dashboard: React.FC = () => {
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [containers, setContainers] = useState<DockerContainer[]>([]);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();
  }, []);

  const loadDashboardData = async () => {
    try {
      const [connectionsData, logsData] = await Promise.all([
        connectionAPI.getAll().catch(() => []),
        auditAPI.getAll({ limit: 5 }).catch(() => []),
      ]);

      // Try to get Docker data, but don't fail if Docker isn't available
      try {
        const dockerData = await dockerAPI.getContainers();
        setContainers(dockerData);
      } catch {
        setContainers([]);
      }

      setConnections(connectionsData);
      setLogs(logsData);
    } catch (error) {
      console.error('Failed to load dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  const allConnections = connections;
  const onlineConnections = allConnections.filter((c) => c.status === 'online');
  const runningContainers = containers.filter((c) => c.status === 'running');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page Header */}
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Overview of your remote access infrastructure</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Connections"
          value={allConnections.length}
          change={`${onlineConnections.length} online`}
          changeType="positive"
          icon={<Server className="w-6 h-6 text-primary" />}
          iconBg="bg-primary/10"
        />
        <StatCard
          title="Running Containers"
          value={runningContainers.length}
          change={`of ${containers.length} total`}
          changeType="neutral"
          icon={<Container className="w-6 h-6 text-accent" />}
          iconBg="bg-accent/10"
        />
        <StatCard
          title="Active Sessions"
          value={onlineConnections.length}
          change={`${allConnections.length} configured`}
          changeType={onlineConnections.length > 0 ? 'positive' : 'neutral'}
          icon={<Activity className="w-6 h-6 text-success" />}
          iconBg="bg-success/10"
        />
        <StatCard
          title="Uptime"
          value="99.9%"
          change="Last 30 days"
          changeType="positive"
          icon={<Activity className="w-6 h-6 text-warning" />}
          iconBg="bg-warning/10"
        />
      </div>

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Connections List */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-lg">Recent Connections</CardTitle>
              <CardDescription>Your most recently accessed servers</CardDescription>
            </div>
            <Badge variant="secondary">{onlineConnections.length} online</Badge>
          </CardHeader>
          <CardContent>
            {allConnections.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No connections configured</p>
              </div>
            ) : (
              <div className="space-y-1">
                {allConnections.slice(0, 6).map((conn) => (
                  <ConnectionItem
                    key={conn.id}
                    name={conn.name}
                    host={conn.host}
                    status={conn.status}
                    type={conn.type as 'ssh' | 'rdp'}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* System Resources */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Resource Usage</CardTitle>
            <CardDescription>Average across online servers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">CPU</span>
                <span className="text-sm text-muted-foreground">32%</span>
              </div>
              <Progress value={32} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Memory</span>
                <span className="text-sm text-muted-foreground">68%</span>
              </div>
              <Progress value={68} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Disk</span>
                <span className="text-sm text-muted-foreground">45%</span>
              </div>
              <Progress value={45} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between mb-2">
                <span className="text-sm font-medium">Network I/O</span>
                <span className="text-sm text-muted-foreground">24 MB/s</span>
              </div>
              <Progress value={24} className="h-2" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vulnerability Overview */}
        <VulnerabilityOverview />

        {/* Recent Activity */}
        <div className="lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Activity</CardTitle>
            <CardDescription>Latest actions across all systems</CardDescription>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Clock className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No recent activity</p>
              </div>
            ) : (
              <div className="space-y-4">
                {logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3">
                    <div
                      className={cn(
                        'w-2 h-2 mt-2 rounded-full flex-shrink-0',
                        log.status === 'success' ? 'bg-success' : 'bg-destructive'
                      )}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{log.action.replace('_', ' ')}</p>
                      <p className="text-xs text-muted-foreground truncate">{log.target}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                        <Clock className="w-3 h-3" />
                        {new Date(log.timestamp).toLocaleTimeString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
        </div>

        {/* System Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-success" />
              System Status
            </CardTitle>
            <CardDescription>Current system health</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm">Backend API</span>
                <Badge variant="outline" className="border-success text-success">
                  Operational
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">WebSocket</span>
                <Badge variant="outline" className="border-success text-success">
                  Operational
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm">Database</span>
                <Badge variant="outline" className="border-success text-success">
                  Operational
                </Badge>
              </div>
              {containers.length > 0 && (
                <div className="flex items-center justify-between">
                  <span className="text-sm">Docker</span>
                  <Badge variant="outline" className="border-success text-success">
                    {runningContainers.length}/{containers.length} Running
                  </Badge>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
