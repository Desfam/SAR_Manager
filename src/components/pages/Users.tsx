import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { usersAPI, AppUser } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { ALL_TAB_PERMISSIONS, TAB_PERMISSION_GROUPS, TabPermission, normalizeTabPermissions } from '@/lib/tab-permissions';

const DEFAULT_ROLE_PERMISSIONS: Record<'admin' | 'user' | 'readonly', TabPermission[]> = {
  admin: [...ALL_TAB_PERMISSIONS],
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

function getDefaultPermissionsForRole(role: 'admin' | 'user' | 'readonly'): TabPermission[] {
  return [...DEFAULT_ROLE_PERMISSIONS[role]];
}

export const Users: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user' | 'readonly',
    permissions: getDefaultPermissionsForRole('user'),
  });
  const [savingUserId, setSavingUserId] = useState<string | null>(null);
  const { toast } = useToast();

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await usersAPI.list();
      setUsers(data.map((user) => ({ ...user, permissions: normalizeTabPermissions(user.permissions) })));
    } catch (error: any) {
      toast({
        title: 'Failed to load users',
        description: error.message || 'Access denied or server error',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setCreating(true);

    try {
      await usersAPI.create(newUser);
      toast({ title: 'User created' });
      setNewUser({ username: '', email: '', password: '', role: 'user', permissions: getDefaultPermissionsForRole('user') });
      await loadUsers();
    } catch (error: any) {
      toast({
        title: 'Create failed',
        description: error.message || 'Unable to create user',
        variant: 'destructive',
      });
    } finally {
      setCreating(false);
    }
  };

  const updateRole = async (user: AppUser, role: 'admin' | 'user' | 'readonly') => {
    try {
      await usersAPI.update(user.id, { role });
      toast({ title: 'Role updated' });
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Role update failed', description: error.message, variant: 'destructive' });
    }
  };

  const toggleActive = async (user: AppUser) => {
    try {
      await usersAPI.update(user.id, { isActive: user.is_active !== 1 });
      toast({ title: user.is_active === 1 ? 'User disabled' : 'User enabled' });
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Update failed', description: error.message, variant: 'destructive' });
    }
  };

  const deleteUser = async (user: AppUser) => {
    if (!confirm(`Delete user ${user.username}?`)) return;

    try {
      await usersAPI.delete(user.id);
      toast({ title: 'User deleted' });
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Delete failed', description: error.message, variant: 'destructive' });
    }
  };

  const toggleNewUserPermission = (permission: TabPermission, checked: boolean) => {
    setNewUser((current) => ({
      ...current,
      permissions: checked
        ? normalizeTabPermissions([...current.permissions, permission])
        : current.permissions.filter((value) => value !== permission),
    }));
  };

  const toggleExistingPermission = (userId: string, permission: TabPermission, checked: boolean) => {
    setUsers((current) =>
      current.map((user) =>
        user.id === userId
          ? {
              ...user,
              permissions: checked
                ? normalizeTabPermissions([...(user.permissions || []), permission])
                : (user.permissions || []).filter((value) => value !== permission),
            }
          : user
      )
    );
  };

  const savePermissions = async (user: AppUser) => {
    setSavingUserId(user.id);
    try {
      await usersAPI.update(user.id, { permissions: normalizeTabPermissions(user.permissions) });
      toast({ title: 'Permissions updated' });
      await loadUsers();
    } catch (error: any) {
      toast({ title: 'Permission update failed', description: error.message, variant: 'destructive' });
    } finally {
      setSavingUserId(null);
    }
  };

  const resetPermissionsForRole = (userId: string, role: 'admin' | 'user' | 'readonly') => {
    setUsers((current) =>
      current.map((user) => (user.id === userId ? { ...user, permissions: getDefaultPermissionsForRole(role) } : user))
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">User Management</h1>
          <p className="text-muted-foreground">Create and manage dashboard users and roles</p>
        </div>
        <Button variant="outline" onClick={loadUsers} disabled={loading}>
          Refresh
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create User</CardTitle>
          <CardDescription>Password must be at least 12 characters</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid grid-cols-1 md:grid-cols-5 gap-4" onSubmit={handleCreateUser}>
            <div className="space-y-2">
              <Label>Username</Label>
              <Input value={newUser.username} onChange={(e) => setNewUser({ ...newUser, username: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} required />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newUser.role} onValueChange={(value: 'admin' | 'user' | 'readonly') => setNewUser({ ...newUser, role: value, permissions: getDefaultPermissionsForRole(value) })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">admin</SelectItem>
                  <SelectItem value="user">user</SelectItem>
                  <SelectItem value="readonly">readonly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={creating}>
                {creating ? 'Creating...' : 'Create'}
              </Button>
            </div>
          </form>

          <div className="mt-6 space-y-4">
            <div>
              <Label>Tab permissions</Label>
              <p className="text-sm text-muted-foreground">Choose which tabs this user can see and open.</p>
            </div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {TAB_PERMISSION_GROUPS.map((group) => (
                <Card key={group.id} className="border-border/60">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">{group.label}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {group.permissions.map((permission) => (
                      <label key={permission.id} className="flex items-center gap-3 text-sm">
                        <Checkbox
                          checked={newUser.permissions.includes(permission.id)}
                          onCheckedChange={(checked) => toggleNewUserPermission(permission.id, checked === true)}
                        />
                        <span>{permission.label}</span>
                      </label>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {users.map((user) => (
          <Card key={user.id}>
            <CardHeader>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                <div>
                  <CardTitle>{user.username}</CardTitle>
                  <CardDescription>{user.email}</CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={user.is_active === 1 ? 'default' : 'secondary'}>
                    {user.is_active === 1 ? 'active' : 'disabled'}
                  </Badge>
                  <Badge variant="outline">{user.permissions?.length || 0} tabs</Badge>
                  <span className="text-sm text-muted-foreground">
                    Last login: {user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-2">
                  <Label>Role</Label>
                  <Select
                    value={user.role}
                    onValueChange={(value: 'admin' | 'user' | 'readonly') => updateRole(user, value)}
                  >
                    <SelectTrigger className="w-40">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="admin">admin</SelectItem>
                      <SelectItem value="user">user</SelectItem>
                      <SelectItem value="readonly">readonly</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="outline" onClick={() => resetPermissionsForRole(user.id, user.role)}>
                    Reset to role defaults
                  </Button>
                  <Button size="sm" onClick={() => savePermissions(user)} disabled={savingUserId === user.id}>
                    {savingUserId === user.id ? 'Saving...' : 'Save permissions'}
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => toggleActive(user)}>
                    {user.is_active === 1 ? 'Disable' : 'Enable'}
                  </Button>
                  <Button size="sm" variant="destructive" onClick={() => deleteUser(user)}>
                    Delete
                  </Button>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {TAB_PERMISSION_GROUPS.map((group) => (
                  <Card key={group.id} className="border-border/60">
                    <CardHeader className="pb-3">
                      <CardTitle className="text-base">{group.label}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {group.permissions.map((permission) => (
                        <label key={permission.id} className="flex items-center gap-3 text-sm">
                          <Checkbox
                            checked={(user.permissions || []).includes(permission.id)}
                            onCheckedChange={(checked) => toggleExistingPermission(user.id, permission.id, checked === true)}
                          />
                          <span>{permission.label}</span>
                        </label>
                      ))}
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};
