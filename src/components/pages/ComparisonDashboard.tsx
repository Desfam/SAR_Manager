import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Cpu, MemoryStick, HardDrive, AlertCircle, Zap, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';

interface SystemMetrics {
  cpu: { usage: number } | null;
  memory: { percentUsed: number } | null;
  disk: { percentUsed: number } | null;
  systemInfo: { hostname: string } | null;
}

interface Connection {
  id: string;
  name: string;
  status: string;
  os: string;
}

interface ComparisonData {
  connectionId: string;
  name: string;
  status: string;
  hostname: string;
  cpu: number;
  memory: number;
  disk: number;
  score: number;
  loading?: boolean;
  failed?: boolean;
}

// Helper: fetch with timeout
async function fetchWithTimeout(url: string, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const ComparisonDashboard: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [comparison, setComparison] = useState<ComparisonData[]>([]);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchComparison();
    // Refresh every 30 seconds
    const interval = setInterval(fetchComparison, 30000);
    return () => clearInterval(interval);
  }, []);

  const fetchComparison = async () => {
    try {
      setError(null);

      // Fetch all connections
      const response = await fetch(`${API_CONFIG.baseURL}/connections`);
      const data = (await response.json()) || [];
      const onlineConns = (data as Connection[]).filter(c => c.status === 'online');
      setConnections(onlineConns);

      // Initialize comparison data with loading states, keeping old data if it exists
      const newIds = new Set(onlineConns.map(c => c.id));
      setComparison(prev => {
        // Keep existing data for systems still online, add new ones as loading
        const updated = prev.filter(s => newIds.has(s.connectionId));
        for (const conn of onlineConns) {
          if (!updated.find(s => s.connectionId === conn.id)) {
            updated.push({
              connectionId: conn.id,
              name: conn.name,
              status: conn.status,
              hostname: 'Loading...',
              cpu: 0,
              memory: 0,
              disk: 0,
              score: 0,
              loading: true,
            });
          }
        }
        return updated;
      });
      setLoadingIds(newIds);

      // Fetch metrics for each connection individually and update as they complete
      for (const conn of onlineConns) {
        (async () => {
          try {
            const metricsRes = await fetchWithTimeout(`${API_CONFIG.baseURL}/connections/${conn.id}/system-metrics`);
            const metrics: SystemMetrics = await metricsRes.json();

            const cpu = metrics.cpu?.usage || 0;
            const memory = metrics.memory?.percentUsed || 0;
            const disk = metrics.disk?.percentUsed || 0;

            // Calculate health score (100 = perfect, 0 = critical)
            const cpuScore = Math.max(0, 100 - cpu);
            const memoryScore = Math.max(0, 100 - memory);
            const diskScore = Math.max(0, 100 - disk);
            const score = Math.round((cpuScore + memoryScore + diskScore) / 3);

            // Update this specific system in the comparison
            setComparison(prev => {
              const idx = prev.findIndex(s => s.connectionId === conn.id);
              if (idx === -1) return prev;
              const updated = [...prev];
              updated[idx] = {
                connectionId: conn.id,
                name: conn.name,
                status: conn.status,
                hostname: metrics.systemInfo?.hostname || 'Unknown',
                cpu,
                memory,
                disk,
                score,
                loading: false,
              };
              // Re-sort by score after update
              updated.sort((a, b) => b.score - a.score);
              return updated;
            });
          } catch (err) {
            // Mark as failed but keep the placeholder
            setComparison(prev => {
              const idx = prev.findIndex(s => s.connectionId === conn.id);
              if (idx === -1) return prev;
              const updated = [...prev];
              updated[idx] = {
                ...updated[idx],
                hostname: 'Failed to fetch',
                loading: false,
                failed: true,
              };
              return updated;
            });
          } finally {
            setLoadingIds(prev => {
              const next = new Set(prev);
              next.delete(conn.id);
              return next;
            });
          }
        })();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    }
  };

  const getHealthColor = (score: number) => {
    if (score >= 80) return 'bg-emerald-500';
    if (score >= 60) return 'bg-yellow-500';
    if (score >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getHealthBadge = (score: number) => {
    if (score >= 80) return { label: 'Healthy', color: 'bg-emerald-500/20 text-emerald-700' };
    if (score >= 60) return { label: 'Good', color: 'bg-yellow-500/20 text-yellow-700' };
    if (score >= 40) return { label: 'Fair', color: 'bg-orange-500/20 text-orange-700' };
    return { label: 'Critical', color: 'bg-red-500/20 text-red-700' };
  };

  const getCpuColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-emerald-500';
  };

  const getMemoryColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-blue-500';
  };

  const getDiskColor = (val: number) => {
    if (val > 80) return 'bg-red-500';
    if (val > 60) return 'bg-yellow-500';
    return 'bg-purple-500';
  };

  const avgCpu = comparison.length > 0 ? Math.round(comparison.reduce((a, b) => a + b.cpu, 0) / comparison.length) : 0;
  const avgMemory = comparison.length > 0 ? Math.round(comparison.reduce((a, b) => a + b.memory, 0) / comparison.length) : 0;
  const avgDisk = comparison.length > 0 ? Math.round(comparison.reduce((a, b) => a + b.disk, 0) / comparison.length) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
            <TrendingUp className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">System Comparison</h1>
            <p className="text-sm text-muted-foreground">Real-time comparison of all online systems</p>
          </div>
        </div>
        <Badge variant="outline">
          {comparison.length} Online
        </Badge>
      </div>

      {error && (
        <Card className="bg-red-50 border-red-200">
          <CardContent className="p-4">
            <div className="flex gap-3 items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5 flex-shrink-0" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Stats */}
      {comparison.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Cpu className="w-4 h-4 text-red-400" />
                <span className="text-sm font-semibold text-foreground">Avg CPU</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{avgCpu}%</div>
              <Progress value={avgCpu} className="mt-2 h-2" />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <MemoryStick className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-semibold text-foreground">Avg Memory</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{avgMemory}%</div>
              <Progress value={avgMemory} className="mt-2 h-2" />
            </CardContent>
          </Card>

          <Card className="bg-card border-border">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <HardDrive className="w-4 h-4 text-purple-400" />
                <span className="text-sm font-semibold text-foreground">Avg Disk</span>
              </div>
              <div className="text-2xl font-bold text-foreground">{avgDisk}%</div>
              <Progress value={avgDisk} className="mt-2 h-2" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Comparison Table */}
      {comparison.length === 0 ? (
        <Card className="bg-card border-border">
          <CardContent className="p-8 text-center">
            <AlertCircle className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">No online systems available</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {comparison.map((system, idx) => {
            const health = getHealthBadge(system.score);
            return (
              <Card key={system.connectionId} className={cn('bg-card border-border hover:border-border/80 transition-all', system.loading && 'opacity-60')}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-start gap-3 flex-1">
                      <div className="mt-1">
                        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm', system.loading ? 'bg-gray-500' : getHealthColor(system.score))}>
                          {system.loading ? <Zap className="w-4 h-4 animate-spin" /> : system.score}
                        </div>
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-foreground">{system.name}</h3>
                        <p className={cn('text-xs', system.failed ? 'text-red-500' : 'text-muted-foreground')}>{system.hostname}</p>
                        {!system.loading && !system.failed && (
                          <div className="mt-2 flex items-center gap-2">
                            <Badge className={health.color}>{health.label}</Badge>
                            <span className="text-xs text-muted-foreground">#{idx + 1} ranked</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Metrics Grid */}
                  <div className="grid grid-cols-3 gap-3">
                    {/* CPU */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1">
                        <Cpu className="w-3 h-3 text-red-400" />
                        <span className="text-xs font-semibold text-muted-foreground">CPU</span>
                      </div>
                      <div className="text-lg font-bold text-foreground">{Math.round(system.cpu)}%</div>
                      <Progress value={system.cpu} className="h-1.5" />
                    </div>

                    {/* Memory */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1">
                        <MemoryStick className="w-3 h-3 text-blue-400" />
                        <span className="text-xs font-semibold text-muted-foreground">Memory</span>
                      </div>
                      <div className="text-lg font-bold text-foreground">{Math.round(system.memory)}%</div>
                      <Progress value={system.memory} className="h-1.5" />
                    </div>

                    {/* Disk */}
                    <div className="space-y-2">
                      <div className="flex items-center gap-1">
                        <HardDrive className="w-3 h-3 text-purple-400" />
                        <span className="text-xs font-semibold text-muted-foreground">Disk</span>
                      </div>
                      <div className="text-lg font-bold text-foreground">{Math.round(system.disk)}%</div>
                      <Progress value={system.disk} className="h-1.5" />
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Legend */}
      {comparison.length > 0 && (
        <Card className="bg-muted/30 border-border">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Health Score Legend</CardTitle>
          </CardHeader>
          <CardContent className="text-xs space-y-1">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-emerald-500" />
              <span>Healthy: 80-100 (Good performance)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-yellow-500" />
              <span>Good: 60-79 (Acceptable load)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-orange-500" />
              <span>Fair: 40-59 (Elevated usage)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded bg-red-500" />
              <span>Critical: 0-39 (High resource usage)</span>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};
