import React, { useEffect, useState } from 'react';
import {
  Globe,
  Plus,
  Play,
  Square,
  Trash2,
  ArrowRightLeft,
  Server,
  Lock,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { connectionAPI, portForwardsAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

interface PortForward {
  id: string;
  name: string;
  type: 'local' | 'remote' | 'dynamic';
  localPort: number;
  remoteHost: string;
  remotePort: number;
  hostId: string;
  hostName?: string;
  status: 'active' | 'stopped';
}

const typeColors = {
  local: 'bg-primary/10 text-primary',
  remote: 'bg-accent/10 text-accent',
  dynamic: 'bg-warning/10 text-warning',
};

export const PortForwarding: React.FC = () => {
  const { toast } = useToast();
  const [forwards, setForwards] = useState<PortForward[]>([]);
  const [hosts, setHosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState({
    name: '',
    type: 'local' as 'local' | 'remote' | 'dynamic',
    hostId: '',
    localPort: '5432',
    remotePort: '5432',
    remoteHost: 'localhost',
  });

  const loadData = async () => {
    setLoading(true);
    try {
      const [forwardsData, connections] = await Promise.all([
        portForwardsAPI.getAll(),
        connectionAPI.getAll(),
      ]);
      const onlineHosts = connections.filter((connection: any) => connection.type === 'ssh' && connection.status === 'online');
      setForwards(forwardsData as PortForward[]);
      setHosts(onlineHosts);
      if (onlineHosts.length > 0 && !form.hostId) {
        setForm((prev) => ({ ...prev, hostId: onlineHosts[0].id }));
      }
    } catch (error: any) {
      toast({
        title: 'Failed to load port forwards',
        description: error.message || 'Unable to load tunnel data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const createForward = async () => {
    if (!form.name || !form.hostId || !form.localPort) {
      toast({ title: 'Missing fields', description: 'Name, host and local port are required', variant: 'destructive' });
      return;
    }

    try {
      await portForwardsAPI.create({
        name: form.name,
        type: form.type,
        hostId: form.hostId,
        localPort: Number(form.localPort),
        remotePort: Number(form.remotePort || 0),
        remoteHost: form.remoteHost || 'localhost',
      });
      toast({ title: 'Tunnel created' });
      setDialogOpen(false);
      setForm((prev) => ({ ...prev, name: '' }));
      await loadData();
    } catch (error: any) {
      toast({ title: 'Create failed', description: error.message || 'Unable to create tunnel', variant: 'destructive' });
    }
  };

  const toggleForward = async (id: string) => {
    try {
      const response = await portForwardsAPI.toggle(id);
      toast({ title: response.message });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Toggle failed', description: error.message || 'Unable to toggle tunnel', variant: 'destructive' });
    }
  };

  const deleteForward = async (id: string, name: string) => {
    if (!confirm(`Delete tunnel "${name}"?`)) return;
    try {
      await portForwardsAPI.delete(id);
      toast({ title: 'Tunnel deleted' });
      await loadData();
    } catch (error: any) {
      toast({ title: 'Delete failed', description: error.message || 'Unable to delete tunnel', variant: 'destructive' });
    }
  };

  const activeCount = forwards.filter((forward) => forward.status === 'active').length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Port Forwarding</h1>
          <p className="text-muted-foreground">Manage SSH tunnel configurations</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Tunnel
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create Port Forward</DialogTitle>
              <DialogDescription>Create a new tunnel configuration.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Tunnel Name</Label>
                <Input value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Type</Label>
                <Select value={form.type} onValueChange={(value: 'local' | 'remote' | 'dynamic') => setForm((prev) => ({ ...prev, type: value }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local Forward (-L)</SelectItem>
                    <SelectItem value="remote">Remote Forward (-R)</SelectItem>
                    <SelectItem value="dynamic">Dynamic SOCKS (-D)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>SSH Host</Label>
                <Select value={form.hostId} onValueChange={(value) => setForm((prev) => ({ ...prev, hostId: value }))}>
                  <SelectTrigger><SelectValue placeholder="Select a host" /></SelectTrigger>
                  <SelectContent>
                    {hosts.map((host) => (
                      <SelectItem key={host.id} value={host.id}>{host.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Local Port</Label>
                  <Input type="number" value={form.localPort} onChange={(e) => setForm((prev) => ({ ...prev, localPort: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Remote Port</Label>
                  <Input type="number" value={form.remotePort} onChange={(e) => setForm((prev) => ({ ...prev, remotePort: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Remote Host</Label>
                <Input value={form.remoteHost} onChange={(e) => setForm((prev) => ({ ...prev, remoteHost: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
              <Button onClick={createForward}>Create Tunnel</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10"><Globe className="w-6 h-6 text-success" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Active Tunnels</p>
                <p className="text-2xl font-bold">{activeCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-muted"><ArrowRightLeft className="w-6 h-6 text-muted-foreground" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Total Configured</p>
                <p className="text-2xl font-bold">{forwards.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10"><Lock className="w-6 h-6 text-primary" /></div>
              <div>
                <p className="text-sm text-muted-foreground">Encrypted</p>
                <p className="text-2xl font-bold">100%</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <Card><CardContent className="py-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {forwards.map((forward) => {
            const isActive = forward.status === 'active';

            return (
              <Card key={forward.id} className="hover:border-primary/50 transition-colors">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold">{forward.name}</h3>
                        <Badge className={cn('text-xs capitalize', typeColors[forward.type])}>{forward.type}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground flex items-center gap-1">
                        <Server className="w-3 h-3" />
                        {forward.hostName || forward.hostId}
                      </p>
                    </div>
                    <div className={cn('w-2.5 h-2.5 rounded-full', isActive ? 'bg-success pulse-online' : 'bg-muted-foreground')} />
                  </div>

                  <div className="font-mono text-sm bg-muted/50 rounded-lg p-3 mb-4">
                    {forward.type === 'dynamic'
                      ? `localhost:${forward.localPort} (SOCKS)`
                      : `localhost:${forward.localPort} → ${forward.remoteHost}:${forward.remotePort}`}
                  </div>

                  <div className="flex gap-2">
                    <Button size="sm" variant={isActive ? 'secondary' : 'default'} onClick={() => toggleForward(forward.id)}>
                      {isActive ? <Square className="w-4 h-4 mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                      {isActive ? 'Stop' : 'Start'}
                    </Button>
                    <Button size="sm" variant="outline" className="text-destructive" onClick={() => deleteForward(forward.id, forward.name)}>
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};
