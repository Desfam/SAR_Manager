import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play, Power, PowerOff, RotateCw, type LucideIcon } from 'lucide-react';
import { proxmoxAPI } from '@/services/api';
import { proxmoxDetails } from '@/services/proxmox';
import { getProxmoxTarget, infraKeys } from '@/hooks/use-infrastructure';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import type { ProxmoxGuest } from '@/lib/proxmox';

export type PowerAction = 'start' | 'shutdown' | 'reboot' | 'stop';

export const POWER: Record<PowerAction, { label: string; progress: string; done: string; icon: LucideIcon }> = {
  start: { label: 'Starten', progress: 'startet …', done: 'gestartet', icon: Play },
  shutdown: { label: 'Herunterfahren', progress: 'fährt herunter …', done: 'heruntergefahren', icon: Power },
  reboot: { label: 'Neustarten', progress: 'startet neu …', done: 'neu gestartet', icon: RotateCw },
  stop: { label: 'Sofort stoppen', progress: 'wird gestoppt …', done: 'gestoppt', icon: PowerOff },
};

export interface PendingTask {
  action: PowerAction;
  upid?: string;
  startedAt: number;
}

export interface PowerGuest {
  node: string;
  type: 'qemu' | 'lxc';
  vmid: number;
  name?: string;
  status?: string;
  lock?: string;
}

export const guestKey = (guest: Pick<ProxmoxGuest, 'node' | 'vmid'>) => `${guest.node}/${guest.vmid}`;
const guestLabel = (guest: PowerGuest) => guest.name ?? `#${guest.vmid}`;

/** Which actions make sense for the guest's current state. */
export function availableActions(guest: PowerGuest, pending?: PendingTask): Record<PowerAction, boolean> {
  const busy = !!pending || !!guest.lock;
  const running = guest.status === 'running';
  const stopped = guest.status === 'stopped';
  return {
    start: !busy && stopped,
    shutdown: !busy && running,
    reboot: !busy && running,
    stop: !busy && (running || guest.status === 'paused'),
  };
}

const CONFIRM: Record<Exclude<PowerAction, 'start'>, { title: string; text: ReactNode; label: string; danger: boolean }> = {
  shutdown: {
    title: 'Herunterfahren?',
    text: 'Das Gastsystem wird sauber heruntergefahren. Das kann je nach System einige Sekunden bis Minuten dauern.',
    label: 'Herunterfahren',
    danger: false,
  },
  reboot: {
    title: 'Neustarten?',
    text: 'Das Gastsystem wird neu gestartet. Laufende Verbindungen und Dienste sind kurz nicht erreichbar.',
    label: 'Neustarten',
    danger: false,
  },
  stop: {
    title: 'Sofort stoppen?',
    text: (
      <>
        Stoppen schaltet sofort aus, <span className="text-ink">wie Stecker ziehen</span>. Nicht gespeicherte Daten gehen verloren. Nimm lieber
        „Herunterfahren“, wenn das System noch reagiert.
      </>
    ),
    label: 'Sofort stoppen',
    danger: true,
  },
};

const TASK_TIMEOUT = 5 * 60_000;

/**
 * Sends power actions, asks for confirmation where it matters, and follows each Proxmox task (UPID)
 * until it has really finished. One instance serves the table and the detail drawer alike.
 */
export function usePowerControl() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<Record<string, PendingTask>>({});
  const [confirm, setConfirm] = useState<{ guest: PowerGuest; action: Exclude<PowerAction, 'start'> } | null>(null);
  const guests = useRef<Record<string, PowerGuest>>({});

  const finish = useCallback(
    (key: string) => {
      setPending((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: infraKeys.proxmox });
    },
    [queryClient],
  );

  const send = useCallback(
    async (guest: PowerGuest, action: PowerAction) => {
      const key = guestKey(guest);
      guests.current[key] = guest;
      setPending((current) => ({ ...current, [key]: { action, startedAt: Date.now() } }));
      try {
        const call = { start: proxmoxAPI.startVm, shutdown: proxmoxAPI.shutdownVm, reboot: proxmoxAPI.rebootVm, stop: proxmoxAPI.stopVm }[action];
        const result = await call(guest.node, guest.type, guest.vmid, getProxmoxTarget());
        const upid = typeof result.upid === 'string' ? result.upid : undefined;
        if (!upid) {
          toast.success(`${guestLabel(guest)}: ${POWER[action].label} gesendet`);
          finish(key);
          return;
        }
        setPending((current) => (current[key] ? { ...current, [key]: { ...current[key], upid } } : current));
      } catch (error) {
        toast.error(`${POWER[action].label} fehlgeschlagen`, { description: `${guestLabel(guest)}: ${(error as Error).message}` });
        finish(key);
      }
    },
    [finish],
  );

  // Follow every running task until Proxmox reports it as stopped
  useEffect(() => {
    const tracked = Object.entries(pending).filter(([, task]) => task.upid);
    if (tracked.length === 0) return;
    const timer = window.setInterval(async () => {
      for (const [key, task] of tracked) {
        const guest = guests.current[key];
        if (!guest || !task.upid) continue;
        if (Date.now() - task.startedAt > TASK_TIMEOUT) {
          toast.warning(`${guestLabel(guest)}: ${POWER[task.action].label} dauert ungewöhnlich lange`, {
            description: 'Der Vorgang läuft in Proxmox weiter. Den Stand siehst du in der Task-Liste des Nodes.',
          });
          finish(key);
          continue;
        }
        try {
          const status = await proxmoxDetails.task(guest.node, task.upid, getProxmoxTarget());
          if (status.status !== 'stopped') continue;
          if (status.exitstatus === 'OK') {
            toast.success(`${guestLabel(guest)} ${POWER[task.action].done}`, { description: `${guest.type === 'lxc' ? 'CT' : 'VM'} ${guest.vmid} · ${guest.node}` });
          } else {
            toast.error(`${POWER[task.action].label} fehlgeschlagen`, { description: `${guestLabel(guest)}: ${status.exitstatus ?? 'unbekannter Fehler'}` });
          }
          finish(key);
        } catch {
          // transient; try again on the next tick
        }
      }
    }, 1500);
    return () => window.clearInterval(timer);
  }, [finish, pending]);

  const request = useCallback(
    (guest: PowerGuest, action: PowerAction) => {
      if (action === 'start') void send(guest, action);
      else setConfirm({ guest, action });
    },
    [send],
  );

  const copy = confirm ? CONFIRM[confirm.action] : null;
  const DialogIcon = confirm ? POWER[confirm.action].icon : Power;

  const dialog = (
    <ConfirmDialog
      open={!!confirm}
      title={confirm && copy ? `${guestLabel(confirm.guest)}: ${copy.title}` : ''}
      description={copy?.text}
      confirmLabel={copy?.label ?? ''}
      tone={copy?.danger ? 'danger' : 'default'}
      icon={<DialogIcon />}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        if (confirm) void send(confirm.guest, confirm.action);
        setConfirm(null);
      }}
    />
  );

  return { pending, request, dialog };
}

export type PowerControl = ReturnType<typeof usePowerControl>;
