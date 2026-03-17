import React, { useState, useEffect } from 'react';
import {
  Container,
  Play,
  Square,
  RefreshCw,
  Trash2,
  MoreVertical,
  Cpu,
  HardDrive,
  Clock,
  Server,
  FileText,
  Info,
  X,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { dockerAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { DockerContainer } from '@/types/connection';
import { useToast } from '@/hooks/use-toast';

const statusColors = {
  running: 'bg-success text-success-foreground',
  stopped: 'bg-muted text-muted-foreground',
  paused: 'bg-warning text-warning-foreground',
  restarting: 'bg-primary text-primary-foreground',
};

const ContainerCard: React.FC<{ 
  container: DockerContainer; 
  onRefresh: () => void;
  onViewLogs: (container: DockerContainer) => void;
  onInspect: (container: DockerContainer) => void;
}> = ({ container, onRefresh, onViewLogs, onInspect }) => {
  const { toast } = useToast();

  const handleAction = async (action: string) => {
    try {
      switch (action) {
        case 'start':
          await dockerAPI.remote.start(container.hostId, container.id);
          toast({ title: 'Container started' });
          break;
        case 'stop':
          await dockerAPI.remote.stop(container.hostId, container.id);
          toast({ title: 'Container stopped' });
          break;
        case 'restart':
          await dockerAPI.remote.restart(container.hostId, container.id);
          toast({ title: 'Container restarted' });
          break;
        case 'remove':
          if (confirm('Are you sure you want to remove this container?')) {
            await dockerAPI.remote.remove(container.hostId, container.id, true);
            toast({ title: 'Container removed' });
          }
          break;
      }
      setTimeout(onRefresh, 1000); // Refresh after a short delay
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Action failed',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Container className="w-5 h-5 text-accent" />
            </div>
            <div>
              <h3 className="font-semibold">{container.name}</h3>
              <p className="text-xs text-muted-foreground font-mono">{container.image}</p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {container.status === 'running' ? (
                <>
                  <DropdownMenuItem onClick={() => handleAction('stop')}>
                    <Square className="w-4 h-4 mr-2" />
                    Stop
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => handleAction('restart')}>
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Restart
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => handleAction('start')}>
                  <Play className="w-4 h-4 mr-2" />
                  Start
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => onViewLogs(container)}>
                <FileText className="w-4 h-4 mr-2" />
                View Logs
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onInspect(container)}>
                <Info className="w-4 h-4 mr-2" />
                Inspect
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem 
                className="text-destructive"
                onClick={() => handleAction('remove')}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="flex items-center gap-2 mb-3">
          <Badge className={cn('text-xs', statusColors[container.status])}>
            {container.status}
          </Badge>
          {container.ports && container.ports.trim() && (
            <Badge variant="outline" className="text-xs font-mono">
              {container.ports}
            </Badge>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Server className="w-3.5 h-3.5" />
            <span>{container.hostName || 'Unknown host'}</span>
          </div>
          <div className="flex items-center gap-2 text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span className="text-xs">{container.statusText}</span>
          </div>
        </div>

        {container.status === 'running' && (
          <div className="mt-4 pt-3 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <Cpu className="w-3 h-3 text-muted-foreground" />
                <span>CPU</span>
              </div>
              <span>{container.cpu}%</span>
            </div>
            <Progress value={container.cpu} className="h-1" />
            <div className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1">
                <HardDrive className="w-3 h-3 text-muted-foreground" />
                <span>Memory</span>
              </div>
              <span>{container.memory} MB</span>
            </div>
            <Progress value={Math.min((container.memory || 0) / 20, 100)} className="h-1" />
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export const Docker: React.FC = () => {
  const [selectedHost, setSelectedHost] = useState<string>('all');
  const [dockerContainers, setDockerContainers] = useState<DockerContainer[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsDialog, setLogsDialog] = useState<{ open: boolean; container?: DockerContainer; logs?: string; loading?: boolean }>({ open: false });
  const [inspectDialog, setInspectDialog] = useState<{ open: boolean; container?: DockerContainer; data?: any; loading?: boolean }>({ open: false });
  const { toast } = useToast();

  useEffect(() => {
    loadContainers();
  }, []);

  useEffect(() => {
    if (selectedHost !== 'all' || dockerContainers.length === 0) {
      return;
    }

    const preferredConnectionId = localStorage.getItem('preferredConnectionId');
    if (preferredConnectionId && dockerContainers.some((container) => container.hostId === preferredConnectionId)) {
      setSelectedHost(preferredConnectionId);
    }
  }, [dockerContainers, selectedHost]);

  const loadContainers = async () => {
    setLoading(true);
    try {
      const containers = await dockerAPI.scanAll();
      setDockerContainers(containers);
    } catch (error: any) {
      console.error('Failed to load containers:', error);
      toast({
        title: 'Error',
        description: 'Failed to load Docker containers',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleViewLogs = async (container: DockerContainer) => {
    setLogsDialog({ open: true, container, loading: true });
    try {
      const response = await dockerAPI.remote.getLogs(container.hostId, container.id, 500);
      setLogsDialog({ open: true, container, logs: response.logs, loading: false });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load logs',
        variant: 'destructive',
      });
      setLogsDialog({ open: false });
    }
  };

  const handleInspect = async (container: DockerContainer) => {
    setInspectDialog({ open: true, container, loading: true });
    try {
      const response = await dockerAPI.remote.inspect(container.hostId, container.id);
      setInspectDialog({ open: true, container, data: response.data, loading: false });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to inspect container',
        variant: 'destructive',
      });
      setInspectDialog({ open: false });
    }
  };

  const hosts = Array.from(
    new Map(
      dockerContainers.map((c) => [c.hostId, { id: c.hostId, name: c.hostName }])
    ).values()
  );

  const filteredContainers =
    selectedHost === 'all'
      ? dockerContainers
      : dockerContainers.filter((c) => c.hostId === selectedHost);

  const runningCount = dockerContainers.filter((c) => c.status === 'running').length;
  const stoppedCount = dockerContainers.filter((c) => c.status === 'stopped').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Docker Containers</h1>
          <p className="text-muted-foreground">Manage containers across your hosts</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedHost} onValueChange={setSelectedHost}>
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Select host" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Hosts</SelectItem>
              {hosts.map((host) => (
                <SelectItem key={host.id} value={host.id}>
                  {host.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadContainers} disabled={loading}>
            <RefreshCw className={cn("w-4 h-4 mr-2", loading && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-accent/10">
                <Container className="w-6 h-6 text-accent" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Total</p>
                <p className="text-2xl font-bold">{dockerContainers.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10">
                <Play className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Running</p>
                <p className="text-2xl font-bold">{runningCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-muted">
                <Square className="w-6 h-6 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Stopped</p>
                <p className="text-2xl font-bold">{stoppedCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Server className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Hosts</p>
                <p className="text-2xl font-bold">{hosts.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Container Grid */}
      {loading ? (
        <div className="text-center py-12 text-muted-foreground">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-2" />
          <p>Scanning connections for Docker containers...</p>
        </div>
      ) : filteredContainers.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Container className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p className="text-lg font-medium mb-2">No Docker containers found</p>
            <p className="text-sm">Make sure Docker is installed and running on your connections</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredContainers.map((container) => (
            <ContainerCard 
              key={container.id} 
              container={container} 
              onRefresh={loadContainers}
              onViewLogs={handleViewLogs}
              onInspect={handleInspect}
            />
          ))}
        </div>
      )}

      {/* Logs Dialog */}
      <Dialog open={logsDialog.open} onOpenChange={(open) => setLogsDialog({ open })}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Container Logs - {logsDialog.container?.name}</DialogTitle>
            <DialogDescription>
              {logsDialog.container?.hostName} • {logsDialog.container?.image}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            {logsDialog.loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p>Loading logs...</p>
              </div>
            ) : (
              <div className="bg-black/90 text-green-400 font-mono text-xs p-4 rounded-lg overflow-auto max-h-[60vh] whitespace-pre-wrap">
                {logsDialog.logs || 'No logs available'}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Inspect Dialog */}
      <Dialog open={inspectDialog.open} onOpenChange={(open) => setInspectDialog({ open })}>
        <DialogContent className="max-w-4xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle>Inspect Container - {inspectDialog.container?.name}</DialogTitle>
            <DialogDescription>
              {inspectDialog.container?.hostName} • {inspectDialog.container?.image}
            </DialogDescription>
          </DialogHeader>
          <div className="relative">
            {inspectDialog.loading ? (
              <div className="text-center py-8 text-muted-foreground">
                <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
                <p>Loading container details...</p>
              </div>
            ) : (
              <div className="bg-muted/50 font-mono text-xs p-4 rounded-lg overflow-auto max-h-[60vh]">
                <pre className="whitespace-pre-wrap">
                  {JSON.stringify(inspectDialog.data, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};
