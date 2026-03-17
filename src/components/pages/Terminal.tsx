import React, { useState, useRef, useEffect } from 'react';
import { Terminal as TerminalIcon, X, Plus, Server, Loader2, Maximize2, Minimize2 } from 'lucide-react';
import { Terminal as XTermTerminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { connectionAPI } from '@/services/api';
import { TerminalWebSocket } from '@/services/terminal';
import { SSHConnection, RDPConnection } from '@/types/connection';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';

interface TerminalTab {
  id: string;
  name: string;
  host: string;
  connectionId?: string;
  ws: TerminalWebSocket | null;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
}

export const Terminal: React.FC = () => {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [activeTab, setActiveTab] = useState<string>('');
  const [connections, setConnections] = useState<(SSHConnection | RDPConnection)[]>([]);
  const [selectedConnection, setSelectedConnection] = useState<string>('');
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  
  const xtermInstancesRef = useRef<Map<string, XTermTerminal>>(new Map());
  const fitAddonsRef = useRef<Map<string, FitAddon>>(new Map());
  const containerRefsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const resizeObserversRef = useRef<Map<string, ResizeObserver>>(new Map());
  const { toast } = useToast();

  // Load connections on mount
  useEffect(() => {
    loadConnections();
    
    // Check if we should auto-connect from URL hash
    const hash = window.location.hash;
    const params = new URLSearchParams(hash.split('?')[1] || '');
    const connectionId = params.get('connection');
    
    if (connectionId) {
      // Auto-connect after loading connections
      setTimeout(() => {
        handleNewTerminal(connectionId);
      }, 500);
    }
  }, []);

  // Handle escape key to exit fullscreen
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };

    if (isFullscreen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isFullscreen]);

  const loadConnections = async () => {
    try {
      const data = await connectionAPI.getAll();
      setConnections(data.filter(c => c.type === 'ssh' && c.status === 'online'));
    } catch (error) {
      console.error('Failed to load connections:', error);
    }
  };

  // Initialize xterm when tab becomes active
  useEffect(() => {
    if (activeTab && !xtermInstancesRef.current.has(activeTab)) {
      const container = containerRefsRef.current.get(activeTab);
      if (container) {
        setTimeout(() => {
          initializeXTerm(activeTab, container);
        }, 0);
      }
    }
  }, [activeTab]);

  // Re-fit terminals when entering/exiting fullscreen
  useEffect(() => {
    if (activeTab) {
      const fitAddon = fitAddonsRef.current.get(activeTab);
      if (fitAddon) {
        setTimeout(() => {
          try {
            fitAddon.fit();
            const xterm = xtermInstancesRef.current.get(activeTab);
            const tab = tabs.find(t => t.id === activeTab);
            if (xterm && tab?.ws && tab.ws.isConnected()) {
              tab.ws.resize(xterm.cols, xterm.rows);
            }
          } catch (e) {
            console.error('Fullscreen resize error:', e);
          }
        }, 300); // Wait for animation to complete
      }
    }
  }, [isFullscreen]);

  const initializeXTerm = (tabId: string, container: HTMLDivElement) => {
    if (xtermInstancesRef.current.has(tabId)) return;

    console.log('Initializing xterm for', tabId);

    try {
      const xterm = new XTermTerminal({
        cols: 80,
        rows: 24,
        cursorBlink: true,
        cursorStyle: 'block',
        scrollback: 10000,
        tabStopWidth: 8,
        theme: {
          background: '#000000',
          foreground: '#e0e0e0',
          cursor: '#ffffff',
          cursorAccent: '#000000',
          selectionBackground: '#3a3a3a',
        },
        fontFamily: 'JetBrains Mono, Consolas, monospace',
        fontSize: 14,
        lineHeight: 1.2,
        letterSpacing: 0,
        allowProposedApi: true,
        convertEol: false,
        windowsMode: false,
      });

      const fitAddon = new FitAddon();
      xterm.loadAddon(fitAddon);

      xterm.open(container);
      
      // Load WebGL addon for better performance
      try {
        const webglAddon = new WebglAddon();
        xterm.loadAddon(webglAddon);
      } catch (e) {
        console.warn('WebGL addon could not be loaded, falling back to canvas renderer', e);
      }

      // Fit after loading addons
      setTimeout(() => {
        fitAddon.fit();
        console.log('xterm fitted:', xterm.cols, 'cols x', xterm.rows, 'rows');
      }, 100);

      // Handle terminal input
      xterm.onData((data) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.ws && tab.ws.isConnected()) {
          tab.ws.sendInput(data);
        }
      });

      // Handle resizing
      const resizeObserver = new ResizeObserver(() => {
        try {
          fitAddon.fit();
          const tab = tabs.find(t => t.id === tabId);
          if (tab?.ws && tab.ws.isConnected()) {
            tab.ws.resize(xterm.cols, xterm.rows);
          }
        } catch (e) {
          console.error('Resize error:', e);
        }
      });

      resizeObserver.observe(container);

      xtermInstancesRef.current.set(tabId, xterm);
      fitAddonsRef.current.set(tabId, fitAddon);
      resizeObserversRef.current.set(tabId, resizeObserver);

      xterm.write('Connecting...\r\n');

      console.log('xterm initialized:', tabId, 'cols:', xterm.cols, 'rows:', xterm.rows);
    } catch (error) {
      console.error('Failed to initialize xterm:', error);
    }
  };

  const createWebSocket = (tabId: string, connectionId?: string, connectionName?: string): TerminalWebSocket => {
    const ws = new TerminalWebSocket(
      // onOutput
      (data) => {
        console.log('Output received:', tabId, data.length, 'bytes');
        const xterm = xtermInstancesRef.current.get(tabId);
        if (xterm) {
          xterm.write(data);
        } else {
          console.warn('xterm not found for', tabId);
        }
      },
      // onConnected
      (message) => {
        console.log('Connected:', tabId, message);
        const xterm = xtermInstancesRef.current.get(tabId);
        if (xterm) {
          xterm.writeln('\r\n' + message);
        }
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, status: 'connected' as const }
              : tab
          )
        );
        toast({
          title: 'Connected',
          description: connectionName || 'Terminal connected',
        });
      },
      // onError
      (error) => {
        console.error('Error:', tabId, error);
        const xterm = xtermInstancesRef.current.get(tabId);
        if (xterm) {
          xterm.writeln('\r\n\x1b[31mError: ' + error + '\x1b[0m');
        }
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, status: 'error' as const }
              : tab
          )
        );
        toast({
          title: 'Connection Error',
          description: error,
          variant: 'destructive',
        });
      },
      // onDisconnected
      (message) => {
        console.log('Disconnected:', tabId, message);
        const xterm = xtermInstancesRef.current.get(tabId);
        if (xterm) {
          xterm.writeln('\r\n' + message);
        }
        setTabs((prev) =>
          prev.map((tab) =>
            tab.id === tabId
              ? { ...tab, status: 'disconnected' as const, ws: null }
              : tab
          )
        );
      }
    );

    console.log('Connecting to:', connectionId || 'local');
    ws.connect(connectionId);
    return ws;
  };

  const handleNewTerminal = (connectionId?: string) => {
    let connection: SSHConnection | RDPConnection | undefined;
    let name = 'Local Terminal';
    let host = 'localhost';

    if (connectionId) {
      connection = connections.find((c) => c.id === connectionId);
      if (connection) {
        name = connection.name;
        host = connection.host;
      }
    }

    const tabId = `tab-${Date.now()}`;
    const ws = createWebSocket(tabId, connectionId, name);

    const newTab: TerminalTab = {
      id: tabId,
      name,
      host,
      connectionId,
      ws,
      status: 'connecting',
    };

    setTabs((prev) => [...prev, newTab]);
    setActiveTab(tabId);
  };

  const handleCloseTab = (tabId: string) => {
    const tab = tabs.find((t) => t.id === tabId);
    if (tab && tab.ws) {
      tab.ws.disconnect();
    }

    const xterm = xtermInstancesRef.current.get(tabId);
    if (xterm) {
      xterm.dispose();
    }

    const resizeObserver = resizeObserversRef.current.get(tabId);
    if (resizeObserver) {
      resizeObserver.disconnect();
    }

    xtermInstancesRef.current.delete(tabId);
    fitAddonsRef.current.delete(tabId);
    resizeObserversRef.current.delete(tabId);
    containerRefsRef.current.delete(tabId);

    setTabs((prev) => {
      const filtered = prev.filter((t) => t.id !== tabId);
      if (activeTab === tabId && filtered.length > 0) {
        setActiveTab(filtered[0].id);
      }
      return filtered;
    });
  };

  const handleCommand = (e: React.KeyboardEvent) => {
    // Not needed - xterm handles input directly via onData
  };

  const toggleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <>
      {/* Fullscreen Backdrop */}
      {isFullscreen && (
        <div 
          className="fixed inset-0 bg-black/80 backdrop-blur-sm z-40 animate-in fade-in duration-300"
          onClick={toggleFullscreen}
        />
      )}

      <div className={cn(
        "flex flex-col transition-all duration-300",
        isFullscreen 
          ? "fixed inset-0 z-50 animate-in zoom-in-95 duration-300 p-0" 
          : "space-y-6 h-full animate-fade-in"
      )}>
      {/* Header */}
      {!isFullscreen && (
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">Terminal</h1>
            <p className="text-muted-foreground">SSH terminal sessions</p>
          </div>
        </div>
      )}

      <div className={cn(
        "flex-1 min-h-0",
        isFullscreen ? "flex" : "grid grid-cols-1 lg:grid-cols-4 gap-6"
      )}>
        {/* Available Connections */}
        {!isFullscreen && (
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Quick Connect</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Select value={selectedConnection} onValueChange={setSelectedConnection}>
                <SelectTrigger>
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((conn) => (
                    <SelectItem key={conn.id} value={conn.id}>
                      {conn.name} ({conn.host})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                className="w-full"
                onClick={() => selectedConnection && handleNewTerminal(selectedConnection)}
                disabled={!selectedConnection}
              >
                <Plus className="w-4 h-4 mr-2" />
                New Terminal
              </Button>
              <div className="pt-4 border-t">
                <p className="text-sm font-medium mb-2">Online Connections</p>
                {connections.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No online connections</p>
                ) : (
                  connections.map((conn) => (
                    <button
                      key={conn.id}
                      onClick={() => handleNewTerminal(conn.id)}
                      className="w-full flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors text-left mb-1"
                    >
                      <Server className="w-4 h-4 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">{conn.name}</p>
                        <p className="text-xs text-muted-foreground font-mono">{conn.host}</p>
                      </div>
                      <div className="w-2 h-2 rounded-full bg-success" />
                    </button>
                  ))
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Terminal */}
        <Card className={cn(
          "flex flex-col bg-terminal-bg transition-all duration-300",
          isFullscreen 
            ? "w-full h-full rounded-none border-0" 
            : "lg:col-span-3 min-h-[500px]"
        )}>
          {tabs.length === 0 ? (
            <CardContent className="flex-1 flex items-center justify-center">
              <div className="text-center text-muted-foreground">
                <TerminalIcon className="w-16 h-16 mx-auto mb-4 opacity-50" />
                <h3 className="text-lg font-semibold mb-2">No Terminal Sessions</h3>
                <p className="text-sm">Select a connection from the sidebar to start</p>
              </div>
            </CardContent>
          ) : (
            <>
              {/* Tabs */}
              <div className="flex items-center border-b border-border px-2 pt-2">
                <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-thin">
                  {tabs.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'flex items-center gap-2 px-3 py-2 rounded-t-lg text-sm transition-colors whitespace-nowrap',
                        activeTab === tab.id
                          ? 'bg-terminal-bg text-terminal'
                          : 'hover:bg-muted text-muted-foreground'
                      )}
                    >
                      <TerminalIcon className="w-4 h-4" />
                      <span className="max-w-32 truncate">{tab.name}</span>
                      {tab.status === 'connecting' && <Loader2 className="w-3 h-3 animate-spin" />}
                      {tab.status === 'connected' && <div className="w-2 h-2 rounded-full bg-success" />}
                      {tab.status === 'error' && <div className="w-2 h-2 rounded-full bg-destructive" />}
                      <X
                        className="w-3 h-3 hover:text-foreground"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCloseTab(tab.id);
                        }}
                      />
                    </button>
                  ))}
                </div>
                {/* Fullscreen Toggle Button */}
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={toggleFullscreen}
                  className="ml-2 text-muted-foreground hover:text-foreground"
                  title={isFullscreen ? "Exit Fullscreen (Esc)" : "Fullscreen"}
                >
                  {isFullscreen ? (
                    <Minimize2 className="w-4 h-4" />
                  ) : (
                    <Maximize2 className="w-4 h-4" />
                  )}
                </Button>
              </div>

              {/* Terminal Container */}
              <div className="flex-1 overflow-hidden bg-terminal-bg rounded-b">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    ref={(el) => {
                      if (el) {
                        containerRefsRef.current.set(tab.id, el);
                      }
                    }}
                    className={cn(
                      'w-full h-full overflow-hidden',
                      activeTab === tab.id ? 'block' : 'hidden'
                    )}
                  />
                ))}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
    </>
  );
};
