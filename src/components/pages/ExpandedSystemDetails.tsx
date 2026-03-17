import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HardDrive, Users, Wifi, Container, Network } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExpandedSystemDetailsProps {
  data: any;
}

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

export const ExpandedSystemDetails: React.FC<ExpandedSystemDetailsProps> = ({ data }) => {
  return (
    <div className="space-y-4">
      {/* Disk Partitions */}
      {data.diskPartitions && data.diskPartitions.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <HardDrive className="w-4 h-4" />
              Disk Partitions ({data.diskPartitions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {data.diskPartitions.map((partition: any, idx: number) => (
                <div key={idx} className="p-3 rounded-lg bg-muted/20 border border-border/50">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="font-mono text-sm font-semibold text-foreground">
                        {partition.mountpoint}
                      </p>
                      <p className="text-xs text-muted-foreground">{partition.filesystem}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-foreground">
                        {Math.round(partition.percentUsed)}%
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatBytes(partition.used)} / {formatBytes(partition.total)}
                      </p>
                    </div>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className={cn(
                        'h-full transition-all',
                        partition.percentUsed > 80
                          ? 'bg-red-500'
                          : partition.percentUsed > 60
                            ? 'bg-yellow-500'
                            : 'bg-emerald-500'
                      )}
                      style={{ width: `${Math.min(partition.percentUsed, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network Interfaces with IP */}
      {data.networkInterfaces && data.networkInterfaces.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Wifi className="w-4 h-4" />
              Network Interfaces ({data.networkInterfaces.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {data.networkInterfaces.map((iface: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 rounded-lg border border-border/50 bg-muted/20 text-center"
                >
                  <p className="text-xs font-semibold text-foreground">{iface.name}</p>
                  <p className="text-[11px] font-mono text-muted-foreground mt-0.5">
                    {iface.ipAddress}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Network I/O Statistics */}
      {data.networkIO && data.networkIO.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4" />
              Network I/O
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm">
              {data.networkIO.slice(0, 5).map((io: any, idx: number) => (
                <div key={idx} className="flex justify-between items-center p-2 bg-muted/20 rounded">
                  <span className="font-mono text-foreground">{io.interface}</span>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>↓ {formatBytes(io.bytesIn)}</span>
                    <span>↑ {formatBytes(io.bytesOut)}</span>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* User Sessions */}
      {data.userSessions && data.userSessions.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Users className="w-4 h-4" />
              Active Users ({data.userSessions.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.userSessions.map((session: any, idx: number) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 bg-muted/20 rounded border border-border/50"
                >
                  <div>
                    <p className="text-sm font-semibold text-foreground">{session.user}</p>
                    <p className="text-xs text-muted-foreground">{session.from}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{session.since}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open Ports */}
      {data.openPorts && data.openPorts.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Network className="w-4 h-4" />
              Open Ports ({data.openPorts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
              {data.openPorts.map((port: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 rounded-lg border border-border/50 bg-muted/20 text-center"
                >
                  <p className="text-sm font-mono font-bold text-foreground">{port.port}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Docker Containers */}
      {data.dockerContainers && data.dockerContainers.length > 0 && (
        <Card className="bg-card border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Container className="w-4 h-4" />
              Docker Containers ({data.dockerContainers.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.dockerContainers.map((container: any, idx: number) => (
                <div
                  key={idx}
                  className="p-2 rounded-lg border border-border/50 bg-muted/20"
                >
                  <p className="text-sm font-semibold text-foreground">{container.name}</p>
                  <p className="text-xs text-muted-foreground">{container.image}</p>
                  <p className="text-xs text-emerald-600 mt-1">{container.status}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
