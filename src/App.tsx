import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Routes, Route } from "react-router-dom";
import { useEffect, useState } from "react";
import Index from "./pages/Index";
import NotFound from "./pages/NotFound";
import Login from "./pages/Login";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";
import {
  authAPI,
  clearAuthToken,
  getAuthToken,
  getAutoLockEnabled,
  getLastSessionActivity,
  getStoredAuthUser,
  isSessionLocked,
  isSessionSignedOut,
  setSessionLocked,
  setSessionSignedOut,
  touchSessionActivity,
} from "./services/api";

const queryClient = new QueryClient();
const AUTO_LOCK_TIMEOUT_MS = 15 * 60 * 1000;

const LockScreen = ({
  authEnabled,
  onUnlocked,
}: {
  authEnabled: boolean;
  onUnlocked: () => void;
}) => {
  const [password, setPassword] = useState("");
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState("");
  const user = getStoredAuthUser();

  const handleUnlock = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!authEnabled) {
      setSessionLocked(false);
      setSessionSignedOut(false);
      touchSessionActivity();
      onUnlocked();
      return;
    }

    if (!user?.username) {
      setError("No user is available to unlock this session. Sign in again.");
      return;
    }

    setUnlocking(true);
    setError("");

    try {
      await authAPI.login(user.username, password);
      setPassword("");
      onUnlocked();
    } catch (unlockError: any) {
      setError(unlockError.message || "Unlock failed");
    } finally {
      setUnlocking(false);
    }
  };

  const handleSignInAgain = () => {
    clearAuthToken();
    setSessionLocked(false);
    setSessionSignedOut(true);
    window.location.assign('/login');
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-black flex items-center justify-center p-4">
      <div className="login-bg-blob login-bg-blob-1" />
      <div className="login-bg-blob login-bg-blob-2" />
      <div className="login-bg-blob login-bg-blob-3" />
      <div className="login-bg-grid" />

      <Card className="relative w-full max-w-md border-border/60 bg-card/90 backdrop-blur-sm">
        <CardHeader>
          <CardTitle>Session Locked</CardTitle>
          <CardDescription>
            {authEnabled
              ? `Unlock to continue as ${user?.email || user?.username || 'current user'}`
              : 'Authentication is disabled on the server. Unlock this browser session to continue.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleUnlock} className="space-y-4">
            {authEnabled ? (
              <div className="space-y-2">
                <Label htmlFor="unlock-password">Password</Label>
                <Input
                  id="unlock-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>
            ) : null}

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" className="w-full" disabled={unlocking}>
              {unlocking ? 'Unlocking...' : authEnabled ? 'Unlock session' : 'Unlock'}
            </Button>
          </form>

          <Button variant="ghost" className="w-full mt-4" onClick={handleSignInAgain}>
            Sign in again
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

const ProtectedApp = () => {
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const authStatus = await authAPI.status();
        setAuthEnabled(authStatus.enabled);
        setLocked(isSessionLocked());

        if (isSessionSignedOut()) {
          setAuthenticated(false);
          return;
        }

        if (!authStatus.enabled) {
          setAuthenticated(true);
          return;
        }

        const token = getAuthToken();
        if (!token) {
          setAuthenticated(false);
          return;
        }

        const me = await authAPI.me();
        setAuthenticated(Boolean(me.user));
      } catch {
        clearAuthToken();
        setAuthenticated(false);
      } finally {
        setLoading(false);
      }
    };

    checkAuth();

    const handleSessionChange = () => {
      checkAuth();
    };

    window.addEventListener('auth-session-changed', handleSessionChange);
    window.addEventListener('storage', handleSessionChange);

    return () => {
      window.removeEventListener('auth-session-changed', handleSessionChange);
      window.removeEventListener('storage', handleSessionChange);
    };
  }, []);

  useEffect(() => {
    if (!authenticated || locked || !getAutoLockEnabled()) {
      return;
    }

    touchSessionActivity();

    const handleActivity = () => {
      touchSessionActivity();
    };

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'focus'];
    for (const eventName of events) {
      window.addEventListener(eventName, handleActivity, { passive: true });
    }

    const interval = window.setInterval(() => {
      if (Date.now() - getLastSessionActivity() >= AUTO_LOCK_TIMEOUT_MS) {
        setSessionLocked(true);
        setLocked(true);
      }
    }, 10000);

    return () => {
      for (const eventName of events) {
        window.removeEventListener(eventName, handleActivity);
      }
      window.clearInterval(interval);
    };
  }, [authenticated, locked]);

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center">Loading...</div>;
  }

  if (!authenticated) {
    return <Navigate to="/login" replace />;
  }

  if (locked) {
    return <LockScreen authEnabled={authEnabled} onUnlocked={() => setLocked(false)} />;
  }

  return <Index />;
};

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<ProtectedApp />} />
          <Route path="/login" element={<Login />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
