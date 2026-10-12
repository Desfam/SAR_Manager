import { useEffect, useRef, useState } from 'react';
import { HashRouter, useLocation, useNavigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'motion/react';
import { TitleBar } from '@/components/shell/TitleBar';
import { Sidebar } from '@/components/shell/Sidebar';
import { CommandPalette } from '@/components/shell/CommandPalette';
import { Toaster } from 'sonner';
import { Dashboard } from '@/pages/Dashboard';
import { Proxmox } from '@/pages/Proxmox';
import { TerminalPage } from '@/pages/TerminalPage';
import { SystemsPage } from '@/pages/SystemsPage';
import { NetworkPage } from '@/pages/NetworkPage';
import { FirewallPage } from '@/pages/FirewallPage';
import { FilesPage } from '@/pages/FilesPage';
import { MonitoringPage } from '@/pages/MonitoringPage';
import { ScriptsPage } from '@/pages/ScriptsPage';
import { SecurityPage } from '@/pages/SecurityPage';
import { SystemDetailPage } from '@/pages/SystemDetailPage';
import { NodeDetailPage } from '@/pages/NodeDetailPage';
import { WazuhPage } from '@/pages/WazuhPage';
import { SocDashboard } from '@/pages/wazuh/SocDashboard';
import { Investigation } from '@/pages/wazuh/Investigation';
import { Timeline } from '@/pages/wazuh/Timeline';
import { LinuxDashboard } from '@/pages/wazuh/LinuxDashboard';
import { Hosts } from '@/pages/wazuh/Hosts';
import { Mitre } from '@/pages/wazuh/Mitre';
import { Vulnerabilities } from '@/pages/wazuh/Vulnerabilities';
import { IocLookup } from '@/pages/wazuh/IocLookup';
import { TrustCenter } from '@/pages/wazuh/TrustCenter';

/** Pages of the Wazuh workspace; entries marked `soon` in the navigation fall back to the placeholder */
import { EventMap } from '@/pages/wazuh/EventMap';
import { ExposureMap } from '@/pages/wazuh/ExposureMap';
import { FullScan } from '@/pages/wazuh/FullScan';
import { Baseline } from '@/pages/wazuh/Baseline';
import { Incidents } from '@/pages/wazuh/Incidents';
import { Findings } from '@/pages/wazuh/Findings';
import { SystemHealth } from '@/pages/wazuh/SystemHealth';

const WAZUH_PAGES: Record<string, () => JSX.Element> = {
  '/wazuh': () => <SocDashboard />,
  '/wazuh/investigation': () => <Investigation />,
  '/wazuh/timeline': () => <Timeline />,
  '/wazuh/linux': () => <LinuxDashboard />,
  '/wazuh/analytics': () => <WazuhPage />,
  '/wazuh/hosts': () => <Hosts />,
  '/wazuh/integration': () => <TrustCenter mode="integration" />,
  '/wazuh/mitre': () => <Mitre />,
  '/wazuh/vulnerabilities': () => <Vulnerabilities />,
  '/wazuh/ioc': () => <IocLookup />,
  '/wazuh/trust': () => <TrustCenter mode="trust" />,
  '/wazuh/event-map': () => <EventMap />,
  '/wazuh/exposure': () => <ExposureMap />,
  '/wazuh/full-scan': () => <FullScan />,
  '/wazuh/baseline': () => <Baseline />,
  '/wazuh/incidents': () => <Incidents />,
  '/wazuh/findings': () => <Findings />,
  '/wazuh/health': () => <SystemHealth />,
};
import { PageErrorBoundary } from '@/components/shell/PageErrorBoundary';
import { AlertsPage } from '@/pages/AlertsPage';
import { NotificationListener } from '@/components/alerts/NotificationListener';
import { ComingSoon } from '@/pages/ComingSoon';
import { findPage, sectionOf, workspaceOf, type Workspace } from '@/lib/navigation';
import { useAgentAlerts, useHostAlerts } from '@/hooks/use-infrastructure';

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false } },
});

function readCollapsed() {
  try {
    return localStorage.getItem('sar.sidebarCollapsed') === 'true';
  } catch {
    return false;
  }
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  // Each workspace remembers its last page, so switching back returns there
  const workspace = workspaceOf(location.pathname);
  const lastPath = useRef<Record<Workspace, string>>({ sar: '/', wazuh: '/wazuh' });
  useEffect(() => {
    lastPath.current[workspace] = `${location.pathname}${location.search}`;
  }, [workspace, location.pathname, location.search]);
  const toggleWorkspace = () => navigate(lastPath.current[workspace === 'wazuh' ? 'sar' : 'wazuh']);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const hostAlerts = useHostAlerts();
  const agentAlerts = useAgentAlerts();
  const alertCount = (hostAlerts.data?.length ?? 0) + (agentAlerts.data?.length ?? 0);

  const page = findPage(location.pathname);
  const section = sectionOf(page);

  const toggleSidebar = () => {
    setCollapsed((value) => {
      try {
        localStorage.setItem('sar.sidebarCollapsed', String(!value));
      } catch {
        // ignore
      }
      return !value;
    });
  };

  return (
    <div className="flex h-full flex-col">
      <TitleBar
        onToggleSidebar={toggleSidebar}
        onOpenPalette={() => setPaletteOpen(true)}
        onNavigate={navigate}
        alertCount={alertCount}
        workspace={workspace}
        onToggleWorkspace={toggleWorkspace}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar pathname={location.pathname} collapsed={collapsed} onNavigate={navigate} />
        <main className="scroll-thin min-w-0 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="px-5 pb-8 pt-5"
            >
              <PageErrorBoundary>
              {page && WAZUH_PAGES[page.path] ? (
                WAZUH_PAGES[page.path]()
              ) : !page || page.path === '/' ? (
                <Dashboard onNavigate={navigate} />
              ) : page.path === '/proxmox' ? (
                location.pathname.startsWith('/proxmox/node/') ? <NodeDetailPage /> : <Proxmox />
              ) : page.path === '/terminal' ? (
                <TerminalPage />
              ) : page.path === '/systems' ? (
                location.pathname.startsWith('/systems/') ? <SystemDetailPage /> : <SystemsPage />
              ) : page.path === '/network' ? (
                <NetworkPage />
              ) : page.path === '/firewall' ? (
                <FirewallPage />
              ) : page.path === '/files' ? (
                <FilesPage />
              ) : page.path === '/monitoring' ? (
                <MonitoringPage />
              ) : page.path === '/scripts' ? (
                <ScriptsPage />
              ) : page.path === '/security' ? (
                <SecurityPage />
              ) : page.path === '/alerts' ? (
                <AlertsPage />
              ) : (
                <ComingSoon page={page} section={section} />
              )}
              </PageErrorBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onNavigate={navigate} />
      <NotificationListener />
      <Toaster
        position="bottom-right"
        offset={20}
        toastOptions={{
          classNames: {
            toast: '!panel-surface !rounded-2xl !text-ink !shadow-[0_20px_50px_-20px_rgb(0_0_0/0.7)] !font-sans',
            description: '!text-muted',
            success: '[&_[data-icon]]:!text-ok',
            error: '[&_[data-icon]]:!text-bad',
          },
        }}
      />
    </div>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <HashRouter>
      <Shell />
    </HashRouter>
  </QueryClientProvider>
);

export default App;
