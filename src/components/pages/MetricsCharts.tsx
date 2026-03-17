import { useState, useEffect, useCallback } from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Clock, Cpu, MemoryStick, HardDrive, Activity, Network, ArrowUpDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MetricsData {
  timestamp: string;
  cpu: number;
  memory: number;
  disk: number;
  loadAvg1: number;
  loadAvg5: number;
  loadAvg15: number;
  netRxRate: number | null;
  netTxRate: number | null;
  diskReadRate: number | null;
  diskWriteRate: number | null;
}

interface MetricsChartsProps {
  connectionId: string;
  connectionName: string;
}

type ChartTab = 'cpu_mem' | 'disk' | 'load' | 'network' | 'disk_io';

const CHART_TABS: { id: ChartTab; label: string; icon: React.ElementType }[] = [
  { id: 'cpu_mem', label: 'CPU & Memory', icon: Cpu },
  { id: 'disk', label: 'Disk', icon: HardDrive },
  { id: 'load', label: 'Load Average', icon: Activity },
  { id: 'network', label: 'Network IO', icon: Network },
  { id: 'disk_io', label: 'Disk IO', icon: ArrowUpDown },
];

const TIME_RANGES = [
  { label: '1h', value: 1 },
  { label: '6h', value: 6 },
  { label: '24h', value: 24 },
  { label: '7d', value: 168 },
  { label: '30d', value: 720 },
];

function formatRate(bytesPerSec: number): string {
  if (!Number.isFinite(bytesPerSec) || bytesPerSec < 0) return '0 B/s';
  if (bytesPerSec >= 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(2)} MB/s`;
  if (bytesPerSec >= 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  return `${bytesPerSec.toFixed(0)} B/s`;
}

function CustomTooltip({ active, payload, label, isPercent, isRate }: any) {
  if (!active || !payload?.length) return null;

  const date = new Date(label);
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });

  return (
    <div className="rounded-xl border border-border/50 bg-card/95 backdrop-blur-sm shadow-xl px-4 py-3 text-xs min-w-[160px]">
      <p className="text-muted-foreground mb-2 font-medium">
        {dateStr} · {timeStr}
      </p>
      {payload.map((entry: any) => (
        <div key={entry.dataKey} className="flex items-center justify-between gap-4 mb-1">
          <div className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
              style={{ background: entry.color }}
            />
            <span className="text-muted-foreground">{entry.name}</span>
          </div>
          <span className="font-semibold text-foreground tabular-nums">
            {isPercent
              ? `${Number(entry.value).toFixed(1)}%`
              : isRate
              ? formatRate(Number(entry.value))
              : Number(entry.value).toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MetricsCharts({ connectionId, connectionName }: MetricsChartsProps) {
  const [data, setData] = useState<MetricsData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hours, setHours] = useState(24);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ChartTab>('cpu_mem');

  const fetchMetricsHistory = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch(
        `/api/connections/${connectionId}/metrics-history?hours=${hours}`
      );

      if (!response.ok) throw new Error('Failed to fetch metrics history');

      const result = await response.json();
      const formatted = result.data
        .map((item: any) => {
          const cpu = Number.parseFloat(item.cpu_usage);
          const memory = Number.parseFloat(item.memory_usage);
          const disk = Number.parseFloat(item.disk_usage);
          const loadAvg1 = Number.parseFloat(item.load_avg_1);
          const loadAvg5 = Number.parseFloat(item.load_avg_5);
          const loadAvg15 = Number.parseFloat(item.load_avg_15);
          const netRxRaw = item.net_rx_rate != null ? Number.parseFloat(item.net_rx_rate) : NaN;
          const netTxRaw = item.net_tx_rate != null ? Number.parseFloat(item.net_tx_rate) : NaN;
          const dReadRaw = item.disk_read_rate != null ? Number.parseFloat(item.disk_read_rate) : NaN;
          const dWriteRaw = item.disk_write_rate != null ? Number.parseFloat(item.disk_write_rate) : NaN;

          return {
            timestamp: item.recorded_at || item.timestamp,
            cpu: Number.isFinite(cpu) ? cpu : 0,
            memory: Number.isFinite(memory) ? memory : 0,
            disk: Number.isFinite(disk) ? disk : 0,
            loadAvg1: Number.isFinite(loadAvg1) ? loadAvg1 : 0,
            loadAvg5: Number.isFinite(loadAvg5) ? loadAvg5 : 0,
            loadAvg15: Number.isFinite(loadAvg15) ? loadAvg15 : 0,
            netRxRate: Number.isFinite(netRxRaw) ? netRxRaw : null,
            netTxRate: Number.isFinite(netTxRaw) ? netTxRaw : null,
            diskReadRate: Number.isFinite(dReadRaw) ? dReadRaw : null,
            diskWriteRate: Number.isFinite(dWriteRaw) ? dWriteRaw : null,
            hasPrimaryMetric:
              Number.isFinite(cpu) || Number.isFinite(memory) || Number.isFinite(disk),
          };
        })
        .filter((item: any) => item.hasPrimaryMetric)
        .map(({ hasPrimaryMetric, ...item }: any) => item);

      setData(formatted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [connectionId, hours]);

  useEffect(() => {
    fetchMetricsHistory();
    const interval = setInterval(fetchMetricsHistory, 30000);
    return () => clearInterval(interval);
  }, [fetchMetricsHistory]);

  const latest = data[data.length - 1];
  const first = data[0];
  const availableHours =
    first && latest
      ? Math.max(0, (new Date(latest.timestamp).getTime() - new Date(first.timestamp).getTime()) / 3600000)
      : 0;

  const formatTick = (iso: string) => {
    const date = new Date(iso);
    if (availableHours <= 8) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    if (availableHours <= 72) {
      return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const GRADIENTS = [
    { id: 'cpu', color: '#ef4444' },
    { id: 'memory', color: '#3b82f6' },
    { id: 'disk', color: '#f59e0b' },
    { id: 'load1', color: '#10b981' },
    { id: 'load5', color: '#06b6d4' },
    { id: 'load15', color: '#8b5cf6' },
    { id: 'netRx', color: '#34d399' },
    { id: 'netTx', color: '#f97316' },
    { id: 'diskRead', color: '#a78bfa' },
    { id: 'diskWrite', color: '#fb7185' },
  ];

  const gradientDefs = (
    <defs>
      {GRADIENTS.map(({ id, color }) => (
        <linearGradient key={id} id={`grad-${id}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.3} />
          <stop offset="95%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      ))}
    </defs>
  );

  const axisProps = {
    tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 11 },
    axisLine: { stroke: 'hsl(var(--border))', strokeOpacity: 0.5 },
    tickLine: false,
  };

  const gridProps = {
    strokeDasharray: '3 3',
    stroke: 'hsl(var(--border))',
    strokeOpacity: 0.4,
    vertical: false,
  };

  // For small datasets (< 100 points), show most/all points; for larger datasets, show ~6-7 points
  const tickInterval = data.length > 0 ? Math.max(0, Math.ceil(data.length / 7) - 1) : 0;

  const EmptyState = () => (
    <div className="h-72 flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <Activity className="w-8 h-8 opacity-30" />
      <p className="text-sm">No data for this time range</p>
      <p className="text-xs opacity-50 mt-2">Requested: {hours}h · Points: {data.length}</p>
    </div>
  );

  const StatBadge = ({
    label,
    value,
    color,
    icon: Icon,
  }: {
    label: string;
    value?: number;
    color: string;
    icon: React.ElementType;
  }) => (
    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
      <Icon className="w-3 h-3" style={{ color }} />
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold text-foreground">
        {value !== undefined ? `${value.toFixed(1)}%` : '—'}
      </span>
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Tab selector */}
        <div className="flex items-center gap-1 rounded-xl bg-muted/40 border border-border/50 p-1">
          {CHART_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all duration-150',
                activeTab === id
                  ? 'bg-card text-foreground shadow-sm border border-border/50'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>

        {/* Time range selector */}
        <div className="flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5 text-muted-foreground" />
          <div className="flex items-center gap-1 rounded-xl bg-muted/40 border border-border/50 p-1">
            {TIME_RANGES.map((range) => (
              <button
                key={range.value}
                onClick={() => setHours(range.value)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-xs font-medium transition-all duration-150',
                  hours === range.value
                    ? 'bg-card text-foreground shadow-sm border border-border/50'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {range.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Chart card */}
      <Card className="border-border/50 bg-card/50">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div>
              <CardTitle className="text-base">
                {activeTab === 'cpu_mem' && 'CPU & Memory Usage'}
                {activeTab === 'disk' && 'Disk Usage'}
                {activeTab === 'load' && 'System Load Average'}
                {activeTab === 'network' && 'Network IO'}
                {activeTab === 'disk_io' && 'Disk IO'}
              </CardTitle>
              <CardDescription className="mt-0.5">
                Last {hours < 24 ? `${hours}h` : hours === 24 ? '24 hours' : hours === 168 ? '7 days' : '30 days'} · {connectionName}
                {!loading && data.length > 1 && availableHours + 0.05 < hours && (
                  <span className="ml-2 text-amber-400/90">(showing {availableHours.toFixed(1)}h available)</span>
                )}
              </CardDescription>
            </div>

            {/* Live value badges */}
            {latest && !loading && (
              <div className="flex flex-wrap justify-end gap-1.5">
                {activeTab === 'cpu_mem' && (
                  <>
                    <StatBadge label="CPU" value={latest.cpu} color="#ef4444" icon={Cpu} />
                    <StatBadge label="RAM" value={latest.memory} color="#3b82f6" icon={MemoryStick} />
                  </>
                )}
                {activeTab === 'disk' && (
                  <StatBadge label="Disk" value={latest.disk} color="#f59e0b" icon={HardDrive} />
                )}
                {activeTab === 'load' && (
                  <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
                    <Activity className="w-3 h-3 text-emerald-400" />
                    <span className="text-muted-foreground">Load</span>
                    <span className="font-semibold text-foreground">{latest.loadAvg1.toFixed(2)}</span>
                  </div>
                )}
                {activeTab === 'network' && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
                      <Network className="w-3 h-3" style={{ color: '#34d399' }} />
                      <span className="text-muted-foreground">RX</span>
                      <span className="font-semibold text-foreground">{latest.netRxRate != null ? formatRate(latest.netRxRate) : '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
                      <Network className="w-3 h-3" style={{ color: '#f97316' }} />
                      <span className="text-muted-foreground">TX</span>
                      <span className="font-semibold text-foreground">{latest.netTxRate != null ? formatRate(latest.netTxRate) : '—'}</span>
                    </div>
                  </div>
                )}
                {activeTab === 'disk_io' && (
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
                      <ArrowUpDown className="w-3 h-3" style={{ color: '#a78bfa' }} />
                      <span className="text-muted-foreground">Read</span>
                      <span className="font-semibold text-foreground">{latest.diskReadRate != null ? formatRate(latest.diskReadRate) : '—'}</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-medium border border-border/50 bg-muted/30">
                      <ArrowUpDown className="w-3 h-3" style={{ color: '#fb7185' }} />
                      <span className="text-muted-foreground">Write</span>
                      <span className="font-semibold text-foreground">{latest.diskWriteRate != null ? formatRate(latest.diskWriteRate) : '—'}</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="pt-2 pb-4">
          {loading ? (
            <div className="h-72 rounded-lg bg-muted/20 animate-pulse" />
          ) : data.length === 0 ? (
            <EmptyState />
          ) : (
            <>
              {activeTab === 'cpu_mem' && (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    {gradientDefs}
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={formatTick} interval={tickInterval} {...axisProps} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                    <Tooltip content={<CustomTooltip isPercent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="cpu"
                      stroke="#ef4444"
                      strokeWidth={2}
                      fill="url(#grad-cpu)"
                      dot={false}
                      name="CPU %"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="memory"
                      stroke="#3b82f6"
                      strokeWidth={2}
                      fill="url(#grad-memory)"
                      dot={false}
                      name="RAM %"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeTab === 'network' && (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    {gradientDefs}
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={formatTick} interval={tickInterval} {...axisProps} />
                    <YAxis tickFormatter={(v) => formatRate(v)} width={70} {...axisProps} />
                    <Tooltip content={<CustomTooltip isRate />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="netRxRate"
                      stroke="#34d399"
                      strokeWidth={2}
                      fill="url(#grad-netRx)"
                      dot={false}
                      name="RX"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="netTxRate"
                      stroke="#f97316"
                      strokeWidth={2}
                      fill="url(#grad-netTx)"
                      dot={false}
                      name="TX"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeTab === 'disk_io' && (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    {gradientDefs}
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={formatTick} interval={tickInterval} {...axisProps} />
                    <YAxis tickFormatter={(v) => formatRate(v)} width={70} {...axisProps} />
                    <Tooltip content={<CustomTooltip isRate />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="diskReadRate"
                      stroke="#a78bfa"
                      strokeWidth={2}
                      fill="url(#grad-diskRead)"
                      dot={false}
                      name="Read"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="diskWriteRate"
                      stroke="#fb7185"
                      strokeWidth={2}
                      fill="url(#grad-diskWrite)"
                      dot={false}
                      name="Write"
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeTab === 'disk' && (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    {gradientDefs}
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={formatTick} interval={tickInterval} {...axisProps} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axisProps} />
                    <Tooltip content={<CustomTooltip isPercent />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="disk"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      fill="url(#grad-disk)"
                      dot={false}
                      name="Disk %"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}

              {activeTab === 'load' && (
                <ResponsiveContainer width="100%" height={320}>
                  <AreaChart data={data} margin={{ top: 4, right: 4, left: -10, bottom: 0 }}>
                    {gradientDefs}
                    <CartesianGrid {...gridProps} />
                    <XAxis dataKey="timestamp" tickFormatter={formatTick} interval={tickInterval} {...axisProps} />
                    <YAxis {...axisProps} />
                    <Tooltip content={<CustomTooltip isPercent={false} />} />
                    <Legend
                      wrapperStyle={{ fontSize: 12, paddingTop: 12 }}
                      formatter={(value) => <span style={{ color: 'hsl(var(--muted-foreground))' }}>{value}</span>}
                    />
                    <Area
                      type="monotone"
                      dataKey="loadAvg1"
                      stroke="#10b981"
                      strokeWidth={2}
                      fill="url(#grad-load1)"
                      dot={false}
                      name="1m avg"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="loadAvg5"
                      stroke="#06b6d4"
                      strokeWidth={2}
                      fill="url(#grad-load5)"
                      dot={false}
                      name="5m avg"
                      isAnimationActive={false}
                    />
                    <Area
                      type="monotone"
                      dataKey="loadAvg15"
                      stroke="#8b5cf6"
                      strokeWidth={2}
                      fill="url(#grad-load15)"
                      dot={false}
                      name="15m avg"
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
