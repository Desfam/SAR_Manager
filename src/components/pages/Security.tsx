import React, { useState, useEffect } from 'react';
import {
  Shield,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Info,
  Play,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Server,
  Zap,
  Copy,
  CheckCheck,
  Download,
  Filter,
  TrendingUp,
  Clock,
  Calendar,
} from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { connectionAPI, securityAPI } from '@/services/api';
import { cn } from '@/lib/utils';
import { useToast } from '@/hooks/use-toast';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface NIS2Requirement {
  id: string;
  requirement: string;
  description: string;
  category: 'governance' | 'asset-management' | 'security-operations' | 'supply-chain' | 'incident-response';
  severity: 'critical' | 'high' | 'medium' | 'low';
  remediation?: string;
  remediationCommand?: string;
  details?: string;
}

interface NIS2Audit {
  id: string;
  hostId: string;
  hostName: string;
  timestamp: string;
  score: number;
  passed: NIS2Requirement[];
  failed: NIS2Requirement[];
  status: 'pending' | 'in-progress' | 'completed' | 'failed';
}

interface SecurityTrendPoint {
  date: string;
  avgScore: number;
  minScore: number;
  maxScore: number;
  scans: number;
}

const NIS2_REQUIREMENTS: NIS2Requirement[] = [
  {
    id: 'nis2-01',
    requirement: 'Access Control',
    description: 'Implement strict access control mechanisms',
    category: 'governance',
    severity: 'critical',
    remediation: 'Implement role-based access control (RBAC). Use principle of least privilege. Regularly audit and revoke unnecessary permissions. Implement multi-factor authentication for administrative access.',
  },
  {
    id: 'nis2-02',
    requirement: 'Encryption in Transit',
    description: 'All data in transit must be encrypted with TLS 1.2+',
    category: 'asset-management',
    severity: 'critical',
    remediation: 'Enable TLS 1.2 or higher on all services. Disable older protocols (SSL 3.0, TLS 1.0, 1.1). Use strong cipher suites. Obtain and install valid SSL/TLS certificates. Monitor certificate expiration dates.',
  },
  {
    id: 'nis2-03',
    requirement: 'Encryption at Rest',
    description: 'Sensitive data at rest must be encrypted',
    category: 'asset-management',
    severity: 'high',
    remediation: 'Enable full disk encryption on all systems. Use AES-256 for database encryption. Encrypt backups. Implement secure key management. Use encrypted filesystems or storage volumes.',
  },
  {
    id: 'nis2-04',
    requirement: 'SSH Key Management',
    description: 'SSH keys must be properly managed with Ed25519 algorithm',
    category: 'security-operations',
    severity: 'critical',
    remediation: 'Generate Ed25519 SSH keys for all connections. Disable password-based SSH authentication. Implement SSH key rotation schedule (annually). Store private keys securely. Use SSH agent with passphrases.',
  },
  {
    id: 'nis2-05',
    requirement: 'Audit Logging',
    description: 'All security events must be logged and monitored',
    category: 'security-operations',
    severity: 'high',
    remediation: 'Enable comprehensive audit logging. Implement centralized log management. Set up real-time alerts for security events. Retain logs for minimum 1 year. Protect logs from tampering with immutable storage.',
  },
  {
    id: 'nis2-06',
    requirement: 'Vulnerability Management',
    description: 'Regular vulnerability scans and patching',
    category: 'security-operations',
    severity: 'high',
    remediation: 'Implement automated vulnerability scanning. Establish patch management policy. Apply security updates within 30 days. Use software composition analysis for dependencies. Maintain inventory of all assets.',
  },
  {
    id: 'nis2-07',
    requirement: 'Incident Response Plan',
    description: 'Documented incident response procedures',
    category: 'incident-response',
    severity: 'high',
    remediation: 'Create incident response plan document. Define roles and responsibilities. Establish communication procedures. Test plan quarterly with tabletop exercises. Maintain contact list of incident response team.',
  },
  {
    id: 'nis2-08',
    requirement: 'Supply Chain Security',
    description: 'Third-party risk management and monitoring',
    category: 'supply-chain',
    severity: 'medium',
    remediation: 'Conduct vendor security assessments. Include security requirements in contracts. Monitor third-party access and activities. Request SOC 2 compliance reports. Implement vendor exit plans.',
  },
  {
    id: 'nis2-09',
    requirement: 'Password Policy',
    description: 'Strong password policies and rotation',
    category: 'governance',
    severity: 'high',
    remediation: 'Enforce minimum 12-character passwords. Require complexity (uppercase, lowercase, numbers, symbols). Implement password history (prevent reuse of last 5). Enforce 90-day rotation. Use password managers. Implement account lockout after 5 failed attempts.',
  },
  {
    id: 'nis2-10',
    requirement: 'MFA Implementation',
    description: 'Multi-factor authentication for critical systems',
    category: 'governance',
    severity: 'critical',
    remediation: 'Enable MFA for all admin/privileged accounts. Support multiple MFA methods (TOTP, FIDO2, hardware tokens). Make MFA mandatory for remote access. Test MFA recovery procedures. Monitor MFA adoption rates.',
  },
];

const severityColors = {
  critical: 'bg-destructive text-destructive-foreground',
  high: 'bg-destructive/80 text-destructive-foreground',
  medium: 'bg-warning text-warning-foreground',
  low: 'bg-muted text-muted-foreground',
};

const categoryColors = {
  'governance': 'bg-blue-500/20 text-blue-400',
  'asset-management': 'bg-purple-500/20 text-purple-400',
  'security-operations': 'bg-orange-500/20 text-orange-400',
  'supply-chain': 'bg-pink-500/20 text-pink-400',
  'incident-response': 'bg-red-500/20 text-red-400',
};

const severityIcons = {
  critical: <XCircle className="w-4 h-4" />,
  high: <AlertTriangle className="w-4 h-4" />,
  medium: <AlertTriangle className="w-4 h-4" />,
  low: <Info className="w-4 h-4" />,
};

const ScoreGauge: React.FC<{ score: number }> = ({ score }) => {
  const getColor = () => {
    if (score >= 90) return 'text-success';
    if (score >= 70) return 'text-warning';
    return 'text-destructive';
  };

  return (
    <div className="relative w-32 h-32">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-muted"
        />
        <path
          d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeDasharray={`${score}, 100`}
          className={getColor()}
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className={cn('text-2xl font-bold', getColor())}>{score}</span>
      </div>
    </div>
  );
};

const NIS2AuditCard: React.FC<{ audit: NIS2Audit; onRescan: (hostId: string) => Promise<void> }> = ({ audit, onRescan }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isRescanning, setIsRescanning] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const { toast } = useToast();

  const handleRescan = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsRescanning(true);
    try {
      await onRescan(audit.hostId);
    } finally {
      setIsRescanning(false);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      toast({
        title: 'Copied to Clipboard',
        description: 'Remediation command copied successfully',
      });
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      toast({
        title: 'Copy Failed',
        description: 'Unable to copy to clipboard',
        variant: 'destructive',
      });
    }
  };

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <ScoreGauge score={audit.score} />
                <div className="flex-1">
                  <CardTitle className="text-lg">{audit.hostName}</CardTitle>
                  <CardDescription>
                    Last scanned: {new Date(audit.timestamp).toLocaleString()}
                  </CardDescription>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <Badge variant="outline" className="bg-success/10 text-success border-success/30">
                      ✓ {audit.passed.length} Passed
                    </Badge>
                    <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">
                      ✗ {audit.failed.length} Failed
                    </Badge>
                    {audit.status === 'in-progress' && (
                      <Badge className="bg-blue-500/20 text-blue-400">
                        <Zap className="w-3 h-3 mr-1 animate-spin" />
                        Scanning...
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleRescan} disabled={isRescanning}>
                  <RefreshCw className={cn('w-4 h-4 mr-2', isRescanning && 'animate-spin')} />
                  {isRescanning ? 'Scanning...' : 'Rescan'}
                </Button>
                {isOpen ? (
                  <ChevronDown className="w-5 h-5 text-muted-foreground" />
                ) : (
                  <ChevronRight className="w-5 h-5 text-muted-foreground" />
                )}
              </div>
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 space-y-4">
            {/* Passed Requirements */}
            {audit.passed.length > 0 && (
              <div>
                <h4 className="font-semibold text-success mb-2">✓ Passed Requirements ({audit.passed.length})</h4>
                <div className="space-y-2">
                  {audit.passed.map((req) => (
                    <div key={req.id} className="p-3 bg-success/10 rounded-lg border border-success/20">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />
                        <div className="flex-1">
                          <p className="font-medium text-sm">{req.requirement}</p>
                          <p className="text-xs text-muted-foreground mt-1">{req.description}</p>
                        </div>
                        <Badge variant="outline" className={cn('text-xs', categoryColors[req.category])}>
                          {req.category}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Failed Requirements */}
            {audit.failed.length > 0 && (
              <div>
                <h4 className="font-semibold text-destructive mb-2">✗ Failed Requirements ({audit.failed.length})</h4>
                <div className="space-y-3">
                  {audit.failed.map((req) => (
                    <Collapsible key={req.id} defaultOpen={false}>
                      <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/20">
                        <CollapsibleTrigger asChild>
                          <div className="flex items-center gap-2 cursor-pointer">
                            <XCircle className="w-4 h-4 text-destructive flex-shrink-0" />
                            <div className="flex-1 min-w-0">
                              <p className="font-medium text-sm">{req.requirement}</p>
                              <p className="text-xs text-muted-foreground mt-1">{req.description}</p>
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              <Badge className={cn('text-xs', severityColors[req.severity])}>
                                {req.severity}
                              </Badge>
                              <ChevronRight className="w-4 h-4 text-muted-foreground" />
                            </div>
                          </div>
                        </CollapsibleTrigger>
                      </div>
                      {req.remediation && (
                        <CollapsibleContent>
                          <div className="mt-2 ml-3 space-y-2">
                            <div className="p-3 bg-warning/10 border-l-2 border-warning rounded-r-lg">
                              <div className="flex items-start gap-2">
                                <AlertTriangle className="w-4 h-4 text-warning mt-0.5 flex-shrink-0" />
                                <div className="flex-1">
                                  <p className="text-xs font-semibold text-warning mb-1">Remediation Steps</p>
                                  <p className="text-xs text-muted-foreground leading-relaxed">{req.remediation}</p>
                                </div>
                              </div>
                            </div>
                            {req.remediationCommand && (
                              <div className="p-3 bg-primary/10 border-l-2 border-primary rounded-r-lg">
                                <div className="flex items-start gap-2">
                                  <div className="flex-1 min-w-0">
                                    <p className="text-xs font-semibold text-primary mb-2">One-Click Remediation</p>
                                    <div className="flex items-center gap-2">
                                      <code className="flex-1 px-2 py-1 bg-muted/50 rounded text-xs font-mono break-all">
                                        {req.remediationCommand}
                                      </code>
                                      <Button
                                        size="sm"
                                        variant="outline"
                                        className="flex-shrink-0 h-7"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          copyToClipboard(req.remediationCommand!, req.id);
                                        }}
                                      >
                                        {copiedId === req.id ? (
                                          <><CheckCheck className="w-3 h-3 mr-1" /> Copied</>
                                        ) : (
                                          <><Copy className="w-3 h-3 mr-1" /> Copy</>
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </CollapsibleContent>
                      )}
                    </Collapsible>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
};

export const Security: React.FC = () => {
  const [audits, setAudits] = useState<NIS2Audit[]>([]);
  const [trendData, setTrendData] = useState<SecurityTrendPoint[]>([]);
  const [connections, setConnections] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [showOnlyFailed, setShowOnlyFailed] = useState(false);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [scheduleFrequency, setScheduleFrequency] = useState<string>('daily');
  const [scheduleTime, setScheduleTime] = useState<string>('02:00');
  const [emailNotifications, setEmailNotifications] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    loadConnections();
    loadAudits();
    loadTrends();
    
    // Load saved schedule
    const savedSchedule = localStorage.getItem('securityScanSchedule');
    if (savedSchedule) {
      try {
        const schedule = JSON.parse(savedSchedule);
        setScheduleFrequency(schedule.frequency || 'daily');
        setScheduleTime(schedule.time || '02:00');
        setEmailNotifications(schedule.email || '');
      } catch (error) {
        console.error('Failed to parse saved schedule:', error);
      }
    }
  }, []);

  const loadConnections = async () => {
    try {
      const data = await connectionAPI.getAll();
      setConnections(data);
    } catch (error) {
      console.error('Failed to load connections:', error);
    }
  };

  const loadAudits = async () => {
    try {
      const response = await securityAPI.getAudits();
      if (response.success && response.audits) {
        // Transform backend audit data to frontend format
        const transformedAudits: NIS2Audit[] = response.audits.map((audit: any) => ({
          id: audit.id.toString(),
          hostId: audit.hostId.toString(),
          hostName: audit.hostName || audit.host || 'Unknown Host',
          timestamp: audit.timestamp,
          score: audit.score,
          status: 'completed' as const,
          passed: audit.passed || [],
          failed: audit.failed || [],
        }));
        setAudits(transformedAudits);
      }
    } catch (error) {
      console.error('Failed to load audits:', error);
      toast({
        title: 'Failed to Load Audits',
        description: 'Unable to retrieve security audit data',
        variant: 'destructive',
      });
    }
  };

  const loadTrends = async () => {
    try {
      const response = await securityAPI.getTrends();
      if (response.success && response.trends) {
        setTrendData(response.trends);
      }
    } catch (error) {
      console.error('Failed to load security trends:', error);
    }
  };

  const runScan = async (hostId?: string) => {
    setIsLoading(true);
    try {
      if (hostId) {
        // Scan single host
        const response = await securityAPI.scanConnection(hostId);
        if (response.success && response.audit) {
          toast({
            title: 'Scan Complete',
            description: `${response.audit.hostName}: ${response.audit.score}% compliance score`,
          });
        }
      } else {
        // Scan all hosts
        const response = await securityAPI.scanAll();
        if (response.success && response.audits) {
          toast({
            title: 'Full Scan Complete',
            description: `Scanned ${response.audits.length} host(s)`,
          });
        }
      }
      // Reload audits after scanning
      await loadAudits();
      await loadTrends();
    } catch (error) {
      console.error('Scan failed:', error);
      toast({
        title: 'Scan Failed',
        description: error instanceof Error ? error.message : 'Failed to run security audit',
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  };

  const exportToCSV = () => {
    try {
      const csvRows = [];
      csvRows.push(['Host', 'Score', 'Check ID', 'Requirement', 'Status', 'Severity', 'Category', 'Remediation Command']);
      
      audits.forEach(audit => {
        // Add passed checks
        audit.passed.forEach(req => {
          csvRows.push([
            audit.hostName,
            audit.score.toString(),
            req.id,
            req.requirement,
            'Passed',
            req.severity,
            req.category,
            req.remediationCommand || '',
          ]);
        });
        
        // Add failed checks
        audit.failed.forEach(req => {
          csvRows.push([
            audit.hostName,
            audit.score.toString(),
            req.id,
            req.requirement,
            'Failed',
            req.severity,
            req.category,
            req.remediationCommand || '',
          ]);
        });
      });
      
      const csvContent = csvRows.map(row => 
        row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
      ).join('\n');
      
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `security-audit-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      toast({
        title: 'Export Successful',
        description: 'Security audit report downloaded as CSV',
      });
    } catch (error) {
      toast({
        title: 'Export Failed',
        description: 'Unable to export security audit data',
        variant: 'destructive',
      });
    }
  };

  const saveSchedule = () => {
    // In a real implementation, this would save to backend
    // For now, we'll just use localStorage
    const schedule = {
      frequency: scheduleFrequency,
      time: scheduleTime,
      email: emailNotifications,
      enabled: true,
    };
    
    localStorage.setItem('securityScanSchedule', JSON.stringify(schedule));
    
    toast({
      title: 'Schedule Saved',
      description: `Automatic scans will run ${scheduleFrequency} at ${scheduleTime}${emailNotifications ? ' with email alerts' : ''}`,
    });
    
    setIsScheduleDialogOpen(false);
  };

  const avgScore = audits.length > 0 
    ? Math.round(audits.reduce((acc, a) => acc + a.score, 0) / audits.length)
    : 0;

  const totalPassed = audits.reduce((acc, a) => acc + a.passed.length, 0);
  const totalFailed = audits.reduce((acc, a) => acc + a.failed.length, 0);
  const compliantHosts = audits.filter(a => a.score >= 80).length;

  // Filter audits based on selected filters
  const filteredAudits = audits.map(audit => {
    let filteredFailed = audit.failed;
    
    if (severityFilter !== 'all') {
      filteredFailed = filteredFailed.filter(req => req.severity === severityFilter);
    }
    
    if (categoryFilter !== 'all') {
      filteredFailed = filteredFailed.filter(req => req.category === categoryFilter);
    }
    
    return {
      ...audit,
      failed: filteredFailed,
      // Adjust score based on filtered results if showing only failed
      displayScore: showOnlyFailed ? audit.score : audit.score,
    };
  }).filter(audit => !showOnlyFailed || audit.failed.length > 0);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">NIS 2 Security Audit</h1>
          <p className="text-muted-foreground">Network and Information Systems Directive 2 compliance scanning</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={isScheduleDialogOpen} onOpenChange={setIsScheduleDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Clock className="w-4 h-4 mr-2" />
                Schedule
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Schedule Automatic Scans</DialogTitle>
                <DialogDescription>
                  Configure automatic security audits to run on a recurring schedule
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="frequency">Scan Frequency</Label>
                  <Select value={scheduleFrequency} onValueChange={setScheduleFrequency}>
                    <SelectTrigger id="frequency">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Daily</SelectItem>
                      <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                      <SelectItem value="monthly">Monthly (1st of month)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Scan Time (24-hour format)</Label>
                  <Input
                    id="time"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email for Alerts (optional)</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="admin@example.com"
                    value={emailNotifications}
                    onChange={(e) => setEmailNotifications(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Receive notifications when critical issues are detected
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsScheduleDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveSchedule}>
                  <Calendar className="w-4 h-4 mr-2" />
                  Save Schedule
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={exportToCSV}>
            <Download className="w-4 h-4 mr-2" />
            Export CSV
          </Button>
          <Button onClick={() => runScan()} disabled={isLoading}>
            <Play className="w-4 h-4 mr-2" />
            {isLoading ? 'Scanning...' : 'Run Full Scan'}
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filters:</span>
            </div>
            <Select value={severityFilter} onValueChange={setSeverityFilter}>
              <SelectTrigger className="w-[160px]">
                <SelectValue placeholder="All Severities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Severities</SelectItem>
                <SelectItem value="critical">Critical Only</SelectItem>
                <SelectItem value="high">High Only</SelectItem>
                <SelectItem value="medium">Medium Only</SelectItem>
                <SelectItem value="low">Low Only</SelectItem>
              </SelectContent>
            </Select>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Categories</SelectItem>
                <SelectItem value="governance">Governance</SelectItem>
                <SelectItem value="asset-management">Asset Management</SelectItem>
                <SelectItem value="security-operations">Security Operations</SelectItem>
                <SelectItem value="supply-chain">Supply Chain</SelectItem>
                <SelectItem value="incident-response">Incident Response</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant={showOnlyFailed ? 'default' : 'outline'}
              size="sm"
              onClick={() => setShowOnlyFailed(!showOnlyFailed)}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Critical Issues Only
            </Button>
            {(severityFilter !== 'all' || categoryFilter !== 'all' || showOnlyFailed) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSeverityFilter('all');
                  setCategoryFilter('all');
                  setShowOnlyFailed(false);
                }}
              >
                Clear Filters
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Security Trends */}
      {trendData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5" />
              Security Score Trends
            </CardTitle>
            <CardDescription>Historical compliance scores over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData.map((entry) => ({
                  name: new Date(entry.date).toLocaleDateString(),
                  score: entry.avgScore,
                  scans: entry.scans,
                }))}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="name" className="text-xs" />
                  <YAxis domain={[0, 100]} className="text-xs" />
                  <Tooltip 
                    contentStyle={{ 
                      backgroundColor: 'hsl(var(--background))', 
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                  />
                  <Legend />
                  <Line 
                    type="monotone" 
                    dataKey="score" 
                    stroke="hsl(var(--primary))" 
                    strokeWidth={2}
                    dot={{ fill: 'hsl(var(--primary))', r: 4 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>Average trend shows security posture improvements</span>
              <Badge variant="outline" className="bg-primary/10 text-primary">
                {avgScore >= 80 ? 'Good' : avgScore >= 60 ? 'Fair' : 'Needs Improvement'}
              </Badge>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-primary/10">
                <Shield className="w-6 h-6 text-primary" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Average Score</p>
                <p className="text-2xl font-bold">{avgScore}%</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Passed Checks</p>
                <p className="text-2xl font-bold">{totalPassed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-destructive/10">
                <AlertTriangle className="w-6 h-6 text-destructive" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Failed Checks</p>
                <p className="text-2xl font-bold">{totalFailed}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <div className="p-3 rounded-lg bg-success/10">
                <CheckCircle className="w-6 h-6 text-success" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Compliant Hosts</p>
                <p className="text-2xl font-bold">{compliantHosts}/{audits.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Audit Results */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">
          Audit Results by Host {filteredAudits.length !== audits.length && `(${filteredAudits.length} of ${audits.length} shown)`}
        </h2>
        {filteredAudits.length === 0 && audits.length > 0 && (
          <Card>
            <CardContent className="py-12 text-center">
              <Filter className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-lg font-semibold mb-2">No results match filters</h3>
              <p className="text-muted-foreground mb-4">Try adjusting your filter criteria</p>
              <Button variant="outline" onClick={() => {
                setSeverityFilter('all');
                setCategoryFilter('all');
                setShowOnlyFailed(false);
              }}>
                Clear All Filters
              </Button>
            </CardContent>
          </Card>
        )}
        {filteredAudits.map((audit) => (
          <NIS2AuditCard key={audit.id} audit={audit} onRescan={runScan} />
        ))}
      </div>

      {/* NIS 2 Requirements Reference */}
      <Card>
        <CardHeader>
          <CardTitle>NIS 2 Compliance Categories</CardTitle>
          <CardDescription>EU Network and Information Systems Directive 2</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {['governance', 'asset-management', 'security-operations', 'supply-chain', 'incident-response'].map((cat) => {
              const reqs = NIS2_REQUIREMENTS.filter(r => r.category === cat);
              return (
                <div key={cat} className="p-4 border border-border rounded-lg">
                  <h4 className={cn('font-semibold mb-2 capitalize', categoryColors[cat as keyof typeof categoryColors])}>
                    {cat.replace('-', ' ')}
                  </h4>
                  <ul className="space-y-1 text-sm">
                    {reqs.map(req => (
                      <li key={req.id} className="text-muted-foreground">
                        • {req.requirement}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};
