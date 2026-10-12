import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { toast } from 'sonner';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BrickWall,
  ChevronRight,
  Layers,
  Container,
  Globe,
  Loader2,
  Monitor,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  ShieldOff,
  ShieldQuestion,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/shell/PageHeader';
import { NotchCard } from '@/components/ui/NotchCard';
import { Drawer } from '@/components/ui/Drawer';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { AnimatedNumber } from '@/components/ui/viz';
import { getProxmoxTarget, useConnections } from '@/hooks/use-infrastructure';
import { guestId, networkKeys, systemForGuest, useFirewallMacros, useFirewallStatus, useGuestFirewall, useGuestNetworks, useGuestOsFirewall, useNetstat } from '@/hooks/use-network';
import { networkApi, type FirewallRule, type GuestFirewall, type GuestNetwork, type NewRule } from '@/services/network';
import { MACRO_PORTS, PORT_NAMES, ruleCoversPort, scopeOf } from '@/lib/net';
import { isWindowsGuest, osFirewallVerdict } from '@/lib/os-firewall';
import { OsFirewallView } from '@/components/firewall/OsFirewallView';
import { ProxmoxConfig } from '@/components/firewall/ProxmoxConfig';

/* ---------- presentation helpers ---------- */

const ACTION_STYLE: Record<string, { label: string; className: string }> = {
  ACCEPT: { label: 'Erlauben', className: 'border-ok/35 bg-ok/10 text-ok' },
  DROP: { label: 'Verwerfen', className: 'border-bad/35 bg-bad/10 text-bad' },
  REJECT: { label: 'Ablehnen', className: 'border-accent/35 bg-accent/10 text-accent' },
};

function serviceOf(rule: FirewallRule) {
  if (rule.macro) {
    const ports = MACRO_PORTS[rule.macro];
    return { title: rule.macro, detail: ports?.length ? ports.join(', ') : rule.macro === 'Ping' ? 'ICMP' : 'Makro' };
  }
  if (rule.proto && rule.dport) return { title: `${rule.proto.toUpperCase()} ${rule.dport}`, detail: PORT_NAMES[Number(rule.dport)] ?? 'Port' };
  if (rule.proto) return { title: rule.proto.toUpperCase(), detail: 'alle Ports' };
  return { title: 'Alles', detail: 'jedes Protokoll' };
}

const where = (value?: string) => value || 'überall';

/** Rules in evaluation order, with datacenter security groups replaced by their rules (only enabled if the group reference is) */
function expandRules(data?: GuestFirewall): FirewallRule[] {
  return (data?.rules ?? []).flatMap((rule) => {
    if (rule.type !== 'group') return [rule];
    const group = data?.groups?.find((entry) => entry.name === rule.action);
    return (group?.rules ?? []).map((inner) => ({ ...inner, pos: rule.pos, enable: rule.enable ? inner.enable : 0, comment: inner.comment ?? `Gruppe ${rule.action}` }));
  });
}

/* ---------- rule builder ---------- */

const QUICK_SERVICES = ['SSH', 'Web', 'HTTP', 'HTTPS', 'RDP', 'DNS', 'Ping', 'SMB', 'MySQL', 'PostgreSQL', 'NTP', 'SMTP'];

interface BuilderState {
  type: 'in' | 'out';
  action: 'ACCEPT' | 'DROP' | 'REJECT';
  service: string; // macro name, or 'custom' / 'any'
  proto: 'tcp' | 'udp';
  dport: string;
  peer: string;
  comment: string;
}

const initialBuilder: BuilderState = { type: 'in', action: 'ACCEPT', service: 'SSH', proto: 'tcp', dport: '', peer: '', comment: '' };

function validateBuilder(state: BuilderState): string | null {
  if (state.service === 'custom') {
    if (!state.dport.trim()) return 'Port angeben, z. B. 8080 oder 8000:8100';
    const valid = /^\d{1,5}(:\d{1,5})?(,\d{1,5}(:\d{1,5})?)*$/.test(state.dport.trim()) && state.dport.split(/[,:]/).every((port) => Number(port) >= 1 && Number(port) <= 65535);
    if (!valid) return 'Ports als Zahl (1–65535), Bereich mit „:“, mehrere mit Komma';
  }
  if (state.peer.trim() && !/^[0-9a-fA-F.:/,]{2,200}$/.test(state.peer.trim())) return 'Nur IP-Adressen oder Netze wie 172.21.4.0/22';
  if (state.comment.length > 120) return 'Kommentar höchstens 120 Zeichen';
  return null;
}

function toRule(state: BuilderState): NewRule {
  const rule: NewRule = { type: state.type, action: state.action };
  if (state.service === 'custom') {
    rule.proto = state.proto;
    rule.dport = state.dport.trim();
  } else if (state.service === 'any') {
    rule.allowAny = true;
  } else {
    rule.macro = state.service;
  }
  if (state.peer.trim()) {
    if (state.type === 'in') rule.source = state.peer.trim();
    else rule.dest = state.peer.trim();
  }
  if (state.comment.trim()) rule.comment = state.comment.trim();
  return rule;
}

function Segmented<T extends string>({ value, onChange, options, id }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: ReactNode }>; id: string }) {
  return (
    <div className="flex rounded-full border border-line/[0.10] bg-raised/50 p-1">
      {options.map((option) => (
        <button key={option.value} type="button" onClick={() => onChange(option.value)} className={cn('relative flex h-9 flex-1 items-center justify-center gap-2 rounded-full text-[13px] transition-colors', value === option.value ? 'text-ink' : 'text-muted hover:text-ink')}>
          {value === option.value && <motion.span layoutId={`fw-seg-${id}`} className="absolute inset-0 rounded-full border border-accent/30 bg-accent/[0.12]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
          <span className="relative flex items-center gap-2">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

const inputClass = 'h-11 w-full rounded-2xl border border-line/[0.10] bg-raised/50 px-4 text-[13.5px] outline-none transition-colors placeholder:text-faint focus:border-accent/45';

function RuleBuilder({ guest, onDone }: { guest: GuestNetwork; onDone: () => void }) {
  const queryClient = useQueryClient();
  const macros = useFirewallMacros();
  const [state, setState] = useState<BuilderState>(initialBuilder);
  const [macroQuery, setMacroQuery] = useState('');
  const set = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => setState((current) => ({ ...current, [key]: value }));
  const error = validateBuilder(state);

  const create = useMutation({
    mutationFn: () => networkApi.createRule(guest, toRule(state), getProxmoxTarget()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: networkKeys.guestFirewall(guest.node, guest.vmid) });
      toast.success('Regel angelegt', { description: `${guest.name} · ganz oben in der Liste` });
      onDone();
    },
    onError: (failure: Error) => toast.error('Regel konnte nicht angelegt werden', { description: failure.message }),
  });

  const otherMacros = (macros.data ?? [])
    .filter((macro) => !QUICK_SERVICES.includes(macro.macro))
    .filter((macro) => !macroQuery || `${macro.macro} ${macro.descr}`.toLowerCase().includes(macroQuery.toLowerCase()))
    .slice(0, 30);

  const serviceText = state.service === 'custom' ? `${state.proto.toUpperCase()} ${state.dport || '…'}` : state.service === 'any' ? 'jeglichen Verkehr' : state.service;
  const actionWord = { ACCEPT: 'Erlaube', DROP: 'Verwirf', REJECT: 'Lehne ab:' }[state.action];
  const peerText = state.peer.trim() || 'überall';
  const sentence = state.type === 'in' ? `${actionWord} ${serviceText} von ${peerText} zu ${guest.name}` : `${actionWord} ${serviceText} von ${guest.name} nach ${peerText}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-5 px-7 pb-6 pt-7">
        <div>
          <p className="text-[12px] text-muted">Neue Firewall-Regel</p>
          <h2 className="mt-1 pr-12 text-[24px] font-semibold tracking-[-0.02em]">{guest.name}</h2>
        </div>

        {/* Visual preview */}
        <div className="grid-texture rounded-2xl border border-line/[0.08] p-4">
          <div className="flex items-center justify-between gap-2 text-[12px]">
            <span className="flex min-w-0 items-center gap-2 rounded-xl border border-line/[0.10] bg-card px-3 py-2">
              {state.type === 'in' ? <Globe className="size-3.5 text-muted" /> : guest.type === 'lxc' ? <Container className="size-3.5 text-accent" /> : <Monitor className="size-3.5 text-accent" />}
              <span className="truncate">{state.type === 'in' ? peerText : guest.name}</span>
            </span>
            <span className="flex min-w-0 flex-1 flex-col items-center">
              <span className={cn('mb-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px]', ACTION_STYLE[state.action].className)}>{serviceText}</span>
              <span className="relative h-0.5 w-full overflow-hidden rounded-full bg-line/[0.08]">
                <motion.span
                  key={`${state.action}-${state.type}`}
                  className={cn('absolute inset-y-0 w-1/3 rounded-full', state.action === 'ACCEPT' ? 'bg-ok' : state.action === 'DROP' ? 'bg-bad' : 'bg-accent')}
                  initial={{ left: '-33%' }}
                  animate={{ left: state.action === 'ACCEPT' ? '100%' : '40%' }}
                  transition={{ duration: 1.2, repeat: state.action === 'ACCEPT' ? Infinity : 0, ease: 'easeInOut' }}
                />
              </span>
              <span className="mt-1 text-[10.5px] text-faint">{state.action === 'ACCEPT' ? 'kommt durch' : state.action === 'DROP' ? 'wird still verworfen' : 'wird abgelehnt (mit Antwort)'}</span>
            </span>
            <span className="flex min-w-0 items-center gap-2 rounded-xl border border-line/[0.10] bg-card px-3 py-2">
              {state.type === 'in' ? guest.type === 'lxc' ? <Container className="size-3.5 text-accent" /> : <Monitor className="size-3.5 text-accent" /> : <Globe className="size-3.5 text-muted" />}
              <span className="truncate">{state.type === 'in' ? guest.name : peerText}</span>
            </span>
          </div>
          <p className="mt-3 text-center text-[13px] text-ink/90">{sentence}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Segmented<'in' | 'out'>
            id="dir"
            value={state.type}
            onChange={(value) => set('type', value)}
            options={[
              { value: 'in', label: <><ArrowDownToLine className="size-4" /> Eingehend</> },
              { value: 'out', label: <><ArrowUpFromLine className="size-4" /> Ausgehend</> },
            ]}
          />
          <Segmented<'ACCEPT' | 'DROP' | 'REJECT'>
            id="action"
            value={state.action}
            onChange={(value) => set('action', value)}
            options={[
              { value: 'ACCEPT', label: 'Erlauben' },
              { value: 'DROP', label: 'Verwerfen' },
              { value: 'REJECT', label: 'Ablehnen' },
            ]}
          />
        </div>

        <div>
          <p className="mb-2 text-[12.5px] font-medium">Dienst</p>
          <div className="grid grid-cols-4 gap-2">
            {QUICK_SERVICES.map((service) => (
              <button
                key={service}
                type="button"
                onClick={() => set('service', service)}
                className={cn(
                  'rounded-xl border px-2 py-2 text-left transition-all',
                  state.service === service ? 'border-accent/45 bg-accent/[0.10]' : 'border-line/[0.08] hover:border-line/[0.18]',
                )}
              >
                <span className="block text-[12.5px] font-medium">{service}</span>
                <span className="block font-mono text-[10px] text-faint">{MACRO_PORTS[service]?.length ? MACRO_PORTS[service].join(', ') : 'ICMP'}</span>
              </button>
            ))}
            <button type="button" onClick={() => set('service', 'custom')} className={cn('col-span-2 rounded-xl border px-3 py-2 text-left transition-all', state.service === 'custom' ? 'border-accent/45 bg-accent/[0.10]' : 'border-line/[0.08] hover:border-line/[0.18]')}>
              <span className="block text-[12.5px] font-medium">Eigener Port</span>
              <span className="block text-[10.5px] text-faint">TCP/UDP und Portnummer</span>
            </button>
            <button type="button" onClick={() => set('service', 'any')} className={cn('col-span-2 rounded-xl border px-3 py-2 text-left transition-all', state.service === 'any' ? 'border-accent/45 bg-accent/[0.10]' : 'border-line/[0.08] hover:border-line/[0.18]')}>
              <span className="block text-[12.5px] font-medium">Alles</span>
              <span className="block text-[10.5px] text-faint">jedes Protokoll, jeder Port</span>
            </button>
          </div>

          {state.service === 'custom' && (
            <div className="mt-3 grid grid-cols-[120px_1fr] gap-3">
              <Segmented<'tcp' | 'udp'> id="proto" value={state.proto} onChange={(value) => set('proto', value)} options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }]} />
              <input className={cn(inputClass, 'font-mono')} value={state.dport} onChange={(event) => set('dport', event.target.value.replace(/[^\d:,]/g, ''))} placeholder="z. B. 8080 oder 8000:8100" />
            </div>
          )}

          <details className="mt-3 rounded-2xl border border-line/[0.07] px-3 py-2">
            <summary className="cursor-pointer text-[12.5px] text-muted">Weitere Proxmox-Dienste ({macros.data?.length ?? '…'})</summary>
            <input className={cn(inputClass, 'mt-2 h-9')} value={macroQuery} onChange={(event) => setMacroQuery(event.target.value)} placeholder="Suchen …" />
            <div className="mt-2 grid max-h-52 grid-cols-2 gap-1.5 overflow-y-auto pr-1">
              {otherMacros.map((macro) => (
                <button key={macro.macro} type="button" onClick={() => set('service', macro.macro)} title={macro.descr} className={cn('truncate rounded-lg border px-2 py-1.5 text-left text-[12px]', state.service === macro.macro ? 'border-accent/45 bg-accent/[0.10]' : 'border-line/[0.07] hover:border-line/[0.16]')}>
                  {macro.macro}
                </button>
              ))}
            </div>
          </details>
        </div>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium">{state.type === 'in' ? 'Von (Quelle)' : 'Nach (Ziel)'}</span>
          <input className={cn(inputClass, 'font-mono')} value={state.peer} onChange={(event) => set('peer', event.target.value)} placeholder="leer = überall, sonst z. B. 172.21.4.0/22" />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-[12.5px] font-medium">Kommentar</span>
          <input className={inputClass} value={state.comment} onChange={(event) => set('comment', event.target.value)} placeholder="optional" maxLength={120} />
        </label>

        {error && <p className="text-[12.5px] text-bad">{error}</p>}
        <p className="text-[11.5px] text-faint">Proxmox setzt neue Regeln ganz oben ein; sie werden also vor den bestehenden geprüft.</p>
      </div>

      <div className="sticky bottom-0 flex justify-end gap-2.5 border-t border-line/[0.07] bg-panel/95 px-7 py-4 backdrop-blur">
        <button type="button" onClick={onDone} className="h-11 rounded-full border border-line/[0.12] px-5 text-[13.5px] hover:bg-raised">Abbrechen</button>
        <button
          type="button"
          disabled={!!error || create.isPending}
          onClick={() => create.mutate()}
          className="flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-5 text-[13.5px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)] disabled:opacity-50"
        >
          {create.isPending ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Regel anlegen
        </button>
      </div>
    </div>
  );
}

/* ---------- guest firewall view ---------- */

function Toggle({ on, onChange, busy, label }: { on: boolean; onChange: () => void; busy?: boolean; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onChange} disabled={busy} className={cn('relative h-6 w-10 shrink-0 rounded-full border transition-colors disabled:opacity-50', on ? 'border-ok/40 bg-ok/25' : 'border-line/[0.14] bg-raised')}>
      <motion.span className={cn('absolute top-0.5 size-[18px] rounded-full', on ? 'bg-ok' : 'bg-faint')} animate={{ left: on ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 34 }} />
    </button>
  );
}

function GuestFirewallView({ guest, clusterOn, nodeOn, onAdd }: { guest: GuestNetwork; clusterOn: boolean; nodeOn: boolean; onAdd: () => void }) {
  const queryClient = useQueryClient();
  const firewall = useGuestFirewall(guest);
  const connections = useConnections();
  const system = systemForGuest(guest, connections.data ?? []);
  const netstat = useNetstat(guest.status === 'running' ? system?.id : undefined, 60_000);
  const [deleteTarget, setDeleteTarget] = useState<FirewallRule | null>(null);
  const [busyPos, setBusyPos] = useState<number | null>(null);

  const rules = firewall.data?.rules ?? [];
  const expanded = expandRules(firewall.data);
  const options = firewall.data?.options ?? {};
  const guestOn = Number(options.enable ?? 0) === 1;
  const nicFlag = guest.interfaces.every((iface) => iface.firewall);
  const effective = clusterOn && guestOn && nicFlag;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: networkKeys.guestFirewall(guest.node, guest.vmid) });

  const toggle = useMutation({
    mutationFn: (rule: FirewallRule) => networkApi.setRuleEnabled(guest, rule.pos, !(rule.enable ?? 0), options.digest, getProxmoxTarget()),
    onMutate: (rule) => setBusyPos(rule.pos),
    onSettled: () => setBusyPos(null),
    onSuccess: () => invalidate(),
    onError: (failure: Error) => toast.error('Regel konnte nicht geändert werden', { description: failure.message }),
  });

  const remove = useMutation({
    mutationFn: (rule: FirewallRule) => networkApi.deleteRule(guest, rule.pos, options.digest, getProxmoxTarget()),
    onSuccess: () => {
      invalidate();
      toast.success('Regel gelöscht');
    },
    onError: (failure: Error) => toast.error('Löschen fehlgeschlagen', { description: failure.message }),
  });

  const listening = [...new Map(
    (netstat.data?.listening ?? [])
      .filter((entry) => entry.local.port !== null && scopeOf(entry.local.ip) !== 'loopback')
      .map((entry) => [`${entry.proto}/${entry.local.port}`, entry]),
  ).values()].sort((a, b) => (a.local.port ?? 0) - (b.local.port ?? 0));

  const inRules = expanded.filter((rule) => rule.type === 'in');
  const outRules = expanded.filter((rule) => rule.type === 'out');
  const policyIn = (options.policy_in as string | undefined) ?? 'DROP';
  const policyOut = (options.policy_out as string | undefined) ?? 'ACCEPT';

  const verdictForPort = (port: number) => {
    for (const rule of inRules) {
      if (!rule.enable) continue;
      const covers = ruleCoversPort(rule, port);
      if (covers === true) return rule.action;
    }
    return `${policyIn} (Standard)`;
  };

  const RuleChip = ({ rule }: { rule: FirewallRule }) => {
    const service = serviceOf(rule);
    return (
      <span className={cn('flex items-center gap-2 rounded-xl border px-2.5 py-1.5', ACTION_STYLE[rule.action]?.className ?? 'border-line/[0.1]', !rule.enable && 'opacity-35')} title={rule.comment}>
        <span className="text-[12px] font-medium">{service.title}</span>
        <span className="font-mono text-[10px] opacity-80">{service.detail}</span>
      </span>
    );
  };

  return (
    <div className="space-y-5">
      {/* Effective state */}
      {!effective ? (
        <div className="flex items-start gap-3 rounded-2xl border border-accent/35 bg-accent/[0.07] p-4 text-[13px]">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-accent" />
          <div>
            <p className="font-medium">Diese Regeln werden zurzeit nicht angewendet.</p>
            <p className="mt-1 text-muted">
              Proxmox filtert nur, wenn die Firewall auf allen Ebenen an ist:{' '}
              <span className={clusterOn ? 'text-ok' : 'text-bad'}>Rechenzentrum {clusterOn ? 'an' : 'aus'}</span> ·{' '}
              <span className={nodeOn ? 'text-ok' : 'text-muted'}>Node {nodeOn ? 'an' : 'aus'}</span> ·{' '}
              <span className={guestOn ? 'text-ok' : 'text-bad'}>Gast {guestOn ? 'an' : 'aus'}</span> ·{' '}
              <span className={nicFlag ? 'text-ok' : 'text-bad'}>Netzwerkkarte {nicFlag ? 'mit Firewall-Flag' : 'ohne Firewall-Flag'}</span>.
              Das Einschalten ist hier bewusst gesperrt, weil es sofort Verbindungen trennen kann; bitte in der Proxmox-Oberfläche.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-ok/35 bg-ok/[0.07] p-4 text-[13px]">
          <ShieldCheck className="size-4 text-ok" /> Firewall aktiv · Standard eingehend <span className="font-mono">{policyIn}</span>, ausgehend <span className="font-mono">{policyOut}</span>
        </div>
      )}

      {/* Port overview */}
      <div className="grid gap-4 xl:grid-cols-2">
        {[
          { title: 'Eingehend', icon: <ArrowDownToLine className="size-4" />, list: inRules, policy: policyIn },
          { title: 'Ausgehend', icon: <ArrowUpFromLine className="size-4" />, list: outRules, policy: policyOut },
        ].map((column) => (
          <div key={column.title} className="rounded-2xl border border-line/[0.07] bg-raised/30 p-4">
            <div className="mb-3 flex items-center justify-between">
              <p className="flex items-center gap-2 text-[13px] font-medium">{column.icon} {column.title}</p>
              <span className="text-[11.5px] text-muted">Standard: <span className={cn('font-mono', column.policy === 'ACCEPT' ? 'text-ok' : 'text-bad')}>{column.policy}</span></span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {column.list.map((rule, index) => <RuleChip key={`${rule.pos}-${index}`} rule={rule} />)}
              {column.list.length === 0 && <span className="text-[12.5px] text-faint">keine Regeln, es gilt der Standard</span>}
            </div>
          </div>
        ))}
      </div>

      {/* Listening ports vs. rules */}
      {system && guest.status === 'running' && (
        <div className="rounded-2xl border border-line/[0.07] p-4">
          <p className="mb-3 text-[13px] font-medium">Offene Ports auf dem Gast <span className="font-normal text-muted">· live über {system.name}</span></p>
          {netstat.isLoading ? (
            <p className="text-[12.5px] text-muted">Lese Ports …</p>
          ) : listening.length === 0 ? (
            <p className="text-[12.5px] text-muted">Keine nach außen lauschenden Ports gefunden.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 2xl:grid-cols-3">
              {listening.map((entry) => {
                const port = entry.local.port!;
                const verdict = verdictForPort(port);
                const allowed = verdict.startsWith('ACCEPT');
                return (
                  <div key={`${entry.proto}-${port}`} className="flex items-center gap-2 rounded-xl border border-line/[0.07] px-3 py-2 text-[12.5px]">
                    <span className="font-mono">{entry.proto.toUpperCase()} {port}</span>
                    <span className="text-muted">{PORT_NAMES[port] ?? ''}</span>
                    <span className={cn('ml-auto text-[11.5px]', !effective ? 'text-faint' : allowed ? 'text-ok' : 'text-bad')}>
                      {!effective ? 'ungefiltert' : allowed ? 'erreichbar' : 'gesperrt'}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
          {!effective && listening.length > 0 && <p className="mt-2 text-[11.5px] text-faint">Solange die Firewall aus ist, sind alle diese Ports aus dem Netz erreichbar.</p>}
        </div>
      )}

      {/* Rule table */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-[13px] font-medium">Regeln ({rules.length})</p>
          <button type="button" onClick={onAdd} className="flex h-9 items-center gap-2 rounded-full bg-gradient-to-r from-accent-strong to-accent px-4 text-[13px] font-medium text-accent-ink shadow-[0_8px_24px_-10px_rgb(var(--accent)/0.9)]">
            <Plus className="size-4" /> Regel hinzufügen
          </button>
        </div>
        {firewall.isLoading ? (
          <p className="py-6 text-center text-[13px] text-muted">Lädt …</p>
        ) : firewall.isError ? (
          <p className="py-6 text-center text-[13px] text-bad">{(firewall.error as Error).message}</p>
        ) : rules.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line/[0.12] py-8 text-center text-[13px] text-muted">Noch keine Regeln für diesen Gast.</p>
        ) : (
          <ul className="space-y-1.5">
            <AnimatePresence initial={false}>
              {rules.map((rule) => {
                const service = serviceOf(rule);
                if (rule.type === 'group') {
                  const group = firewall.data?.groups?.find((entry) => entry.name === rule.action);
                  return (
                    <motion.li key={`${rule.pos}-group-${rule.action}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-3 rounded-2xl border border-line/[0.07] px-3 py-2.5', !rule.enable && 'opacity-60')}>
                      <span className="w-6 text-center font-mono text-[11px] text-faint">{rule.pos}</span>
                      <span className="flex w-24 items-center gap-1.5 text-[12px] text-muted"><Layers className="size-3.5" /> Gruppe</span>
                      <span className="w-20 rounded-full border border-line/[0.14] px-2 py-0.5 text-center text-[11px] text-muted">Rechenz.</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium">{rule.action} <span className="font-mono text-[11px] font-normal text-muted">{group ? `${group.rules.length} Regeln` : 'Gruppe nicht gefunden'}</span></span>
                        <span className="mt-1 flex flex-wrap gap-1">{group?.rules.map((inner, index) => <RuleChip key={index} rule={{ ...inner, enable: rule.enable ? inner.enable : 0 }} />)}</span>
                      </span>
                      <span className="text-[11px] text-faint" title="Sicherheitsgruppen werden im Rechenzentrum gepflegt">{rule.enable ? 'aktiv' : 'aus'}</span>
                    </motion.li>
                  );
                }
                return (
                  <motion.li key={`${rule.pos}-${rule.type}-${rule.macro ?? rule.dport}`} layout initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className={cn('flex items-center gap-3 rounded-2xl border border-line/[0.07] px-3 py-2.5', !rule.enable && 'opacity-60')}>
                    <span className="w-6 text-center font-mono text-[11px] text-faint">{rule.pos}</span>
                    <span className="flex w-24 items-center gap-1.5 text-[12px] text-muted">
                      {rule.type === 'in' ? <ArrowDownToLine className="size-3.5" /> : <ArrowUpFromLine className="size-3.5" />}
                      {rule.type === 'in' ? 'Eingehend' : rule.type === 'out' ? 'Ausgehend' : 'Gruppe'}
                    </span>
                    <span className={cn('w-20 rounded-full border px-2 py-0.5 text-center text-[11px]', ACTION_STYLE[rule.action]?.className)}>{ACTION_STYLE[rule.action]?.label ?? rule.action}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{service.title} <span className="font-mono text-[11px] font-normal text-muted">{service.detail}</span></span>
                      <span className="flex items-center gap-1.5 truncate font-mono text-[11px] text-faint">
                        {rule.type === 'in' ? where(rule.source) : guest.name} <ArrowRight className="size-3" /> {rule.type === 'in' ? guest.name : where(rule.dest)}
                        {rule.comment && <span className="font-sans text-muted">· {rule.comment}</span>}
                      </span>
                    </span>
                    <Toggle on={!!rule.enable} busy={busyPos === rule.pos} label={rule.enable ? 'Regel deaktivieren' : 'Regel aktivieren'} onChange={() => toggle.mutate(rule)} />
                    <button type="button" onClick={() => setDeleteTarget(rule)} aria-label="Regel löschen" className="flex size-8 items-center justify-center rounded-full text-muted transition-colors hover:bg-bad/10 hover:text-bad">
                      <Trash2 className="size-4" />
                    </button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        )}
      </div>

      <div>
        <p className="mb-3 text-[13px] font-medium">Konfiguration in Proxmox</p>
        <ProxmoxConfig guest={guest} data={firewall.data} />
      </div>

      <ConfirmDialog
        open={!!deleteTarget}
        title="Regel löschen?"
        description={deleteTarget ? `${ACTION_STYLE[deleteTarget.action]?.label ?? deleteTarget.action} ${serviceOf(deleteTarget).title} (${deleteTarget.type === 'in' ? 'eingehend' : 'ausgehend'}, Position ${deleteTarget.pos}) wird aus der Firewall von ${guest.name} entfernt.` : ''}
        confirmLabel="Löschen"
        tone="danger"
        icon={<Trash2 />}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          if (deleteTarget) remove.mutate(deleteTarget);
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

/* ---------- layers: Proxmox in front of the guest, then the guest's own firewall ---------- */

type Layer = 'proxmox' | 'guest';

function LayerTile({ active, onClick, eyebrow, title, detail, tone, icon }: { active: boolean; onClick: () => void; eyebrow: string; title: string; detail: string; tone: 'ok' | 'warn' | 'muted'; icon: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn('relative min-w-0 flex-1 rounded-2xl border px-4 py-3 text-left transition-colors', active ? 'border-accent/40' : 'border-line/[0.08] hover:border-line/[0.16]')}
    >
      {active && <motion.span layoutId="fw-layer" className="absolute inset-0 rounded-2xl bg-accent/[0.08]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
      <span className="relative flex items-center gap-2 text-[11px] text-muted">{icon} {eyebrow}</span>
      <span className={cn('relative mt-1 block truncate text-[14px] font-medium', tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-accent' : 'text-ink')}>{title}</span>
      <span className="relative block truncate text-[11.5px] text-faint">{detail}</span>
    </button>
  );
}

function GuestPanel({ guest, clusterOn, nodeOn, onAdd }: { guest: GuestNetwork; clusterOn: boolean; nodeOn: boolean; onAdd: () => void }) {
  const [params, setParams] = useSearchParams();
  const layer: Layer = params.get('ebene') === 'gast' ? 'guest' : 'proxmox';
  const setLayer = (next: Layer) => {
    const copy = new URLSearchParams(params);
    if (next === 'guest') copy.set('ebene', 'gast');
    else copy.delete('ebene');
    setParams(copy, { replace: true });
  };

  const firewall = useGuestFirewall(guest);
  const connections = useConnections();
  const system = systemForGuest(guest, connections.data ?? []);
  const windows = isWindowsGuest(guest.ostype);
  const running = guest.status === 'running';
  const os = useGuestOsFirewall(running && !windows ? system?.id : undefined);

  const guestOn = Number(firewall.data?.options.enable ?? 0) === 1;
  const nicFlag = guest.interfaces.every((iface) => iface.firewall);
  const pveEffective = clusterOn && guestOn && nicFlag;
  const ruleCount = expandRules(firewall.data).length;
  const pveTile = firewall.isLoading
    ? { title: 'Lädt …', detail: '', tone: 'muted' as const }
    : pveEffective
      ? { title: 'Aktiv', detail: `eingehend ${firewall.data?.options.policy_in ?? 'DROP'} · ${ruleCount} Regeln`, tone: 'ok' as const }
      : { title: 'Nicht wirksam', detail: !guestOn ? `Gast-Firewall aus · ${ruleCount} Regeln vorbereitet` : !clusterOn ? 'Rechenzentrum aus' : 'Netzwerkkarte ohne Firewall-Flag', tone: 'warn' as const };

  const verdict = os.data ? osFirewallVerdict(os.data) : null;
  const osTile = windows
    ? { title: 'Windows', detail: 'nur über RDP einsehbar', tone: 'muted' as const, icon: <ShieldQuestion className="size-3.5" /> }
    : !running
      ? { title: 'Gast aus', detail: 'nur im laufenden Betrieb lesbar', tone: 'muted' as const, icon: <ShieldQuestion className="size-3.5" /> }
      : !system
        ? { title: 'Kein SSH-Zugang', detail: 'unter Systeme einrichten', tone: 'muted' as const, icon: <ShieldQuestion className="size-3.5" /> }
        : os.isLoading
          ? { title: 'Lese …', detail: `über ${system.name}`, tone: 'muted' as const, icon: <Loader2 className="size-3.5 animate-spin" /> }
          : os.isError
            ? { title: 'Nicht lesbar', detail: (os.error as Error).message, tone: 'warn' as const, icon: <ShieldAlert className="size-3.5" /> }
            : verdict?.state === 'filtering'
              ? { title: verdict.title, detail: verdict.detail, tone: 'ok' as const, icon: <ShieldCheck className="size-3.5" /> }
              : verdict?.state === 'open'
                ? { title: 'Filtert nichts', detail: verdict.detail, tone: 'warn' as const, icon: <ShieldOff className="size-3.5" /> }
                : { title: verdict?.title ?? '–', detail: verdict?.detail ?? '', tone: 'muted' as const, icon: <ShieldQuestion className="size-3.5" /> };

  const arrow = <ChevronRight className="size-4 shrink-0 text-faint" />;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="hidden shrink-0 flex-col items-center text-[11px] text-muted sm:flex"><Globe className="mb-1 size-4" /> Netz</span>
        <span className="hidden sm:block">{arrow}</span>
        <LayerTile active={layer === 'proxmox'} onClick={() => setLayer('proxmox')} eyebrow="1 · Proxmox-Firewall" icon={<BrickWall className="size-3.5" />} {...pveTile} />
        {arrow}
        <LayerTile active={layer === 'guest'} onClick={() => setLayer('guest')} eyebrow={`2 · Firewall im ${guest.type === 'lxc' ? 'Container' : 'Gast-OS'}`} {...osTile} />
        <span className="hidden sm:block">{arrow}</span>
        <span className="hidden shrink-0 flex-col items-center text-[11px] text-muted sm:flex">{guest.type === 'lxc' ? <Container className="mb-1 size-4" /> : <Monitor className="mb-1 size-4" />} Dienste</span>
      </div>

      {layer === 'proxmox' ? (
        <GuestFirewallView guest={guest} clusterOn={clusterOn} nodeOn={nodeOn} onAdd={onAdd} />
      ) : (
        <OsFirewallView guest={guest} system={system} />
      )}
    </div>
  );
}

/* ---------- page ---------- */

export function FirewallPage() {
  const [params, setParams] = useSearchParams();
  const guests = useGuestNetworks();
  const status = useFirewallStatus();
  const [query, setQuery] = useState('');
  const [builderFor, setBuilderFor] = useState<GuestNetwork | null>(null);

  const list = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return (guests.data ?? []).filter((guest) => !needle || `${guest.name} ${guest.vmid} ${guest.ips.join(' ')}`.toLowerCase().includes(needle));
  }, [guests.data, query]);

  const selectedKey = params.get('guest');
  const selected = (guests.data ?? []).find((guest) => guestId(guest) === selectedKey) ?? list[0] ?? null;
  const clusterOn = Number(status.data?.cluster.enable ?? 0) === 1;
  const nodeOn = (node: string) => Number(status.data?.nodes.find((entry) => entry.node === node)?.enable ?? 0) === 1;
  const noFlag = (guests.data ?? []).filter((guest) => guest.interfaces.some((iface) => !iface.firewall));

  return (
    <>
      <PageHeader section="Sicherheit" title="Firewall" description="Beide Ebenen je VM und Container: die Proxmox-Firewall davor und die Firewall im Gast selbst" />

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 2xl:grid-cols-4">
        <NotchCard index={0} glow className="min-h-[140px]" tone={clusterOn ? undefined : 'warn'} eyebrow="Rechenzentrum" title="Cluster-Firewall">
          <p className={cn('mt-3 text-[34px] font-bold leading-none', clusterOn ? 'text-ok' : 'text-accent')}>{status.isLoading ? '…' : clusterOn ? 'An' : 'Aus'}</p>
          <p className="mt-2 text-[12.5px] text-muted">{clusterOn ? 'Regeln können greifen' : 'keine Regel wird angewendet'}</p>
        </NotchCard>
        <NotchCard index={1} className="min-h-[140px]" eyebrow="Nodes" title="Node-Firewall">
          <p className="mt-3 text-[34px] font-bold leading-none tracking-[-0.03em]">
            <AnimatedNumber value={(status.data?.nodes ?? []).filter((node) => node.enable === 1).length} /><span className="ml-1 text-[18px] font-medium text-muted">/ {status.data?.nodes.length ?? 0}</span>
          </p>
          <p className="mt-2 text-[12.5px] text-muted">aktiv</p>
        </NotchCard>
        <NotchCard index={2} className="min-h-[140px]" eyebrow="Gäste" title="Ohne Firewall-Flag">
          <p className={cn('mt-3 text-[34px] font-bold leading-none tracking-[-0.03em]', noFlag.length ? 'text-accent' : 'text-ok')}><AnimatedNumber value={noFlag.length} /></p>
          <p className="mt-2 truncate text-[12.5px] text-muted">{noFlag.length ? noFlag.map((guest) => guest.name).join(', ') : 'alle Netzwerkkarten erfasst'}</p>
        </NotchCard>
        <NotchCard index={3} className="min-h-[140px]" eyebrow="Hinweis" title="Wirksamkeit">
          <p className="mt-3 flex items-start gap-2 text-[12.5px] text-muted">
            {clusterOn ? <ShieldCheck className="mt-0.5 size-4 shrink-0 text-ok" /> : <ShieldAlert className="mt-0.5 size-4 shrink-0 text-accent" />}
            {clusterOn ? 'Regeln wirken, wo auch Gast-Firewall und Netzwerkkarten-Flag an sind.' : 'Regeln lassen sich vorbereiten; wirksam werden sie erst, wenn die Firewall im Rechenzentrum und am Gast eingeschaltet ist.'}
          </p>
        </NotchCard>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
        <NotchCard index={4} eyebrow="Proxmox" title="VMs & Container" bodyClassName="pt-3">
          <label className="flex h-10 items-center gap-2.5 rounded-full border border-line/[0.10] bg-raised/50 px-4 focus-within:border-accent/40">
            <Search className="size-4 text-muted" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name, VMID, IP …" className="h-full flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
          </label>
          <ul className="scroll-thin -mx-2 mt-3 max-h-[640px] space-y-0.5 overflow-y-auto px-2">
            {list.map((guest) => {
              const active = selected && guestId(selected) === guestId(guest);
              const missingFlag = guest.interfaces.some((iface) => !iface.firewall);
              return (
                <li key={guestId(guest)}>
                  <button
                    type="button"
                    onClick={() => setParams((current) => {
                      const next = new URLSearchParams(current);
                      next.set('guest', guestId(guest));
                      return next;
                    })}
                    className={cn('relative flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors', active ? 'text-ink' : 'hover:bg-hover/60')}
                  >
                    {active && <motion.span layoutId="fw-guest" className="absolute inset-0 rounded-xl border border-accent/25 bg-accent/[0.10]" transition={{ type: 'spring', stiffness: 450, damping: 38 }} />}
                    <span className={cn('relative size-2 rounded-full', guest.status === 'running' ? 'bg-ok' : 'bg-faint')} />
                    {guest.type === 'lxc' ? <Container className="relative size-3.5 text-muted" /> : <Monitor className="relative size-3.5 text-muted" />}
                    <span className="relative min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{guest.name}</span>
                      <span className="block truncate font-mono text-[10.5px] text-faint">{guest.vmid} · {guest.ips[0] ?? guest.node}</span>
                    </span>
                    {missingFlag && <span className="relative size-1.5 rounded-full bg-bad" title="Netzwerkkarte ohne Firewall-Flag" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </NotchCard>

        <NotchCard
          index={5}
          eyebrow={selected ? `${selected.type === 'lxc' ? 'Container' : 'VM'} ${selected.vmid} · ${selected.node}` : 'Firewall'}
          title={selected?.name ?? 'Kein Gast gewählt'}
          bodyClassName="pt-4"
          actions={selected ? [{ label: 'Regel hinzufügen', icon: <Plus />, onClick: () => setBuilderFor(selected) }] : []}
        >
          {guests.isLoading ? (
            <p className="flex items-center justify-center py-16 text-muted"><Loader2 className="mr-2 size-4 animate-spin" /> Lädt …</p>
          ) : selected ? (
            <GuestPanel key={guestId(selected)} guest={selected} clusterOn={clusterOn} nodeOn={nodeOn(selected.node)} onAdd={() => setBuilderFor(selected)} />
          ) : (
            <p className="py-16 text-center text-muted"><BrickWall className="mx-auto mb-2 size-6" /> Gast auswählen</p>
          )}
        </NotchCard>
      </div>

      <Drawer open={!!builderFor} onClose={() => setBuilderFor(null)} label="Firewall-Regel" width={560}>
        {builderFor && <RuleBuilder key={guestId(builderFor)} guest={builderFor} onDone={() => setBuilderFor(null)} />}
      </Drawer>
    </>
  );
}

