import React, { useState, useEffect } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dashboard } from '@/components/pages/Dashboard';
import { Connections } from '@/components/pages/Connections';
import { Inventory } from '@/components/pages/Inventory';
import { Jobs } from '@/components/pages/Jobs';
import { SystemMonitorReal } from '@/components/pages/SystemMonitorReal';
import { ComparisonDashboard } from '@/components/pages/ComparisonDashboard';
import { AlertManagement } from '@/components/pages/AlertManagement';
import { Diagnostics } from '@/components/pages/Diagnostics';
import { Security } from '@/components/pages/Security';
import { Docker } from '@/components/pages/Docker';
import { Scripts } from '@/components/pages/Scripts';
import { AuditLogs } from '@/components/pages/AuditLogs';
import { Settings } from '@/components/pages/Settings';
import { Terminal } from '@/components/pages/Terminal';
import { FileBrowser } from '@/components/pages/FileBrowser';
import { PortForwarding } from '@/components/pages/PortForwarding';
import { Topology } from '@/components/pages/Topology';
import { Agents } from '@/components/pages/Agents';
import { TaskManagement } from '@/components/pages/TaskManagement';
import { Proxmox } from '@/components/pages/Proxmox';
import { Users } from '@/components/pages/Users';
import { CommandPalette, useCommandPalette } from '@/components/CommandPalette';
import { AppUser, authAPI, connectionAPI, setSessionLocked, setSessionSignedOut, touchSessionActivity } from '@/services/api';
import { API_CONFIG } from '@/services/api-config';
import { healthCheck } from '@/services/api';
import { ALL_TAB_PERMISSIONS } from '@/lib/tab-permissions';

export const MainLayout: React.FC = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [collapsed, setCollapsed] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [currentTheme, setCurrentTheme] = useState<'dark' | 'darker' | 'black' | 'light' | 'soft'>(() => {
    const saved = localStorage.getItem('theme') as 'dark' | 'darker' | 'black' | 'light' | 'soft' | null;
    return saved || 'dark';
  });
  const [onlineCount, setOnlineCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [currentUserDisplay, setCurrentUserDisplay] = useState('Account');
  const [backendHealthy, setBackendHealthy] = useState<boolean>(false);
  const [agentsOnlineCount, setAgentsOnlineCount] = useState(0);
  const [agentsTotalCount, setAgentsTotalCount] = useState(0);
  const [activeAlertsCount, setActiveAlertsCount] = useState(0);
  const [currentUser, setCurrentUser] = useState<AppUser | null>(null);
  const commandPalette = useCommandPalette();
  const allowedTabs = currentUser?.permissions?.length ? currentUser.permissions : ALL_TAB_PERMISSIONS;

  const hasTabAccess = (tab: string) => allowedTabs.includes(tab as typeof ALL_TAB_PERMISSIONS[number]);

  useEffect(() => {
    document.documentElement.classList.remove('dark', 'theme-darker', 'theme-black', 'theme-light', 'theme-soft');
    if (currentTheme === 'light') {
      document.documentElement.classList.add('theme-light');
    } else {
      document.documentElement.classList.add(currentTheme === 'dark' ? 'dark' : `theme-${currentTheme}`);
    }
  }, [isDarkMode, currentTheme]);

  const handleThemeChange = (theme: 'dark' | 'darker' | 'black' | 'light' | 'soft') => {
    setCurrentTheme(theme);
    localStorage.setItem('theme', theme);
    setIsDarkMode(theme !== 'light');
  };

  useEffect(() => {
    const fetchConnectionStats = async () => {
      try {
        const [connections, healthRes, agentsRes, activeAlertsRes, activeAgentAlertsRes] = await Promise.all([
          connectionAPI.getAll(),
          healthCheck(),
          fetch(`${API_CONFIG.baseURL}/agents`),
          fetch(`${API_CONFIG.baseURL}/connections/alerts/active`),
          fetch(`${API_CONFIG.baseURL}/agents/alerts/active`),
        ]);

        setTotalCount(connections.length);
        setOnlineCount(connections.filter(c => c.status === 'online').length);

        setBackendHealthy(healthRes.status === 'ok');

        const agents = agentsRes.ok ? await agentsRes.json() : [];
        setAgentsTotalCount(Array.isArray(agents) ? agents.length : 0);
        setAgentsOnlineCount(Array.isArray(agents) ? agents.filter((a: any) => a.status === 'online').length : 0);

        const activeAlerts = activeAlertsRes.ok ? await activeAlertsRes.json() : [];
        const activeAgentAlerts = activeAgentAlertsRes.ok ? await activeAgentAlertsRes.json() : [];
        const infraAlertsCount = Array.isArray(activeAlerts) ? activeAlerts.length : 0;
        const agentAlertsCount = Array.isArray(activeAgentAlerts) ? activeAgentAlerts.length : 0;
        setActiveAlertsCount(infraAlertsCount + agentAlertsCount);
      } catch (error) {
        console.error('Failed to fetch connection stats:', error);
        setBackendHealthy(false);
      }
    };

    fetchConnectionStats();
    const interval = setInterval(fetchConnectionStats, 30000); // Update every 30 seconds
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadCurrentUser = async () => {
      try {
        const me = await authAPI.me();
        if (me.user) {
          setCurrentUser(me.user);
          setCurrentUserDisplay(me.user.email || me.user.username || 'Account');
        } else {
          setCurrentUser(null);
          setCurrentUserDisplay('Account');
        }
      } catch {
        setCurrentUser(null);
        setCurrentUserDisplay('Account');
      }
    };

    loadCurrentUser();
  }, []);

  const handleOpenProfile = () => {
    setActiveTab(hasTabAccess('settings') ? 'settings' : allowedTabs[0] || 'dashboard');
  };

  const handleOpenPreferences = () => {
    setActiveTab(hasTabAccess('settings') ? 'settings' : allowedTabs[0] || 'dashboard');
  };

  const handleSignOut = () => {
    authAPI.logout();
    window.location.assign('/login');
  };

  const handleLockScreen = () => {
    touchSessionActivity();
    setSessionSignedOut(false);
    setSessionLocked(true);
  };

  useEffect(() => {
    const handleNavigateTab = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: string }>;
      if (customEvent.detail?.tab && hasTabAccess(customEvent.detail.tab)) {
        setActiveTab(customEvent.detail.tab);
      }
    };

    window.addEventListener('navigate-tab', handleNavigateTab as EventListener);
    return () => window.removeEventListener('navigate-tab', handleNavigateTab as EventListener);
  }, []);

  useEffect(() => {
    if (!hasTabAccess(activeTab)) {
      setActiveTab(allowedTabs[0] || 'dashboard');
    }
  }, [activeTab, currentUser]);

  if (!hasTabAccess(activeTab)) {
    return null;
  }

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return <Dashboard />;
      case 'inventory':
        return <Inventory />;
      case 'jobs':
        return <Jobs />;
      case 'hosts':
      case 'connections':
        return <Connections />;
      case 'monitor':
        return <SystemMonitorReal />;
      case 'comparison':
        return <ComparisonDashboard />;
      case 'alerts':
        return <AlertManagement />;
      case 'diagnostics':
        return <Diagnostics />;
      case 'security':
        return <Security />;
      case 'docker':
        return <Docker />;
      case 'scripts':
        return <Scripts />;
      case 'tunnels':
        return <PortForwarding />;
      case 'topology':
        return <Topology />;
      case 'terminal':
        return <Terminal />;
      case 'files':
        return <FileBrowser />;
      case 'agents':
        return <Agents />;
      case 'proxmox':
        return <Proxmox />;
      case 'tasks':
        return <TaskManagement />;
      case 'users':
        return <Users />;
      case 'logs':
        return <AuditLogs />;
      case 'settings':
        return <Settings currentTheme={currentTheme} onThemeChange={handleThemeChange} />;
      default:
        return (
          <Card>
            <CardHeader>
              <CardTitle>Access denied</CardTitle>
            </CardHeader>
            <CardContent>
              You do not have permission to access this tab.
            </CardContent>
          </Card>
        );
    }
  };

  return (
    <div className="flex h-screen bg-background overflow-hidden">
      <Sidebar
        activeTab={activeTab === 'connections' ? 'hosts' : activeTab}
        onTabChange={setActiveTab}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(!collapsed)}
        allowedTabs={allowedTabs}
        backendHealthy={backendHealthy}
        agentsOnlineCount={agentsOnlineCount}
        agentsTotalCount={agentsTotalCount}
        activeAlertsCount={activeAlertsCount}
      />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Header
          isDarkMode={isDarkMode}
          onToggleDarkMode={() => setIsDarkMode(!isDarkMode)}
          onlineCount={onlineCount}
          totalCount={totalCount}
          currentTheme={currentTheme}
          onThemeChange={handleThemeChange}
          userDisplay={currentUserDisplay}
          onOpenProfile={handleOpenProfile}
          onOpenPreferences={handleOpenPreferences}
          onLockScreen={handleLockScreen}
          onSignOut={handleSignOut}
        />
        <main className="flex-1 overflow-auto bg-background p-6 scrollbar-thin">
          {renderContent()}
        </main>
      </div>
      <CommandPalette open={commandPalette.open} onOpenChange={commandPalette.setOpen} />
    </div>
  );
};
