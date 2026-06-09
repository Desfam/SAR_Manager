export const TAB_PERMISSION_GROUPS = [
  {
    id: 'core',
    label: 'Core',
    permissions: [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'inventory', label: 'Inventory' },
      { id: 'jobs', label: 'Jobs' },
      { id: 'alerts', label: 'Alerts' },
    ],
  },
  {
    id: 'hosts',
    label: 'Hosts & Connections',
    permissions: [
      { id: 'hosts', label: 'Hosts' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'files', label: 'File Browser' },
    ],
  },
  {
    id: 'operations',
    label: 'Operations',
    permissions: [
      { id: 'scripts', label: 'Scripts' },
      { id: 'tasks', label: 'Tasks' },
      { id: 'diagnostics', label: 'Diagnostics' },
      { id: 'tunnels', label: 'Port Forwarding' },
    ],
  },
  {
    id: 'infrastructure',
    label: 'Infrastructure',
    permissions: [
      { id: 'docker', label: 'Docker' },
      { id: 'proxmox', label: 'Proxmox' },
      { id: 'monitor', label: 'System Monitor' },
      { id: 'comparison', label: 'System Comparison' },
      { id: 'topology', label: 'Network Topology' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents',
    permissions: [{ id: 'agents', label: 'Agents' }],
  },
  {
    id: 'security',
    label: 'Security',
    permissions: [
      { id: 'security', label: 'Security' },
      { id: 'logs', label: 'Audit Logs' },
    ],
  },
  {
    id: 'admin',
    label: 'Admin',
    permissions: [
      { id: 'users', label: 'Users' },
      { id: 'settings', label: 'Settings' },
    ],
  },
] as const;

export const ALL_TAB_PERMISSIONS = TAB_PERMISSION_GROUPS.flatMap((group) =>
  group.permissions.map((permission) => permission.id)
);

export type TabPermission = (typeof ALL_TAB_PERMISSIONS)[number];

export function normalizeTabPermissions(input: unknown): TabPermission[] {
  const values = Array.isArray(input) ? input : [];
  return Array.from(new Set(values.filter((value): value is TabPermission => typeof value === 'string' && ALL_TAB_PERMISSIONS.includes(value as TabPermission))));
}