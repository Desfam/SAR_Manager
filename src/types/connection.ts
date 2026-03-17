export interface SSHConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  status: 'online' | 'offline' | 'connecting';
  lastConnected?: string;
  tags: string[];
  os?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  uptime?: string;
  is_favorite?: number;
  connection_group?: string;
  last_seen?: string;
}

export interface RDPConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  domain?: string;
  status: 'online' | 'offline' | 'connecting';
  lastConnected?: string;
  tags: string[];
  os?: string;
  cpu?: number;
  memory?: number;
  disk?: number;
  is_favorite?: number;
  connection_group?: string;
  last_seen?: string;
}

export interface DockerContainer {
  id: string;
  name: string;
  image: string;
  status: 'running' | 'stopped' | 'paused' | 'restarting';
  ports: string[];
  created: string;
  hostId: string;
  cpu?: number;
  memory?: number;
}

export interface DiagnosticResult {
  id: string;
  type: 'ping' | 'traceroute' | 'dns' | 'port-scan' | 'whois' | 'ssl-check' | 'http-check';
  target: string;
  status: 'running' | 'completed' | 'failed';
  startTime: string;
  endTime?: string;
  result?: string;
}

export interface SecurityAudit {
  id: string;
  hostId: string;
  hostName: string;
  timestamp: string;
  score: number;
  issues: SecurityIssue[];
  status: 'running' | 'completed' | 'failed';
}

export interface SecurityIssue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  title: string;
  description: string;
  recommendation: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  user: string;
  action: string;
  target: string;
  details: string;
  status: 'success' | 'failed';
}

export interface Script {
  id: string;
  name: string;
  description: string;
  content: string;
  type: 'bash' | 'powershell' | 'python';
  lastRun?: string;
  tags: string[];
}
