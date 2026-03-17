// API Service Layer for SSH & RDP Manager

import { API_CONFIG, API_ENDPOINTS } from './api-config';
import { SSHConnection, RDPConnection, DockerContainer, Script, SecurityAudit, AuditLog } from '@/types/connection';

const AUTH_TOKEN_KEY = 'authToken';

export function getAuthToken(): string | null {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAuthToken(token: string): void {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearAuthToken(): void {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

export interface ProxmoxNode {
  node: string;
  status?: string;
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  [key: string]: any;
}

export interface ProxmoxVm {
  vmid: number;
  name?: string;
  status?: string;
  node?: string;
  type: 'qemu' | 'lxc';
  cpu?: number;
  maxcpu?: number;
  mem?: number;
  maxmem?: number;
  [key: string]: any;
}

export interface AppUser {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
  is_active?: number;
  created_at?: string;
  last_login?: string | null;
}

export interface AgentSummary {
  id: string;
  name: string;
  hostname: string;
  os: string;
  platform: string;
  version: string;
  tags: string[];
  environment: string;
  status: 'online' | 'offline' | 'error';
  last_seen: string;
  created_at: string;
  updated_at: string;
}

export interface AgentSecurityAlert {
  id: number;
  agent_id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  evidence?: string;
  is_resolved: number;
  created_at: string;
}

export interface InfrastructureAlert {
  id: number;
  connection_id: string;
  metric_type: string;
  metric_value: number;
  threshold: number;
  severity: 'warning' | 'critical' | 'info';
  resolved: number;
  created_at: string;
  resolved_at: string | null;
}

export interface ScriptExecution {
  id: number;
  script_id: string;
  connection_id: string;
  status: 'running' | 'success' | 'failed';
  output?: string | null;
  error?: string | null;
  started_at: string;
  finished_at?: string | null;
}

// Helper function to make API requests
async function apiRequest<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_CONFIG.baseURL}${endpoint}`;
  const token = getAuthToken();
  
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

export const authAPI = {
  status: async (): Promise<{ enabled: boolean }> => {
    return apiRequest(API_ENDPOINTS.auth.status);
  },

  login: async (username: string, password: string): Promise<{ token: string; user: AppUser }> => {
    const result = await apiRequest<{ token: string; user: AppUser }>(API_ENDPOINTS.auth.login, {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (result.token) {
      setAuthToken(result.token);
    }

    return result;
  },

  me: async (): Promise<{ user: AppUser | null; enabled: boolean }> => {
    return apiRequest(API_ENDPOINTS.auth.me);
  },

  logout: (): void => {
    clearAuthToken();
  },

  bootstrapAdmin: async (payload: { username: string; email: string; password: string }): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.auth.bootstrapAdmin, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};

export const usersAPI = {
  list: async (): Promise<AppUser[]> => {
    return apiRequest(API_ENDPOINTS.auth.users);
  },

  create: async (payload: { username: string; email: string; password: string; role: 'admin' | 'user' | 'readonly' }): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.auth.users, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  update: async (id: string, payload: { role?: 'admin' | 'user' | 'readonly'; isActive?: boolean }): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.auth.userById(id), {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.auth.userById(id), {
      method: 'DELETE',
    });
  },
};

// Connection API
export const connectionAPI = {
  // Get all connections
  getAll: async (): Promise<(SSHConnection | RDPConnection)[]> => {
    return apiRequest(API_ENDPOINTS.connections.list);
  },

  // Get single connection
  get: async (id: string): Promise<SSHConnection | RDPConnection> => {
    return apiRequest(API_ENDPOINTS.connections.get(id));
  },

  // Create connection
  create: async (data: Partial<SSHConnection | RDPConnection>): Promise<{ id: string; message: string }> => {
    return apiRequest(API_ENDPOINTS.connections.create, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update connection
  update: async (id: string, data: Partial<SSHConnection | RDPConnection>): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.connections.update(id), {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete connection
  delete: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.connections.delete(id), {
      method: 'DELETE',
    });
  },

  // Test connection
  test: async (id: string): Promise<{ success: boolean; message: string; sysinfo?: any }> => {
    return apiRequest(API_ENDPOINTS.connections.test(id), {
      method: 'POST',
    });
  },

  // Get system info
  getSysInfo: async (id: string): Promise<any> => {
    return apiRequest(API_ENDPOINTS.connections.sysinfo(id));
  },

  // Ensure SSH key exists
  ensureSSHKey: async (keyPath?: string): Promise<any> => {
    return apiRequest(API_ENDPOINTS.connections.sshKeyEnsure, {
      method: 'POST',
      body: JSON.stringify({ keyPath }),
    });
  },

  // Test SSH key for connection
  testSSHKey: async (id: string, keyPath?: string): Promise<any> => {
    return apiRequest(API_ENDPOINTS.connections.sshKeyTest(id), {
      method: 'POST',
      body: JSON.stringify({ keyPath }),
    });
  },

  // Setup SSH key on remote host
  setupSSHKey: async (id: string, keyPath?: string): Promise<any> => {
    return apiRequest(API_ENDPOINTS.connections.sshKeySetup(id), {
      method: 'POST',
      body: JSON.stringify({ keyPath }),
    });
  },

  // Toggle favorite status
  toggleFavorite: async (id: string): Promise<{ message: string; is_favorite: boolean }> => {
    return apiRequest(`/connections/${id}/favorite`, {
      method: 'PATCH',
    });
  },

  // Update connection group
  updateGroup: async (id: string, group: string): Promise<{ message: string; group: string | null }> => {
    return apiRequest(`/connections/${id}/group`, {
      method: 'PATCH',
      body: JSON.stringify({ group }),
    });
  },

  // Get all unique groups
  getGroups: async (): Promise<string[]> => {
    return apiRequest('/connections/groups/list');
  },
};

// Docker API
export const dockerAPI = {
  // Scan all connections for Docker containers
  scanAll: async (): Promise<DockerContainer[]> => {
    return apiRequest('/docker/scan-all');
  },

  // Remote container actions (via SSH)
  remote: {
    start: async (hostId: string, containerId: string): Promise<{ message: string }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}/start`, {
        method: 'POST',
      });
    },

    stop: async (hostId: string, containerId: string): Promise<{ message: string }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}/stop`, {
        method: 'POST',
      });
    },

    restart: async (hostId: string, containerId: string): Promise<{ message: string }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}/restart`, {
        method: 'POST',
      });
    },

    remove: async (hostId: string, containerId: string, force = false): Promise<{ message: string }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}?force=${force}`, {
        method: 'DELETE',
      });
    },

    getLogs: async (hostId: string, containerId: string, tail = 100): Promise<{ logs: string }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}/logs?tail=${tail}`);
    },

    inspect: async (hostId: string, containerId: string): Promise<{ data: any }> => {
      return apiRequest(`/docker/remote/containers/${hostId}/${containerId}/inspect`);
    },
  },

  // Get Docker status
  getStatus: async (): Promise<{ available: boolean; running: boolean }> => {
    return apiRequest(API_ENDPOINTS.docker.status);
  },

  // Get Docker info
  getInfo: async (): Promise<any> => {
    return apiRequest(API_ENDPOINTS.docker.info);
  },

  // Get all containers
  getContainers: async (): Promise<DockerContainer[]> => {
    return apiRequest(API_ENDPOINTS.docker.containers);
  },

  // Get container details
  getContainer: async (id: string): Promise<DockerContainer> => {
    return apiRequest(API_ENDPOINTS.docker.container(id));
  },

  // Start container
  start: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.docker.start(id), {
      method: 'POST',
    });
  },

  // Stop container
  stop: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.docker.stop(id), {
      method: 'POST',
    });
  },

  // Restart container
  restart: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.docker.restart(id), {
      method: 'POST',
    });
  },

  // Get container logs
  getLogs: async (id: string): Promise<{ logs: string }> => {
    return apiRequest(API_ENDPOINTS.docker.logs(id));
  },

  // Get container stats
  getStats: async (id: string): Promise<any> => {
    return apiRequest(API_ENDPOINTS.docker.containerStats(id));
  },
};

// Scripts API
export const scriptsAPI = {
  // Get all scripts
  getAll: async (): Promise<Script[]> => {
    return apiRequest(API_ENDPOINTS.scripts.list);
  },

  // Create script
  create: async (data: Partial<Script>): Promise<{ id: string; message: string }> => {
    return apiRequest(API_ENDPOINTS.scripts.create, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update script
  update: async (id: string, data: Partial<Script>): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.scripts.update(id), {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete script
  delete: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.scripts.delete(id), {
      method: 'DELETE',
    });
  },

  // Execute script
  execute: async (id: string, connectionId: string): Promise<{
    executionId: number;
    message: string;
    status: 'success' | 'failed';
    output: string;
    error?: string;
    exitCode: number;
  }> => {
    return apiRequest(API_ENDPOINTS.scripts.execute(id), {
      method: 'POST',
      body: JSON.stringify({ connectionId }),
    });
  },

  getExecutions: async (id: string): Promise<ScriptExecution[]> => {
    return apiRequest(API_ENDPOINTS.scripts.executions(id));
  },
};

// Diagnostics API
export const diagnosticsAPI = {
  // Ping host
  ping: async (host: string, count?: number): Promise<{ success: boolean; output: string; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.ping, {
      method: 'POST',
      body: JSON.stringify({ host, count: count || 4 }),
    });
  },

  // Traceroute
  traceroute: async (host: string): Promise<{ success: boolean; output: string; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.traceroute, {
      method: 'POST',
      body: JSON.stringify({ host }),
    });
  },

  // DNS lookup
  dnsLookup: async (hostname: string): Promise<{ success: boolean; output: string; addresses?: string[]; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.dns, {
      method: 'POST',
      body: JSON.stringify({ hostname }),
    });
  },

  // Port test
  testPort: async (host: string, port: number, timeout?: number): Promise<{ success: boolean; open: boolean; output: string; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.port, {
      method: 'POST',
      body: JSON.stringify({ host, port, timeout }),
    });
  },

  // Port scan
  portScan: async (host: string, ports?: number[], preset?: string): Promise<{ success: boolean; output: string; openPorts?: any[]; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.portscan, {
      method: 'POST',
      body: JSON.stringify({ host, ports, preset }),
    });
  },

  // WHOIS lookup
  whois: async (target: string): Promise<{ success: boolean; output: string; error?: string }> => {
    return apiRequest(API_ENDPOINTS.diagnostics.whois, {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  },

  // Get port presets
  getPortPresets: async (): Promise<any> => {
    return apiRequest(API_ENDPOINTS.diagnostics.portPresets);
  },

  // Get network interfaces
  getInterfaces: async (): Promise<any> => {
    return apiRequest(API_ENDPOINTS.diagnostics.interfaces);
  },
};

// System API
export const systemAPI = {
  // Get system stats
  getStats: async (): Promise<any> => {
    return apiRequest(API_ENDPOINTS.system.stats);
  },

  // Ping host
  ping: async (host: string): Promise<{ alive: boolean; time: number; output: string }> => {
    return apiRequest(API_ENDPOINTS.system.ping, {
      method: 'POST',
      body: JSON.stringify({ host }),
    });
  },

  // Traceroute
  traceroute: async (host: string): Promise<{ hops: any[] }> => {
    return apiRequest(API_ENDPOINTS.system.traceroute, {
      method: 'POST',
      body: JSON.stringify({ host }),
    });
  },

  // DNS lookup
  dnsLookup: async (host: string): Promise<{ addresses: string[] }> => {
    return apiRequest(API_ENDPOINTS.system.dnsLookup, {
      method: 'POST',
      body: JSON.stringify({ host }),
    });
  },

  // Port scan
  portScan: async (host: string, ports: string): Promise<{ openPorts: number[] }> => {
    return apiRequest(API_ENDPOINTS.system.portScan, {
      method: 'POST',
      body: JSON.stringify({ host, ports }),
    });
  },

  // Whois
  whois: async (domain: string): Promise<{ data: string }> => {
    return apiRequest(API_ENDPOINTS.system.whois, {
      method: 'POST',
      body: JSON.stringify({ domain }),
    });
  },
};

// Audit Logs API
export const auditAPI = {
  // Get all audit logs
  getAll: async (filters?: { action?: string; status?: string; limit?: number }): Promise<AuditLog[]> => {
    const params = new URLSearchParams();
    if (filters?.action) params.append('action', filters.action);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.limit) params.append('limit', filters.limit.toString());
    
    const query = params.toString() ? `?${params.toString()}` : '';
    return apiRequest(`${API_ENDPOINTS.audit.list}${query}`);
  },
};

export const alertsAPI = {
  getActive: async (): Promise<InfrastructureAlert[]> => {
    return apiRequest('/connections/alerts/active');
  },
};

export const agentsAPI = {
  getAll: async (): Promise<AgentSummary[]> => {
    return apiRequest('/agents');
  },

  getActiveAlerts: async (): Promise<AgentSecurityAlert[]> => {
    return apiRequest('/agents/alerts/active');
  },
};

export const portForwardsAPI = {
  getAll: async (): Promise<any[]> => {
    return apiRequest(API_ENDPOINTS.portForwards.list);
  },

  create: async (data: {
    name: string;
    type: 'local' | 'remote' | 'dynamic';
    localPort: number;
    remoteHost: string;
    remotePort: number;
    hostId: string;
  }): Promise<{ id: string; message: string }> => {
    return apiRequest(API_ENDPOINTS.portForwards.create, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  toggle: async (id: string): Promise<{ message: string; status: 'active' | 'stopped' }> => {
    return apiRequest(API_ENDPOINTS.portForwards.toggle(id), {
      method: 'PATCH',
    });
  },

  delete: async (id: string): Promise<{ message: string }> => {
    return apiRequest(API_ENDPOINTS.portForwards.delete(id), {
      method: 'DELETE',
    });
  },
};

export const proxmoxAPI = {
  getStatus: async (): Promise<{
    connected: boolean;
    version?: {
      version: string;
      release: string;
      repoid: string;
    };
    apiUrl?: string;
    insecureTls?: boolean;
    error?: string;
  }> => {
    return apiRequest(API_ENDPOINTS.proxmox.status());
  },

  getStatusForTarget: async (target?: string): Promise<{
    connected: boolean;
    version?: {
      version: string;
      release: string;
      repoid: string;
    };
    apiUrl?: string;
    insecureTls?: boolean;
    error?: string;
  }> => {
    return apiRequest(API_ENDPOINTS.proxmox.status(target));
  },

  getNodes: async (target?: string): Promise<ProxmoxNode[]> => {
    return apiRequest(API_ENDPOINTS.proxmox.nodes(target));
  },

  getVms: async (node: string, target?: string): Promise<ProxmoxVm[]> => {
    return apiRequest(API_ENDPOINTS.proxmox.vms(node, target));
  },

  startVm: async (
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number | string,
    target?: string
  ): Promise<{ message: string; upid?: string }> => {
    return apiRequest(API_ENDPOINTS.proxmox.startVm(node, type, vmid), {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  },

  stopVm: async (
    node: string,
    type: 'qemu' | 'lxc',
    vmid: number | string,
    target?: string
  ): Promise<{ message: string; upid?: string }> => {
    return apiRequest(API_ENDPOINTS.proxmox.stopVm(node, type, vmid), {
      method: 'POST',
      body: JSON.stringify({ target }),
    });
  },
};

// SSH Keys API
export const sshKeysAPI = {
  // Get all SSH keys
  getAll: async (): Promise<Array<{
    name: string;
    publicKey: string;
    createdAt: string;
    path: string;
  }>> => {
    return apiRequest('/ssh-keys');
  },

  // Get specific SSH key
  get: async (name: string): Promise<{
    name: string;
    publicKey: string;
    path: string;
  }> => {
    return apiRequest(`/ssh-keys/${name}`);
  },

  // Generate new SSH key
  generate: async (data: {
    name?: string;
    passphrase?: string;
    comment?: string;
    type?: 'rsa' | 'ed25519' | 'ecdsa';
  }): Promise<{
    name: string;
    publicKey: string;
    privateKeyPath: string;
    publicKeyPath: string;
    message: string;
  }> => {
    return apiRequest('/ssh-keys/generate', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Delete SSH key
  delete: async (name: string): Promise<{ message: string }> => {
    return apiRequest(`/ssh-keys/${name}`, {
      method: 'DELETE',
    });
  },

  // Deploy SSH key to a remote server
  deploy: async (connectionId: string, keyName: string, password: string): Promise<{
    success: boolean;
    message: string;
    output: string;
  }> => {
    return apiRequest('/ssh-key-deploy/deploy', {
      method: 'POST',
      body: JSON.stringify({ connectionId, keyName, password }),
    });
  },
};

// Security API
export const securityAPI = {
  // Run security audit on a single connection
  scanConnection: async (connectionId: string): Promise<{
    success: boolean;
    audit: any;
  }> => {
    return apiRequest(`/security/scan/${connectionId}`, {
      method: 'POST',
    });
  },

  // Run security audit on all connections
  scanAll: async (): Promise<{
    success: boolean;
    audits: any[];
  }> => {
    return apiRequest('/security/scan-all', {
      method: 'POST',
    });
  },

  // Get all audit results
  getAudits: async (): Promise<{
    success: boolean;
    audits: any[];
  }> => {
    return apiRequest('/security/audits');
  },

  // Get aggregated security score trend data
  getTrends: async (): Promise<{
    success: boolean;
    trends: Array<{
      date: string;
      avgScore: number;
      minScore: number;
      maxScore: number;
      scans: number;
    }>;
  }> => {
    return apiRequest('/security/audits/trends');
  },

  // Get audit results for a specific connection
  getConnectionAudits: async (connectionId: string): Promise<{
    success: boolean;
    audits: any[];
  }> => {
    return apiRequest(`/security/audits/${connectionId}`);
  },

  // Delete an audit
  deleteAudit: async (auditId: number): Promise<{
    success: boolean;
  }> => {
    return apiRequest(`/security/audits/${auditId}`, {
      method: 'DELETE',
    });
  },
};

// Health check
export const healthCheck = async (): Promise<{ status: string; uptime: number }> => {
  return apiRequest('/health');
};
