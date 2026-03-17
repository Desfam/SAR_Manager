import React, { useState, useEffect } from 'react';
import {
  Network,
  Play,
  Square,
  Loader2,
  CheckCircle,
  XCircle,
  Globe,
  MapPin,
  Shield,
  Search,
  Clock,
  Activity,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { diagnosticsAPI } from '@/services/api';
import { useToast } from '@/hooks/use-toast';

interface DiagnosticTool {
  id: string;
  name: string;
  description: string;
  icon: React.ReactNode;
  placeholder: string;
}

const tools: DiagnosticTool[] = [
  {
    id: 'ping',
    name: 'Ping',
    description: 'Test connectivity to a host',
    icon: <Network className="w-5 h-5" />,
    placeholder: 'google.com or 8.8.8.8',
  },
  {
    id: 'traceroute',
    name: 'Traceroute',
    description: 'Trace the path to a host',
    icon: <MapPin className="w-5 h-5" />,
    placeholder: 'google.com',
  },
  {
    id: 'dns',
    name: 'DNS Lookup',
    description: 'Query DNS records',
    icon: <Globe className="w-5 h-5" />,
    placeholder: 'example.com',
  },
  {
    id: 'port-scan',
    name: 'Port Scan',
    description: 'Scan common ports on a host',
    icon: <Search className="w-5 h-5" />,
    placeholder: '192.168.1.1',
  },
  {
    id: 'whois',
    name: 'WHOIS',
    description: 'Domain registration info',
    icon: <Shield className="w-5 h-5" />,
    placeholder: 'example.com',
  },
];

export const Diagnostics: React.FC = () => {
  const [activeTool, setActiveTool] = useState('ping');
  const [target, setTarget] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [results, setResults] = useState<string | null>(null);
  const [portScanPreset, setPortScanPreset] = useState<string>('common');
  const [history, setHistory] = useState<
    Array<{ id: string; tool: string; target: string; time: string; status: 'success' | 'failed' }>
  >([]);
  const { toast } = useToast();

  const currentTool = tools.find((t) => t.id === activeTool)!;

  const runDiagnostic = async () => {
    if (!target) return;
    setIsRunning(true);
    setResults(null);

    try {
      let response: any;
      
      switch (activeTool) {
        case 'ping':
          response = await diagnosticsAPI.ping(target, 4);
          setResults(response.output || 'No output received');
          break;
          
        case 'traceroute':
          response = await diagnosticsAPI.traceroute(target);
          setResults(response.output || 'No output received');
          break;
          
        case 'dns':
          response = await diagnosticsAPI.dnsLookup(target);
          setResults(response.output || 'No output received');
          break;
          
        case 'port-scan':
          response = await diagnosticsAPI.portScan(target, undefined, portScanPreset);
          setResults(response.output || 'No output received');
          break;
          
        case 'whois':
          response = await diagnosticsAPI.whois(target);
          setResults(response.output || 'No output received');
          break;
          
        default:
          setResults(`${currentTool.name} completed for ${target}\n\nResults would appear here...`);
      }

      // Add to history
      setHistory([
        { 
          id: Date.now().toString(), 
          tool: activeTool, 
          target, 
          time: 'Just now', 
          status: response?.success !== false ? 'success' : 'failed' 
        },
        ...history.slice(0, 9),
      ]);
    } catch (error: any) {
      const errorMsg = `Error running ${currentTool.name}:\n${error.message || 'Unknown error'}`;
      setResults(errorMsg);
      
      toast({
        title: 'Diagnostic Failed',
        description: error.message || 'An error occurred',
        variant: 'destructive',
      });

      setHistory([
        { 
          id: Date.now().toString(), 
          tool: activeTool, 
          target, 
          time: 'Just now', 
          status: 'failed' 
        },
        ...history.slice(0, 9),
      ]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Network Diagnostics</h1>
        <p className="text-muted-foreground">Built-in tools for troubleshooting network issues</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Tools Sidebar */}
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">Tools</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="space-y-1 px-2 pb-2">
              {tools.map((tool) => (
                <button
                  key={tool.id}
                  onClick={() => {
                    setActiveTool(tool.id);
                    setResults(null);
                  }}
                  className={cn(
                    'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all text-left',
                    activeTool === tool.id
                      ? 'bg-primary text-primary-foreground'
                      : 'hover:bg-muted text-foreground'
                  )}
                >
                  <div
                    className={cn(
                      'p-1.5 rounded-md',
                      activeTool === tool.id ? 'bg-primary-foreground/20' : 'bg-muted'
                    )}
                  >
                    {tool.icon}
                  </div>
                  <div>
                    <p className="font-medium text-sm">{tool.name}</p>
                    <p
                      className={cn(
                        'text-xs',
                        activeTool === tool.id ? 'text-primary-foreground/70' : 'text-muted-foreground'
                      )}
                    >
                      {tool.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Main Content */}
        <div className="lg:col-span-3 space-y-4">
          {/* Tool Interface */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {currentTool.icon}
                {currentTool.name}
              </CardTitle>
              <CardDescription>{currentTool.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {activeTool === 'port-scan' && (
                <div className="space-y-2">
                  <Label htmlFor="port-preset">Port Preset</Label>
                  <Select value={portScanPreset} onValueChange={setPortScanPreset}>
                    <SelectTrigger id="port-preset">
                      <SelectValue placeholder="Select preset" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="common">Common Ports (Top 100)</SelectItem>
                      <SelectItem value="web">Web Ports (80, 443, 8080, etc.)</SelectItem>
                      <SelectItem value="mail">Mail Ports (25, 110, 143, etc.)</SelectItem>
                      <SelectItem value="database">Database Ports (3306, 5432, etc.)</SelectItem>
                      <SelectItem value="all">All Common Ports (1000+)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="flex gap-2">
                <div className="flex-1">
                  <Input
                    placeholder={currentTool.placeholder}
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && runDiagnostic()}
                    disabled={isRunning}
                  />
                </div>
                <Button onClick={runDiagnostic} disabled={!target || isRunning}>
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Running...
                    </>
                  ) : (
                    <>
                      <Play className="w-4 h-4 mr-2" />
                      Run
                    </>
                  )}
                </Button>
                {isRunning && (
                  <Button variant="destructive" onClick={() => setIsRunning(false)}>
                    <Square className="w-4 h-4" />
                  </Button>
                )}
              </div>

              {/* Results */}
              {(results || isRunning) && (
                <div className="bg-terminal-bg rounded-lg p-4 font-mono text-sm">
                  {isRunning ? (
                    <div className="flex items-center gap-2 text-terminal">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Running {currentTool.name.toLowerCase()} on {target}...
                    </div>
                  ) : (
                    <pre className="text-terminal whitespace-pre-wrap terminal-glow">{results}</pre>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* History */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Clock className="w-5 h-5" />
                Recent Diagnostics
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between py-2 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3">
                      {item.status === 'success' ? (
                        <CheckCircle className="w-4 h-4 text-success" />
                      ) : (
                        <XCircle className="w-4 h-4 text-destructive" />
                      )}
                      <div>
                        <span className="font-medium text-sm capitalize">{item.tool}</span>
                        <span className="text-muted-foreground mx-2">→</span>
                        <span className="font-mono text-sm">{item.target}</span>
                      </div>
                    </div>
                    <span className="text-xs text-muted-foreground">{item.time}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};
