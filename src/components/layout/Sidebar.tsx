import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  LayoutDashboard,
  Server,
  Activity,
  Network,
  Shield,
  Container,
  FileCode,
  Settings,
  History,
  Globe,
  Terminal,
  MonitorUp,
  ChevronLeft,
  ChevronRight,
  BarChart3,
  Map,
  Cpu,
  ClipboardList,
  ChevronDown,
  Users,
  Boxes,
  Bot,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SidebarProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  backendHealthy: boolean;
  agentsOnlineCount: number;
  agentsTotalCount: number;
  activeAlertsCount: number;
}

const menuGroups = [
  {
    id: 'core',
    label: 'Core',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { id: 'inventory', label: 'Inventory', icon: Boxes },
      { id: 'jobs', label: 'Jobs', icon: ClipboardList },
      { id: 'alerts', label: 'Alerts', icon: Shield },
    ],
  },
  {
    id: 'hosts',
    label: 'Hosts & Connections',
    items: [
      { id: 'hosts', label: 'Hosts', icon: Server },
      { id: 'terminal', label: 'Terminal', icon: Terminal },
      { id: 'files', label: 'File Browser', icon: MonitorUp },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    items: [
      { id: 'scripts', label: 'Scripts', icon: FileCode },
      { id: 'tasks', label: 'Tasks', icon: ClipboardList },
      { id: 'diagnostics', label: 'Diagnostics', icon: Network },
      { id: 'tunnels', label: 'Port Forwarding', icon: Globe },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    items: [
      { id: 'docker', label: 'Docker', icon: Container },
      { id: 'proxmox', label: 'Proxmox', icon: Server },
      { id: 'monitor', label: 'System Monitor', icon: Activity },
      { id: 'comparison', label: 'System Comparison', icon: BarChart3 },
      { id: 'topology', label: 'Network Topology', icon: Map },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    items: [
      { id: 'agents', label: 'Agents', icon: Bot },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    items: [
      { id: 'security', label: 'Security', icon: Shield },
      { id: 'logs', label: 'Audit Logs', icon: History },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    items: [
      { id: 'users', label: 'Users', icon: Users },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  onTabChange,
  collapsed,
  onToggleCollapse,
  backendHealthy,
  agentsOnlineCount,
  agentsTotalCount,
  activeAlertsCount,
}) => {
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    core: true,
    hosts: true,
    operations: true,
    infrastructure: true,
    agents: true,
    security: true,
    admin: true,
  });

  const toggleGroup = (groupId: string) => {
    setOpenGroups((prev) => ({ ...prev, [groupId]: !prev[groupId] }));
  };

  return (
    <aside
      className={cn(
        'h-screen bg-sidebar border-r border-sidebar-border flex flex-col transition-all duration-300',
        collapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Logo */}
      <div className="h-16 flex items-center justify-between px-4 border-b border-sidebar-border">
        {!collapsed && (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-primary">
              <Terminal className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-sm text-sidebar-accent-foreground">SSH & RDP</span>
              <span className="text-xs text-sidebar-foreground">Manager Pro</span>
            </div>
          </div>
        )}
        {collapsed && (
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center glow-primary mx-auto">
            <Terminal className="w-5 h-5 text-primary-foreground" />
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-2 space-y-1 overflow-y-auto scrollbar-thin">
        {menuGroups.map((group) => {
          const isOpen = openGroups[group.id];

          return (
            <div key={group.id} className="space-y-1">
              {!collapsed && (
                <button
                  onClick={() => toggleGroup(group.id)}
                  className="w-full flex items-center justify-between px-2 py-1 text-xs font-semibold uppercase tracking-wide text-sidebar-foreground/70 hover:text-sidebar-foreground"
                >
                  <span>{group.label}</span>
                  <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', !isOpen && '-rotate-90')} />
                </button>
              )}

              {(collapsed || isOpen) &&
                group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => onTabChange(item.id)}
                      className={cn(
                        'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200',
                        'hover:bg-sidebar-accent group',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-primary'
                          : 'text-sidebar-foreground'
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-5 h-5 flex-shrink-0 transition-colors',
                          isActive
                            ? 'text-sidebar-primary'
                            : 'text-sidebar-foreground group-hover:text-sidebar-accent-foreground'
                        )}
                      />
                      {!collapsed && (
                        <span
                          className={cn(
                            'text-sm font-medium transition-colors',
                            isActive ? 'text-sidebar-primary' : 'group-hover:text-sidebar-accent-foreground'
                          )}
                        >
                          {item.label}
                        </span>
                      )}
                    </button>
                  );
                })}
            </div>
          );
        })}
      </nav>

      {!collapsed && (
        <div className="px-3 pb-3 border-t border-sidebar-border pt-3 space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-sidebar-foreground/70">
            Health
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-sidebar-foreground/80">Backend</span>
              <Badge variant={backendHealthy ? 'default' : 'destructive'} className="h-5 px-2">
                {backendHealthy ? 'Online' : 'Offline'}
              </Badge>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-sidebar-foreground/80">Agents</span>
              <Badge variant="secondary" className="h-5 px-2">
                {agentsOnlineCount}/{agentsTotalCount}
              </Badge>
            </div>
            <button
              type="button"
              onClick={() => onTabChange('alerts')}
              className="w-full flex items-center justify-between text-xs rounded px-1 py-1 hover:bg-sidebar-accent"
            >
              <span className="text-sidebar-foreground/80">Alerts</span>
              <Badge variant={activeAlertsCount > 0 ? 'destructive' : 'secondary'} className="h-5 px-2">
                {activeAlertsCount}
              </Badge>
            </button>
          </div>
        </div>
      )}

      {/* Collapse Toggle */}
      <div className="p-2 border-t border-sidebar-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-center text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
          onClick={onToggleCollapse}
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span className="ml-2 text-sm">Collapse</span>
            </>
          )}
        </Button>
      </div>
    </aside>
  );
};
