import React, { useState, useEffect } from 'react';
import { 
  Server, Activity, Cpu, HardDrive, Network, RefreshCw,
  Terminal, Trash2, Circle, ChevronRight, Clock, Tag
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

interface Agent {
  id: string;
  name: string;
  hostname: string;
  os: string;
  platform: string;
  version: string;
  tags: string[];
  environment: string;
  status: 'online' | 'offline' | 'error';
  last_seen: string;
  created_at: string;
  updated_at: string;
}

interface AgentMetrics {
  cpu_usage: number;
  cpu_cores: number;
  memory_total: number;
  memory_used: number;
  memory_percent: number;
  disk_total: number;
  disk_used: number;
  disk_percent: number;
  network_sent: number;
  network_recv: number;
  processes_total: number;
  processes_running: number;
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
  uptime: number;
  timestamp: string;
}

export const Agents: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [commandDialog, setCommandDialog] = useState(false);
  const [command, setCommand] = useState('');
  const [commandArgs, setCommandArgs] = useState('');
  const { toast } = useToast();

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadAgentMetrics(selectedAgent.id);
      const interval = setInterval(() => loadAgentMetrics(selectedAgent.id), 10000);
      return () => clearInterval(interval);
    }
  }, [selectedAgent]);

  const loadAgents = async () => {
    try {
      const response = await fetch('/api/agents');
      const data = await response.json();
      setAgents(data);
    } catch (error) {
      console.error('Error loading agents:', error);
      toast({
        title: 'Error',
        description: 'Failed to load agents',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadAgentMetrics = async (agentId: string) => {
    try {
      const response = await fetch(`/api/agents/${agentId}/metrics/latest`);
      if (response.ok) {
        const data = await response.json();
        setAgentMetrics(data);
      }
    } catch (error) {
      console.error('Error loading metrics:', error);
    }
  };

  const executeCommand = async () => {
    if (!selectedAgent || !command) return;

    try {
      const response = await fetch(`/api/agents/${selectedAgent.id}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          command,
          args: commandArgs ? commandArgs.split(' ') : [],
        }),
      });

      if (response.ok) {
        toast({
          title: 'Command Sent',
          description: 'Command has been sent to the agent',
        });
        setCommandDialog(false);
        setCommand('');
        setCommandArgs('');
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to execute command',
        variant: 'destructive',
      });
    }
  };

  const deleteAgent = async (agentId: string) => {
    if (!confirm('Are you sure you want to delete this agent?')) return;

    try {
      const response = await fetch(`/api/agents/${agentId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toast({
          title: 'Agent Deleted',
          description: 'Agent has been removed',
        });
        loadAgents();
        if (selectedAgent?.id === agentId) {
          setSelectedAgent(null);
        }
      }
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to delete agent',
        variant: 'destructive',
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': return 'text-green-500';
      case 'offline': return 'text-gray-400';
      case 'error': return 'text-red-500';
      default: return 'text-gray-400';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <RefreshCw className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent Management</h1>
          <p className="text-muted-foreground">
            Monitor and manage remote agents
          </p>
        </div>
        <Button onClick={loadAgents} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 min-h-0">
        {/* Agents List */}
        <Card className="lg:col-span-1 overflow-auto">
          <CardHeader>
            <CardTitle>Agents ({agents.length})</CardTitle>
            <CardDescription>Connected remote systems</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {agents.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Server className="w-12 h-12 mx-auto mb-2 opacity-50" />
                <p>No agents registered</p>
              </div>
            ) : (
              agents.map((agent) => (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgent(agent)}
                  className={cn(
                    'w-full p-3 rounded-lg border text-left transition-colors',
                    selectedAgent?.id === agent.id
                      ? 'bg-primary/10 border-primary'
                      : 'hover:bg-muted'
                  )}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Circle className={cn('w-2 h-2 fill-current', getStatusColor(agent.status))} />
                        <span className="font-medium truncate">{agent.name}</span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {agent.hostname}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {agent.os} · {agent.platform}
                      </p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {agent.tags.slice(0, 2).map((tag) => (
                          <Badge key={tag} variant="outline" className="text-xs">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Agent Details */}
        <div className="lg:col-span-2 space-y-6 overflow-auto">
          {selectedAgent ? (
            <>
              {/* Agent Info */}
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="flex items-center gap-2">
                        <Circle className={cn('w-3 h-3 fill-current', getStatusColor(selectedAgent.status))} />
                        {selectedAgent.name}
                      </CardTitle>
                      <CardDescription>{selectedAgent.hostname}</CardDescription>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => setCommandDialog(true)}
                        disabled={selectedAgent.status !== 'online'}
                        size="sm"
                      >
                        <Terminal className="w-4 h-4 mr-2" />
                        Execute Command
                      </Button>
                      <Button
                        onClick={() => deleteAgent(selectedAgent.id)}
                        variant="destructive"
                        size="sm"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Operating System</Label>
                      <p className="font-medium">{selectedAgent.os}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Platform</Label>
                      <p className="font-medium">{selectedAgent.platform}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Version</Label>
                      <p className="font-medium">{selectedAgent.version}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Environment</Label>
                      <Badge>{selectedAgent.environment}</Badge>
                    </div>
                  </div>
                  
                  <div>
                    <Label className="text-muted-foreground flex items-center gap-2">
                      <Tag className="w-4 h-4" />
                      Tags
                    </Label>
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {selectedAgent.tags.map((tag) => (
                        <Badge key={tag} variant="secondary">
                          {tag}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div>
                    <Label className="text-muted-foreground flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      Last Seen
                    </Label>
                    <p className="font-medium">
                      {new Date(selectedAgent.last_seen).toLocaleString()}
                    </p>
                  </div>
                </CardContent>
              </Card>

              {/* Metrics */}
              {agentMetrics && (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Cpu className="w-4 h-4" />
                          CPU Usage
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {agentMetrics.cpu_usage.toFixed(1)}%
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {agentMetrics.cpu_cores} cores
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Load: {agentMetrics.load_avg_1.toFixed(2)} / {agentMetrics.load_avg_5.toFixed(2)} / {agentMetrics.load_avg_15.toFixed(2)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Activity className="w-4 h-4" />
                          Memory
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {agentMetrics.memory_percent.toFixed(1)}%
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(agentMetrics.memory_used)} / {formatBytes(agentMetrics.memory_total)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <HardDrive className="w-4 h-4" />
                          Disk
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-2xl font-bold">
                          {agentMetrics.disk_percent.toFixed(1)}%
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {formatBytes(agentMetrics.disk_used)} / {formatBytes(agentMetrics.disk_total)}
                        </p>
                      </CardContent>
                    </Card>

                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Network className="w-4 h-4" />
                          Network
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="text-sm">
                          <p className="text-xs text-muted-foreground">
                            ↑ {formatBytes(agentMetrics.network_sent)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            ↓ {formatBytes(agentMetrics.network_recv)}
                          </p>
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">System Information</CardTitle>
                    </CardHeader>
                    <CardContent className="grid grid-cols-2 gap-4 text-sm">
                      <div>
                        <Label className="text-muted-foreground">Processes</Label>
                        <p>{agentMetrics.processes_running} running / {agentMetrics.processes_total} total</p>
                      </div>
                      <div>
                        <Label className="text-muted-foreground">Uptime</Label>
                        <p>{formatUptime(agentMetrics.uptime)}</p>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </>
          ) : (
            <Card className="h-full flex items-center justify-center">
              <CardContent className="text-center text-muted-foreground py-12">
                <Server className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <p>Select an agent to view details</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* Command Dialog */}
      <Dialog open={commandDialog} onOpenChange={setCommandDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Execute Command</DialogTitle>
            <DialogDescription>
              Run a command on {selectedAgent?.name}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="command">Command</Label>
              <Input
                id="command"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="systemctl"
              />
            </div>
            <div>
              <Label htmlFor="args">Arguments (space-separated)</Label>
              <Input
                id="args"
                value={commandArgs}
                onChange={(e) => setCommandArgs(e.target.value)}
                placeholder="status nginx"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCommandDialog(false)}>
              Cancel
            </Button>
            <Button onClick={executeCommand}>
              <Terminal className="w-4 h-4 mr-2" />
              Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
