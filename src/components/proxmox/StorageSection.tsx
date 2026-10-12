import { useMemo } from 'react';
import { motion } from 'motion/react';
import { Archive, Database, HardDrive, Share2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatBytes } from '@/lib/proxmox';
import { useStorage } from '@/hooks/use-proxmox';
import type { StorageEntry } from '@/services/proxmox';
import { NotchCard } from '@/components/ui/NotchCard';
import { Meter, UsageValue } from './shared';
import { usageTone } from '@/lib/usage';

interface StorageItem {
  key: string;
  name: string;
  type?: string;
  content: string[];
  shared: boolean;
  nodes: string[];
  offlineOn: string[];
  used: number;
  total: number;
  percent: number | null;
}

const CONTENT_LABELS: Record<string, string> = {
  images: 'VM-Disks',
  rootdir: 'CT-Volumes',
  backup: 'Backups',
  iso: 'ISOs',
  vztmpl: 'CT-Vorlagen',
  snippets: 'Snippets',
  import: 'Import',
};

/** Shared storages are reported once per node; they are one storage, so they are merged. */
function groupStorage(entries: StorageEntry[]): StorageItem[] {
  const groups = new Map<string, StorageItem>();
  entries.forEach((entry) => {
    const shared = entry.shared === 1;
    const key = shared ? entry.storage : `${entry.storage}@${entry.node}`;
    const available = entry.status === 'available';
    const existing = groups.get(key);
    if (existing) {
      existing.nodes.push(entry.node);
      if (!available) existing.offlineOn.push(entry.node);
      if (available && !existing.total) {
        existing.used = entry.disk ?? 0;
        existing.total = entry.maxdisk ?? 0;
      }
      return;
    }
    groups.set(key, {
      key,
      name: entry.storage,
      type: entry.plugintype,
      content: (entry.content ?? '').split(',').filter(Boolean),
      shared,
      nodes: [entry.node],
      offlineOn: available ? [] : [entry.node],
      used: available ? entry.disk ?? 0 : 0,
      total: available ? entry.maxdisk ?? 0 : 0,
      percent: null,
    });
  });
  return [...groups.values()]
    .map((item) => ({ ...item, nodes: item.nodes.sort(), percent: item.total ? (item.used / item.total) * 100 : null }))
    .sort((left, right) => (right.percent ?? -1) - (left.percent ?? -1));
}

function iconFor(item: StorageItem) {
  if (item.content.includes('backup') && !item.content.includes('images')) return Archive;
  if (item.shared) return Share2;
  if (item.type?.startsWith('lvm') || item.type === 'zfspool') return Database;
  return HardDrive;
}

export function StorageSection({ index = 0 }: { index?: number }) {
  const storage = useStorage();
  const items = useMemo(() => groupStorage(storage.data ?? []), [storage.data]);
  const warnings = items.filter((item) => usageTone(item.percent) !== 'normal' || item.offlineOn.length > 0).length;

  return (
    <NotchCard index={index} eyebrow={warnings > 0 ? `${warnings} mit Hinweis` : 'Alles im grünen Bereich'} title={`Storage (${items.length})`} bodyClassName="pt-4">
      {storage.isLoading ? (
        <p className="py-8 text-center text-[13px] text-muted">Lädt Storage …</p>
      ) : storage.isError ? (
        <p className="py-8 text-center text-[13px] text-bad">Storage nicht verfügbar: {(storage.error as Error).message}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {items.map((item, position) => {
            const Icon = iconFor(item);
            const tone = usageTone(item.percent);
            const fullyOffline = item.offlineOn.length === item.nodes.length;
            return (
              <motion.div
                key={item.key}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 + position * 0.03, duration: 0.35 }}
                className={cn(
                  'rounded-2xl border bg-raised/35 p-4 transition-colors hover:bg-raised/60',
                  fullyOffline || tone === 'bad' ? 'border-bad/35' : tone === 'warn' || item.offlineOn.length > 0 ? 'border-accent/40' : 'border-line/[0.07]',
                )}
              >
                <div className="flex items-start gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-line/[0.08] bg-raised text-muted">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-mono text-[13px] font-medium">{item.name}</p>
                      <span className="rounded-md bg-hover px-1.5 py-0.5 font-mono text-[10px] text-muted">{item.type}</span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-muted">
                      {item.shared ? `Geteilt · ${item.nodes.length} ${item.nodes.length === 1 ? "Node" : "Nodes"}` : item.nodes[0]}
                    </p>
                  </div>
                  {fullyOffline ? <span className="text-[12px] text-bad">nicht erreichbar</span> : <UsageValue value={item.percent} className="text-[13px]" />}
                </div>
                {!fullyOffline && (
                  <>
                    <Meter value={item.percent} className="mt-3" />
                    <div className="mt-2 flex items-center justify-between text-[11.5px] text-muted">
                      <span className="font-mono">{formatBytes(item.used)} / {formatBytes(item.total)}</span>
                      <span>{formatBytes(Math.max(0, item.total - item.used))} frei</span>
                    </div>
                  </>
                )}
                <div className="mt-2.5 flex flex-wrap gap-1.5">
                  {item.content.map((content) => (
                    <span key={content} className="rounded-full border border-line/[0.08] px-2 py-0.5 text-[10.5px] text-muted">
                      {CONTENT_LABELS[content] ?? content}
                    </span>
                  ))}
                  {item.offlineOn.length > 0 && !fullyOffline && (
                    <span className="rounded-full bg-warn/10 px-2 py-0.5 text-[10.5px] text-warn">fehlt auf {item.offlineOn.join(', ')}</span>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </NotchCard>
  );
}
