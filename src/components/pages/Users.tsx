import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { usersAPI, AppUser } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

export const Users: React.FC = () => {
  const [users, setUsers] = useState<AppUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({
    username: '',
    email: '',
    password: '',
    role: 'user' as 'admin' | 'user' | 'readonly',
  });
  const { toast } = useToast();

  const loadUsers = async () => {
    setLoading(true);
    try {
      const data = await usersAPI.list();
      setUsers(data);
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
      setNewUser({ username: '', email: '', password: '', role: 'user' });
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
              <Select value={newUser.role} onValueChange={(value: 'admin' | 'user' | 'readonly') => setNewUser({ ...newUser, role: value })}>
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
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Users</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Username</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.username}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Select
                      value={user.role}
                      onValueChange={(value: 'admin' | 'user' | 'readonly') => updateRole(user, value)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">admin</SelectItem>
                        <SelectItem value="user">user</SelectItem>
                        <SelectItem value="readonly">readonly</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge variant={user.is_active === 1 ? 'default' : 'secondary'}>
                      {user.is_active === 1 ? 'active' : 'disabled'}
                    </Badge>
                  </TableCell>
                  <TableCell>{user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</TableCell>
                  <TableCell className="text-right space-x-2">
                    <Button size="sm" variant="outline" onClick={() => toggleActive(user)}>
                      {user.is_active === 1 ? 'Disable' : 'Enable'}
                    </Button>
                    <Button size="sm" variant="destructive" onClick={() => deleteUser(user)}>
                      Delete
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
};
