import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import {
  Box,
  Check,
  CheckCircle2,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Lock,
  Monitor,
  MonitorPlay,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  SquareTerminal,
  Trash2,
  Unplug,
  Wifi,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';
import { connectionAPI } from '@/services/api';
import type { ConnectionTestResult } from '@/types/connection';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AnimatedNumber } from '@/components/ui/viz';
import { formatRelative } from '@/lib/format';
import { infraKeys, useConnections, type Connection } from '@/hooks/use-infrastructure';
import { useGuestNetworks } from '@/hooks/use-network';
import { useRdpLaunch } from '@/hooks/use-rdp';
import type { GuestNetwork } from '@/services/network';

/* ---------- data ---------- */

type RawConnection = Connection & { auth_type?: 'password' | 'key'; private_key_path?: string | null; last_connected?: string };

interface PublicKeyInfo {
  exists: boolean;
  keyPath: string;
  publicKey?: string;
  type?: string;
  comment?: string;
  fingerprint?: string | null;
}

function usePublicKey() {
  return useQuery<PublicKeyInfo>({
    queryKey: ['infra', 'ssh-public-key'],
    queryFn: async () => {
      const response = await fetch(`${API_CONFIG.baseURL}/connections/ssh-key/public`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    staleTime: 60_000,
  });
}

const authOf = (connection: RawConnection) => (connection.auth_type ?? (connection as { authType?: string }).authType ?? 'password') as 'password' | 'key';

/* ---------- small pieces ---------- */

function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'ok' | 'accent' | 'bad' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
        tone === 'ok' && 'border-ok/30 bg-ok/10 text-ok',
        tone === 'accent' && 'border-accent/30 bg-accent/10 text-accent',
        tone === 'bad' && 'border-bad/30 bg-bad/10 text-bad',
        tone === 'muted' && 'border-line/[0.10] text-muted',
      )}
    >
      {children}
    </span>
  );
}

function Field({ label, hint, children, error }: { label: string; hint?: ReactNode; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12.5px] font-medium text-ink/90">{label}</span>
      {children}
      {error ? <span className="mt-1 block text-[11.5px] text-bad">{error}</span> : hint ? <span className="mt-1 block text-[11.5px] text-faint">{hint}</span> : null}
    </label>
  );
}

const inputClass =
  'h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 text-[13.5px] outline-none transition-colors placeholder:text-faint focus:border-accent/45 focus:bg-raised';

function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string; icon?: ReactNode }>; id: string }) {
  return (
    <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn('relative flex h-9 flex-1 items-center justify-center gap-2 rounded-full text-[13px] transition-colors', value === option.value ? 'text-ink' : 'text-muted hover:text-ink')}
        >
          {value === option.value && <motion.span layoutId={`seg-${id}`} className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
          <span className="relative flex items-center gap-2">{option.icon}{option.label}</span>
        </button>
      ))}
    </div>
  );
}

/* ---------- form ---------- */

interface FormState {
  type: 'ssh' | 'rdp';
  name: string;
  host: string;
  port: string;
  username: string;
  authType: 'password' | 'key';
  password: string;
  privateKeyPath: string;
  tags: string;
  deployKey: boolean;
}

const emptyForm = (keyPath: string): FormState => ({
  type: 'ssh',
  name: '',
  host: '',
  port: '22',
  username: 'root',
  authType: 'password',
  password: '',
  privateKeyPath: keyPath,
  tags: '',
  deployKey: true,
});

function validate(form: FormState, editing: boolean) {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!form.name.trim()) errors.name = 'Bitte einen Namen angeben.';
  if (!form.host.trim()) errors.host = 'Bitte Host oder IP angeben.';
  else if (/\s/.test(form.host.trim())) errors.host = 'Ohne Leerzeichen.';
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.port = '1 bis 65535';
  if (!form.username.trim()) errors.username = 'Bitte einen Benutzer angeben.';
  if (form.type === 'ssh' && form.authType === 'password' && !form.password && !editing) errors.password = 'Für den ersten Login wird das Passwort gebraucht.';
  if (form.type === 'ssh' && form.authType === 'key' && !form.privateKeyPath.trim()) errors.privateKeyPath = 'Pfad zum privaten Schlüssel angeben.';
  return errors;
}

interface ConnectionFormProps {
  connection: RawConnection | null;
  /** Prefill for a new connection, e.g. from a Proxmox container. */
  preset?: Partial<FormState>;
  keyInfo?: PublicKeyInfo;
  onDone: (saved: { id: string; deployKey: boolean }) => void;
  onCancel: () => void;
}

function ConnectionForm({ connection, preset, keyInfo, onDone, onCancel }: ConnectionFormProps) {
  const queryClient = useQueryClient();
  const editing = !!connection;
  const defaultKeyPath = keyInfo?.keyPath ?? '~/.ssh/id_ed25519';
  const [form, setForm] = useState<FormState>(() =>
    connection
      ? {
          type: connection.type === 'rdp' ? 'rdp' : 'ssh',
          name: connection.name,
          host: connection.host,
          port: String(connection.port),
          username: connection.username,
          authType: authOf(connection),
          password: '',
          privateKeyPath: connection.private_key_path ?? defaultKeyPath,
          tags: (connection.tags ?? []).join(', '),
          deployKey: false,
        }
      : { ...emptyForm(defaultKeyPath), ...preset },
  );
  const [showPassword, setShowPassword] = useState(false);
  const [touched, setTouched] = useState(false);
  const errors = validate(form, editing);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        type: form.type,
        name: form.name.trim(),
        host: form.host.trim(),
        port: Number(form.port),
        username: form.username.trim(),
        authType: form.type === 'rdp' ? 'password' : form.authType,
        privateKeyPath: form.type === 'ssh' && form.authType === 'key' ? form.privateKeyPath.trim() : null,
        tags: form.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
      };
      // An empty password field while editing keeps the stored one
      if (form.password || !editing) payload.password = form.password || null;
      if (editing && connection) {
        await connectionAPI.update(connection.id, payload);
        return { id: connection.id };
      }
      return connectionAPI.create(payload);
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: infraKeys.connections });
      toast.success(editing ? `${form.name} gespeichert` : `${form.name} angelegt`);
      onDone({ id: result.id, deployKey: form.type === 'ssh' && form.authType === 'password' && form.deployKey && !editing });
    },
    onError: (error: Error) => toast.error('Speichern fehlgeschlagen', { description: error.message }),
  });

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(errors).length === 0) save.mutate();
  };
  const err = (key: keyof FormState) => (touched ? errors[key] : undefined);

  return (
    <form onSubmit={submit} className="flex h-full flex-col">
      <div className="flex-1 space-y-5 px-7 pb-6 pt-7">
        <div>
          <p className="text-[12px] text-muted">{editing ? 'Verbindung bearbeiten' : 'Neue Verbindung'}</p>
          <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{editing ? connection?.name : 'System hinzufügen'}</h2>
        </div>

        <Segmented<'ssh' | 'rdp'>
          id="conn-type"
          value={form.type}
          onChange={(type) => setForm((current) => ({ ...current, type, port: current.port === '22' || current.port === '3389' ? (type === 'rdp' ? '3389' : '22') : current.port }))}
          options={[
            { value: 'ssh', label: 'SSH', icon: <SquareTerminal className="size-4" /> },
            { value: 'rdp', label: 'RDP', icon: <Monitor className="size-4" /> },
          ]}
        />

        <Field label="Name" error={err('name')}>
          <input className={inputClass} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="z. B. fog-server" autoFocus />
        </Field>

        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Host / IP" error={err('host')}>
            <input className={cn(inputClass, 'font-mono')} value={form.host} onChange={(event) => set('host', event.target.value)} placeholder="172.21.5.32" />
          </Field>
          <Field label="Port" error={err('port')}>
            <input className={cn(inputClass, 'font-mono')} inputMode="numeric" value={form.port} onChange={(event) => set('port', event.target.value.replace(/\D/g, ''))} />
          </Field>
        </div>

        <Field label="Benutzer" error={err('username')}>
          <input className={cn(inputClass, 'font-mono')} value={form.username} onChange={(event) => set('username', event.target.value)} placeholder="root" autoComplete="off" />
        </Field>

        {form.type === 'ssh' && (
          <div className="space-y-3">
            <span className="block text-[12.5px] font-medium text-ink/90">Anmeldung</span>
            <Segmented<'password' | 'key'>
              id="auth-type"
              value={form.authType}
              onChange={(value) => set('authType', value)}
              options={[
                { value: 'password', label: 'Passwort', icon: <Lock className="size-4" /> },
                { value: 'key', label: 'SSH-Schlüssel', icon: <KeyRound className="size-4" /> },
              ]}
            />
          </div>
        )}

        {(form.type === 'rdp' || form.authType === 'password') && (
          <Field
            label="Passwort"
            error={err('password')}
            hint={editing ? 'Leer lassen, um das gespeicherte Passwort zu behalten.' : form.type === 'rdp' ? 'Optional, wird für RDP nur gespeichert.' : undefined}
          >
            <div className="relative">
              <input
                className={cn(inputClass, 'pr-12')}
                type={showPassword ? 'text' : 'password'}
                value={form.password}
                onChange={(event) => set('password', event.target.value)}
                autoComplete="new-password"
                placeholder={editing ? '••••••••' : ''}
              />
              <button
                type="button"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                className="absolute right-3 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-ink"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
        )}

        {form.type === 'ssh' && form.authType === 'key' && (
          <Field label="Privater Schlüssel (Pfad auf dem Backend-Rechner)" error={err('privateKeyPath')} hint="Der passende Public Key muss auf dem Server in ~/.ssh/authorized_keys stehen.">
            <input className={cn(inputClass, 'font-mono')} value={form.privateKeyPath} onChange={(event) => set('privateKeyPath', event.target.value)} />
          </Field>
        )}

        {form.type === 'ssh' && form.authType === 'password' && !editing && (
          <button
            type="button"
            onClick={() => set('deployKey', !form.deployKey)}
            className={cn(
              'flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-colors',
              form.deployKey ? 'border-accent/35 bg-accent/[0.07]' : 'border-line/[0.08] hover:border-line/[0.16]',
            )}
          >
            <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border', form.deployKey ? 'border-accent bg-accent text-accent-ink' : 'border-line/25')}>
              {form.deployKey && <Check className="size-3.5" />}
            </span>
            <span>
              <span className="block text-[13.5px] font-medium">Danach meinen Public Key hinterlegen</span>
              <span className="mt-0.5 block text-[12px] text-muted">
                Einmal mit dem Passwort anmelden, den Key in <span className="font-mono">~/.ssh/authorized_keys</span> eintragen und künftig ohne Passwort verbinden.
              </span>
            </span>
          </button>
        )}

        <Field label="Tags" hint="Mit Komma trennen, z. B. proxmox, produktiv">
          <input className={inputClass} value={form.tags} onChange={(event) => set('tags', event.target.value)} />
        </Field>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line/[0.07] bg-panel/95 px-7 py-4 backdrop-blur">
        <button type="button" onClick={onCancel} className="h-11 rounded-full border border-line/[0.12] px-5 text-[13.5px] transition-colors hover:bg-raised">
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={save.isPending}
          className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] transition-all active:scale-[0.98] disabled:opacity-60"
        >
          {save.isPending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          {editing ? 'Speichern' : 'Anlegen'}
        </button>
      </div>
    </form>
  );
}

/* ---------- test result ---------- */

function TestResultView({ result }: { result: ConnectionTestResult }) {
  return (
    <div className={cn('rounded-2xl border p-4', result.success ? 'border-ok/30 bg-ok/[0.06]' : 'border-bad/30 bg-bad/[0.06]')}>
      <p className={cn('flex items-center gap-2 text-[14px] font-semibold', result.success ? 'text-ok' : 'text-bad')}>
        {result.success ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {result.message}
      </p>
      <ul className="mt-3 space-y-1.5">
        {result.checks.map((check) => (
          <li key={check.key} className="flex items-start gap-2.5 text-[12.5px]">
            <span className="mt-0.5">
              {check.status === 'passed' ? (
                <Check className="size-3.5 text-ok" />
              ) : check.status === 'failed' ? (
                <XCircle className="size-3.5 text-bad" />
              ) : check.status === 'warning' ? (
                <CircleAlert className="size-3.5 text-accent" />
              ) : (
                <span className="block size-3.5 text-center text-faint">–</span>
              )}
            </span>
            <span className="flex-1">
              <span className="text-ink/90">{check.label}</span>
              <span className="block text-muted">{check.message}</span>
            </span>
            <span className="font-mono text-[11px] text-faint">{check.durationMs} ms</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ---------- key setup ---------- */

function KeySetupDialog({ connection, keyInfo, onClose }: { connection: RawConnection | null; keyInfo?: PublicKeyInfo; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [removePassword, setRemovePassword] = useState(true);
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    setResult(null);
    setRemovePassword(true);
  }, [connection?.id]);

  const setup = useMutation({
    mutationFn: async () => {
      if (!connection) throw new Error('Keine Verbindung');
      const outcome = await connectionAPI.setupSSHKey(connection.id);
      if (!outcome.success) throw new Error(outcome.error ? `${outcome.message}: ${outcome.error}` : outcome.message);
      if (removePassword) {
        // The backend already switched the connection to key login; now drop the stored password
        await connectionAPI.update(connection.id, { authType: 'key', password: null } as Record<string, unknown>);
      }
      return outcome as { success: boolean; message: string };
    },
    onSuccess: (outcome) => {
      setResult({ success: true, message: outcome.message });
      queryClient.invalidateQueries({ queryKey: infraKeys.connections });
      toast.success(`${connection?.name}: Login per Schlüssel eingerichtet`);
    },
    onError: (error: Error) => setResult({ success: false, message: error.message }),
  });

  const copyKey = () => {
    if (keyInfo?.publicKey) void navigator.clipboard.writeText(keyInfo.publicKey).then(() => toast.success('Public Key kopiert'));
  };

  return (
    <AnimatePresence>
      {connection && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => event.target === event.currentTarget && !setup.isPending && onClose()}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            initial={{ opacity: 0, y: 10, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="panel-surface w-[560px] max-w-[94vw] rounded-[22px] p-6 shadow-[0_30px_80px_-20px_rgb(0_0_0/0.7)]"
          >
            <span className="mb-4 flex size-11 items-center justify-center rounded-2xl border border-accent/30 bg-accent/10 text-accent">
              <KeyRound className="size-5" />
            </span>
            <h2 className="text-[17px] font-semibold">Public Key auf {connection.name} hinterlegen</h2>
            <p className="mt-2 text-[13.5px] leading-relaxed text-muted">
              Die App meldet sich einmal mit dem gespeicherten Passwort als <span className="font-mono text-ink">{connection.username}</span> an und trägt deinen Key in{' '}
              <span className="font-mono text-ink">~/.ssh/authorized_keys</span> ein, nur falls er dort noch fehlt. Vorhandene Keys bleiben unverändert. Danach wird geprüft, ob der Login per Key klappt.
            </p>

            {keyInfo?.exists ? (
              <div className="mt-4 rounded-2xl border border-line/[0.08] bg-raised/50 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-mono text-[12px] text-ink/90">{keyInfo.type} · {keyInfo.comment}</p>
                    <p className="mt-0.5 truncate font-mono text-[11px] text-faint">{keyInfo.fingerprint}</p>
                  </div>
                  <button type="button" onClick={copyKey} title="Public Key kopieren" className="flex size-9 shrink-0 items-center justify-center rounded-full border border-line/[0.10] text-muted hover:text-ink">
                    <Copy className="size-4" />
                  </button>
                </div>
                <p className="mt-2 font-mono text-[11px] text-faint">{keyInfo.keyPath}.pub</p>
              </div>
            ) : (
              <p className="mt-4 rounded-2xl border border-accent/30 bg-accent/[0.07] p-3.5 text-[12.5px] text-muted">
                Auf dem Backend-Rechner gibt es noch keinen Schlüssel unter <span className="font-mono">{keyInfo?.keyPath ?? '~/.ssh/id_ed25519'}</span>. Er wird beim Einrichten neu erzeugt (ed25519, ohne Passphrase).
              </p>
            )}

            {authOf(connection) === 'password' && (
              <button type="button" onClick={() => setRemovePassword((value) => !value)} className="mt-4 flex items-center gap-3 text-left text-[13px]">
                <span className={cn('flex size-5 items-center justify-center rounded-md border', removePassword ? 'border-accent bg-accent text-accent-ink' : 'border-line/25')}>
                  {removePassword && <Check className="size-3.5" />}
                </span>
                Gespeichertes Passwort danach aus der App entfernen
              </button>
            )}

            {result && (
              <p className={cn('mt-4 flex items-start gap-2 rounded-2xl border p-3 text-[13px]', result.success ? 'border-ok/30 bg-ok/[0.07] text-ok' : 'border-bad/30 bg-bad/[0.07] text-bad')}>
                {result.success ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
                {result.message}
              </p>
            )}
            {result && !result.success && /verification failed/i.test(result.message) && (
              <div className="mt-3 rounded-2xl border border-line/[0.08] bg-raised/40 p-3.5 text-[12.5px] text-muted">
                <p className="text-ink/90">Der Key steht jetzt auf dem Server, aber sshd akzeptiert ihn nicht. Häufige Gründe, prüfbar im Terminal des Servers:</p>
                <ul className="mt-2 list-disc space-y-1 pl-4">
                  <li>Rechte zu offen: Home-Verzeichnis, <span className="font-mono">~/.ssh</span> (700) oder <span className="font-mono">authorized_keys</span> (600)</li>
                  <li><span className="font-mono">AuthorizedKeysFile</span> zeigt woanders hin</li>
                  <li><span className="font-mono">PubkeyAuthentication no</span> oder ein <span className="font-mono">Match</span>-Block für diesen Benutzer</li>
                </ul>
                <p className="mt-2 font-mono text-[11.5px] text-faint">sshd -T | grep -Ei &apos;pubkey|authorizedkeys|permitroot|strictmodes&apos;</p>
              </div>
            )}

            <div className="mt-6 flex justify-end gap-2.5">
              <button type="button" onClick={onClose} disabled={setup.isPending} className="h-10 rounded-full border border-line/[0.12] px-4 text-[13.5px] hover:bg-raised disabled:opacity-50">
                {result?.success ? 'Fertig' : 'Abbrechen'}
              </button>
              {!result?.success && (
                <button
                  type="button"
                  onClick={() => setup.mutate()}
                  disabled={setup.isPending}
                  className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink disabled:opacity-60"
                >
                  {setup.isPending ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                  {setup.isPending ? 'Richte ein …' : 'Key hinterlegen'}
                </button>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---------- connection card ---------- */

interface CardProps {
  connection: RawConnection;
  index: number;
  testing: boolean;
  lastTest?: ConnectionTestResult;
  highlighted: boolean;
  onTest: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onDeployKey: () => void;
  onTerminal: () => void;
  onOpen: () => void;
  /** The Proxmox guest (VM or LXC) behind this connection, if any. */
  container?: GuestNetwork;
}

function ConnectionCard({ connection, index, testing, lastTest, highlighted, onTest, onEdit, onDelete, onDeployKey, onTerminal, onOpen, container }: CardProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ssh = connection.type !== 'rdp';
  const rdp = useRdpLaunch();
  const openRdp = () => rdp.mutate({ id: connection.id, name: connection.name });
  const online = connection.status === 'online';
  const auth = authOf(connection);

  return (
    <NotchCard
      index={index}
      glow={highlighted}
      tone={connection.status === 'offline' ? 'bad' : undefined}
      eyebrow={container ? `${ssh ? 'SSH' : 'RDP'} · ${container.type === 'lxc' ? 'CT' : 'VM'} ${container.vmid} · ${container.node}` : ssh ? 'SSH' : 'RDP'}
      title={connection.name}
      onClick={onOpen}
      ariaLabel={`Übersicht von ${connection.name} öffnen`}
      actions={[
        ...(ssh ? [{ label: 'Terminal öffnen', icon: <SquareTerminal />, onClick: onTerminal }] : [{ label: 'Per RDP verbinden', icon: <MonitorPlay />, onClick: openRdp }]),
        { label: 'Bearbeiten', icon: <Pencil />, onClick: onEdit },
      ]}
    >
      <p className="mt-1 truncate font-mono text-[12.5px] text-muted">
        {connection.username}@{connection.host}:{connection.port}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill tone={online ? 'ok' : connection.status === 'offline' ? 'bad' : 'muted'}>
          <span className={cn('size-1.5 rounded-full', online ? 'bg-ok' : connection.status === 'offline' ? 'bg-bad' : 'bg-faint')} />
          {online ? 'Online' : connection.status === 'offline' ? 'Offline' : 'Unbekannt'}
        </Pill>
        {ssh && (auth === 'key' ? <Pill tone="accent"><KeyRound className="size-3" /> Schlüssel</Pill> : <Pill><Lock className="size-3" /> Passwort</Pill>)}
        {container && <Pill>{container.type === 'lxc' ? <Box className="size-3" /> : <Monitor className="size-3" />} {container.type === 'lxc' ? 'LXC' : 'VM'} {container.vmid}</Pill>}
        {(connection.tags ?? []).filter((tag) => !(container && ['lxc', 'vm', container.node].includes(tag))).map((tag) => <Pill key={tag}>{tag}</Pill>)}
      </div>
      <p className="mt-3 text-[11.5px] text-faint">
        {connection.last_connected ? `Zuletzt geprüft ${formatRelative(connection.last_connected)}` : 'Noch nicht geprüft'}
        {lastTest && <span className={lastTest.success ? 'text-ok' : 'text-bad'}> · {lastTest.success ? 'Test ok' : 'Test fehlgeschlagen'}</span>}
      </p>

      <div className="mt-auto flex items-center gap-2 pt-4" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          onClick={onTest}
          disabled={testing}
          className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full border border-line/[0.12] text-[13px] transition-all hover:border-accent/40 hover:bg-raised disabled:opacity-60"
        >
          {testing ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />} Testen
        </button>
        {!ssh && (
          <button
            type="button"
            onClick={openRdp}
            disabled={rdp.isPending}
            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent text-[13px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] transition-all disabled:opacity-60"
          >
            {rdp.isPending ? <Loader2 className="size-4 animate-spin" /> : <MonitorPlay className="size-4" />} Verbinden
          </button>
        )}
        {ssh && auth === 'password' && (
          <button
            type="button"
            onClick={onDeployKey}
            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] text-[13px] text-accent transition-all hover:bg-accent/[0.14]"
          >
            <KeyRound className="size-4" /> Key hinterlegen
          </button>
        )}
        <div className="relative">
          <button type="button" onClick={() => setMenuOpen((value) => !value)} aria-label="Weitere Aktionen" className="flex size-9 items-center justify-center rounded-full border border-line/[0.12] text-muted hover:text-ink">
            <MoreHorizontal className="size-4" />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, y: 4, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.15 }}
                className="panel-surface absolute bottom-11 right-0 z-10 w-48 rounded-2xl p-1.5 shadow-2xl"
                onMouseLeave={() => setMenuOpen(false)}
              >
                {ssh && auth === 'key' && (
                  <button type="button" onClick={() => { setMenuOpen(false); onDeployKey(); }} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] hover:bg-hover">
                    <KeyRound className="size-4" /> Key erneut prüfen
                  </button>
                )}
                <button type="button" onClick={() => { setMenuOpen(false); onDelete(); }} className="flex h-9 w-full items-center gap-2 rounded-xl px-3 text-left text-[13px] text-bad hover:bg-bad/10">
                  <Trash2 className="size-4" /> Entfernen
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </NotchCard>
  );
}

/* ---------- Proxmox guest without access ---------- */

function osOf(guest: GuestNetwork): { label: string; windows: boolean | null } {
  const os = guest.ostype ?? '';
  if (os.startsWith('win') || os === 'w2k' || os === 'wxp' || os === 'wvista') return { label: os === 'win11' ? 'Windows 11' : os === 'win10' ? 'Windows 10' : 'Windows', windows: true };
  if (guest.type === 'lxc') return { label: os ? os.charAt(0).toUpperCase() + os.slice(1) : 'Linux', windows: false };
  if (os === 'l26' || os === 'l24') return { label: 'Linux', windows: false };
  if (os === 'solaris') return { label: 'Solaris', windows: false };
  return { label: 'OS unbekannt', windows: null };
}

function presetFor(guest: GuestNetwork): Partial<FormState> {
  const { windows } = osOf(guest);
  const kind = guest.type === 'lxc' ? 'lxc' : 'vm';
  return windows
    ? { type: 'rdp', name: guest.name ?? `vm-${guest.vmid}`, host: guest.ips[0] ?? '', port: '3389', username: 'Administrator', tags: `${kind}, windows, ${guest.node}` }
    : { type: 'ssh', name: guest.name ?? `${kind}-${guest.vmid}`, host: guest.ips[0] ?? '', port: '22', username: 'root', tags: `${kind}, ${guest.node}`, deployKey: true };
}

/** The app system that belongs to a Proxmox guest: same IP, otherwise the same name (SSH or RDP). */
function systemFor(guest: GuestNetwork, list: RawConnection[]) {
  return list.find((item) => guest.ips.includes(item.host)) ?? list.find((item) => !!guest.name && item.name.toLowerCase() === guest.name.toLowerCase());
}

function GuestCard({ guest, index, onSetup, onProxmox }: { guest: GuestNetwork; index: number; onSetup: () => void; onProxmox: () => void }) {
  const running = guest.status === 'running';
  const os = osOf(guest);
  const lxc = guest.type === 'lxc';
  const rdp = os.windows === true;
  return (
    <NotchCard
      index={index}
      className={cn(!running && 'opacity-70')}
      eyebrow={`${lxc ? 'Proxmox-Container' : 'Proxmox-VM'} · ${lxc ? 'CT' : 'VM'} ${guest.vmid} · ${guest.node}`}
      title={guest.name ?? `${lxc ? 'CT' : 'VM'} ${guest.vmid}`}
      actions={[{ label: 'In Proxmox anzeigen', icon: <Box />, onClick: onProxmox }]}
    >
      <p className="mt-1 truncate font-mono text-[12.5px] text-muted">
        {guest.ips[0] ? `${rdp ? '' : 'root@'}${guest.ips[0]}:${rdp ? 3389 : 22}` : lxc ? 'IP unbekannt' : 'IP unbekannt · kein Gast-Agent'}
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Pill tone={running ? 'ok' : 'muted'}>
          <span className={cn('size-1.5 rounded-full', running ? 'bg-ok' : 'bg-faint')} />
          {running ? 'Läuft' : 'Gestoppt'}
        </Pill>
        <Pill>{lxc ? <Box className="size-3" /> : <Monitor className="size-3" />} {lxc ? 'LXC' : 'VM'} {guest.vmid}</Pill>
        <Pill tone={os.windows === null ? 'muted' : undefined}>{os.label}</Pill>
        <Pill tone="muted"><Unplug className="size-3" /> Kein Zugang</Pill>
      </div>
      <p className="mt-3 text-[11.5px] text-faint">
        {!guest.ips[0] && !lxc
          ? 'Ohne Gast-Agent kennt Proxmox die IP nicht; im Formular eintragen.'
          : rdp
            ? 'Vorschlag: RDP-Zugang (Port 3389).'
            : os.windows === null
              ? 'Betriebssystem in Proxmox nicht gesetzt; SSH oder RDP im Formular wählen.'
              : 'Für Terminal, Dateien und Live-Netzwerk einen SSH-Zugang einrichten.'}
      </p>
      <div className="mt-auto pt-4">
        <button
          type="button"
          onClick={onSetup}
          className="flex h-9 w-full items-center justify-center gap-2 rounded-full border border-accent/30 bg-accent/[0.08] text-[13px] text-accent transition-all hover:bg-accent/[0.14]"
        >
          <Plus className="size-4" /> {rdp ? 'RDP-Zugang einrichten' : 'Zugang einrichten'}
        </button>
      </div>
    </NotchCard>
  );
}

/* ---------- page ---------- */

export function SystemsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const connections = useConnections();
  const keyInfo = usePublicKey();
  const list = useMemo(() => (connections.data ?? []) as RawConnection[], [connections.data]);

  const [query, setQuery] = useState('');
  const [editor, setEditor] = useState<{ connection: RawConnection | null; preset?: Partial<FormState> } | null>(null);
  const guestNetworks = useGuestNetworks();
  const [guestKind, setGuestKind] = useState<'all' | 'qemu' | 'lxc'>('all');
  const [keyTarget, setKeyTarget] = useState<RawConnection | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RawConnection | null>(null);
  const [testing, setTesting] = useState<Record<string, boolean>>({});
  const [results, setResults] = useState<Record<string, ConnectionTestResult>>({});
  const [resultView, setResultView] = useState<string | null>(null);
  const highlighted = params.get('host');

  useEffect(() => {
    if (!highlighted) return;
    const timer = window.setTimeout(() => setParams({}, { replace: true }), 4000);
    return () => window.clearTimeout(timer);
  }, [highlighted, setParams]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return list
      .filter((item) => !needle || `${item.name} ${item.host} ${item.username} ${(item.tags ?? []).join(' ')}`.toLowerCase().includes(needle))
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [list, query]);

  // Every Proxmox guest (VM and LXC): matched to an existing system by IP or name, the rest listed for setup
  const proxmoxGuests = useMemo(() => guestNetworks.data ?? [], [guestNetworks.data]);
  const guestFor = useMemo(() => {
    const map = new Map<string, GuestNetwork>();
    proxmoxGuests.forEach((guest) => {
      const system = systemFor(guest, list);
      if (system && !map.has(system.id)) map.set(system.id, guest);
    });
    return map;
  }, [proxmoxGuests, list]);
  const unmanaged = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const managed = new Set([...guestFor.values()].map((guest) => guest.vmid));
    return proxmoxGuests
      .filter((guest) => !managed.has(guest.vmid))
      .filter((guest) => guestKind === 'all' || guest.type === guestKind)
      .filter((guest) => !needle || `${guest.name} ${guest.vmid} ${guest.ips.join(' ')} ${guest.node} ${osOf(guest).label}`.toLowerCase().includes(needle))
      .sort((left, right) => Number(right.status === 'running') - Number(left.status === 'running') || left.vmid - right.vmid);
  }, [guestFor, guestKind, proxmoxGuests, query]);
  const unmanagedTotal = proxmoxGuests.length - new Set([...guestFor.values()].map((guest) => guest.vmid)).size;
  const setupGuest = (guest: GuestNetwork) => setEditor({ connection: null, preset: presetFor(guest) });

  const ssh = list.filter((item) => item.type !== 'rdp');
  const sshOnline = ssh.filter((item) => item.status === 'online').length;
  const withKey = ssh.filter((item) => authOf(item) === 'key').length;
  const rdp = list.length - ssh.length;

  const test = async (connection: RawConnection) => {
    setTesting((current) => ({ ...current, [connection.id]: true }));
    try {
      const result = await connectionAPI.test(connection.id);
      setResults((current) => ({ ...current, [connection.id]: result }));
      setResultView(connection.id);
      queryClient.invalidateQueries({ queryKey: infraKeys.connections });
    } catch (error) {
      toast.error(`Test von ${connection.name} fehlgeschlagen`, { description: (error as Error).message });
    } finally {
      setTesting((current) => ({ ...current, [connection.id]: false }));
    }
  };

  const remove = useMutation({
    mutationFn: (connection: RawConnection) => connectionAPI.delete(connection.id),
    onSuccess: (_result, connection) => {
      queryClient.invalidateQueries({ queryKey: infraKeys.connections });
      toast.success(`${connection.name} entfernt`);
    },
    onError: (error: Error) => toast.error('Entfernen fehlgeschlagen', { description: error.message }),
  });

  const viewed = resultView ? list.find((item) => item.id === resultView) : undefined;

  return (
    <>
      <PageHeader
        section="Infrastruktur"
        title="Systeme"
        description="SSH- und RDP-Verbindungen anlegen, testen und per Schlüssel absichern"
        actions={
          <button
            type="button"
            onClick={() => setEditor({ connection: null })}
            className="flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] transition-all active:scale-[0.97]"
          >
            <Plus className="size-4" /> System hinzufügen
          </button>
        }
      />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[150px]" eyebrow="Remote Access" title="SSH-Hosts">
          <p className="mt-3 text-[44px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={sshOnline} /><span className="ml-1 text-[20px] font-medium text-muted">/ {ssh.length}</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">online</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[150px]" eyebrow="Absicherung" title="Login per Schlüssel">
          <p className="mt-3 text-[44px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={withKey} /><span className="ml-1 text-[20px] font-medium text-muted">/ {ssh.length}</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-line/[0.07]">
            <motion.div className="h-full rounded-full bg-gradient-to-r from-accent/70 to-accent" initial={{ width: 0 }} animate={{ width: `${ssh.length ? (withKey / ssh.length) * 100 : 0}%` }} transition={{ duration: 1, delay: 0.3 }} />
          </div>
        </NotchCard>
        <NotchCard index={2} className="min-h-[150px]" eyebrow="Remote Desktop" title="RDP-Hosts">
          <p className="mt-3 text-[44px] font-bold leading-none tracking-[-0.03em]"><AnimatedNumber value={rdp} /></p>
          <p className="mt-2 text-[12.5px] text-muted">{rdp === 0 ? 'noch keine angelegt' : 'angelegt'}</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[150px]" eyebrow="Dein Schlüssel" title={keyInfo.data?.exists ? keyInfo.data.type ?? 'SSH-Key' : 'Kein Schlüssel'}>
          <p className="mt-3 truncate font-mono text-[12px] text-ink/90">{keyInfo.data?.comment ?? '–'}</p>
          <p className="mt-1 truncate font-mono text-[11px] text-faint">{keyInfo.data?.fingerprint ?? keyInfo.data?.keyPath ?? ''}</p>
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-muted"><ShieldCheck className="size-3.5" /> wird beim Hinterlegen verwendet</p>
        </NotchCard>
      </div>

      <div className="mb-4 mt-7 flex items-center gap-3">
        <label className="flex h-10 w-full max-w-[380px] items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 transition-colors focus-within:border-accent/40">
          <Search className="size-4 text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, Host, Benutzer oder Tag …" className="h-full flex-1 bg-transparent text-[13.5px] outline-none placeholder:text-faint" />
        </label>
        <span className="text-[12.5px] text-muted">
          {filtered.length} von {list.length} Systemen{proxmoxGuests.length ? ` · ${proxmoxGuests.length} Gäste in Proxmox, ${guestFor.size} davon mit Zugang` : ''}
        </span>
      </div>

      {connections.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lädt …</div>
      ) : list.length === 0 ? (
        <NotchCard className="min-h-[220px]" bodyClassName="items-center justify-center text-center">
          <p className="text-[16px] font-semibold">Noch keine Systeme</p>
          <p className="mt-1.5 text-[13px] text-muted">Lege dein erstes SSH- oder RDP-System an.</p>
          <button type="button" onClick={() => setEditor({ connection: null })} className="mt-4 flex h-10 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13.5px] font-medium text-accent-ink">
            <Plus className="size-4" /> System hinzufügen
          </button>
        </NotchCard>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((connection, index) => (
            <ConnectionCard
              key={connection.id}
              connection={connection}
              index={4 + index}
              testing={!!testing[connection.id]}
              lastTest={results[connection.id]}
              highlighted={highlighted === connection.id}
              onTest={() => void test(connection)}
              onEdit={() => setEditor({ connection })}
              onDelete={() => setDeleteTarget(connection)}
              onDeployKey={() => setKeyTarget(connection)}
              onTerminal={() => navigate(`/terminal?host=${encodeURIComponent(connection.id)}`)}
              onOpen={() => navigate(`/systems/${encodeURIComponent(connection.id)}`)}
              container={guestFor.get(connection.id)}
            />
          ))}
        </div>
      )}

      {unmanagedTotal > 0 && (
        <>
          <div className="mb-4 mt-9 flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[17px] font-semibold tracking-[-0.01em]">Proxmox-Gäste ohne Zugang</h2>
              <p className="mt-1 text-[13px] text-muted">
                {unmanagedTotal} von {proxmoxGuests.length} VMs und Containern · Name, IP und Betriebssystem kommen aus Proxmox, für den Zugang fehlt nur Passwort oder Schlüssel
              </p>
            </div>
            <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
              {([['all', 'Alle'], ['qemu', 'VMs'], ['lxc', 'LXC']] as const).map(([value, label]) => (
                <button key={value} type="button" onClick={() => setGuestKind(value)} className={cn('relative h-8 rounded-full px-3.5 text-[12.5px] transition-colors', guestKind === value ? 'text-ink' : 'text-muted hover:text-ink')}>
                  {guestKind === value && <motion.span layoutId="sys-kind" className="absolute inset-0 rounded-full border border-accent/25 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                  <span className="relative">{label}</span>
                </button>
              ))}
            </div>
          </div>
          {unmanaged.length === 0 ? (
            <p className="py-8 text-center text-[13px] text-muted">Keine Gäste für diesen Filter.</p>
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 2xl:grid-cols-3">
              {unmanaged.map((guest, index) => (
                <GuestCard key={`${guest.node}-${guest.vmid}`} guest={guest} index={4 + filtered.length + index} onSetup={() => setupGuest(guest)} onProxmox={() => navigate('/proxmox')} />
              ))}
            </div>
          )}
        </>
      )}

      <Drawer open={!!editor} onClose={() => setEditor(null)} label="Verbindung bearbeiten" width={520}>
        {editor && (
          <ConnectionForm
            key={editor.connection?.id ?? `new-${editor.preset?.host ?? ''}-${editor.preset?.name ?? ''}`}
            connection={editor.connection}
            preset={editor.preset}
            keyInfo={keyInfo.data}
            onCancel={() => setEditor(null)}
            onDone={({ id, deployKey }) => {
              setEditor(null);
              if (deployKey) {
                // Wait for the refreshed list so the dialog shows the new connection
                void queryClient.fetchQuery({ queryKey: infraKeys.connections }).then((data) => {
                  const created = (data as RawConnection[] | undefined)?.find((item) => item.id === id);
                  if (created) setKeyTarget(created);
                });
              }
            }}
          />
        )}
      </Drawer>

      <Drawer open={!!viewed} onClose={() => setResultView(null)} label="Testergebnis" width={480}>
        {viewed && results[viewed.id] && (
          <div className="px-7 pb-8 pt-7">
            <p className="text-[12px] text-muted">Verbindungstest</p>
            <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{viewed.name}</h2>
            <p className="mb-5 mt-1 font-mono text-[12.5px] text-muted">{viewed.username}@{viewed.host}:{viewed.port}</p>
            <TestResultView result={results[viewed.id]} />
          </div>
        )}
      </Drawer>

      <KeySetupDialog connection={keyTarget} keyInfo={keyInfo.data} onClose={() => setKeyTarget(null)} />

      <ConfirmDialog
        open={!!deleteTarget}
        title={`${deleteTarget?.name} entfernen?`}
        description="Die Verbindung wird aus der App gelöscht, zusammen mit ihrem Metrik-Verlauf, Alerts, Schwellenwerten und Scan-Ergebnissen. Auf dem Server selbst ändert sich nichts."
        confirmLabel="Entfernen"
        tone="danger"
        icon={<Trash2 />}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </>
  );
}
