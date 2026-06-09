import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { authAPI, getAuthToken, isSessionSignedOut, setSessionSignedOut } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

const Login: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [showBootstrap, setShowBootstrap] = useState(false);
  const [bootstrapForm, setBootstrapForm] = useState({ username: '', email: '', password: '' });
  const [authEnabled, setAuthEnabled] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const check = async () => {
      try {
        const status = await authAPI.status();
        setAuthEnabled(status.enabled);
        if (!status.enabled) {
          if (isSessionSignedOut()) {
            return;
          }
          navigate('/');
          return;
        }

        if (getAuthToken()) {
          const me = await authAPI.me().catch(() => null);
          if (me?.user) {
            navigate('/');
          }
        }
      } catch {
        // Ignore during initial load
      }
    };

    check();
  }, [navigate]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);

    try {
      await authAPI.login(username.trim(), password);
      toast({ title: 'Welcome back', description: 'Login successful' });
      navigate('/');
    } catch (error: any) {
      toast({
        title: 'Login failed',
        description: error.message || 'Invalid credentials',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEnterApp = () => {
    setSessionSignedOut(false);
    navigate('/');
  };

  const handleBootstrap = async (event: React.FormEvent) => {
    event.preventDefault();
    setBootstrapping(true);

    try {
      await authAPI.bootstrapAdmin(bootstrapForm);
      toast({ title: 'Admin created', description: 'You can now log in with this account' });
      setShowBootstrap(false);
      setUsername(bootstrapForm.username);
      setPassword('');
      setBootstrapForm({ username: '', email: '', password: '' });
    } catch (error: any) {
      toast({
        title: 'Bootstrap failed',
        description: error.message || 'Could not create admin user',
        variant: 'destructive',
      });
    } finally {
      setBootstrapping(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black flex items-center justify-center p-4">
      <div className="login-bg-blob login-bg-blob-1" />
      <div className="login-bg-blob login-bg-blob-2" />
      <div className="login-bg-blob login-bg-blob-3" />
      <div className="login-bg-grid" />

      <Card className="relative w-full max-w-md border-border/60 bg-card/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Server Manager Login</CardTitle>
          <CardDescription>
            {authEnabled ? 'Sign in to continue' : 'Authentication is disabled on the server for testing'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {authEnabled ? (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="admin"
                  autoComplete="username"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Backend authentication is currently disabled. Use the button below to re-enter the dashboard for this browser session.
              </p>
              <Button className="w-full" onClick={handleEnterApp}>
                Open dashboard
              </Button>
            </div>
          )}

          <div className="mt-6 border-t border-border pt-4">
            <Button variant="ghost" className="w-full" onClick={() => setShowBootstrap((prev) => !prev)}>
              {showBootstrap ? 'Hide first-admin setup' : 'Create first admin'}
            </Button>

            {showBootstrap && authEnabled && (
              <form className="space-y-3 mt-3" onSubmit={handleBootstrap}>
                <Input
                  placeholder="Admin username"
                  value={bootstrapForm.username}
                  onChange={(event) => setBootstrapForm({ ...bootstrapForm, username: event.target.value })}
                  required
                />
                <Input
                  placeholder="Admin email"
                  type="email"
                  value={bootstrapForm.email}
                  onChange={(event) => setBootstrapForm({ ...bootstrapForm, email: event.target.value })}
                  required
                />
                <Input
                  placeholder="Admin password (12+ chars)"
                  type="password"
                  value={bootstrapForm.password}
                  onChange={(event) => setBootstrapForm({ ...bootstrapForm, password: event.target.value })}
                  required
                />
                <Button type="submit" className="w-full" variant="outline" disabled={bootstrapping}>
                  {bootstrapping ? 'Creating...' : 'Create admin account'}
                </Button>
              </form>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;
