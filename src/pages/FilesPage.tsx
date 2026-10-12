import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import {
  ArrowUp,
  ChevronRight,
  Download,
  Eye,
  EyeOff,
  File,
  FileArchive,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderPlus,
  HardDrive,
  Home,
  KeyRound,
  Loader2,
  Lock,
  Pencil,
  RefreshCw,
  Save,
  ScrollText,
  Search,
  Server,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { formatBytes } from '@/lib/proxmox';
import { formatRelative } from '@/lib/format';
import { useConnections, type Connection } from '@/hooks/use-infrastructure';
import { filesApi, joinPath, octalOf, parentOf, permissionString, type Preview, type RemoteFile } from '@/services/files';

/* ---------- helpers ---------- */

const TEXT_EXT = new Set(['txt', 'md', 'log', 'conf', 'cfg', 'ini', 'yaml', 'yml', 'json', 'xml', 'env', 'sh', 'bash', 'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'php', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sql', 'toml', 'service', 'csv']);
const CODE_EXT = new Set(['sh', 'bash', 'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'php', 'go', 'rs', 'java', 'c', 'h', 'cpp', 'sql', 'json', 'yaml', 'yml', 'toml']);
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp']);
const ARCHIVE_EXT = new Set(['zip', 'tar', 'gz', 'tgz', 'bz2', 'xz', '7z', 'rar', 'deb', 'rpm']);

function iconFor(file: RemoteFile) {
  if (file.type === 'folder') return { icon: Folder, className: 'text-accent' };
  const extension = file.name.includes('.') ? file.name.split('.').pop()!.toLowerCase() : '';
  if (IMAGE_EXT.has(extension)) return { icon: FileImage, className: 'text-info' };
  if (ARCHIVE_EXT.has(extension)) return { icon: FileArchive, className: 'text-warn' };
  if (CODE_EXT.has(extension)) return { icon: FileCode2, className: 'text-ok' };
  if (extension === 'log') return { icon: ScrollText, className: 'text-muted' };
  if (TEXT_EXT.has(extension) || file.name.startsWith('.')) return { icon: FileText, className: 'text-muted' };
  if (/^(id_|authorized_keys|known_hosts)/.test(file.name)) return { icon: KeyRound, className: 'text-accent' };
  return { icon: File, className: 'text-faint' };
}

const homeOf = (connection: Connection) => (connection.username === 'root' ? '/root' : `/home/${connection.username}`);

type SortKey = 'name' | 'size' | 'modified';

/* ---------- dialogs ---------- */

function InputDialog({ open, title, label, initial, confirm, onCancel, onSubmit, hint, mono = true }: { open: boolean; title: string; label: string; initial: string; confirm: string; onCancel: () => void; onSubmit: (value: string) => void; hint?: ReactNode; mono?: boolean }) {
  const [value, setValue] = useState(initial);
  useEffect(() => setValue(initial), [initial, open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
          <motion.form
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.2 }}
            onSubmit={(event) => {
              event.preventDefault();
              if (value.trim()) onSubmit(value.trim());
            }}
            className="panel-surface w-[520px] max-w-[94vw] rounded-[22px] p-6 shadow-2xl"
          >
            <h2 className="text-[17px] font-semibold">{title}</h2>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-[12.5px] text-muted">{label}</span>
              <input
                autoFocus
                value={value}
                onChange={(event) => setValue(event.target.value)}
                onFocus={(event) => {
                  const dot = event.target.value.lastIndexOf('.');
                  const slash = event.target.value.lastIndexOf('/');
                  if (dot > slash + 1) event.target.setSelectionRange(slash + 1, dot);
                }}
                className={cn('h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 text-[13.5px] outline-none focus:border-accent/45', mono && 'font-mono')}
              />
            </label>
            {hint && <div className="mt-2 text-[12px] text-muted">{hint}</div>}
            <div className="mt-6 flex justify-end gap-2.5">
              <button type="button" onClick={onCancel} className="h-10 rounded-full border border-line/[0.12] px-4 text-[13.5px] hover:bg-raised">Abbrechen</button>
              <button type="submit" className="h-10 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink">{confirm}</button>
            </div>
          </motion.form>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ChmodDialog({ file, path, onCancel, onSubmit }: { file: RemoteFile | null; path: string; onCancel: () => void; onSubmit: (mode: string) => void }) {
  const [mode, setMode] = useState(0o644);
  useEffect(() => {
    if (file) setMode(file.permissions & 0o777);
  }, [file]);
  const roles = [
    { label: 'Besitzer', shift: 6 },
    { label: 'Gruppe', shift: 3 },
    { label: 'Andere', shift: 0 },
  ];
  const bits = [
    { label: 'Lesen', value: 4 },
    { label: 'Schreiben', value: 2 },
    { label: 'Ausführen', value: 1 },
  ];
  return (
    <AnimatePresence>
      {file && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => event.target === event.currentTarget && onCancel()}>
          <motion.div initial={{ opacity: 0, y: 10, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }} className="panel-surface w-[460px] max-w-[94vw] rounded-[22px] p-6 shadow-2xl">
            <h2 className="text-[17px] font-semibold">Rechte von {file.name}</h2>
            <p className="mt-1 truncate font-mono text-[12px] text-muted">{path}</p>
            <div className="mt-5 grid grid-cols-[90px_repeat(3,1fr)] gap-2 text-[12.5px]">
              <span />
              {bits.map((bit) => <span key={bit.label} className="text-center text-muted">{bit.label}</span>)}
              {roles.map((role) => (
                <div key={role.label} className="contents">
                  <span className="self-center text-muted">{role.label}</span>
                  {bits.map((bit) => {
                    const flag = bit.value << role.shift;
                    const on = (mode & flag) !== 0;
                    return (
                      <button
                        key={bit.label}
                        type="button"
                        onClick={() => setMode((current) => current ^ flag)}
                        className={cn('h-10 rounded-xl border font-mono text-[13px] transition-colors', on ? 'border-accent/45 bg-accent/[0.12] text-accent' : 'border-line/[0.10] text-faint hover:border-line/[0.2]')}
                      >
                        {on ? ['r', 'w', 'x'][[4, 2, 1].indexOf(bit.value)] : '–'}
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            <p className="mt-4 text-center font-mono text-[15px]">{permissionString(mode, file.type === 'folder')} · {octalOf(mode)}</p>
            <div className="mt-6 flex justify-end gap-2.5">
              <button type="button" onClick={onCancel} className="h-10 rounded-full border border-line/[0.12] px-4 text-[13.5px] hover:bg-raised">Abbrechen</button>
              <button type="button" onClick={() => onSubmit(octalOf(mode))} className="h-10 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink">Übernehmen</button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- preview / editor ---------- */

function PreviewPanel({ connectionId, file, path, onClose, onSaved }: { connectionId: string; file: RemoteFile; path: string; onClose: () => void; onSaved: () => void }) {
  const preview = useQuery({ queryKey: ['files', 'preview', connectionId, path], queryFn: () => filesApi.preview(connectionId, path), staleTime: 0 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const data = preview.data as Preview | undefined;
  const text = data?.kind === 'text' && !data.tooLarge ? data.content ?? '' : null;
  const dirty = editing && text !== null && draft !== text;

  useEffect(() => {
    if (text !== null) setDraft(text);
  }, [text]);

  const save = async () => {
    setSaving(true);
    try {
      await filesApi.write(connectionId, path, draft);
      toast.success(`${file.name} gespeichert`);
      setEditing(false);
      await preview.refetch();
      onSaved();
    } catch (error) {
      toast.error('Speichern fehlgeschlagen', { description: (error as Error).message });
    } finally {
      setSaving(false);
    }
  };

  const lines = (editing ? draft : text ?? '').split('\n');
  const { icon: Icon, className } = iconFor(file);

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-line/[0.07] px-7 pb-5 pt-7">
        <p className="flex items-center gap-2 text-[12px] text-muted"><Icon className={cn('size-4', className)} /> {formatBytes(file.size)} · {formatRelative(file.modified)} · <span className="font-mono">{permissionString(file.permissions, false)}</span></p>
        <h2 className="mt-1 truncate pr-12 text-[22px] font-semibold tracking-[-0.02em]">{file.name}</h2>
        <p className="mt-0.5 truncate font-mono text-[11.5px] text-faint">{path}</p>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={() => void filesApi.download(connectionId, path).catch((error) => toast.error('Download fehlgeschlagen', { description: error.message }))} className="flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-3.5 text-[13px] hover:border-accent/40 hover:bg-raised">
            <Download className="size-4" /> Herunterladen
          </button>
          {text !== null && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="flex h-9 items-center gap-2 rounded-full border border-line/[0.12] px-3.5 text-[13px] hover:border-accent/40 hover:bg-raised">
              <Pencil className="size-4" /> Bearbeiten
            </button>
          )}
          {editing && (
            <>
              <button type="button" disabled={!dirty || saving} onClick={() => void save()} className="flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-3.5 text-[13px] font-medium text-accent-ink disabled:opacity-50">
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Speichern
              </button>
              <button type="button" onClick={() => { setEditing(false); setDraft(text ?? ''); }} className="h-9 rounded-full border border-line/[0.12] px-3.5 text-[13px] hover:bg-raised">Verwerfen</button>
              {dirty && <span className="self-center text-[12px] text-accent">ungespeichert</span>}
            </>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-[#0e0e0f] scroll-thin">
        {preview.isLoading ? (
          <p className="flex items-center justify-center py-20 text-[13px] text-[#9a9aa1]"><Loader2 className="mr-2 size-4 animate-spin" /> Lädt …</p>
        ) : preview.isError ? (
          <p className="px-7 py-10 text-[13px] text-bad">{(preview.error as Error).message}</p>
        ) : data?.kind === 'image' && !data.tooLarge ? (
          <div className="grid-texture flex min-h-full items-center justify-center p-6">
            <img src={`data:${data.mime};base64,${data.base64}`} alt={file.name} className="max-h-[70vh] max-w-full rounded-lg shadow-2xl" />
          </div>
        ) : data?.kind === 'binary' ? (
          <p className="px-7 py-16 text-center text-[13px] text-[#9a9aa1]">Binärdatei · keine Vorschau. Zum Ansehen herunterladen.</p>
        ) : data && 'tooLarge' in data && data.tooLarge ? (
          <p className="px-7 py-16 text-center text-[13px] text-[#9a9aa1]">Zu groß für die Vorschau ({formatBytes(data.size)}, Grenze {formatBytes(data.limit ?? 0)}). Zum Ansehen herunterladen.</p>
        ) : editing ? (
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            spellCheck={false}
            onKeyDown={(event) => {
              if ((event.ctrlKey || event.metaKey) && event.key === 's') {
                event.preventDefault();
                if (dirty) void save();
              }
              if (event.key === 'Tab') {
                event.preventDefault();
                const target = event.currentTarget;
                const start = target.selectionStart;
                setDraft(`${draft.slice(0, start)}  ${draft.slice(target.selectionEnd)}`);
                requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2));
              }
            }}
            className="selectable block h-full min-h-[60vh] w-full resize-none bg-transparent p-5 font-mono text-[12.5px] leading-[1.6] text-[#e6e6e8] outline-none"
          />
        ) : (
          <pre className="selectable flex p-5 font-mono text-[12.5px] leading-[1.6] text-[#e6e6e8]">
            <span className="select-none pr-4 text-right text-[#5c5c63]">{lines.map((_, index) => <span key={index} className="block">{index + 1}</span>)}</span>
            <code className="whitespace-pre">{text}</code>
          </pre>
        )}
      </div>
      {editing && <p className="border-t border-line/[0.07] px-7 py-2 text-[11px] text-faint">Strg+S speichert · Tab rückt ein</p>}
      <button type="button" onClick={onClose} className="sr-only">Schließen</button>
    </div>
  );
}

/* ---------- page ---------- */

interface UploadItem {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

export function FilesPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const connections = useConnections();
  const hosts = useMemo(() => (connections.data ?? []).filter((connection) => connection.type !== 'rdp'), [connections.data]);

  const hostId = params.get('host') ?? (() => {
    try {
      return localStorage.getItem('sar.filesHost');
    } catch {
      return null;
    }
  })() ?? hosts[0]?.id ?? null;
  const host = hosts.find((item) => item.id === hostId) ?? hosts[0] ?? null;
  const [pathByHost, setPathByHost] = useState<Record<string, string>>({});
  const path = host ? pathByHost[host.id] ?? homeOf(host) : '/';

  const [showHidden, setShowHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewFile, setPreviewFile] = useState<RemoteFile | null>(null);
  const [dialog, setDialog] = useState<null | { kind: 'mkdir' } | { kind: 'rename'; file: RemoteFile } | { kind: 'move'; names: string[] } | { kind: 'path' }>(null);
  const [chmodFile, setChmodFile] = useState<RemoteFile | null>(null);
  const [deleteNames, setDeleteNames] = useState<string[] | null>(null);
  const [overwrite, setOverwrite] = useState<{ files: File[]; existing: string[] } | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [dragOverFolder, setDragOverFolder] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; file: RemoteFile } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const selectHost = (id: string) => {
    setParams({ host: id });
    setSelected(new Set());
    try {
      localStorage.setItem('sar.filesHost', id);
    } catch {
      // ignore
    }
  };
  const go = useCallback((next: string) => {
    if (!host) return;
    setPathByHost((current) => ({ ...current, [host.id]: next }));
    setSelected(new Set());
    setFilter('');
  }, [host]);

  const listing = useQuery({
    queryKey: ['files', 'list', host?.id, path],
    queryFn: () => filesApi.list(host!.id, path),
    enabled: !!host,
    retry: false,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['files', 'list', host?.id] });

  const files = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return (listing.data?.files ?? [])
      .filter((file) => showHidden || !file.name.startsWith('.'))
      .filter((file) => !needle || file.name.toLowerCase().includes(needle))
      .sort((left, right) => {
        if (left.type !== right.type) return left.type === 'folder' ? -1 : 1;
        const value = sort.key === 'name' ? left.name.localeCompare(right.name, 'de', { numeric: true }) : sort.key === 'size' ? left.size - right.size : new Date(left.modified).getTime() - new Date(right.modified).getTime();
        return value * sort.dir;
      });
  }, [filter, listing.data, showHidden, sort]);

  const hiddenCount = (listing.data?.files ?? []).filter((file) => file.name.startsWith('.')).length;
  const totalSize = files.filter((file) => file.type === 'file').reduce((sum, file) => sum + file.size, 0);
  const selectedFiles = files.filter((file) => selected.has(file.name));

  /* ----- actions ----- */
  const run = async (label: string, task: () => Promise<unknown>, success?: string) => {
    try {
      await task();
      if (success) toast.success(success);
    } catch (error) {
      toast.error(`${label} fehlgeschlagen`, { description: (error as Error).message });
    } finally {
      refresh();
    }
  };

  const open = (file: RemoteFile) => (file.type === 'folder' ? go(joinPath(path, file.name)) : setPreviewFile(file));
  const download = (names: string[]) => names.forEach((name) => void filesApi.download(host!.id, joinPath(path, name)).catch((error) => toast.error(`Download von ${name} fehlgeschlagen`, { description: error.message })));

  const moveNames = async (names: string[], targetDir: string) => {
    if (!host) return;
    const target = targetDir.replace(/\/$/, '') || '/';
    for (const name of names) {
      await run('Verschieben', () => filesApi.move(host.id, joinPath(path, name), joinPath(target, name)));
    }
    toast.success(`${names.length === 1 ? names[0] : `${names.length} Einträge`} nach ${target} verschoben`);
    setSelected(new Set());
  };

  const startUpload = (list: File[]) => {
    if (!host) return;
    const existing = list.filter((file) => (listing.data?.files ?? []).some((entry) => entry.name === file.name)).map((file) => file.name);
    if (existing.length) setOverwrite({ files: list, existing });
    else void doUpload(list);
  };

  const doUpload = async (list: File[]) => {
    if (!host) return;
    const directory = path;
    for (const file of list) {
      const id = crypto.randomUUID();
      setUploads((current) => [...current, { id, name: file.name, progress: 0, status: 'uploading' }]);
      try {
        await filesApi.upload(host.id, directory, file, (progress) => setUploads((current) => current.map((item) => (item.id === id ? { ...item, progress } : item))));
        setUploads((current) => current.map((item) => (item.id === id ? { ...item, progress: 1, status: 'done' } : item)));
      } catch (error) {
        setUploads((current) => current.map((item) => (item.id === id ? { ...item, status: 'error', error: (error as Error).message } : item)));
      }
      refresh();
    }
    setTimeout(() => setUploads((current) => current.filter((item) => item.status !== 'done')), 3000);
  };

  /* ----- keyboard ----- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('input, textarea, [role=dialog]') || dialog || previewFile || deleteNames || chmodFile) return;
      if (event.key === 'Backspace') {
        event.preventDefault();
        go(parentOf(path));
      } else if (event.key === 'Delete' && selected.size) {
        setDeleteNames([...selected]);
      } else if (event.key === 'F2' && selected.size === 1) {
        const file = files.find((item) => selected.has(item.name));
        if (file) setDialog({ kind: 'rename', file });
      } else if (event.key === 'Enter' && selected.size === 1) {
        const file = files.find((item) => selected.has(item.name));
        if (file) open(file);
      } else if ((event.ctrlKey || event.metaKey) && event.key === 'a') {
        event.preventDefault();
        setSelected(new Set(files.map((file) => file.name)));
      } else if (event.key === 'Escape') {
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, []);

  /* ----- drag & drop ----- */
  const onDropArea = (event: DragEvent) => {
    event.preventDefault();
    setDropActive(false);
    if (event.dataTransfer.files.length) startUpload([...event.dataTransfer.files]);
  };

  const segments = path.split('/').filter(Boolean);
  const bookmarks = host ? [
    { label: 'Home', path: homeOf(host), icon: Home },
    { label: 'Wurzel', path: '/', icon: HardDrive },
    { label: 'Logs', path: '/var/log', icon: ScrollText },
    { label: 'Konfiguration', path: '/etc', icon: Settings2 },
    { label: 'Temp', path: '/tmp', icon: Folder },
  ] : [];

  const sortButton = (key: SortKey, label: string, className?: string) => (
    <button type="button" onClick={() => setSort((current) => ({ key, dir: current.key === key ? (current.dir === 1 ? -1 : 1) : 1 }))} className={cn('flex items-center gap-1 hover:text-ink', className, sort.key === key && 'text-ink')}>
      {label} {sort.key === key && <span>{sort.dir === 1 ? '↑' : '↓'}</span>}
    </button>
  );

  return (
    <>
      <PageHeader section="Betrieb" title="Dateien" description="Dateien auf deinen Systemen per SFTP ansehen, bearbeiten, verschieben, hoch- und herunterladen" />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        {/* Hosts & bookmarks */}
        <div className="flex flex-col gap-5">
          <NotchCard index={0} eyebrow="SFTP" title="Systeme" bodyClassName="pt-3">
            <ul className="space-y-0.5">
              {hosts.map((item) => {
                const active = host?.id === item.id;
                return (
                  <li key={item.id}>
                    <button type="button" onClick={() => selectHost(item.id)} className={cn('relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', !active && 'hover:bg-hover/60')}>
                      {active && <motion.span layoutId="files-host" className="absolute inset-0 rounded-xl border border-accent/25 bg-accent/[0.10]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                      <span className={cn('relative size-2 rounded-full', item.status === 'online' ? 'bg-ok' : 'bg-bad')} />
                      <span className="relative min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{item.name}</span>
                        <span className="block truncate font-mono text-[10.5px] text-faint">{item.username}@{item.host}</span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {hosts.length === 0 && <li className="py-4 text-center text-[12.5px] text-muted">{connections.isLoading ? 'Lädt …' : 'Keine SSH-Systeme angelegt.'}</li>}
            </ul>
          </NotchCard>
          {host && (
            <NotchCard index={1} eyebrow="Schnellzugriff" title="Orte" bodyClassName="pt-3">
              <ul className="space-y-0.5">
                {bookmarks.map((bookmark) => (
                  <li key={bookmark.path}>
                    <button type="button" onClick={() => go(bookmark.path)} className={cn('flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-hover/60', path === bookmark.path && 'text-accent')}>
                      <bookmark.icon className="size-4 text-muted" />
                      <span className="flex-1">{bookmark.label}</span>
                      <span className="font-mono text-[10.5px] text-faint">{bookmark.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </NotchCard>
          )}
        </div>

        {/* Browser */}
        <NotchCard
          index={2}
          eyebrow={host ? `${host.username}@${host.host}` : 'Kein System'}
          title={host?.name ?? 'Dateien'}
          bodyClassName="pt-3"
          actions={host ? [
            { label: 'Hochladen', icon: <Upload />, onClick: () => fileInput.current?.click() },
            { label: 'Neuer Ordner', icon: <FolderPlus />, onClick: () => setDialog({ kind: 'mkdir' }) },
          ] : []}
        >
          {!host ? (
            <p className="py-16 text-center text-[13px] text-muted"><Server className="mx-auto mb-2 size-6" /> Lege zuerst unter „Systeme“ einen SSH-Zugang an.</p>
          ) : (
            <>
              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => go(parentOf(path))} disabled={path === '/'} title="Eine Ebene höher (Rücktaste)" className="flex size-9 items-center justify-center rounded-full border border-line/[0.10] text-muted transition-colors hover:text-ink disabled:opacity-30">
                  <ArrowUp className="size-4" />
                </button>
                <nav aria-label="Pfad" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-full border border-line/[0.10] bg-raised/40 px-2 py-1 scroll-thin">
                  <button type="button" onClick={() => go('/')} className="rounded-full px-2 py-1 font-mono text-[12.5px] text-muted hover:bg-hover hover:text-ink">/</button>
                  {segments.map((segment, index) => {
                    const target = `/${segments.slice(0, index + 1).join('/')}`;
                    return (
                      <span key={target} className="flex shrink-0 items-center">
                        <ChevronRight className="size-3.5 text-faint" />
                        <button
                          type="button"
                          onClick={() => go(target)}
                          onDragOver={(event) => { event.preventDefault(); setDragOverFolder(target); }}
                          onDragLeave={() => setDragOverFolder(null)}
                          onDrop={(event) => {
                            event.preventDefault();
                            setDragOverFolder(null);
                            const names = event.dataTransfer.getData('application/x-sar-files');
                            if (names && target !== path) void moveNames(JSON.parse(names), target);
                          }}
                          className={cn('rounded-full px-2 py-1 font-mono text-[12.5px] transition-colors hover:bg-hover hover:text-ink', index === segments.length - 1 ? 'text-ink' : 'text-muted', dragOverFolder === target && 'bg-accent/15 text-accent')}
                        >
                          {segment}
                        </button>
                      </span>
                    );
                  })}
                  <button type="button" onClick={() => setDialog({ kind: 'path' })} title="Pfad eingeben" className="ml-auto rounded-full px-2 py-1 text-[11.5px] text-faint hover:text-ink">Pfad …</button>
                </nav>
                <label className="flex h-9 w-[200px] items-center gap-2 rounded-full border border-line/[0.10] bg-raised/40 px-3 focus-within:border-accent/40">
                  <Search className="size-3.5 text-muted" />
                  <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtern …" className="h-full w-full bg-transparent text-[12.5px] outline-none placeholder:text-faint" />
                </label>
                <button type="button" onClick={() => setShowHidden((value) => !value)} title={showHidden ? 'Versteckte ausblenden' : 'Versteckte anzeigen'} className={cn('flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] transition-colors', showHidden ? 'border-accent/30 bg-accent/10 text-accent' : 'border-line/[0.10] text-muted hover:text-ink')}>
                  {showHidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />} {hiddenCount}
                </button>
                <button type="button" onClick={refresh} title="Aktualisieren" className="flex size-9 items-center justify-center rounded-full border border-line/[0.10] text-muted hover:text-ink">
                  <RefreshCw className={cn('size-4', listing.isFetching && 'animate-spin')} />
                </button>
              </div>

              {/* Selection bar */}
              <AnimatePresence>
                {selected.size > 0 && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/25 bg-accent/[0.07] px-3 py-2 text-[12.5px]">
                      <span className="font-medium">{selected.size} ausgewählt</span>
                      <span className="text-muted">· {formatBytes(selectedFiles.filter((file) => file.type === 'file').reduce((sum, file) => sum + file.size, 0))}</span>
                      <span className="ml-auto flex gap-1.5">
                        <SelectionButton icon={<Download className="size-3.5" />} label="Herunterladen" disabled={selectedFiles.some((file) => file.type === 'folder')} onClick={() => download([...selected])} />
                        <SelectionButton icon={<FolderInput className="size-3.5" />} label="Verschieben" onClick={() => setDialog({ kind: 'move', names: [...selected] })} />
                        <SelectionButton icon={<Trash2 className="size-3.5" />} label="Löschen" danger onClick={() => setDeleteNames([...selected])} />
                        <SelectionButton icon={<X className="size-3.5" />} label="Aufheben" onClick={() => setSelected(new Set())} />
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* List */}
              <div
                className={cn('relative mt-3 min-h-[420px] rounded-2xl border transition-colors', dropActive ? 'border-accent/60 bg-accent/[0.05]' : 'border-line/[0.07]')}
                onDragOver={(event) => {
                  if (event.dataTransfer.types.includes('Files')) {
                    event.preventDefault();
                    setDropActive(true);
                  }
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropActive(false);
                }}
                onDrop={onDropArea}
              >
                <div className="grid grid-cols-[28px_minmax(0,1fr)_100px_150px_110px] items-center gap-x-3 border-b border-line/[0.07] px-4 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-faint">
                  <input
                    type="checkbox"
                    aria-label="Alle auswählen"
                    checked={files.length > 0 && selected.size === files.length}
                    onChange={(event) => setSelected(event.target.checked ? new Set(files.map((file) => file.name)) : new Set())}
                    className="size-3.5 accent-[rgb(var(--accent))]"
                  />
                  {sortButton('name', 'Name')}
                  {sortButton('size', 'Größe', 'justify-end')}
                  {sortButton('modified', 'Geändert')}
                  <span>Rechte</span>
                </div>

                {listing.isLoading ? (
                  <p className="flex items-center justify-center py-24 text-[13px] text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lade {path} …</p>
                ) : listing.isError ? (
                  <div className="py-20 text-center text-[13px]">
                    <p className="flex items-center justify-center gap-2 text-bad"><Lock className="size-4" /> {(listing.error as Error).message}</p>
                    <button type="button" onClick={() => go(homeOf(host))} className="mt-3 text-accent hover:underline">Zum Home-Verzeichnis →</button>
                  </div>
                ) : files.length === 0 ? (
                  <div className="py-24 text-center text-[13px] text-muted">
                    {filter ? (
                      'Nichts gefunden.'
                    ) : !showHidden && hiddenCount > 0 ? (
                      <>
                        Nur versteckte Einträge ({hiddenCount}).{' '}
                        <button type="button" onClick={() => setShowHidden(true)} className="text-accent hover:underline">Einblenden</button>
                      </>
                    ) : (
                      'Leerer Ordner. Dateien hierher ziehen zum Hochladen.'
                    )}
                  </div>
                ) : (
                  <ul className="py-1">
                    {files.map((file, index) => {
                      const { icon: Icon, className } = iconFor(file);
                      const isSelected = selected.has(file.name);
                      const isFolder = file.type === 'folder';
                      const target = joinPath(path, file.name);
                      return (
                        <li
                          key={file.name}
                          style={{ animationDelay: `${Math.min(index, 20) * 12}ms` }}
                          draggable
                          onDragStart={(event) => {
                            const names = isSelected ? [...selected] : [file.name];
                            event.dataTransfer.setData('application/x-sar-files', JSON.stringify(names));
                            event.dataTransfer.effectAllowed = 'move';
                          }}
                          onDragOver={(event) => {
                            if (isFolder && event.dataTransfer.types.includes('application/x-sar-files')) {
                              event.preventDefault();
                              setDragOverFolder(target);
                            }
                          }}
                          onDragLeave={() => setDragOverFolder((current) => (current === target ? null : current))}
                          onDrop={(event) => {
                            const names = event.dataTransfer.getData('application/x-sar-files');
                            if (!isFolder || !names) return;
                            event.preventDefault();
                            event.stopPropagation();
                            setDragOverFolder(null);
                            const list: string[] = JSON.parse(names).filter((name: string) => name !== file.name);
                            if (list.length) void moveNames(list, target);
                          }}
                          onClick={(event) => {
                            setSelected((current) => {
                              const next = new Set(event.ctrlKey || event.metaKey ? current : []);
                              if (event.shiftKey && current.size) {
                                const names = files.map((item) => item.name);
                                const last = names.findIndex((name) => current.has(name));
                                const [from, to] = [Math.min(last, index), Math.max(last, index)];
                                names.slice(from, to + 1).forEach((name) => next.add(name));
                              } else if (next.has(file.name) && (event.ctrlKey || event.metaKey)) next.delete(file.name);
                              else next.add(file.name);
                              return next;
                            });
                          }}
                          onDoubleClick={() => open(file)}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            if (!isSelected) setSelected(new Set([file.name]));
                            setMenu({ x: event.clientX, y: event.clientY, file });
                          }}
                          className={cn(
                            'group grid cursor-default grid-cols-[28px_minmax(0,1fr)_100px_150px_110px] items-center gap-x-3 px-4 py-[7px] text-[13px] transition-colors animate-in fade-in fill-mode-both duration-300',
                            isSelected ? 'bg-accent/[0.10]' : 'hover:bg-hover/50',
                            dragOverFolder === target && 'bg-accent/20 ring-1 ring-inset ring-accent/50',
                          )}
                        >
                          <input
                            type="checkbox"
                            aria-label={`${file.name} auswählen`}
                            checked={isSelected}
                            onClick={(event) => event.stopPropagation()}
                            onChange={() => setSelected((current) => {
                              const next = new Set(current);
                              if (next.has(file.name)) next.delete(file.name);
                              else next.add(file.name);
                              return next;
                            })}
                            className="size-3.5 accent-[rgb(var(--accent))]"
                          />
                          <span className="flex min-w-0 items-center gap-2.5">
                            <Icon className={cn('size-4 shrink-0', className)} />
                            <span className={cn('truncate', file.name.startsWith('.') && 'text-muted')}>{file.name}</span>
                            <span className="ml-auto hidden shrink-0 gap-0.5 group-hover:flex">
                              {!isFolder && <RowButton label="Herunterladen" onClick={() => download([file.name])}><Download className="size-3.5" /></RowButton>}
                              <RowButton label="Umbenennen (F2)" onClick={() => setDialog({ kind: 'rename', file })}><Pencil className="size-3.5" /></RowButton>
                              <RowButton label="Löschen" danger onClick={() => setDeleteNames([file.name])}><Trash2 className="size-3.5" /></RowButton>
                            </span>
                          </span>
                          <span className="text-right font-mono text-[11.5px] text-muted">{isFolder ? '–' : formatBytes(file.size)}</span>
                          <span className="truncate text-[12px] text-muted" title={new Date(file.modified).toLocaleString('de-DE')}>{formatRelative(file.modified)}</span>
                          <span className="font-mono text-[11px] text-faint">{permissionString(file.permissions, isFolder)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}

                <AnimatePresence>
                  {dropActive && (
                    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-2xl bg-canvas/70 backdrop-blur-[2px]">
                      <span className="flex flex-col items-center gap-2 text-accent">
                        <Upload className="size-8" />
                        <span className="text-[14px] font-medium">Hier ablegen zum Hochladen nach {path}</span>
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <p className="mt-3 flex flex-wrap gap-x-4 text-[11.5px] text-faint">
                <span>{files.filter((file) => file.type === 'folder').length} Ordner · {files.filter((file) => file.type === 'file').length} Dateien · {formatBytes(totalSize)}</span>
                <span>Doppelklick öffnet · Ziehen auf einen Ordner verschiebt · Rechtsklick für mehr · Entf löscht · F2 benennt um</span>
              </p>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(event) => { if (event.target.files?.length) startUpload([...event.target.files]); event.target.value = ''; }} />
            </>
          )}
        </NotchCard>
      </div>

      {/* Context menu */}
      <AnimatePresence>
        {menu && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.12 }}
            className="panel-surface fixed z-50 w-52 rounded-2xl p-1.5 shadow-2xl"
            style={{ left: Math.min(menu.x, window.innerWidth - 220), top: Math.min(menu.y, window.innerHeight - 280) }}
            onClick={(event) => event.stopPropagation()}
          >
            {[
              { label: menu.file.type === 'folder' ? 'Öffnen' : 'Ansehen', icon: Eye, action: () => open(menu.file) },
              ...(menu.file.type === 'file' ? [{ label: 'Herunterladen', icon: Download, action: () => download(selected.size > 1 ? [...selected] : [menu.file.name]) }] : []),
              { label: 'Umbenennen', icon: Pencil, action: () => setDialog({ kind: 'rename', file: menu.file }) },
              { label: 'Verschieben …', icon: FolderInput, action: () => setDialog({ kind: 'move', names: selected.size > 1 ? [...selected] : [menu.file.name] }) },
              { label: 'Rechte …', icon: Lock, action: () => setChmodFile(menu.file) },
              { label: 'Pfad kopieren', icon: FileText, action: () => void navigator.clipboard.writeText(joinPath(path, menu.file.name)).then(() => toast.success('Pfad kopiert')) },
              { label: 'Löschen', icon: Trash2, action: () => setDeleteNames(selected.size > 1 ? [...selected] : [menu.file.name]), danger: true },
            ].map((item) => (
              <button
                key={item.label}
                type="button"
                onClick={() => {
                  setMenu(null);
                  item.action();
                }}
                className={cn('flex h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-[13px] transition-colors', 'danger' in item && item.danger ? 'text-bad hover:bg-bad/10' : 'hover:bg-hover')}
              >
                <item.icon className="size-4" /> {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Upload progress */}
      <AnimatePresence>
        {uploads.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }} className="panel-surface fixed bottom-6 left-1/2 z-40 w-[420px] -translate-x-1/2 rounded-2xl p-3 shadow-2xl">
            <p className="mb-2 flex items-center justify-between px-1 text-[12.5px] font-medium">
              Upload {uploads.filter((item) => item.status === 'done').length} / {uploads.length}
              <button type="button" onClick={() => setUploads((current) => current.filter((item) => item.status === 'uploading'))} className="text-[11.5px] text-muted hover:text-ink">Ausblenden</button>
            </p>
            <ul className="max-h-48 space-y-1.5 overflow-y-auto">
              {uploads.map((item) => (
                <li key={item.id} className="rounded-xl px-1">
                  <div className="flex items-center justify-between gap-3 text-[12px]">
                    <span className="truncate">{item.name}</span>
                    <span className={cn('font-mono text-[11px]', item.status === 'error' ? 'text-bad' : item.status === 'done' ? 'text-ok' : 'text-muted')}>
                      {item.status === 'error' ? 'Fehler' : item.status === 'done' ? 'fertig' : `${Math.round(item.progress * 100)} %`}
                    </span>
                  </div>
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-line/[0.07]">
                    <motion.div className={cn('h-full rounded-full', item.status === 'error' ? 'bg-bad' : 'bg-gradient-to-r from-accent/70 to-accent')} animate={{ width: `${Math.round(item.progress * 100)}%` }} />
                  </div>
                  {item.error && <p className="mt-0.5 truncate text-[11px] text-bad">{item.error}</p>}
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Dialogs */}
      <Drawer open={!!previewFile} onClose={() => setPreviewFile(null)} label="Datei" width={760}>
        {previewFile && host && <PreviewPanel connectionId={host.id} file={previewFile} path={joinPath(path, previewFile.name)} onClose={() => setPreviewFile(null)} onSaved={refresh} />}
      </Drawer>

      <InputDialog
        open={dialog?.kind === 'mkdir'}
        title="Neuer Ordner"
        label={`In ${path}`}
        initial=""
        confirm="Anlegen"
        mono={false}
        onCancel={() => setDialog(null)}
        onSubmit={(name) => {
          setDialog(null);
          if (name.includes('/')) return toast.error('Der Name darf keinen „/“ enthalten');
          void run('Anlegen', () => filesApi.mkdir(host!.id, joinPath(path, name)), `Ordner ${name} angelegt`);
        }}
      />
      <InputDialog
        open={dialog?.kind === 'rename'}
        title="Umbenennen"
        label="Neuer Name"
        initial={dialog?.kind === 'rename' ? dialog.file.name : ''}
        confirm="Umbenennen"
        mono={false}
        onCancel={() => setDialog(null)}
        onSubmit={(name) => {
          if (dialog?.kind !== 'rename') return;
          const from = dialog.file.name;
          setDialog(null);
          if (name === from) return;
          if (name.includes('/')) return toast.error('Zum Verschieben „Verschieben …“ nutzen');
          void run('Umbenennen', () => filesApi.move(host!.id, joinPath(path, from), joinPath(path, name)), `${from} → ${name}`);
        }}
      />
      <InputDialog
        open={dialog?.kind === 'move'}
        title={dialog?.kind === 'move' ? `${dialog.names.length === 1 ? dialog.names[0] : `${dialog.names.length} Einträge`} verschieben` : ''}
        label="Zielordner (absoluter Pfad)"
        initial={path}
        confirm="Verschieben"
        hint={<>Tipp: Einträge lassen sich auch direkt auf einen Ordner oder ein Pfadsegment oben ziehen. Bestehende Ziele werden nicht überschrieben.</>}
        onCancel={() => setDialog(null)}
        onSubmit={(target) => {
          if (dialog?.kind !== 'move') return;
          const names = dialog.names;
          setDialog(null);
          if (!target.startsWith('/')) return toast.error('Bitte einen absoluten Pfad angeben, z. B. /root/archiv');
          if (target.replace(/\/$/, '') === path.replace(/\/$/, '')) return;
          void moveNames(names, target);
        }}
      />
      <InputDialog
        open={dialog?.kind === 'path'}
        title="Gehe zu"
        label="Pfad"
        initial={path}
        confirm="Öffnen"
        onCancel={() => setDialog(null)}
        onSubmit={(target) => {
          setDialog(null);
          if (!target.startsWith('/')) return toast.error('Bitte einen absoluten Pfad angeben');
          go(target);
        }}
      />
      <ChmodDialog
        file={chmodFile}
        path={chmodFile ? joinPath(path, chmodFile.name) : ''}
        onCancel={() => setChmodFile(null)}
        onSubmit={(mode) => {
          const file = chmodFile!;
          setChmodFile(null);
          void run('Rechte ändern', () => filesApi.chmod(host!.id, joinPath(path, file.name), mode), `Rechte von ${file.name} auf ${mode} gesetzt`);
        }}
      />
      <ConfirmDialog
        open={!!deleteNames}
        title={deleteNames ? (deleteNames.length === 1 ? `${deleteNames[0]} löschen?` : `${deleteNames.length} Einträge löschen?`) : ''}
        description={
          deleteNames ? (
            <>
              {deleteNames.some((name) => files.find((file) => file.name === name)?.type === 'folder') ? (
                <span className="text-ink">Ordner werden mit ihrem gesamten Inhalt gelöscht. </span>
              ) : null}
              Das lässt sich nicht rückgängig machen. Auf <span className="font-mono text-ink">{host?.name}</span> in <span className="font-mono text-ink">{path}</span>.
            </>
          ) : ''
        }
        confirmLabel="Endgültig löschen"
        tone="danger"
        icon={<Trash2 />}
        onCancel={() => setDeleteNames(null)}
        onConfirm={() => {
          const names = deleteNames ?? [];
          setDeleteNames(null);
          setSelected(new Set());
          void (async () => {
            for (const name of names) await run('Löschen', () => filesApi.remove(host!.id, joinPath(path, name)));
            toast.success(names.length === 1 ? `${names[0]} gelöscht` : `${names.length} Einträge gelöscht`);
          })();
        }}
      />
      <ConfirmDialog
        open={!!overwrite}
        title="Vorhandene Dateien überschreiben?"
        description={overwrite ? <>In <span className="font-mono text-ink">{path}</span> gibt es schon: <span className="font-mono text-ink">{overwrite.existing.join(', ')}</span>. Beim Hochladen werden sie ersetzt.</> : ''}
        confirmLabel="Überschreiben"
        tone="danger"
        icon={<Upload />}
        onCancel={() => setOverwrite(null)}
        onConfirm={() => {
          const list = overwrite?.files ?? [];
          setOverwrite(null);
          void doUpload(list);
        }}
      />
    </>
  );
}

function RowButton({ label, onClick, children, danger }: { label: string; onClick: () => void; children: ReactNode; danger?: boolean }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={cn('flex size-7 items-center justify-center rounded-lg text-muted transition-colors', danger ? 'hover:bg-bad/10 hover:text-bad' : 'hover:bg-hover hover:text-ink')}
    >
      {children}
    </button>
  );
}

function SelectionButton({ icon, label, onClick, danger, disabled }: { icon: ReactNode; label: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={disabled ? 'Ordner können nicht direkt heruntergeladen werden' : undefined} className={cn('flex h-8 items-center gap-1.5 rounded-full border px-3 transition-colors disabled:opacity-40', danger ? 'border-bad/30 text-bad hover:bg-bad/10' : 'border-line/[0.12] hover:bg-raised')}>
      {icon} {label}
    </button>
  );
}
