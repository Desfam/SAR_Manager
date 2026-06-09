import type { UserRole } from '../middleware/auth.js';

export const TAB_PERMISSIONS = [
  'dashboard',
  'inventory',
  'jobs',
  'alerts',
  'hosts',
  'terminal',
  'files',
  'scripts',
  'tasks',
  'diagnostics',
  'tunnels',
  'docker',
  'proxmox',
  'monitor',
  'comparison',
  'topology',
  'agents',
  'security',
  'logs',
  'users',
  'settings',
] as const;

export type TabPermission = (typeof TAB_PERMISSIONS)[number];

const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, TabPermission[]> = {
  admin: [...TAB_PERMISSIONS],
  user: [
    'dashboard',
    'inventory',
    'jobs',
    'alerts',
    'hosts',
    'terminal',
    'files',
    'scripts',
    'tasks',
    'diagnostics',
    'tunnels',
    'docker',
    'proxmox',
    'monitor',
    'comparison',
    'topology',
    'agents',
    'security',
    'logs',
  ],
  readonly: [
    'dashboard',
    'inventory',
    'jobs',
    'alerts',
    'hosts',
    'terminal',
    'files',
    'diagnostics',
    'monitor',
    'comparison',
    'topology',
    'agents',
    'security',
    'logs',
  ],
};

export function getDefaultPermissionsForRole(role: UserRole): TabPermission[] {
  return [...DEFAULT_ROLE_PERMISSIONS[role]];
}

export function normalizePermissions(input: unknown, role: UserRole): TabPermission[] {
  const rawPermissions = Array.isArray(input) ? input : [];
  const normalized = rawPermissions.filter(
    (permission): permission is TabPermission => typeof permission === 'string' && TAB_PERMISSIONS.includes(permission as TabPermission)
  );

  if (normalized.length === 0) {
    return getDefaultPermissionsForRole(role);
  }

  return Array.from(new Set(normalized));
}

export function parseStoredPermissions(raw: unknown, role: UserRole): TabPermission[] {
  if (Array.isArray(raw)) {
    return normalizePermissions(raw, role);
  }

  if (typeof raw !== 'string' || raw.trim() === '') {
    return getDefaultPermissionsForRole(role);
  }

  try {
    return normalizePermissions(JSON.parse(raw), role);
  } catch {
    return getDefaultPermissionsForRole(role);
  }
}