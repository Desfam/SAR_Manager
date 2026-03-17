import React, { useMemo, useState } from 'react';
import {
  ArrowLeft,
  Activity,
  Network,
  Shield,
  Container,
  FileCode,
  Globe,
  Terminal as TerminalIcon,
  Folder,
  ClipboardList,
  CheckCircle,
  Clock,
  AlertCircle,
  Key,
  Lock,
  HardDrive,
  Timer,
  Package,
  Trash2,
  Users,
  Wifi,
  ScrollText,
  KeyRound,
  Loader2,
  List,
  RefreshCw,
  Zap,
  Server,
  Copy,
  ExternalLink,
  ChevronRight,
  Tag,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { SSHConnection, RDPConnection } from '@/types/connection';
import { API_CONFIG } from '@/services/api-config';

interface TaskItem {
  id: string;
  title: string;
  description?: string;
  status: 'todo' | 'in-progress' | 'done' | 'blocked';
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignedVms?: string[];
  dueDate?: string;
}

interface ConnectionDetailProps {
  connection: SSHConnection | RDPConnection;
  onBack: () => void;
  onNavigateToTab: (tab: string, connectionId?: string) => void;
}

const moduleCards = [
  { id: 'monitor',     title: 'System Monitor',  description: 'Live CPU, memory, disk and process metrics',   icon: Activity,     color: 'text-blue-400 bg-blue-500/10'   },
  { id: 'diagnostics', title: 'Diagnostics',      description: 'Run ping, traceroute, DNS and network tests',  icon: Network,      color: 'text-violet-400 bg-violet-500/10'},
  { id: 'security',   title: 'Security',          description: 'Audit and compliance checks for this host',    icon: Shield,       color: 'text-red-400 bg-red-500/10'     },
  { id: 'docker',     title: 'Docker',            description: 'Manage containers running on this host',       icon: Container,    color: 'text-cyan-400 bg-cyan-500/10'   },
  { id: 'scripts',    title: 'Scripts',           description: 'Execute automation scripts against this host',  icon: FileCode,     color: 'text-yellow-400 bg-yellow-500/10'},
  { id: 'tunnels',    title: 'Port Forwarding',   description: 'Create and manage SSH tunnels',                icon: Globe,        color: 'text-green-400 bg-green-500/10' },
  { id: 'terminal',   title: 'Terminal',          description: 'Open an interactive terminal session',         icon: TerminalIcon, color: 'text-orange-400 bg-orange-500/10'},
  { id: 'files',      title: 'File Browser',      description: 'Browse, upload and manage remote files',       icon: Folder,       color: 'text-pink-400 bg-pink-500/10'   },
];

const QUICK_ACTION_GROUPS = [
  {
    label: 'System Info',
    actions: [
      { id: 'disk-usage',      label: 'Disk Usage',     icon: HardDrive,  color: 'text-blue-400'   },
      { id: 'memory-usage',    label: 'Memory',         icon: Activity,   color: 'text-purple-400' },
      { id: 'system-uptime',   label: 'Uptime',         icon: Timer,      color: 'text-green-400'  },
      { id: 'logged-in-users', label: 'Active Users',   icon: Users,      color: 'text-yellow-400' },
    ],
  },
  {
    label: 'Packages',
    actions: [
      { id: 'check-updates', label: 'Check Updates', icon: Package,    color: 'text-cyan-400'   },
      { id: 'apt-update',    label: 'Update List',   icon: RefreshCw,  color: 'text-blue-400'   },
      { id: 'apt-upgrade',   label: 'Upgrade All',   icon: Zap,        color: 'text-emerald-400'},
      { id: 'apt-clean',     label: 'Clean Cache',   icon: Trash2,     color: 'text-orange-400' },
    ],
  },
  {
    label: 'Maintenance',
    actions: [
      { id: 'failed-services', label: 'Failed Services', icon: AlertCircle, color: 'text-red-400'    },
      { id: 'list-processes',  label: 'Processes',       icon: List,        color: 'text-slate-400'  },
      { id: 'network-info',    label: 'Network',         icon: Wifi,        color: 'text-teal-400'   },
      { id: 'clear-logs',      label: 'Clean Logs',      icon: ScrollText,  color: 'text-amber-400'  },
    ],
  },
];

export const ConnectionDetail: React.FC<ConnectionDetailProps> = ({ connection, onBack, onNavigateToTab }) => {
  const protocolLabel = 'authType' in connection ? 'SSH' : 'RDP';
  const isSSH = protocolLabel === 'SSH';
  const isOnline = connection.status === 'online';
  const authType = 'authType' in connection ? (connection as SSHConnection).authType : null;

  // Quick action state
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [outputDialog, setOutputDialog] = useState<{ title: string; output: string; success: boolean } | null>(null);

  // Password change state
  const [pwDialogOpen, setPwDialogOpen] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  const tasksForConnection = useMemo(() => {
    try {
      const raw = localStorage.getItem('taskManagement');
      const tasks: TaskItem[] = raw ? JSON.parse(raw) : [];
      return tasks.filter((task) => task.assignedVms?.includes(connection.id) && task.status !== 'done');
    } catch (error) {
      return [];
    }
  }, [connection.id]);

  const runAction = async (actionId: string) => {
    setActionLoading(actionId);
    try {
      const res = await fetch(`${API_CONFIG.baseURL}/connections/${connection.id}/quick-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: actionId }),
      });
      const data = await res.json();
      const label = QUICK_ACTION_GROUPS.flatMap(g => g.actions).find(a => a.id === actionId)?.label ?? actionId;
      setOutputDialog({
        title: label,
        output: data.output || data.error || 'No output',
        success: data.success,
      });
    } catch (e: any) {
      setOutputDialog({ title: actionId, output: e.message, success: false });
    } finally {
      setActionLoading(null);
    }
  };

  const handlePasswordChange = async () => {
    setPwError('');
    if (newPassword !== confirmPassword) { setPwError('Passwords do not match'); return; }
    if (newPassword.length < 8) { setPwError('Password must be at least 8 characters'); return; }
    setPwLoading(true);
    try {
      const res = await fetch(`${API_CONFIG.baseURL}/connections/${connection.id}/quick-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'change-password', params: { newPassword } }),
      });
      const data = await res.json();
      setPwDialogOpen(false);
      setNewPassword('');
      setConfirmPassword('');
      setOutputDialog({ title: 'Change Password', output: data.output || data.error || 'Done', success: data.success });
    } catch (e: any) {
      setPwError(e.message);
    } finally {
      setPwLoading(false);
    }
  };

  const copyToClipboard = (text: string) => navigator.clipboard.writeText(text).catch(() => {});

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Back button */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Hosts
      </button>

      {/* Hero header */}
      <div className="relative rounded-2xl overflow-hidden border border-border bg-card">
        <div className={cn(
          'absolute inset-0 opacity-10',
          isOnline ? 'bg-gradient-to-br from-emerald-500 via-transparent to-transparent' : 'bg-gradient-to-br from-slate-500 via-transparent to-transparent'
        )} />
        <div className="relative p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={cn(
                'w-14 h-14 rounded-2xl flex items-center justify-center shrink-0',
                isOnline ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'
              )}>
                <Server className="w-7 h-7" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{connection.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm font-mono text-muted-foreground">{connection.host}:{connection.port}</span>
                  <button
                    onClick={() => copyToClipboard(`${connection.host}:${connection.port}`)}
                    className="text-muted-foreground/50 hover:text-muted-foreground transition-colors"
                    title="Copy"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                </div>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className={cn(
                'inline-flex items-center gap-1.5 text-xs px-3 py-1 rounded-full font-medium',
                isOnline ? 'bg-emerald-500/15 text-emerald-400' : 'bg-muted text-muted-foreground'
              )}>
                <div className={cn('w-1.5 h-1.5 rounded-full', isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-muted-foreground/60')} />
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
          </div>

          {/* Meta pills */}
          <div className="flex flex-wrap gap-2 mt-5">
            <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-muted text-muted-foreground font-mono">
              {protocolLabel}
            </span>
            {connection.username && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
                <Users className="w-3 h-3" />
                {connection.username}
              </span>
            )}
            {authType && (
              <span className={cn(
                'inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg',
                authType === 'key' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
              )}>
                {authType === 'key' ? <Key className="w-3 h-3" /> : <Lock className="w-3 h-3" />}
                {authType === 'key' ? 'SSH Key' : 'Password'}
              </span>
            )}
            {connection.connection_group && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-primary/10 text-primary">
                <Tag className="w-3 h-3" />
                {connection.connection_group}
              </span>
            )}
            {connection.os && (
              <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg bg-muted text-muted-foreground">
                {connection.os}
              </span>
            )}
            {connection.tags?.map(tag => (
              <span key={tag} className="inline-flex items-center text-xs px-2 py-1 rounded-lg bg-secondary/60 text-muted-foreground">
                #{tag}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tool tiles */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Tools</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {moduleCards.map((mod) => {
            const Icon = mod.icon;
            return (
              <button
                key={mod.id}
                onClick={() => onNavigateToTab(mod.id, connection.id)}
                className="group flex flex-col items-center gap-2.5 p-4 rounded-xl border border-border bg-card hover:border-primary/40 hover:bg-muted/30 transition-all text-center"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center transition-all group-hover:scale-105', mod.color)}>
                  <Icon className="w-5 h-5" />
                </div>
                <span className="text-xs font-medium leading-tight text-foreground/80 group-hover:text-foreground">{mod.title}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      {isSSH && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</h2>
            {isOnline && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => { setNewPassword(''); setConfirmPassword(''); setPwError(''); setPwDialogOpen(true); }}
              >
                <KeyRound className="w-3.5 h-3.5" />
                Change Password
              </Button>
            )}
          </div>
          <div className="space-y-3">
            {QUICK_ACTION_GROUPS.map((group) => (
              <div key={group.label} className="rounded-xl border border-border bg-card p-4">
                <p className="text-xs font-medium text-muted-foreground mb-3">{group.label}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {group.actions.map((action) => {
                    const Icon = action.icon;
                    const isRunning = actionLoading === action.id;
                    return (
                      <button
                        key={action.id}
                        disabled={!!actionLoading || !isOnline}
                        onClick={() => runAction(action.id)}
                        className={cn(
                          'flex items-center gap-2 px-3 py-2.5 rounded-lg border text-xs font-medium transition-all',
                          'border-border bg-background hover:bg-muted/60 hover:border-border/80',
                          'disabled:opacity-40 disabled:cursor-not-allowed'
                        )}
                      >
                        {isRunning
                          ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          : <Icon className={cn('w-3.5 h-3.5 shrink-0', action.color)} />
                        }
                        <span className="truncate">{action.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {!isOnline && (
            <p className="text-xs text-muted-foreground mt-2">Quick actions are only available when the host is online.</p>
          )}
        </div>
      )}

      {/* Active Tasks */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardList className="w-4 h-4" />
            Active Tasks
          </CardTitle>
          <CardDescription>Tasks assigned to this host and not yet completed.</CardDescription>
        </CardHeader>
        <CardContent>
          {tasksForConnection.length === 0 ? (
            <p className="text-sm text-muted-foreground">No active tasks for this connection.</p>
          ) : (
            <div className="space-y-2">
              {tasksForConnection.map((task) => (
                <div key={task.id} className="p-3 rounded-lg border border-border bg-card/50 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium truncate text-sm">{task.title}</p>
                    {task.description && (
                      <p className="text-xs text-muted-foreground truncate">{task.description}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Badge variant="outline" className="capitalize text-xs">{task.priority}</Badge>
                    <Badge variant={task.status === 'blocked' ? 'destructive' : 'secondary'} className="capitalize text-xs">
                      {task.status === 'in-progress' ? <><Clock className="w-3 h-3 mr-1" /> In Progress</> :
                       task.status === 'blocked'     ? <><AlertCircle className="w-3 h-3 mr-1" /> Blocked</> :
                                                       <><CheckCircle className="w-3 h-3 mr-1" /> To Do</>}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
          <Button variant="outline" size="sm" className="mt-4" onClick={() => onNavigateToTab('tasks', connection.id)}>
            Open Task Management
          </Button>
        </CardContent>
      </Card>

      {/* Action Output Dialog */}
      <Dialog open={!!outputDialog} onOpenChange={(open) => !open && setOutputDialog(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {outputDialog?.success
                ? <CheckCircle className="w-4 h-4 text-emerald-500" />
                : <AlertCircle className="w-4 h-4 text-red-500" />
              }
              {outputDialog?.title}
            </DialogTitle>
            <DialogDescription>{connection.name} · {connection.host}</DialogDescription>
          </DialogHeader>
          <pre className="text-xs font-mono bg-muted rounded-lg p-4 max-h-96 overflow-auto whitespace-pre-wrap break-all">
            {outputDialog?.output}
          </pre>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => copyToClipboard(outputDialog?.output ?? '')}>
              <Copy className="w-3.5 h-3.5 mr-1.5" /> Copy
            </Button>
            <Button size="sm" onClick={() => setOutputDialog(null)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Change Password Dialog */}
      <Dialog open={pwDialogOpen} onOpenChange={setPwDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="w-4 h-4" />
              Change Password
            </DialogTitle>
            <DialogDescription>
              Change the SSH password for <strong>{connection.username}</strong> on {connection.name}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-pw">New Password</Label>
              <Input
                id="new-pw"
                type="password"
                placeholder="Min. 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="confirm-pw">Confirm Password</Label>
              <Input
                id="confirm-pw"
                type="password"
                placeholder="Repeat password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </div>
            {pwError && <p className="text-xs text-destructive">{pwError}</p>}
            <p className="text-xs text-muted-foreground">
              Requires sudo access. Password must be printable ASCII, no single quotes or backslashes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPwDialogOpen(false)} disabled={pwLoading}>Cancel</Button>
            <Button onClick={handlePasswordChange} disabled={pwLoading || !newPassword || !confirmPassword}>
              {pwLoading ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Changing...</> : 'Change Password'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
