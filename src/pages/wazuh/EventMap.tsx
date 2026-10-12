import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Shimmer } from '@/components/systems/fx';
import { useEventMap } from '@/hooks/use-soc';
import { RANGES } from '@/lib/soc';
import { formatCount } from '@/lib/wazuh';
import type { EventMapData } from '@/services/soc';

type Node = EventMapData['nodes'][number];

const COLUMNS: Array<{ kind: Node['kind']; label: string }> = [
  { kind: 'host', label: 'Hosts' },
  { kind: 'rule', label: 'Regeln' },
  { kind: 'mitre', label: 'MITRE-Techniken' },
];
const WIDTH = 1100;
const ROW = 30;
const NODE_W = 230;
const X = [10, (WIDTH - NODE_W) / 2, WIDTH - NODE_W - 10];
const LEVELS = [3, 7, 10, 12];

const clip = (value: string) => (value.length > 28 ? `${value.slice(0, 27)}…` : value);
const levelColor = (level: number) => (level >= 12 ? 'rgb(var(--bad))' : level >= 7 ? 'rgb(var(--accent))' : 'rgb(var(--muted))');

export function EventMap() {
  const navigate = useNavigate();
  const [hours, setHours] = useState(24);
  const [minLevel, setMinLevel] = useState(7);
  const [hover, setHover] = useState<string | null>(null);
  const map = useEventMap(hours, minLevel);
  const d = map.data;

  const layout = useMemo(() => {
    if (!d) return null;
    const positions = new Map<string, { x: number; y: number; node: Node }>();
    let rows = 0;
    COLUMNS.forEach((column, columnIndex) => {
      const nodes = d.nodes.filter((node) => node.kind === column.kind).sort((a, b) => b.count - a.count);
      rows = Math.max(rows, nodes.length);
      nodes.forEach((node, index) => positions.set(node.id, { x: X[columnIndex], y: 36 + index * ROW, node }));
    });
    const maxLink = Math.max(1, ...d.links.map((link) => link.count));
    return { positions, height: 36 + rows * ROW + 10, maxLink };
  }, [d]);

  // everything connected to the hovered node (one hop in both directions, plus the second hop through rules)
  const active = useMemo(() => {
    if (!hover || !d) return null;
    const set = new Set([hover]);
    const walk = (id: string, direction: 'down' | 'up', depth: number) => {
      if (!depth) return;
      d.links.forEach((link) => {
        const next = direction === 'down' ? (link.source === id ? link.target : null) : link.target === id ? link.source : null;
        if (next && !set.has(next)) { set.add(next); walk(next, direction, depth - 1); }
      });
    };
    walk(hover, 'down', 2);
    walk(hover, 'up', 2);
    return set;
  }, [hover, d]);

  const open = (node: Node) => {
    const q = node.kind === 'host' ? `host:"${node.label}"` : node.kind === 'rule' ? `rule:${node.ruleId}` : `mitre:${node.mitreId}`;
    navigate(`/wazuh/investigation?q=${encodeURIComponent(q)}`);
  };

  return (
    <>
      <PageHeader
        section="Explore"
        title="Event Map"
        description="Welche Hosts lösen welche Regeln aus, und zu welchen Angriffstechniken gehören sie? Hover zeigt Zusammenhänge, Klick öffnet die Events."
        actions={
          <div className="flex items-center gap-2">
            {map.isFetching && <Loader2 className="size-4 animate-spin text-muted" />}
            <select value={minLevel} onChange={(event) => setMinLevel(Number(event.target.value))} className="h-10 rounded-full border border-line/[0.12] bg-raised/60 px-3 text-[12.5px] outline-none" aria-label="Mindest-Level">
              {LEVELS.map((level) => <option key={level} value={level}>ab Level {level}</option>)}
            </select>
            <div className="flex rounded-full border border-line/[0.12] p-1">
              {RANGES.map((range) => (
                <button key={range.hours} type="button" onClick={() => setHours(range.hours)} className={cn('relative h-8 rounded-full px-3 text-[12.5px]', hours === range.hours ? 'text-ink' : 'text-muted hover:text-ink')}>
                  {hours === range.hours && <motion.span layoutId="map-range" className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" />}
                  <span className="relative">{range.label}</span>
                </button>
              ))}
            </div>
          </div>
        }
      />

      <NotchCard index={0} eyebrow={d ? `${d.nodes.length} Knoten · ${d.links.length} Verbindungen` : 'lädt'} title="Zusammenhänge" bodyClassName="pt-3">
        {map.isError ? (
          <p className="py-10 text-center text-[13px] text-bad">{(map.error as Error).message}</p>
        ) : !d || !layout ? (
          <Shimmer className="h-[480px] w-full" />
        ) : !d.nodes.length ? (
          <p className="py-10 text-center text-[13px] text-muted">Keine Events ab Level {minLevel} im Zeitraum.</p>
        ) : (
          <div className="scroll-thin overflow-x-auto">
            <svg viewBox={`0 0 ${WIDTH} ${layout.height}`} className="w-full min-w-[900px]" style={{ height: layout.height }}>
              {COLUMNS.map((column, index) => (
                <text key={column.kind} x={X[index]} y={16} className="fill-[rgb(var(--faint))] text-[11px] uppercase tracking-[0.08em]">{column.label}</text>
              ))}
              {d.links.map((link, index) => {
                const from = layout.positions.get(link.source);
                const to = layout.positions.get(link.target);
                if (!from || !to) return null;
                const x1 = from.x + NODE_W;
                const y1 = from.y + 11;
                const x2 = to.x;
                const y2 = to.y + 11;
                const mid = (x1 + x2) / 2;
                const lit = active ? active.has(link.source) && active.has(link.target) : false;
                return (
                  <motion.path
                    key={`${link.source}-${link.target}`}
                    d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
                    fill="none"
                    stroke={lit ? 'rgb(var(--accent))' : 'rgb(var(--line))'}
                    strokeOpacity={active ? (lit ? 0.9 : 0.04) : 0.16}
                    strokeWidth={1 + 5 * Math.sqrt(link.count / layout.maxLink)}
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.8, delay: Math.min(index, 60) * 0.008 }}
                  />
                );
              })}
              {[...layout.positions.values()].map(({ x, y, node }, index) => {
                const dim = active && !active.has(node.id);
                return (
                  <motion.g
                    key={node.id}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: dim ? 0.25 : 1, x: 0 }}
                    transition={{ delay: hover ? 0 : Math.min(index, 40) * 0.012 }}
                    onMouseEnter={() => setHover(node.id)}
                    onMouseLeave={() => setHover(null)}
                    onClick={() => open(node)}
                    className="cursor-pointer"
                  >
                    <title>{`${node.label}${node.tactic ? ` (${node.tactic})` : ''}\n${formatCount(node.count)} Events · max. Level ${node.maxLevel}`}</title>
                    <rect x={x} y={y} width={NODE_W} height={22} rx={11} fill="rgb(var(--raised))" stroke={hover === node.id ? 'rgb(var(--accent))' : 'rgb(var(--line) / 0.12)'} />
                    <circle cx={x + 11} cy={y + 11} r={4} fill={levelColor(node.maxLevel)} />
                    <text x={x + 21} y={y + 15} className="fill-[rgb(var(--ink))] text-[11.5px]">
                      {clip((node.kind === 'mitre' && node.mitreId ? `${node.mitreId} ` : '') + node.label)}
                    </text>
                    <text x={x + NODE_W - 9} y={y + 15} textAnchor="end" className="fill-[rgb(var(--faint))] font-mono text-[10px]">{formatCount(node.count)}</text>
                  </motion.g>
                );
              })}
            </svg>
          </div>
        )}
        <p className="mt-3 text-[11.5px] text-faint">Punktfarbe = höchstes Level (rot ab 12, Akzent ab 7). Linienstärke = Anzahl Events. Nur die häufigsten Hosts, Regeln und Techniken.</p>
      </NotchCard>
    </>
  );
}
