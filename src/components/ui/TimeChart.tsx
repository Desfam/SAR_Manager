import { useId } from 'react';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';

export interface ChartSeries {
  key: string;
  label: string;
  /** CSS colour, e.g. 'rgb(var(--accent))' */
  color: string;
}

interface TimeChartProps {
  data: Array<Record<string, number | null>>;
  series: ChartSeries[];
  format: (value: number) => string;
  /** Upper bound of the y-axis, e.g. 100 for percentages; auto when omitted. */
  max?: number;
  height?: number;
  timeframe: 'hour' | 'day' | 'week' | 'month' | 'year';
}

function tick(time: number, timeframe: TimeChartProps['timeframe']) {
  const date = new Date(time * 1000);
  if (timeframe === 'year') return date.toLocaleDateString('de-DE', { month: 'short', year: '2-digit' });
  if (timeframe === 'month') return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  if (timeframe === 'week') return date.toLocaleDateString('de-DE', { weekday: 'short' });
  return date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function TimeChart({ data, series, format, max, height = 150, timeframe }: TimeChartProps) {
  const id = useId().replace(/:/g, '');

  const Tip = ({ active, payload, label }: TooltipProps<number, string>) => {
    if (!active || !payload?.length) return null;
    const date = new Date(Number(label) * 1000);
    return (
      <div className="panel-surface rounded-xl px-3 py-2 text-[12px] shadow-xl">
        <p className="mb-1 font-mono text-[11px] text-muted">
          {date.toLocaleDateString('de-DE')} · {date.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
        </p>
        {payload.map((entry) => (
          <p key={String(entry.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-muted">
              <span className="size-2 rounded-full" style={{ background: entry.color }} />
              {series.find((item) => item.key === entry.dataKey)?.label}
            </span>
            <span className="font-mono tabular text-ink">{typeof entry.value === 'number' ? format(entry.value) : '–'}</span>
          </p>
        ))}
      </div>
    );
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 4, bottom: 0, left: 0 }}>
        <defs>
          {series.map((item) => (
            <linearGradient key={item.key} id={`${id}-${item.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={item.color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={item.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid vertical={false} stroke="rgb(var(--line) / 0.06)" />
        <XAxis
          dataKey="time"
          tickFormatter={(value: number) => tick(value, timeframe)}
          tick={{ fill: 'rgb(var(--faint))', fontSize: 10.5 }}
          axisLine={false}
          tickLine={false}
          minTickGap={36}
        />
        <YAxis
          domain={[0, max ?? 'auto']}
          tickFormatter={format}
          tick={{ fill: 'rgb(var(--faint))', fontSize: 10.5 }}
          axisLine={false}
          tickLine={false}
          width={58}
        />
        <Tooltip content={<Tip />} cursor={{ stroke: 'rgb(var(--line) / 0.2)', strokeDasharray: '3 3' }} />
        {series.map((item) => (
          <Area
            key={item.key}
            dataKey={item.key}
            type="monotone"
            stroke={item.color}
            strokeWidth={1.8}
            fill={`url(#${id}-${item.key})`}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0 }}
            connectNulls
            isAnimationActive
            animationDuration={700}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
