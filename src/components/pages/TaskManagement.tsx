import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { connectionAPI } from '@/services/api';
import { SSHConnection, RDPConnection } from '@/types/connection';
import { ClipboardList, Plus, Trash2, CheckCircle2, Circle, Clock, AlertCircle, Server, GripVertical, Calendar } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

type Priority = 'low' | 'medium' | 'high' | 'critical';
type Status = 'todo' | 'in-progress' | 'done' | 'blocked';

interface Task {
  id: string;
  title: string;
  description: string;
  status: Status;
  priority: Priority;
  assignedVms: string[];
  createdAt: string;
  dueDate?: string;
  tags: string[];
}

const statusConfig: Record<Status, { label: string; icon: React.ElementType; color: string }> = {
  'todo': { label: 'To Do', icon: Circle, color: 'text-muted-foreground' },
  'in-progress': { label: 'In Progress', icon: Clock, color: 'text-blue-400' },
  'done': { label: 'Done', icon: CheckCircle2, color: 'text-emerald-400' },
  'blocked': { label: 'Blocked', icon: AlertCircle, color: 'text-red-400' },
};

const priorityConfig: Record<Priority, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  'low': { label: 'Low', variant: 'outline' },
  'medium': { label: 'Medium', variant: 'secondary' },
  'high': { label: 'High', variant: 'default' },
  'critical': { label: 'Critical', variant: 'destructive' },
};

export const TaskManagement: React.FC = () => {
  const [tasks, setTasks] = useState<Task[]>(() => {
    // Load tasks from localStorage on mount
    const savedTasks = localStorage.getItem('taskManagement');
    return savedTasks ? JSON.parse(savedTasks) : [];
  });
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  const [filterVm, setFilterVm] = useState<string>('all');
  const [showForm, setShowForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: '', description: '', priority: 'medium' as Priority, assignedVms: [] as string[], dueDate: '', tags: '' });
  const { toast } = useToast();

  useEffect(() => {
    loadConnections();
  }, []);

  // Save tasks to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('taskManagement', JSON.stringify(tasks));
  }, [tasks]);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const data = await connectionAPI.getAll();
      setConnections(data);
    } catch (error) {
      console.error('Failed to load connections:', error);
      toast({
        title: 'Error',
        description: 'Failed to load connections',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const allHosts = connections.map(c => ({
    id: c.id,
    name: c.name,
    type: c.type,
    status: c.status,
  }));

  const filteredTasks = tasks.filter(t => {
    if (filterStatus !== 'all' && t.status !== filterStatus) return false;
    if (filterVm !== 'all' && !t.assignedVms.includes(filterVm)) return false;
    return true;
  });

  const columns: Status[] = ['todo', 'in-progress', 'done', 'blocked'];
  const stats = {
    total: tasks.length,
    todo: tasks.filter(t => t.status === 'todo').length,
    inProgress: tasks.filter(t => t.status === 'in-progress').length,
    done: tasks.filter(t => t.status === 'done').length,
    blocked: tasks.filter(t => t.status === 'blocked').length,
  };

  const addTask = () => {
    if (!newTask.title.trim()) return;
    const task: Task = {
      id: Date.now().toString(),
      title: newTask.title,
      description: newTask.description,
      status: 'todo',
      priority: newTask.priority,
      assignedVms: newTask.assignedVms,
      createdAt: new Date().toISOString().split('T')[0],
      dueDate: newTask.dueDate || undefined,
      tags: newTask.tags.split(',').map(t => t.trim()).filter(Boolean),
    };
    setTasks(prev => [task, ...prev]);
    setNewTask({ title: '', description: '', priority: 'medium', assignedVms: [], dueDate: '', tags: '' });
    setShowForm(false);
    toast({ title: 'Task created', description: `"${task.title}" added to To Do` });
  };

  const updateStatus = (taskId: string, status: Status) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
  };

  const deleteTask = (taskId: string) => {
    setTasks(prev => prev.filter(t => t.id !== taskId));
    toast({ title: 'Task deleted' });
  };

  const getHostName = (id: string) => allHosts.find(h => h.id === id)?.name ?? id;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-violet-500/20 flex items-center justify-center">
            <ClipboardList className="w-5 h-5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Task Management</h1>
            <p className="text-sm text-muted-foreground">Organize and track tasks across your VMs</p>
          </div>
        </div>
        <Button onClick={() => setShowForm(!showForm)} className="gap-2">
          <Plus className="w-4 h-4" /> New Task
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total', value: stats.total, color: 'text-foreground' },
          { label: 'To Do', value: stats.todo, color: 'text-muted-foreground' },
          { label: 'In Progress', value: stats.inProgress, color: 'text-blue-400' },
          { label: 'Done', value: stats.done, color: 'text-emerald-400' },
          { label: 'Blocked', value: stats.blocked, color: 'text-red-400' },
        ].map(s => (
          <Card key={s.label} className="bg-card border-border">
            <CardContent className="p-3 text-center">
              <div className={cn('text-2xl font-bold font-mono', s.color)}>{s.value}</div>
              <div className="text-xs text-muted-foreground">{s.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* New Task Form */}
      {showForm && (
        <Card className="bg-card border-border border-primary/30">
          <CardContent className="p-4 space-y-3">
            <input
              placeholder="Task title..."
              value={newTask.title}
              onChange={e => setNewTask(p => ({ ...p, title: e.target.value }))}
              className="w-full h-9 px-3 text-sm bg-muted/30 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <textarea
              placeholder="Description..."
              value={newTask.description}
              onChange={e => setNewTask(p => ({ ...p, description: e.target.value }))}
              className="w-full h-20 px-3 py-2 text-sm bg-muted/30 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Select value={newTask.priority} onValueChange={v => setNewTask(p => ({ ...p, priority: v as Priority }))}>
                <SelectTrigger className="bg-muted/30 border-border"><SelectValue placeholder="Priority" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">Low</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="critical">Critical</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="date"
                value={newTask.dueDate}
                onChange={e => setNewTask(p => ({ ...p, dueDate: e.target.value }))}
                className="h-9 px-3 text-sm bg-muted/30 border border-border rounded-md text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <input
                placeholder="Tags (comma-separated)"
                value={newTask.tags}
                onChange={e => setNewTask(p => ({ ...p, tags: e.target.value }))}
                className="h-9 px-3 text-sm bg-muted/30 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>
            {/* VM Assignment */}
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Assign to VMs</label>
              <div className="flex flex-wrap gap-1.5">
                {allHosts.map(h => {
                  const selected = newTask.assignedVms.includes(h.id);
                  return (
                    <button
                      key={h.id}
                      onClick={() => setNewTask(p => ({
                        ...p,
                        assignedVms: selected ? p.assignedVms.filter(id => id !== h.id) : [...p.assignedVms, h.id]
                      }))}
                      className={cn(
                        'px-2 py-1 text-xs rounded-md border transition-colors',
                        selected ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/50'
                      )}
                    >
                      <Server className="w-3 h-3 inline mr-1" />{h.name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button size="sm" onClick={addTask}>Create Task</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px] bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            {columns.map(s => <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={filterVm} onValueChange={setFilterVm}>
          <SelectTrigger className="w-[220px] bg-card border-border"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All VMs</SelectItem>
            {allHosts.map(h => <SelectItem key={h.id} value={h.id}>{h.name} ({h.type.toUpperCase()})</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Kanban Board */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {columns.map(col => {
          const config = statusConfig[col];
          const Icon = config.icon;
          const colTasks = filteredTasks.filter(t => t.status === col);
          return (
            <div key={col} className="space-y-2">
              <div className="flex items-center gap-2 px-1">
                <Icon className={cn('w-4 h-4', config.color)} />
                <span className="text-sm font-semibold text-foreground">{config.label}</span>
                <Badge variant="outline" className="text-[10px] ml-auto">{colTasks.length}</Badge>
              </div>
              <div className="space-y-2 min-h-[200px]">
                {colTasks.map(task => {
                  const priConf = priorityConfig[task.priority];
                  return (
                    <Card key={task.id} className="bg-card border-border hover:border-primary/30 transition-colors">
                      <CardContent className="p-3 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-foreground leading-tight">{task.title}</h3>
                          <Badge variant={priConf.variant} className="text-[10px] shrink-0">{priConf.label}</Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{task.description}</p>

                        {/* Assigned VMs */}
                        {task.assignedVms.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {task.assignedVms.map(vmId => (
                              <span key={vmId} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-muted/40 text-muted-foreground border border-border">
                                <Server className="w-2.5 h-2.5" />{getHostName(vmId)}
                              </span>
                            ))}
                          </div>
                        )}

                        {/* Tags */}
                        {task.tags.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {task.tags.map(tag => (
                              <span key={tag} className="px-1.5 py-0.5 text-[10px] rounded-full bg-primary/10 text-primary">{tag}</span>
                            ))}
                          </div>
                        )}

                        {/* Footer */}
                        <div className="flex items-center justify-between pt-1 border-t border-border/30">
                          <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                            {task.dueDate && (
                              <span className="flex items-center gap-0.5"><Calendar className="w-3 h-3" />{task.dueDate}</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1">
                            <Select value={task.status} onValueChange={(v) => updateStatus(task.id, v as Status)}>
                              <SelectTrigger className="h-6 w-[100px] text-[10px] bg-muted/30 border-border">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {columns.map(s => <SelectItem key={s} value={s}>{statusConfig[s].label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-red-400" onClick={() => deleteTask(task.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
