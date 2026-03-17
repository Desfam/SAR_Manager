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
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface Agent {
  id: string;
  name: string;
  hostname: string;
  os: string;
  platform: string;
  version: string;
  tags: string[];
  environment: string;
  status: 'online' | 'offline' | 'error' | 'stale';
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

interface AgentConnection {
  id: number;
  protocol?: string;
  local_address?: string;
  remote_address?: string;
  state?: string;
  pid?: number;
  process_name?: string;
  timestamp?: string;
}

interface AgentSecurityAlert {
  id: number;
  agent_id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  evidence?: string;
  is_resolved: number;
  created_at: string;
}

type FeatureKey =
  | 'metrics'
  | 'security_audits'
  | 'command_execution'
  | 'file_collection'
  | 'service_inspection'
  | 'artifact_upload';

interface AgentProfile {
  id: string;
  name: string;
  description?: string;
  features: Record<string, boolean>;
}

interface EffectivePolicy {
  profile_id: string;
  features: Record<string, boolean>;
  metrics_interval_seconds: number;
  audit_interval_seconds: number;
}

interface StoredPolicy {
  profile_id: string;
  feature_overrides: Record<string, boolean>;
  metrics_interval_seconds: number;
  audit_interval_seconds: number;
}

interface AgentPolicyResponse {
  effective: EffectivePolicy;
  stored: StoredPolicy | null;
}

interface AgentJob {
  id: string;
  agent_id: string;
  job_type: string;
  audit_type?: string;
  status: 'pending' | 'sent' | 'running' | 'completed' | 'failed';
  created_at: string;
  completed_at?: string;
}

interface AuditFinding {
  id: string;
  severity: string;
  status: string;
  message: string;
  detail?: string;
}

interface AuditResult {
  id: number;
  job_id: string;
  audit_type: string;
  status: string;
  score: number;
  passed: number;
  failed: number;
  warnings: number;
  findings: AuditFinding[];
  created_at: string;
}

const FEATURE_LABELS: Record<FeatureKey, string> = {
  metrics: 'Metrics',
  security_audits: 'Security Audits',
  command_execution: 'Command Execution',
  file_collection: 'File Collection',
  service_inspection: 'Service Inspection',
  artifact_upload: 'Artifact Upload',
};

const AUDIT_TYPES = [
  'linux_baseline_audit',
  'ssh_hardening_audit',
  'patch_status_audit',
  'filesystem_permissions_audit',
];

export const Agents: React.FC = () => {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [agentMetrics, setAgentMetrics] = useState<AgentMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [connectionsLoading, setConnectionsLoading] = useState(false);
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);
  const [securityAlerts, setSecurityAlerts] = useState<AgentSecurityAlert[]>([]);
  const [commandDialog, setCommandDialog] = useState(false);
  const [command, setCommand] = useState('');
  const [commandArgs, setCommandArgs] = useState('');
  const [profiles, setProfiles] = useState<AgentProfile[]>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policySaving, setPolicySaving] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState('standard-linux');
  const [featureOverrides, setFeatureOverrides] = useState<Record<FeatureKey, boolean>>({
    metrics: true,
    security_audits: true,
    command_execution: true,
    file_collection: false,
    service_inspection: true,
    artifact_upload: false,
  });
  const [metricsInterval, setMetricsInterval] = useState(30);
  const [auditInterval, setAuditInterval] = useState(3600);
  const [auditType, setAuditType] = useState('linux_baseline_audit');
  const [auditResults, setAuditResults] = useState<AuditResult[]>([]);
  const [auditResultsLoading, setAuditResultsLoading] = useState(false);
  const [jobSubmitting, setJobSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadAgents();
    const interval = setInterval(loadAgents, 30000); // Refresh every 30s
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedAgent) {
      loadAgentMetrics(selectedAgent.id);
      loadAgentConnections(selectedAgent.id);
      loadAgentAlerts(selectedAgent.id);
      loadProfiles();
      loadPolicy(selectedAgent.id);
      loadAuditResults(selectedAgent.id);
      const metricsInterval = setInterval(() => loadAgentMetrics(selectedAgent.id), 10000);
      const connectionsInterval = setInterval(() => loadAgentConnections(selectedAgent.id), 10000);
      const alertsInterval = setInterval(() => loadAgentAlerts(selectedAgent.id), 15000);
      const auditInterval = setInterval(() => loadAuditResults(selectedAgent.id), 20000);
      return () => {
        clearInterval(metricsInterval);
        clearInterval(connectionsInterval);
        clearInterval(alertsInterval);
        clearInterval(auditInterval);
      };
    }
  }, [selectedAgent]);

  useEffect(() => {
    if (!selectedAgent) {
      setConnections([]);
      setSecurityAlerts([]);
      setAuditResults([]);
    }
  }, [selectedAgent]);

  const mapFeatures = (features: Record<string, boolean> | undefined): Record<FeatureKey, boolean> => ({
    metrics: !!features?.metrics,
    security_audits: !!features?.security_audits,
    command_execution: !!features?.command_execution,
    file_collection: !!features?.file_collection,
    service_inspection: !!features?.service_inspection,
    artifact_upload: !!features?.artifact_upload,
  });

  const loadProfiles = async () => {
    try {
      const response = await fetch('/api/agents/profiles');
      if (!response.ok) return;
      const data = await response.json();
      setProfiles(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading profiles:', error);
    }
  };

  const loadPolicy = async (agentId: string) => {
    setPolicyLoading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/policy`);
      if (!response.ok) return;
      const data: AgentPolicyResponse = await response.json();
      setSelectedProfile(data.stored?.profile_id || data.effective.profile_id || 'standard-linux');
      setFeatureOverrides(mapFeatures(data.effective.features));
      setMetricsInterval(data.effective.metrics_interval_seconds || 30);
      setAuditInterval(data.effective.audit_interval_seconds || 3600);
    } catch (error) {
      console.error('Error loading policy:', error);
    } finally {
      setPolicyLoading(false);
    }
  };

  const savePolicy = async () => {
    if (!selectedAgent) return;
    setPolicySaving(true);
    try {
      const response = await fetch(`/api/agents/${selectedAgent.id}/policy`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profile_id: selectedProfile,
          feature_overrides: featureOverrides,
          metrics_interval_seconds: metricsInterval,
          audit_interval_seconds: auditInterval,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save policy');
      }

      toast({ title: 'Policy saved', description: 'Agent policy has been updated.' });
      loadPolicy(selectedAgent.id);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to save policy', variant: 'destructive' });
    } finally {
      setPolicySaving(false);
    }
  };

  const runAudit = async () => {
    if (!selectedAgent) return;
    setJobSubmitting(true);
    try {
      const response = await fetch(`/api/agents/${selectedAgent.id}/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          job_type: 'security_audit',
          audit_type: auditType,
          requested_by: 'web-ui',
          options: {},
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to create audit job');
      }

      const job: AgentJob = await response.json();
      toast({
        title: 'Audit job created',
        description: `Job ${job.id} queued for ${selectedAgent.name}`,
      });

      setTimeout(() => loadAuditResults(selectedAgent.id), 3000);
    } catch (error) {
      toast({ title: 'Error', description: 'Failed to start audit', variant: 'destructive' });
    } finally {
      setJobSubmitting(false);
    }
  };

  const loadAuditResults = async (agentId: string) => {
    setAuditResultsLoading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/audit-results?limit=10`);
      if (!response.ok) return;
      const data = await response.json();
      setAuditResults(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Error loading audit results:', error);
    } finally {
      setAuditResultsLoading(false);
    }
  };

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

  const loadAgentConnections = async (agentId: string) => {
    setConnectionsLoading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/connections?limit=100`);
      if (response.ok) {
        const data = await response.json();
        setConnections(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading connections:', error);
    } finally {
      setConnectionsLoading(false);
    }
  };

  const loadAgentAlerts = async (agentId: string) => {
    setAlertsLoading(true);
    try {
      const response = await fetch(`/api/agents/${agentId}/alerts?limit=25`);
      if (response.ok) {
        const data = await response.json();
        setSecurityAlerts(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error loading security alerts:', error);
    } finally {
      setAlertsLoading(false);
    }
  };

  const resolveAgentAlert = async (alertId: number) => {
    try {
      const response = await fetch(`/api/agents/alerts/${alertId}/resolve`, {
        method: 'POST',
      });
      if (response.ok && selectedAgent) {
        loadAgentAlerts(selectedAgent.id);
      }
    } catch (error) {
      console.error('Error resolving agent alert:', error);
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
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Agent Policy</CardTitle>
                  <CardDescription>
                    Profile, feature toggles and intervals pushed to this agent
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="space-y-2">
                      <Label>Profile</Label>
                      <Select
                        value={selectedProfile}
                        onValueChange={(value) => {
                          setSelectedProfile(value);
                          const profile = profiles.find((p) => p.id === value);
                          if (profile) {
                            setFeatureOverrides(mapFeatures(profile.features));
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select profile" />
                        </SelectTrigger>
                        <SelectContent>
                          {profiles.map((profile) => (
                            <SelectItem key={profile.id} value={profile.id}>
                              {profile.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Metrics Interval (sec)</Label>
                      <Input
                        type="number"
                        min={5}
                        value={metricsInterval}
                        onChange={(e) => setMetricsInterval(Number(e.target.value) || 30)}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>Audit Interval (sec)</Label>
                      <Input
                        type="number"
                        min={60}
                        value={auditInterval}
                        onChange={(e) => setAuditInterval(Number(e.target.value) || 3600)}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {(Object.keys(FEATURE_LABELS) as FeatureKey[]).map((key) => (
                      <div key={key} className="flex items-center justify-between border rounded-md px-3 py-2">
                        <Label className="text-sm">{FEATURE_LABELS[key]}</Label>
                        <Switch
                          checked={featureOverrides[key]}
                          onCheckedChange={(checked) =>
                            setFeatureOverrides((prev) => ({ ...prev, [key]: checked }))
                          }
                        />
                      </div>
                    ))}
                  </div>

                  <div className="flex justify-end">
                    <Button onClick={savePolicy} disabled={policyLoading || policySaving}>
                      {policySaving ? 'Saving...' : 'Save Policy'}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Security Audit Jobs</CardTitle>
                  <CardDescription>
                    Trigger structured audits and review latest results
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    <div className="space-y-2 lg:col-span-2">
                      <Label>Audit Type</Label>
                      <Select value={auditType} onValueChange={setAuditType}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select audit" />
                        </SelectTrigger>
                        <SelectContent>
                          {AUDIT_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {type}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end">
                      <Button onClick={runAudit} disabled={jobSubmitting || selectedAgent.status !== 'online'} className="w-full">
                        {jobSubmitting ? 'Starting...' : 'Run Audit'}
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Latest Audit Results</Label>
                      <Button variant="outline" size="sm" onClick={() => loadAuditResults(selectedAgent.id)}>
                        Refresh
                      </Button>
                    </div>

                    <div className="max-h-72 overflow-auto scrollbar-thin border rounded-md">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Type</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Score</TableHead>
                            <TableHead>Summary</TableHead>
                            <TableHead>Time</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {auditResultsLoading && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground">
                                Loading audit results...
                              </TableCell>
                            </TableRow>
                          )}

                          {!auditResultsLoading && auditResults.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="text-center text-muted-foreground">
                                No audit results yet
                              </TableCell>
                            </TableRow>
                          )}

                          {!auditResultsLoading && auditResults.map((result) => (
                            <TableRow key={result.id}>
                              <TableCell>{result.audit_type}</TableCell>
                              <TableCell>
                                <Badge variant={result.status === 'success' ? 'default' : 'destructive'}>
                                  {result.status}
                                </Badge>
                              </TableCell>
                              <TableCell>{result.score}</TableCell>
                              <TableCell>
                                {result.passed}/{result.failed}/{result.warnings}
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {new Date(result.created_at).toLocaleString()}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </CardContent>
              </Card>

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

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Live Connections</CardTitle>
                      <CardDescription>
                        Protocol and process-level socket snapshot from agent telemetry
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="max-h-80 overflow-auto scrollbar-thin">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>Protocol</TableHead>
                              <TableHead>State</TableHead>
                              <TableHead>Local</TableHead>
                              <TableHead>Remote</TableHead>
                              <TableHead>Process</TableHead>
                              <TableHead>PID</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {connectionsLoading && (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground">
                                  Loading live connections...
                                </TableCell>
                              </TableRow>
                            )}
                            {!connectionsLoading && connections.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={6} className="text-center text-muted-foreground">
                                  No live connection data from this agent yet
                                </TableCell>
                              </TableRow>
                            )}
                            {!connectionsLoading && connections.map((conn) => (
                              <TableRow key={conn.id}>
                                <TableCell>{conn.protocol || '-'}</TableCell>
                                <TableCell>
                                  <Badge variant={conn.state === 'ESTABLISHED' ? 'default' : 'secondary'}>
                                    {conn.state || '-'}
                                  </Badge>
                                </TableCell>
                                <TableCell className="font-mono text-xs">{conn.local_address || '-'}</TableCell>
                                <TableCell className="font-mono text-xs">{conn.remote_address || '-'}</TableCell>
                                <TableCell>{conn.process_name || '-'}</TableCell>
                                <TableCell>{conn.pid || '-'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-sm">Security Alerts</CardTitle>
                      <CardDescription>
                        Automatic anomaly alerts from live connection behavior
                      </CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-2">
                        {alertsLoading && (
                          <p className="text-sm text-muted-foreground">Loading alerts...</p>
                        )}

                        {!alertsLoading && securityAlerts.length === 0 && (
                          <p className="text-sm text-muted-foreground">No alerts for this agent</p>
                        )}

                        {!alertsLoading && securityAlerts.map((alert) => (
                          <div key={alert.id} className="rounded-md border p-3 flex items-start justify-between gap-4">
                            <div className="space-y-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge
                                  variant={
                                    alert.severity === 'critical'
                                      ? 'destructive'
                                      : alert.severity === 'warning'
                                        ? 'secondary'
                                        : 'outline'
                                  }
                                >
                                  {alert.severity}
                                </Badge>
                                <Badge variant="outline">{alert.alert_type.replace(/_/g, ' ')}</Badge>
                                <span className="text-xs text-muted-foreground">
                                  {new Date(alert.created_at).toLocaleString()}
                                </span>
                              </div>
                              <p className="text-sm">{alert.message}</p>
                            </div>
                            {!alert.is_resolved && (
                              <Button size="sm" variant="outline" onClick={() => resolveAgentAlert(alert.id)}>
                                Resolve
                              </Button>
                            )}
                          </div>
                        ))}
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
