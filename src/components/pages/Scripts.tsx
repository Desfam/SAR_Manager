import React, { useEffect, useState } from 'react';
import {
  FileCode,
  Plus,
  Play,
  Trash2,
  Clock,
  Server,
  CheckSquare,
  Loader2,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { connectionAPI, scriptsAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface ScriptItem {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'bash' | 'powershell' | 'python';
  tags: string[];
  updated_at?: string;
}

const typeIcons = {
  bash: '🐧',
  powershell: '💠',
  python: '🐍',
};

const typeColors = {
  bash: 'bg-success/10 text-success',
  powershell: 'bg-primary/10 text-primary',
  python: 'bg-warning/10 text-warning',
};

export const Scripts: React.FC = () => {
  const { toast } = useToast();
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [selectedHosts, setSelectedHosts] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningScriptId, setRunningScriptId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newScript, setNewScript] = useState({
    name: '',
    description: '',
    type: 'bash' as 'bash' | 'powershell' | 'python',
    content: '#!/bin/bash\n\necho "Hello from script"',
    tags: '',
  });

  const loadData = async () => {
    try {
      setLoading(true);
      const [scriptsData, connectionsData] = await Promise.all([
        scriptsAPI.getAll(),
        connectionAPI.getAll(),
      ]);

      setScripts((scriptsData as any[]).map((script) => ({
        ...script,
        type: (script.type || script.script_type || 'bash') as 'bash' | 'powershell' | 'python',
        tags: Array.isArray(script.tags) ? script.tags : [],
      })));

      const onlineSSH = connectionsData.filter((connection: any) => connection.type === 'ssh' && connection.status === 'online');
      setConnections(onlineSSH);
      if (onlineSSH.length > 0 && selectedHosts.length === 0) {
        setSelectedHosts([onlineSSH[0].id]);
      }
    } catch (error: any) {
      toast({
        title: 'Failed to load scripts',
        description: error.message || 'Unable to fetch scripts data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const toggleHost = (hostId: string) => {
    setSelectedHosts((prev) =>
      prev.includes(hostId) ? prev.filter((id) => id !== hostId) : [...prev, hostId]
    );
  };

  const createScript = async () => {
    if (!newScript.name.trim() || !newScript.content.trim()) {
      toast({
        title: 'Missing fields',
        description: 'Script name and content are required',
        variant: 'destructive',
      });
      return;
    }

    try {
      await scriptsAPI.create({
        name: newScript.name,
        description: newScript.description,
        type: newScript.type,
        content: newScript.content,
        tags: newScript.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      } as any);

      toast({ title: 'Script created' });
      setCreateOpen(false);
      setNewScript({
        name: '',
        description: '',
        type: 'bash',
        content: '#!/bin/bash\n\necho "Hello from script"',
        tags: '',
      });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Create failed',
        description: error.message || 'Unable to create script',
        variant: 'destructive',
      });
    }
  };

  const runScript = async (scriptId: string, scriptName: string) => {
    if (selectedHosts.length === 0) {
      toast({
        title: 'No target host selected',
        description: 'Select at least one host to execute scripts',
        variant: 'destructive',
      });
      return;
    }

    const targetHostId = selectedHosts[0];
    setRunningScriptId(scriptId);
    try {
      const response = await scriptsAPI.execute(scriptId, targetHostId);
      toast({
        title: response.status === 'success' ? 'Script executed' : 'Script failed',
        description: `${scriptName} (${response.exitCode})`,
        variant: response.status === 'success' ? 'default' : 'destructive',
      });
    } catch (error: any) {
      toast({
        title: 'Execution failed',
        description: error.message || 'Unable to run script',
        variant: 'destructive',
      });
    } finally {
      setRunningScriptId(null);
    }
  };

  const deleteScript = async (scriptId: string, scriptName: string) => {
    if (!confirm(`Delete script "${scriptName}"?`)) return;

    try {
      await scriptsAPI.delete(scriptId);
      toast({ title: 'Script deleted' });
      await loadData();
    } catch (error: any) {
      toast({
        title: 'Delete failed',
        description: error.message || 'Unable to delete script',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Scripts</h1>
          <p className="text-muted-foreground">Automate tasks across your servers</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              New Script
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create New Script</DialogTitle>
              <DialogDescription>Write and save a script for remote execution.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Script Name</Label>
                  <Input value={newScript.name} onChange={(e) => setNewScript((prev) => ({ ...prev, name: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Type</Label>
                  <div className="flex gap-2">
                    {(['bash', 'powershell', 'python'] as const).map((type) => (
                      <Button
                        key={type}
                        variant={newScript.type === type ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => setNewScript((prev) => ({ ...prev, type }))}
                      >
                        {typeIcons[type]} {type}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Description</Label>
                <Input value={newScript.description} onChange={(e) => setNewScript((prev) => ({ ...prev, description: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Tags (comma separated)</Label>
                <Input value={newScript.tags} onChange={(e) => setNewScript((prev) => ({ ...prev, tags: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Script Content</Label>
                <Textarea className="font-mono h-48" value={newScript.content} onChange={(e) => setNewScript((prev) => ({ ...prev, content: e.target.value }))} />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button onClick={createScript}>Create Script</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <Card><CardContent className="py-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto text-muted-foreground" /></CardContent></Card>
          ) : scripts.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-muted-foreground">No scripts yet.</CardContent></Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scripts.map((script) => (
                <Card key={script.id} className="hover:border-primary/50 transition-colors">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-lg', typeColors[script.type])}>
                          {typeIcons[script.type]}
                        </div>
                        <div>
                          <h3 className="font-semibold">{script.name}</h3>
                          <p className="text-xs text-muted-foreground line-clamp-1">{script.description}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="capitalize">{script.type}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {script.tags.map((tag) => (
                        <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
                      ))}
                    </div>

                    {script.updated_at && (
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                        <Clock className="w-3.5 h-3.5" />
                        <span>Updated: {new Date(script.updated_at).toLocaleString()}</span>
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Button size="sm" onClick={() => runScript(script.id, script.name)} disabled={runningScriptId === script.id || selectedHosts.length === 0}>
                        {runningScriptId === script.id ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Play className="w-4 h-4 mr-1" />}
                        Run
                      </Button>
                      <Button size="sm" variant="outline" className="text-destructive" onClick={() => deleteScript(script.id, script.name)}>
                        <Trash2 className="w-4 h-4 mr-1" />
                        Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Server className="w-5 h-5" />
                Target Hosts
              </CardTitle>
              <CardDescription>Select servers to run scripts on (first selected host is used).</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {connections.map((host) => (
                  <div key={host.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors cursor-pointer" onClick={() => toggleHost(host.id)}>
                    <Checkbox checked={selectedHosts.includes(host.id)} />
                    <div className="flex-1">
                      <p className="font-medium text-sm">{host.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">{host.host}</p>
                    </div>
                    <div className="w-2 h-2 rounded-full bg-success" />
                  </div>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t border-border">
                <Button className="w-full" variant="outline" disabled={selectedHosts.length === 0}>
                  <CheckSquare className="w-4 h-4 mr-2" />
                  {selectedHosts.length} host{selectedHosts.length !== 1 ? 's' : ''} selected
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
