import React, { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Play, Square, Server } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { proxmoxAPI, ProxmoxNode, ProxmoxVm } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { Input } from '@/components/ui/input';

export const Proxmox: React.FC = () => {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof proxmoxAPI.getStatus>> | null>(null);
  const [nodes, setNodes] = useState<ProxmoxNode[]>([]);
  const [selectedNode, setSelectedNode] = useState<string>('');
  const [proxmoxTarget, setProxmoxTarget] = useState<string>(() => localStorage.getItem('proxmoxTarget') || '');
  const [vms, setVms] = useState<ProxmoxVm[]>([]);
  const [loading, setLoading] = useState(true);
  const [vmLoading, setVmLoading] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);
  const { toast } = useToast();

  const sortedVms = useMemo(() => {
    return [...vms].sort((a, b) => Number(a.vmid) - Number(b.vmid));
  }, [vms]);

  const loadStatusAndNodes = async (targetOverride?: string) => {
    const target = (targetOverride ?? proxmoxTarget).trim();
    setLoading(true);
    try {
      const [statusData, nodesData] = await Promise.all([
        proxmoxAPI.getStatusForTarget(target || undefined),
        proxmoxAPI.getNodes(target || undefined),
      ]);

      setStatus(statusData);
      setNodes(nodesData);

      if (nodesData.length > 0) {
        setSelectedNode((prev) => prev || nodesData[0].node);
      }
    } catch (error: any) {
      toast({
        title: 'Proxmox connection failed',
        description: error.message || 'Unable to load Proxmox data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadVms = async (node: string, targetOverride?: string) => {
    const target = (targetOverride ?? proxmoxTarget).trim();
    if (!node) {
      setVms([]);
      return;
    }

    setVmLoading(true);
    try {
      const vmData = await proxmoxAPI.getVms(node, target || undefined);
      setVms(vmData);
    } catch (error: any) {
      toast({
        title: 'Failed to load VMs',
        description: error.message || 'Unable to fetch VM list',
        variant: 'destructive',
      });
      setVms([]);
    } finally {
      setVmLoading(false);
    }
  };

  const handlePowerAction = async (vm: ProxmoxVm, action: 'start' | 'stop') => {
    const key = `${vm.type}-${vm.vmid}-${action}`;
    const target = proxmoxTarget.trim();
    setActionKey(key);

    try {
      if (action === 'start') {
        await proxmoxAPI.startVm(selectedNode, vm.type, vm.vmid, target || undefined);
      } else {
        await proxmoxAPI.stopVm(selectedNode, vm.type, vm.vmid, target || undefined);
      }

      toast({
        title: `Power ${action} queued`,
        description: `${vm.name || `VM ${vm.vmid}`} (${vm.type.toUpperCase()})`,
      });

      setTimeout(() => {
        loadVms(selectedNode, target || undefined);
      }, 1200);
    } catch (error: any) {
      toast({
        title: `Failed to ${action} VM`,
        description: error.message || 'Action failed',
        variant: 'destructive',
      });
    } finally {
      setActionKey(null);
    }
  };

  useEffect(() => {
    loadStatusAndNodes(proxmoxTarget);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (selectedNode) {
      loadVms(selectedNode, proxmoxTarget);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode]);

  const handleConnect = async () => {
    const target = proxmoxTarget.trim();
    localStorage.setItem('proxmoxTarget', target);
    await loadStatusAndNodes(target);
    if (selectedNode) {
      await loadVms(selectedNode, target);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Server className="w-6 h-6 text-primary" />
            Proxmox
          </h1>
          <p className="text-muted-foreground">Manage your Proxmox nodes and VMs from this dashboard</p>
        </div>
        <Button variant="outline" onClick={loadStatusAndNodes} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Connection Status</CardTitle>
          <CardDescription>Enter Proxmox IP/host and connect using backend API token auth</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={proxmoxTarget}
              onChange={(e) => setProxmoxTarget(e.target.value)}
              placeholder="192.168.1.10 or proxmox.local:8006"
            />
            <Button onClick={handleConnect} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Connect
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={status?.connected ? 'default' : 'destructive'}>
              {status?.connected ? 'Connected' : 'Not Connected'}
            </Badge>
            {status?.version?.version && (
              <Badge variant="outline">Version {status.version.version}</Badge>
            )}
            {status?.apiUrl && (
              <span className="text-sm text-muted-foreground">Endpoint: {status.apiUrl}</span>
            )}
            {!status?.connected && status?.error && (
              <span className="text-sm text-destructive">{status.error}</span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Virtual Machines</CardTitle>
          <CardDescription>Select a node and control VM power state</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-xs">
            <Select value={selectedNode} onValueChange={setSelectedNode}>
              <SelectTrigger>
                <SelectValue placeholder="Select node" />
              </SelectTrigger>
              <SelectContent>
                {nodes.map((node) => (
                  <SelectItem key={node.node} value={node.node}>
                    {node.node} ({node.status || 'unknown'})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>VMID</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vmLoading && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    Loading VMs...
                  </TableCell>
                </TableRow>
              )}
              {!vmLoading && sortedVms.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    No VMs found for this node
                  </TableCell>
                </TableRow>
              )}
              {!vmLoading &&
                sortedVms.map((vm) => {
                  const isRunning = vm.status === 'running';
                  const startKey = `${vm.type}-${vm.vmid}-start`;
                  const stopKey = `${vm.type}-${vm.vmid}-stop`;

                  return (
                    <TableRow key={`${vm.type}-${vm.vmid}`}>
                      <TableCell className="font-mono">{vm.vmid}</TableCell>
                      <TableCell>{vm.name || '-'}</TableCell>
                      <TableCell className="uppercase">{vm.type}</TableCell>
                      <TableCell>
                        <Badge variant={isRunning ? 'default' : 'secondary'}>
                          {vm.status || 'unknown'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="inline-flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isRunning || actionKey === stopKey || actionKey === startKey}
                            onClick={() => handlePowerAction(vm, 'start')}
                          >
                            <Play className="w-3.5 h-3.5 mr-1" />
                            Start
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={!isRunning || actionKey === stopKey || actionKey === startKey}
                            onClick={() => handlePowerAction(vm, 'stop')}
                          >
                            <Square className="w-3.5 h-3.5 mr-1" />
                            Stop
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
