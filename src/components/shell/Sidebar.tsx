import { AnimatePresence, motion } from 'motion/react';
import { findPage, navigationFor, workspaceOf } from '@/lib/navigation';
import { cn } from '@/lib/utils';
import { useAgents, useBackendHealth, useConnections, useDockerContainers } from '@/hooks/use-infrastructure';
import { useWazuhStatus } from '@/hooks/use-wazuh';
import { useSocFleet } from '@/hooks/use-soc';

interface SidebarProps {
  pathname: string;
  collapsed: boolean;
  onNavigate: (path: string) => void;
}

function StatusRow({ label, value, tone }: { label: string; value: string; tone: 'ok' | 'warn' | 'bad' | 'none' }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span className="flex items-center gap-2 text-muted">
        <span className={cn('size-1.5 rounded-full', { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', none: 'bg-faint' }[tone])} />
        {label}
      </span>
      <span className="font-mono tabular text-ink/90">{value}</span>
    </div>
  );
}

function StatusBlock() {
  const health = useBackendHealth();
  const connections = useConnections();
  const agents = useAgents();
  const docker = useDockerContainers();
  const hosts = connections.data ?? [];
  const online = hosts.filter((host) => host.status === 'online').length;
  const agentList = agents.data ?? [];
  const agentsOnline = agentList.filter((agent) => agent.status === 'online').length;
  const containers = docker.data ?? [];
  const running = containers.filter((container) => container.status === 'running').length;

  return (
    <div className="mx-3 mb-3 space-y-2 rounded-2xl border border-line/[0.07] bg-raised/50 p-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Status</p>
      <StatusRow label="Backend" value={health.data?.ok ? `${health.data.latencyMs} ms` : 'offline'} tone={health.data?.ok ? 'ok' : 'bad'} />
      <StatusRow label="Systeme" value={connections.data ? `${online} / ${hosts.length}` : '–'} tone={!connections.data ? 'none' : online < hosts.length ? 'warn' : 'ok'} />
      <StatusRow label="Agents" value={agents.data ? `${agentsOnline} / ${agentList.length}` : '–'} tone={!agents.data ? 'none' : agentsOnline < agentList.length ? 'warn' : 'ok'} />
      <StatusRow label="Container" value={docker.data ? `${running} / ${containers.length}` : '–'} tone={!docker.data ? 'none' : running < containers.length ? 'warn' : 'ok'} />
    </div>
  );
}

/** Status of the Wazuh stack, shown instead of the SAR status in the Wazuh workspace */
function WazuhStatusBlock() {
  const status = useWazuhStatus();
  const fleet = useSocFleet();
  const connection = fleet.data?.connection;
  return (
    <div className="mx-3 mb-3 space-y-2 rounded-2xl border border-line/[0.07] bg-raised/50 p-3.5">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">Wazuh</p>
      <StatusRow label="Indexer" value={status.data?.configured ? `${status.data.latencyMs} ms` : status.isError ? 'Fehler' : '–'} tone={status.data?.configured ? 'ok' : status.isError ? 'bad' : 'none'} />
      <StatusRow label="Manager" value={fleet.data ? fleet.data.version ?? 'ok' : fleet.isError ? 'Fehler' : '–'} tone={fleet.data ? 'ok' : fleet.isError ? 'bad' : 'none'} />
      <StatusRow label="Agents aktiv" value={connection ? `${connection.active} / ${connection.total}` : '–'} tone={!connection ? 'none' : connection.disconnected ? 'warn' : 'ok'} />
    </div>
  );
}

export function Sidebar({ pathname, collapsed, onNavigate }: SidebarProps) {
  const active = findPage(pathname);
  const workspace = workspaceOf(pathname);

  return (
    <motion.aside
      initial={false}
      animate={{ width: collapsed ? 76 : 236 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="panel-surface mb-3 ml-3 mt-3 flex shrink-0 flex-col overflow-hidden rounded-panel"
    >
      <nav aria-label="Hauptnavigation" className="scroll-thin flex-1 overflow-y-auto overflow-x-hidden px-3 py-4">
        <AnimatePresence mode="wait" initial={false}>
        <motion.div key={workspace} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.22 }}>
        {navigationFor(workspace).map((section) => (
          <div key={section.label} className="mb-4 last:mb-0">
            <AnimatePresence initial={false}>
              {!collapsed && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mb-1.5 whitespace-nowrap px-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint"
                >
                  {section.label}
                </motion.p>
              )}
            </AnimatePresence>
            <div className="space-y-1">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = active?.path === item.path;
                return (
                  <button
                    key={item.path}
                    type="button"
                    onClick={() => onNavigate(item.path)}
                    aria-current={isActive ? 'page' : undefined}
                    title={collapsed ? item.label : undefined}
                    className={cn(
                      'group relative flex h-[42px] w-full items-center gap-3 rounded-[14px] px-3 text-[13.5px] transition-colors duration-200',
                      isActive ? 'text-accent' : 'text-ink/80 hover:text-ink',
                    )}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-[14px] border border-accent/20 bg-gradient-to-r from-accent/[0.16] via-accent/[0.07] to-transparent"
                        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                      />
                    )}
                    {!isActive && <span className="absolute inset-0 rounded-[14px] bg-hover opacity-0 transition-opacity duration-200 group-hover:opacity-60" />}
                    <Icon className={cn('relative size-[18px] shrink-0 transition-transform duration-200 group-hover:scale-110', isActive ? 'text-accent' : 'text-muted group-hover:text-ink')} />
                    <AnimatePresence initial={false}>
                      {!collapsed && (
                        <motion.span initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -4 }} className="relative truncate">
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {item.soon && !collapsed && <span className="relative ml-auto rounded-full border border-line/[0.10] px-1.5 text-[9.5px] uppercase tracking-[0.08em] text-faint">bald</span>}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        </motion.div>
        </AnimatePresence>
      </nav>
      {!collapsed && (workspace === 'wazuh' ? <WazuhStatusBlock /> : <StatusBlock />)}
    </motion.aside>
  );
}
