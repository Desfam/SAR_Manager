import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Server,
  Monitor,
  Plus,
  Search,
  MoreVertical,
  Play,
  Trash2,
  Edit,
  Copy,
  ExternalLink,
  Key,
  Lock,
  RefreshCw,
  Loader2,
  Upload,
  Star,
  Terminal,
  Wifi,
  WifiOff,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { Label } from '@/components/ui/label';
import { connectionAPI, sshKeysAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { SSHConnection, RDPConnection } from '@/types/connection';
import { useToast } from '@/hooks/use-toast';
import { ConnectionDetail } from './ConnectionDetail';

const ConnectionCard: React.FC<{
  connection: SSHConnection | RDPConnection;
  type: 'ssh' | 'rdp';
  onDelete: (id: string) => void;
  onTest: (id: string) => void;
  onConnect: (connection: SSHConnection | RDPConnection) => void;
  onImportKey: (connection: SSHConnection | RDPConnection) => void;
  onViewDetails: (connection: SSHConnection | RDPConnection) => void;
  onEdit: (connection: SSHConnection | RDPConnection) => void;
  onToggleFavorite: (id: string) => void;
}> = ({ connection, type, onDelete, onTest, onConnect, onImportKey, onViewDetails, onEdit, onToggleFavorite }) => {
  const isOnline = connection.status === 'online';
  const { toast } = useToast();

  const formatLastSeen = (lastSeen?: string) => {
    if (!lastSeen) return 'Never';
    const now = new Date();
    const then = new Date(lastSeen);
    const diffMs = now.getTime() - then.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${diffDays}d ago`;
  };

  const authType = 'authType' in connection ? connection.authType : null;

  return (
    <Card className={cn(
      'group flex flex-col overflow-hidden transition-all duration-200 hover:shadow-lg',
      isOnline ? 'hover:border-emerald-500/40' : 'hover:border-muted-foreground/30'
    )}>
      {/* Status accent strip */}
      <div className={cn(
        'h-0.5 w-full shrink-0',
        isOnline ? 'bg-gradient-to-r from-emerald-500 to-emerald-400' : 'bg-muted-foreground/20'
      )} />
      <CardContent className="p-5 flex flex-col flex-1">
        {/* Top row: icon + name + actions */}
        <div className="flex items-start gap-3 mb-4">
          <div
            className={cn(
              'w-11 h-11 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200',
              type === 'ssh'
                ? isOnline ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'
                : isOnline ? 'bg-blue-500/15 text-blue-400'    : 'bg-muted text-muted-foreground'
            )}
          >
            {type === 'ssh' ? <Server className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </div>

          <div className="flex-1 min-w-0 cursor-pointer" onClick={() => onViewDetails(connection)}>
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-foreground truncate leading-tight">{connection.name}</h3>
              {connection.is_favorite && (
                <Star className="w-3 h-3 fill-yellow-400 text-yellow-400 shrink-0" />
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-0.5 truncate">
              {connection.username ? `${connection.username}@` : ''}{connection.host}:{connection.port}
            </p>
          </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <button
              className="p-1.5 rounded-md hover:bg-muted transition-colors"
              onClick={(e) => { e.stopPropagation(); onToggleFavorite(connection.id); }}
              title={connection.is_favorite ? 'Remove favorite' : 'Add favorite'}
            >
              <Star className={cn(
                'w-3.5 h-3.5 transition-colors',
                connection.is_favorite ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/50 hover:text-yellow-400'
              )} />
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-7 w-7">
                  <MoreVertical className="w-3.5 h-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                <DropdownMenuItem 
                  onClick={(e) => { 
                    e.preventDefault();
                    e.stopPropagation(); 
                    onTest(connection.id); 
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Play className="w-4 h-4 mr-2" />
                  Test Connection
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={(e) => { 
                    e.preventDefault();
                    e.stopPropagation(); 
                    onConnect(connection);
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Terminal className="w-4 h-4 mr-2" />
                  Open Terminal
                </DropdownMenuItem>
                {type === 'ssh' && (
                  <DropdownMenuItem 
                    onClick={(e) => { 
                      e.preventDefault();
                      e.stopPropagation(); 
                      onImportKey(connection); 
                    }}
                    onSelect={(e) => e.preventDefault()}
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    Import SSH Key
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  onClick={(e) => { 
                    e.preventDefault();
                    e.stopPropagation(); 
                    onEdit(connection); 
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem 
                  onClick={(e) => { 
                    e.preventDefault();
                    e.stopPropagation(); 
                    toast({ title: 'Coming Soon', description: 'Duplicate functionality will be added' });
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Copy className="w-4 h-4 mr-2" />
                  Duplicate
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem 
                  className="text-destructive"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (confirm(`Delete connection "${connection.name}"?`)) {
                      onDelete(connection.id);
                    }
                  }}
                  onSelect={(e) => e.preventDefault()}
                >
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Status + badges row */}
        <div className="flex items-center gap-2 flex-wrap mb-3">
          <div className={cn(
            'inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium shrink-0',
            isOnline
              ? 'bg-emerald-500/10 text-emerald-500'
              : 'bg-muted text-muted-foreground'
          )}>
            <div className={cn(
              'w-1.5 h-1.5 rounded-full',
              isOnline ? 'bg-emerald-500 animate-pulse' : 'bg-muted-foreground/60'
            )} />
            {isOnline ? 'Online' : formatLastSeen(connection.last_seen)}
          </div>

          <span className="text-xs font-mono uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {type}
          </span>

          {authType && (
            <span className={cn(
              'inline-flex items-center gap-1 text-xs',
              authType === 'key' ? 'text-emerald-500' : 'text-amber-500'
            )}>
              {authType === 'key'
                ? <Key className="w-3 h-3" />
                : <Lock className="w-3 h-3" />
              }
              {authType === 'key' ? 'Key' : 'Pwd'}
            </span>
          )}

          {connection.connection_group && (
            <Badge variant="outline" className="text-xs border-primary/30 text-primary/80 py-0">
              {connection.connection_group}
            </Badge>
          )}
        </div>

        {/* OS + tags */}
        <div className="mb-4 min-h-[1.25rem]">
          {isOnline && connection.os && (
            <p className="text-xs text-muted-foreground truncate mb-1.5">{connection.os}</p>
          )}
          {connection.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {connection.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="text-xs px-1.5 py-0.5 rounded-md bg-secondary/60 text-muted-foreground">
                  #{tag}
                </span>
              ))}
              {connection.tags.length > 3 && (
                <span className="text-xs text-muted-foreground">+{connection.tags.length - 3}</span>
              )}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 pt-3 border-t border-border mt-auto">
          <Button
            className="flex-1 h-8 text-xs gap-1.5"
            variant={isOnline ? 'default' : 'secondary'}
            size="sm"
            disabled={!isOnline}
            onClick={(e) => { e.stopPropagation(); onConnect(connection); }}
          >
            <Terminal className="w-3.5 h-3.5" />
            {isOnline ? 'Terminal' : 'Offline'}
          </Button>
          <Button
            className="h-8 w-8 shrink-0"
            variant="outline"
            size="icon"
            title="Test connection"
            onClick={(e) => { e.stopPropagation(); onTest(connection.id); }}
          >
            <Play className="w-3.5 h-3.5" />
          </Button>
          <Button
            className="h-8 w-8 shrink-0"
            variant="outline"
            size="icon"
            title="View details"
            onClick={() => onViewDetails(connection)}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export const Connections: React.FC = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [selectedGroup, setSelectedGroup] = useState<string>('all');
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editingConnectionId, setEditingConnectionId] = useState<string | null>(null);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const [selectedConnection, setSelectedConnection] = useState<SSHConnection | RDPConnection | null>(null);
  const [selectedDetailConnection, setSelectedDetailConnection] = useState<SSHConnection | RDPConnection | null>(null);
  const [sshKeys, setSshKeys] = useState<any[]>([]);
  const [importForm, setImportForm] = useState({
    keyName: '',
    password: '',
  });
  const [importing, setImporting] = useState(false);
  const [newConnection, setNewConnection] = useState({
    type: 'ssh',
    name: '',
    host: '',
    port: '22',
    username: '',
    authType: 'password',
    password: '',
  });
  const { toast } = useToast();

  // Load connections on mount
  useEffect(() => {
    loadConnections();
    loadSSHKeys();
  }, []);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const data = await connectionAPI.getAll();
      setConnections(data);
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to load connections',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const loadSSHKeys = async () => {
    try {
      const keys = await sshKeysAPI.getAll();
      setSshKeys(keys);
    } catch (error: any) {
      console.error('Failed to load SSH keys:', error);
    }
  };

  const handleImportKey = (connection: SSHConnection | RDPConnection) => {
    setSelectedConnection(connection);
    setImportForm({ keyName: '', password: '' });
    setIsImportDialogOpen(true);
  };

  const handleImportKeySubmit = async () => {
    if (!selectedConnection || !importForm.keyName || !importForm.password) {
      toast({
        title: 'Error',
        description: 'Please select a key and enter the password',
        variant: 'destructive',
      });
      return;
    }

    setImporting(true);
    try {
      const result = await sshKeysAPI.deploy(
        selectedConnection.id,
        importForm.keyName,
        importForm.password
      );

      toast({
        title: 'Success',
        description: result.message,
      });

      setIsImportDialogOpen(false);
      setImportForm({ keyName: '', password: '' });
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to import SSH key',
        variant: 'destructive',
      });
    } finally {
      setImporting(false);
    }
  };

  const handleSaveConnection = async () => {
    try {
      if (isEditMode && editingConnectionId) {
        // Update existing connection
        await connectionAPI.update(editingConnectionId, {
          ...newConnection,
          port: parseInt(newConnection.port),
        });
        
        toast({
          title: 'Success',
          description: 'Connection updated successfully',
        });
      } else {
        // Create new connection
        await connectionAPI.create({
          ...newConnection,
          port: parseInt(newConnection.port),
          tags: [],
          status: 'offline',
        });
        
        toast({
          title: 'Success',
          description: 'Connection created successfully',
        });
      }
      
      setIsDialogOpen(false);
      setIsEditMode(false);
      setEditingConnectionId(null);
      setNewConnection({
        type: 'ssh',
        name: '',
        host: '',
        port: '22',
        username: '',
        authType: 'password',
        password: '',
      });
      
      loadConnections();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to save connection',
        variant: 'destructive',
      });
    }
  };

  const handleEditConnection = (connection: SSHConnection | RDPConnection) => {
    setIsEditMode(true);
    setEditingConnectionId(connection.id);
    setNewConnection({
      type: connection.type,
      name: connection.name,
      host: connection.host,
      port: connection.port.toString(),
      username: connection.username,
      authType: 'authType' in connection ? connection.authType : 'password',
      password: '',
    });
    setIsDialogOpen(true);
  };

  const handleDeleteConnection = async (id: string) => {
    try {
      await connectionAPI.delete(id);
      toast({
        title: 'Success',
        description: 'Connection deleted successfully',
      });
      loadConnections();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to delete connection',
        variant: 'destructive',
      });
    }
  };

  const handleTestConnection = async (id: string) => {
    try {
      toast({
        title: 'Testing Connection',
        description: 'Please wait...',
      });
      
      const result = await connectionAPI.test(id);
      
      if (result.success) {
        toast({
          title: 'Success',
          description: result.message,
        });
        loadConnections();
      } else {
        toast({
          title: 'Failed',
          description: result.message,
          variant: 'destructive',
        });
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to test connection',
        variant: 'destructive',
      });
    }
  };

  const handleToggleFavorite = async (id: string) => {
    try {
      await connectionAPI.toggleFavorite(id);
      loadConnections();
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update favorite',
        variant: 'destructive',
      });
    }
  };

  const handleConnect = (connection: SSHConnection | RDPConnection) => {
    // Navigate to Terminal page with connection ID
    window.location.hash = `#terminal?connection=${connection.id}`;
    toast({
      title: 'Opening Terminal',
      description: `Connecting to ${connection.name}...`,
    });
  };

  const filterConnections = <T extends SSHConnection | RDPConnection>(connections: T[]) =>
    connections.filter(
      (c) => {
        // Group filter
        const groupMatch = selectedGroup === 'all' || 
          (selectedGroup === 'ungrouped' && !c.connection_group) ||
          c.connection_group === selectedGroup;
        
        // Search filter
        const searchMatch = c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          c.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (c.tags && c.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase())));
        
        return groupMatch && searchMatch;
      }
    );

  // Get unique groups
  const uniqueGroups = Array.from(new Set(
    connections
      .map(c => c.connection_group)
      .filter((g): g is string => !!g)
  )).sort();

  const sshConnections = connections.filter((c) => c.type === 'ssh') as SSHConnection[];
  const rdpConnections = connections.filter((c) => c.type === 'rdp') as RDPConnection[];
  const filteredSSH = filterConnections(sshConnections);
  const filteredRDP = filterConnections(rdpConnections);
  const allConnections = [...filteredSSH, ...filteredRDP];

  return (
    <>
      {selectedDetailConnection ? (
        <ConnectionDetail 
          connection={selectedDetailConnection} 
          onBack={() => setSelectedDetailConnection(null)}
          onNavigateToTab={(tab, connectionId) => {
            if (connectionId) {
              localStorage.setItem('preferredConnectionId', connectionId);
            }

            if (tab === 'terminal' && connectionId) {
              window.location.hash = `#terminal?connection=${connectionId}`;
            }

            window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab } }));
          }}
        />
      ) : (
        <div className="space-y-6 animate-fade-in">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold">Hosts</h1>
              <p className="text-muted-foreground">Manage your SSH and RDP connections</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="icon" onClick={loadConnections} disabled={loading}>
                <RefreshCw className={cn("w-4 h-4", loading && "animate-spin")} />
              </Button>
              <Dialog open={isDialogOpen} onOpenChange={(open) => {
                setIsDialogOpen(open);
                if (!open) {
                  setIsEditMode(false);
                  setEditingConnectionId(null);
                  setNewConnection({
                    type: 'ssh',
                    name: '',
                    host: '',
                    port: '22',
                    username: '',
                    authType: 'password',
                    password: '',
                  });
                }
              }}>
                <DialogTrigger asChild>
                  <Button>
                    <Plus className="w-4 h-4 mr-2" />
                    Add Connection
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>{isEditMode ? 'Edit Connection' : 'Add New Connection'}</DialogTitle>
                    <DialogDescription>
                      {isEditMode ? 'Update your connection settings.' : 'Create a new SSH or RDP connection to your server.'}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4 py-4">
                    <div className="space-y-2">
                      <Label>Connection Type</Label>
                      <Select value={newConnection.type} onValueChange={(value) => setNewConnection({ ...newConnection, type: value, port: value === 'ssh' ? '22' : '3389' })}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="ssh">
                            <div className="flex items-center">
                              <Server className="w-4 h-4 mr-2" />
                              SSH
                            </div>
                          </SelectItem>
                          <SelectItem value="rdp">
                            <div className="flex items-center">
                              <Monitor className="w-4 h-4 mr-2" />
                              RDP
                            </div>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="name">Connection Name</Label>
                      <Input 
                        id="name" 
                        placeholder="Production Server" 
                        value={newConnection.name}
                        onChange={(e) => setNewConnection({ ...newConnection, name: e.target.value })}
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div className="col-span-2 space-y-2">
                        <Label htmlFor="host">Host</Label>
                        <Input 
                          id="host" 
                          placeholder="192.168.1.100" 
                          value={newConnection.host}
                          onChange={(e) => setNewConnection({ ...newConnection, host: e.target.value })}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="port">Port</Label>
                        <Input 
                          id="port" 
                          placeholder="22" 
                          value={newConnection.port}
                          onChange={(e) => setNewConnection({ ...newConnection, port: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input 
                        id="username" 
                        placeholder="admin" 
                        value={newConnection.username}
                        onChange={(e) => setNewConnection({ ...newConnection, username: e.target.value })}
                      />
                    </div>
                    {newConnection.type === 'ssh' && (
                      <>
                        <div className="space-y-2">
                          <Label>Authentication Type</Label>
                          <Select value={newConnection.authType} onValueChange={(value) => setNewConnection({ ...newConnection, authType: value })}>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="password">Password</SelectItem>
                              <SelectItem value="key">SSH Key</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        {newConnection.authType === 'password' && (
                          <div className="space-y-2">
                            <Label htmlFor="password">Password</Label>
                            <Input 
                              id="password" 
                              type="password" 
                              placeholder="••••••••" 
                              value={newConnection.password}
                              onChange={(e) => setNewConnection({ ...newConnection, password: e.target.value })}
                            />
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
                    <Button onClick={handleSaveConnection} disabled={!newConnection.name || !newConnection.host || !newConnection.username}>
                      {isEditMode ? 'Update Connection' : 'Add Connection'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>

          {/* Stats bar */}
          {connections.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                  <Server className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xl font-bold leading-none">{connections.length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total Hosts</p>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                  <Wifi className="w-4 h-4 text-emerald-500" />
                </div>
                <div>
                  <p className="text-xl font-bold leading-none">{connections.filter(c => c.status === 'online').length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Online</p>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                  <WifiOff className="w-4 h-4 text-muted-foreground" />
                </div>
                <div>
                  <p className="text-xl font-bold leading-none">{connections.filter(c => c.status !== 'online').length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Offline</p>
                </div>
              </div>
              <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-yellow-500/10 flex items-center justify-center shrink-0">
                  <Star className="w-4 h-4 text-yellow-500" />
                </div>
                <div>
                  <p className="text-xl font-bold leading-none">{connections.filter(c => c.is_favorite).length}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Favorites</p>
                </div>
              </div>
            </div>
          )}

          {/* Favorites strip */}
          {connections.filter(c => c.is_favorite).length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Pinned</h2>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {connections.filter(c => c.is_favorite).map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedDetailConnection(c)}
                    className={cn(
                      'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm whitespace-nowrap transition-all',
                      'bg-card hover:border-primary/40 hover:bg-muted/50'
                    )}
                  >
                    <div className={cn(
                      'w-2 h-2 rounded-full shrink-0',
                      c.status === 'online' ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                    )} />
                    <span className="font-medium">{c.name}</span>
                    <span className="text-xs text-muted-foreground font-mono">{c.host}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Search & Filters */}
          <div className="flex items-center gap-4">
            <Select value={selectedGroup} onValueChange={setSelectedGroup}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by group" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Groups</SelectItem>
                <SelectItem value="ungrouped">Ungrouped</SelectItem>
                {uniqueGroups.map((group) => (
                  <SelectItem key={group} value={group}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search connections..."
                className="pl-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList>
                <TabsTrigger value="all">
                  All ({connections.length})
                </TabsTrigger>
                <TabsTrigger value="ssh">SSH ({sshConnections.length})</TabsTrigger>
                <TabsTrigger value="rdp">RDP ({rdpConnections.length})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>

          {/* Loading State */}
          {loading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Empty State */}
          {!loading && connections.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <Server className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
                <h3 className="text-lg font-semibold mb-2">No connections yet</h3>
                <p className="text-muted-foreground mb-4">Get started by adding your first SSH or RDP connection</p>
                <Button onClick={() => setIsDialogOpen(true)}>
                  <Plus className="w-4 h-4 mr-2" />
                  Add Connection
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Connections Grid */}
          {!loading && connections.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {activeTab === 'all' &&
                allConnections.map((conn) => (
                  <ConnectionCard
                    key={conn.id}
                    connection={conn}
                    type={conn.type as 'ssh' | 'rdp'}
                    onDelete={handleDeleteConnection}
                    onTest={handleTestConnection}
                    onConnect={handleConnect}
                    onImportKey={handleImportKey}
                    onViewDetails={setSelectedDetailConnection}
                    onEdit={handleEditConnection}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              {activeTab === 'ssh' &&
                filteredSSH.map((conn) => (
                  <ConnectionCard 
                    key={conn.id} 
                    connection={conn} 
                    type="ssh" 
                    onDelete={handleDeleteConnection}
                    onTest={handleTestConnection}
                    onConnect={handleConnect}
                    onImportKey={handleImportKey}
                    onViewDetails={setSelectedDetailConnection}
                    onEdit={handleEditConnection}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
              {activeTab === 'rdp' &&
                filteredRDP.map((conn) => (
                  <ConnectionCard 
                    key={conn.id} 
                    connection={conn} 
                    type="rdp" 
                    onDelete={handleDeleteConnection}
                    onTest={handleTestConnection}
                    onConnect={handleConnect}
                    onImportKey={handleImportKey}
                    onViewDetails={setSelectedDetailConnection}
                    onEdit={handleEditConnection}
                    onToggleFavorite={handleToggleFavorite}
                  />
                ))}
            </div>
          )}

          {/* SSH Key Import Dialog */}
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Import SSH Key</DialogTitle>
                <DialogDescription>
                  Import an SSH key to {selectedConnection?.name} for passwordless authentication
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Select SSH Key</Label>
                  <Select
                    value={importForm.keyName}
                    onValueChange={(value) => setImportForm({ ...importForm, keyName: value })}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select a key" />
                    </SelectTrigger>
                    <SelectContent>
                      {sshKeys.length === 0 ? (
                        <SelectItem value="none" disabled>
                          No SSH keys available. Go to Settings to generate one.
                        </SelectItem>
                      ) : (
                        sshKeys.map((key) => (
                          <SelectItem key={key.name} value={key.name}>
                            {key.name}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Password for {selectedConnection?.name}</Label>
                  <Input
                    type="password"
                    placeholder="Enter SSH password"
                    value={importForm.password}
                    onChange={(e) => setImportForm({ ...importForm, password: e.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">
                    This password is used once to log in and add the public key to authorized_keys
                  </p>
                </div>
                <div className="bg-blue-500/10 border border-blue-500/20 rounded p-3 text-sm">
                  <p className="text-blue-400 mb-1 font-medium">💡 How it works:</p>
                  <p className="text-muted-foreground">
                    We'll connect to your server using the password, then add the selected public key 
                    to ~/.ssh/authorized_keys. Future connections can use the key instead of the password.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsImportDialogOpen(false)} disabled={importing}>
                  Cancel
                </Button>
                <Button onClick={handleImportKeySubmit} disabled={importing || !importForm.keyName || !importForm.password}>
                  {importing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Importing...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4 mr-2" />
                      Import Key
                    </>
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </>
  );
};
