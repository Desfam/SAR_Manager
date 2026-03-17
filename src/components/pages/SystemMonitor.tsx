import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { sshConnections, rdpConnections } from '@/data/mockData';
import { Cpu, MemoryStick, HardDrive, Activity, ArrowUpDown, Search, RefreshCw, Zap, Thermometer, Network, Server, CircleDot, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';

interface Process {
  pid: number;
  user: string;
  cpu: number;
  mem: number;
  vsz: string;
  rss: string;
  stat: string;
  time: string;
  command: string;
  priority: number;
}

interface Agent {
  id: string;
  name: string;
  os: string;
  status: string;
  last_seen: string;
}

interface AgentMetrics {
  cpu_usage: number;
  cpu_cores: number;
  memory_percent: number;
  memory_total: number;
  memory_used: number;
  disk_percent: number;
  disk_total: number;
  disk_used: number;
  processes_total: number;
  processes_running: number;
  load_avg_1: number;
  load_avg_5: number;
  load_avg_15: number;
}

interface AgentService {
  name: string;
  active_state: string;
  sub_state: string;
  description: string;
}

const generateProcesses = (hostId: string): Process[] => {
  const processes: Process[] = [
    { pid: 1, user: 'root', cpu: 0.0, mem: 0.1, vsz: '168M', rss: '11M', stat: 'Ss', time: '12:34', command: '/sbin/init', priority: 20 },
    { pid: 2, user: 'root', cpu: 0.0, mem: 0.0, vsz: '0', rss: '0', stat: 'S', time: '0:00', command: '[kthreadd]', priority: 20 },
    { pid: 345, user: 'root', cpu: 1.2, mem: 2.3, vsz: '1.2G', rss: '245M', stat: 'Ssl', time: '45:12', command: '/usr/bin/dockerd', priority: 20 },
    { pid: 567, user: 'root', cpu: 0.8, mem: 1.5, vsz: '890M', rss: '156M', stat: 'Ssl', time: '32:45', command: '/usr/bin/containerd', priority: 20 },
    { pid: 890, user: 'www-data', cpu: 3.5, mem: 4.2, vsz: '456M', rss: '89M', stat: 'S', time: '15:23', command: 'nginx: worker process', priority: 20 },
    { pid: 891, user: 'www-data', cpu: 2.8, mem: 3.8, vsz: '448M', rss: '82M', stat: 'S', time: '14:56', command: 'nginx: worker process', priority: 20 },
    { pid: 1024, user: 'postgres', cpu: 5.2, mem: 8.4, vsz: '2.1G', rss: '512M', stat: 'Ss', time: '1:23:45', command: 'postgres: main process', priority: 20 },
    { pid: 1025, user: 'postgres', cpu: 2.1, mem: 3.2, vsz: '2.1G', rss: '198M', stat: 'Ss', time: '45:12', command: 'postgres: checkpointer', priority: 20 },
    { pid: 1026, user: 'postgres', cpu: 1.8, mem: 2.9, vsz: '2.1G', rss: '178M', stat: 'Ss', time: '38:22', command: 'postgres: background writer', priority: 20 },
    { pid: 1500, user: 'node', cpu: 8.4, mem: 6.7, vsz: '1.8G', rss: '340M', stat: 'Sl', time: '2:34:12', command: 'node /app/server.js', priority: 20 },
    { pid: 1678, user: 'root', cpu: 0.3, mem: 0.8, vsz: '234M', rss: '45M', stat: 'Ss', time: '5:34', command: '/usr/sbin/sshd -D', priority: 20 },
    { pid: 1800, user: 'root', cpu: 0.1, mem: 0.2, vsz: '112M', rss: '18M', stat: 'Ss', time: '0:45', command: '/usr/sbin/cron -f', priority: 20 },
    { pid: 2100, user: 'redis', cpu: 4.5, mem: 12.3, vsz: '3.2G', rss: '890M', stat: 'Ssl', time: '3:45:22', command: 'redis-server *:6379', priority: 20 },
    { pid: 2500, user: 'monitor', cpu: 6.2, mem: 5.1, vsz: '1.5G', rss: '290M', stat: 'Ssl', time: '1:12:34', command: '/usr/bin/prometheus', priority: 20 },
    { pid: 2700, user: 'grafana', cpu: 3.1, mem: 4.8, vsz: '980M', rss: '220M', stat: 'Ssl', time: '56:23', command: '/usr/sbin/grafana-server', priority: 20 },
    { pid: 3000, user: 'root', cpu: 0.5, mem: 0.4, vsz: '156M', rss: '32M', stat: 'S', time: '2:34', command: '/usr/lib/systemd/systemd-journald', priority: 20 },
    { pid: 3200, user: 'root', cpu: 0.2, mem: 0.3, vsz: '89M', rss: '22M', stat: 'Ss', time: '1:12', command: '/usr/lib/systemd/systemd-udevd', priority: 20 },
    { pid: 4500, user: 'deploy', cpu: 12.5, mem: 7.8, vsz: '2.4G', rss: '456M', stat: 'Rl', time: '0:45', command: 'npm run build', priority: 20 },
  ];
  // Vary based on hostId hash
  const seed = hostId.charCodeAt(hostId.length - 1);
  return processes.slice(0, 10 + (seed % 8)).map(p => ({
    ...p,
    cpu: Math.max(0, p.cpu + ((seed * p.pid) % 5) - 2),
    mem: Math.max(0, p.mem + ((seed * p.pid) % 3) - 1),
  }));
};

const cpuBarSegments = (count: number) => {
  return Array.from({ length: count }, (_, i) => ({
    label: `CPU ${i}`,
    usage: Math.random() * 100,
    user: Math.random() * 60,
    system: Math.random() * 20,
    iowait: Math.random() * 10,
  }));
};

export const SystemMonitor: React.FC = () => {
  const sshHosts = sshConnections.filter(c => c.status === 'online').map(c => ({ 
    id: c.id, 
    name: c.name, 
    os: c.os, 
    cpu: c.cpu, 
    memory: c.memory, 
    disk: c.disk, 
    type: 'ssh' as const 
  }));
  
  const rdpHosts = rdpConnections.filter(c => c.status === 'online').map(c => ({ 
    id: c.id, 
    name: c.name, 
    os: c.os, 
    cpu: c.cpu, 
    memory: c.memory, 
    disk: c.disk, 
    type: 'rdp' as const 
  }));

  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentMetrics, setAgentMetrics] = useState<Record<string, AgentMetrics>>({});
  const [agentServices, setAgentServices] = useState<AgentService[]>([]);
  const [selectedHost, setSelectedHost] = useState('');
  const [selectedType, setSelectedType] = useState<'ssh' | 'rdp' | 'agent'>('ssh');
  const [sortBy, setSortBy] = useState<'cpu' | 'mem' | 'pid'>('cpu');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [filter, setFilter] = useState('');
  const [processes, setProcesses] = useState<Process[]>([]);
  const [cpuCores, setCpuCores] = useState(cpuBarSegments(4));
  const [tick, setTick] = useState(0);
  const [serviceFilter, setServiceFilter] = useState('active');

  const allHosts = [...sshHosts, ...rdpHosts];
  
  // Fetch agents
  useEffect(() => {
    const fetchAgents = async () => {
      try {
        const response = await fetch(`${API_CONFIG.baseURL}/agents`);
        const data = await response.json();
        setAgents(data.filter((a: Agent) => a.status === 'online'));
      } catch (error) {
        console.error('Failed to fetch agents:', error);
      }
    };

    fetchAgents();
    const interval = setInterval(fetchAgents, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch agent metrics
  useEffect(() => {
    const fetchMetrics = async () => {
      for (const agent of agents) {
        try {
          const response = await fetch(`${API_CONFIG.baseURL}/agents/${agent.id}/metrics/latest`);
          const data = await response.json();
          setAgentMetrics(prev => ({ ...prev, [agent.id]: data }));
        } catch (error) {
          console.error(`Failed to fetch metrics for ${agent.name}:`, error);
        }
      }
    };

    if (agents.length > 0) {
      fetchMetrics();
      const interval = setInterval(fetchMetrics, 10000);
      return () => clearInterval(interval);
    }
  }, [agents]);

  // Fetch services for selected agent
  useEffect(() => {
    if (selectedType === 'agent' && selectedHost) {
      const fetchServices = async () => {
        try {
          const response = await fetch(`${API_CONFIG.baseURL}/agents/${selectedHost}/services`);
          const data = await response.json();
          setAgentServices(data);
        } catch (error) {
          console.error('Failed to fetch services:', error);
        }
      };

      fetchServices();
    }
  }, [selectedHost, selectedType]);

  // Set initial host - prefer agents
  useEffect(() => {
    if (agents.length > 0 && (!selectedHost || selectedType !== 'agent')) {
      // Prefer live agents over SSH/RDP
      setSelectedHost(agents[0].id);
      setSelectedType('agent');
    } else if (!selectedHost && allHosts.length > 0) {
      setSelectedHost(allHosts[0].id);
      setSelectedType(allHosts[0].type);
    }
  }, [agents, allHosts, selectedHost, selectedType]);

  const host = selectedType === 'agent' 
    ? agents.find(a => a.id === selectedHost)
    : allHosts.find(h => h.id === selectedHost);

  const metrics = selectedType === 'agent' && selectedHost ? agentMetrics[selectedHost] : null;

  useEffect(() => {
    if (selectedHost && selectedType !== 'agent') {
      setProcesses(generateProcesses(selectedHost));
      setCpuCores(cpuBarSegments(selectedHost.includes('ssh') ? 8 : 4));
    } else if (metrics) {
      // For agents, we could show real processes if available
      setProcesses([]);
      setCpuCores(cpuBarSegments(metrics.cpu_cores || 4));
    }
  }, [selectedHost, selectedType, metrics]);

  // Simulate live updates only for non-agent hosts
  useEffect(() => {
    if (selectedType === 'agent') return; // Don't simulate for agents
    
    const interval = setInterval(() => {
      setTick(t => t + 1);
      setProcesses(prev => prev.map(p => ({
        ...p,
        cpu: Math.max(0, Math.min(100, p.cpu + (Math.random() * 4 - 2))),
        mem: Math.max(0, Math.min(100, p.mem + (Math.random() * 2 - 1))),
      })));
      setCpuCores(prev => prev.map(c => ({
        ...c,
        usage: Math.max(0, Math.min(100, c.usage + (Math.random() * 10 - 5))),
        user: Math.max(0, Math.min(80, c.user + (Math.random() * 6 - 3))),
        system: Math.max(0, Math.min(30, c.system + (Math.random() * 4 - 2))),
      })));
    }, 2000);
    return () => clearInterval(interval);
  }, [selectedType]);

  const filtered = processes
    .filter(p => !filter || p.command.toLowerCase().includes(filter.toLowerCase()) || p.user.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => {
      const mul = sortDir === 'desc' ? -1 : 1;
      if (sortBy === 'cpu') return mul * (a.cpu - b.cpu);
      if (sortBy === 'mem') return mul * (a.mem - b.mem);
      return mul * (a.pid - b.pid);
    });

  // Use agent metrics if available, otherwise fall back to mock data
  const totalCpu = metrics?.cpu_usage ?? host?.cpu ?? 0;
  const totalMem = metrics?.memory_percent ?? host?.memory ?? 0;
  const totalDisk = metrics?.disk_percent ?? host?.disk ?? 0;
  const loadAvg = metrics 
    ? [metrics.load_avg_1?.toFixed(2) || '0.00', metrics.load_avg_5?.toFixed(2) || '0.00', metrics.load_avg_15?.toFixed(2) || '0.00']
    : [(totalCpu / 25).toFixed(2), (totalCpu / 28).toFixed(2), (totalCpu / 30).toFixed(2)];
  const totalTasks = metrics?.processes_total ?? processes.length;
  const runningTasks = metrics?.processes_running ?? processes.filter(p => p.stat.includes('R')).length;
  const sleepingTasks = totalTasks - runningTasks;
  const memoryGB = metrics ? (metrics.memory_total / (1024 ** 3)).toFixed(1) : '32';
  const memoryUsedGB = metrics ? (metrics.memory_used / (1024 ** 3)).toFixed(1) : ((totalMem / 100) * 32).toFixed(1);
  const diskGB = metrics ? (metrics.disk_total / (1024 ** 3)).toFixed(0) : '500';
  const diskUsedGB = metrics ? (metrics.disk_used / (1024 ** 3)).toFixed(0) : ((totalDisk / 100) * 500).toFixed(0);

  const filteredServices = agentServices.filter(s => {
    if (serviceFilter === 'active') return s.active_state === 'active';
    if (serviceFilter === 'inactive') return s.active_state !== 'active';
    return true;
  });

  const getCpuColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 50) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getMemColor = (val: number) => {
    if (val > 85) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
            <Activity className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Monitor</h1>
            <p className="text-sm text-muted-foreground">htop-style overview of your virtual machines</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedHost} onValueChange={(val) => {
            setSelectedHost(val);
            // Determine type from value
            const agent = agents.find(a => a.id === val);
            if (agent) {
              setSelectedType('agent');
            } else {
              const host = allHosts.find(h => h.id === val);
              if (host) setSelectedType(host.type);
            }
          }}>
            <SelectTrigger className="w-[260px] bg-card border-border">
              <SelectValue placeholder="Select host" />
            </SelectTrigger>
            <SelectContent>
              {agents.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">AGENTS (Live)</div>
                  {agents.map(a => (
                    <SelectItem key={a.id} value={a.id}>
                      <span className="flex items-center gap-2">
                        <Server className="w-3 h-3 text-emerald-500" />
                        {a.name}
                        <Badge variant="outline" className="text-[9px] ml-1 bg-emerald-500/10">LIVE</Badge>
                      </span>
                    </SelectItem>
                  ))}
                </>
              )}
              {allHosts.length > 0 && (
                <>
                  <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">SSH/RDP (Mock)</div>
                  {allHosts.map(h => (
                    <SelectItem key={h.id} value={h.id}>
                      <span className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-blue-500" />
                        {h.name}
                      </span>
                    </SelectItem>
                  ))}
                </>
              )}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => {
            if (selectedType !== 'agent') {
              setProcesses(generateProcesses(selectedHost));
            }
          }}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {host && (
        <>
          {/* CPU Bars - htop style */}
          <Card className="bg-card border-border">
            <CardContent className="p-4 font-mono text-xs">
              <div className="grid grid-cols-1 gap-1.5">
                {cpuCores.map((core, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-muted-foreground w-8 text-right">{i}</span>
                    <div className="flex-1 h-4 bg-muted/30 rounded-sm overflow-hidden flex relative">
                      <div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${core.user}%` }} />
                      <div className="h-full bg-red-500 transition-all duration-1000" style={{ width: `${core.system}%` }} />
                      <div className="h-full bg-amber-500/70 transition-all duration-1000" style={{ width: `${core.iowait}%` }} />
                      <span className="absolute right-1 top-0 h-full flex items-center text-[10px] text-foreground/70 font-bold">{core.usage.toFixed(1)}%</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-4 mt-2 text-[10px] text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm" /> user</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-red-500 rounded-sm" /> system</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 bg-amber-500/70 rounded-sm" /> iowait</span>
              </div>
            </CardContent>
          </Card>

          {/* Memory / Swap / Summary */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <MemoryStick className="w-4 h-4 text-blue-400" />
                  <span className="text-sm font-semibold text-foreground">Memory</span>
                </div>
                <div className="h-3 bg-muted/30 rounded-full overflow-hidden mb-1">
                  <div className={cn('h-full rounded-full transition-all duration-1000', getMemColor(totalMem))} style={{ width: `${totalMem}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{memoryUsedGB}G / {memoryGB}G</span>
                  <span className="font-bold">{totalMem.toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <HardDrive className="w-4 h-4 text-purple-400" />
                  <span className="text-sm font-semibold text-foreground">Disk</span>
                </div>
                <div className="h-3 bg-muted/30 rounded-full overflow-hidden mb-1">
                  <div className={cn('h-full rounded-full transition-all duration-1000', totalDisk > 80 ? 'bg-red-500' : totalDisk > 60 ? 'bg-yellow-500' : 'bg-purple-500')} style={{ width: `${totalDisk}%` }} />
                </div>
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{diskUsedGB}G / {diskGB}G</span>
                  <span className="font-bold">{totalDisk.toFixed(1)}%</span>
                </div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Thermometer className="w-4 h-4 text-orange-400" />
                  <span className="text-sm font-semibold text-foreground">Load Avg</span>
                </div>
                <div className="text-xl font-mono font-bold text-foreground mt-1">
                  {loadAvg.join('  ')}
                </div>
                <div className="text-[10px] text-muted-foreground mt-1">1min  5min  15min</div>
              </CardContent>
            </Card>
            <Card className="bg-card border-border">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-yellow-400" />
                  <span className="text-sm font-semibold text-foreground">Tasks</span>
                </div>
                <div className="text-xl font-mono font-bold text-foreground mt-1">{totalTasks}</div>
                <div className="text-[10px] text-muted-foreground mt-1">
                  {runningTasks} running, {sleepingTasks} sleeping, 0 stopped
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Process Table */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Processes</CardTitle>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Filter..."
                      value={filter}
                      onChange={e => setFilter(e.target.value)}
                      className="h-8 pl-8 pr-3 text-xs bg-muted/30 border border-border rounded-md text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary w-48"
                    />
                  </div>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-xs font-mono">
                  <thead>
                    <tr className="bg-muted/30 text-muted-foreground">
                      <th className="text-left px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('pid'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                        PID {sortBy === 'pid' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                      </th>
                      <th className="text-left px-3 py-2">USER</th>
                      <th className="text-left px-3 py-2">PRI</th>
                      <th className="text-left px-3 py-2">VIRT</th>
                      <th className="text-left px-3 py-2">RES</th>
                      <th className="text-left px-3 py-2">S</th>
                      <th className="text-right px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('cpu'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                        CPU% {sortBy === 'cpu' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                      </th>
                      <th className="text-right px-3 py-2 cursor-pointer hover:text-foreground" onClick={() => { setSortBy('mem'); setSortDir(d => d === 'asc' ? 'desc' : 'asc'); }}>
                        MEM% {sortBy === 'mem' && <ArrowUpDown className="w-3 h-3 inline ml-0.5" />}
                      </th>
                      <th className="text-left px-3 py-2">TIME+</th>
                      <th className="text-left px-3 py-2">Command</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((p) => (
                      <tr key={p.pid} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                        <td className="px-3 py-1.5 text-primary">{p.pid}</td>
                        <td className="px-3 py-1.5">
                          <span className={cn(
                            p.user === 'root' ? 'text-red-400' : 'text-foreground'
                          )}>{p.user}</span>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{p.priority}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{p.vsz}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{p.rss}</td>
                        <td className="px-3 py-1.5">
                          <span className={cn(
                            p.stat.includes('R') ? 'text-emerald-400' : 'text-muted-foreground'
                          )}>{p.stat}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-12 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', getCpuColor(p.cpu))} style={{ width: `${Math.min(100, p.cpu)}%` }} />
                            </div>
                            <span className={cn(
                              p.cpu > 10 ? 'text-red-400 font-bold' : p.cpu > 5 ? 'text-yellow-400' : 'text-foreground'
                            )}>{p.cpu.toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <div className="w-12 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', getMemColor(p.mem))} style={{ width: `${Math.min(100, p.mem)}%` }} />
                            </div>
                            <span className={cn(
                              p.mem > 10 ? 'text-blue-400 font-bold' : 'text-foreground'
                            )}>{p.mem.toFixed(1)}</span>
                          </div>
                        </td>
                        <td className="px-3 py-1.5 text-muted-foreground">{p.time}</td>
                        <td className="px-3 py-1.5 text-foreground max-w-[300px] truncate">{p.command}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Services (for agents only) */}
          {selectedType === 'agent' && agentServices.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">Services ({filteredServices.length})</CardTitle>
                  <Select value={serviceFilter} onValueChange={setServiceFilter}>
                    <SelectTrigger className="w-[140px] h-8 bg-muted/30 border-border">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Services</SelectItem>
                      <SelectItem value="active">Active Only</SelectItem>
                      <SelectItem value="inactive">Inactive Only</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <div className="overflow-x-auto max-h-96">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-muted/30 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 w-8"></th>
                        <th className="text-left px-3 py-2">Service Name</th>
                        <th className="text-left px-3 py-2">State</th>
                        <th className="text-left px-3 py-2">Status</th>
                        <th className="text-left px-3 py-2">Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredServices.map((s, idx) => (
                        <tr key={idx} className="border-t border-border/30 hover:bg-muted/20 transition-colors">
                          <td className="px-3 py-2">
                            {s.active_state === 'active' ? (
                              <CircleDot className="w-3 h-3 text-emerald-500" />
                            ) : (
                              <Circle className="w-3 h-3 text-muted-foreground" />
                            )}
                          </td>
                          <td className="px-3 py-2 font-mono text-emerald-400">{s.name}</td>
                          <td className="px-3 py-2">
                            <Badge 
                              variant="outline" 
                              className={cn(
                                'text-[10px]',
                                s.active_state === 'active' ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/50' : 
                                s.active_state === 'failed' ? 'bg-red-500/10 text-red-500 border-red-500/50' :
                                'bg-muted text-muted-foreground'
                              )}
                            >
                              {s.active_state}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-muted-foreground">{s.sub_state}</td>
                          <td className="px-3 py-2 text-muted-foreground max-w-[400px] truncate">{s.description}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* All VMs overview */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">All VMs Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                {allHosts.map(h => (
                  <button
                    key={h.id}
                    onClick={() => setSelectedHost(h.id)}
                    className={cn(
                      'p-3 rounded-lg border text-left transition-all hover:border-primary/50',
                      h.id === selectedHost ? 'border-primary bg-primary/5' : 'border-border bg-muted/10'
                    )}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-semibold text-foreground truncate">{h.name}</span>
                      <Badge variant="outline" className="text-[10px]">{h.type.toUpperCase()}</Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground mb-2">{h.os}</div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Cpu className="w-3 h-3 text-emerald-400" />
                        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', getCpuColor(h.cpu ?? 0))} style={{ width: `${h.cpu ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{h.cpu}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <MemoryStick className="w-3 h-3 text-blue-400" />
                        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', getMemColor(h.memory ?? 0))} style={{ width: `${h.memory ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{h.memory}%</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <HardDrive className="w-3 h-3 text-purple-400" />
                        <div className="flex-1 h-1.5 bg-muted/30 rounded-full overflow-hidden">
                          <div className={cn('h-full rounded-full', (h.disk ?? 0) > 80 ? 'bg-red-500' : 'bg-purple-500')} style={{ width: `${h.disk ?? 0}%` }} />
                        </div>
                        <span className="text-[10px] text-muted-foreground w-8 text-right">{h.disk}%</span>
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
};
