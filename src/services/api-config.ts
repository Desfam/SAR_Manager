// API Configuration for connecting frontend to backend

export const API_CONFIG = {
  // Backend API base URL
  // For development: http://localhost:3001
  // For production: Will use the same host (proxied through nginx)
  baseURL: import.meta.env.PROD ? '/api' : 'http://localhost:3001/api',
  
  // WebSocket URL for terminal connections
  wsURL: import.meta.env.PROD 
    ? `ws://${window.location.host}/terminal`
    : 'ws://localhost:3001/terminal',
  
  // Request timeout
  timeout: 30000,
  
  // Retry configuration
  retry: {
    attempts: 3,
    delay: 1000,
  },
};

// API Endpoints
export const API_ENDPOINTS = {
  // Auth
  auth: {
    status: '/auth/status',
    login: '/auth/login',
    me: '/auth/me',
    bootstrapAdmin: '/auth/bootstrap-admin',
    users: '/auth/users',
    userById: (id: string) => `/auth/users/${id}`,
  },

  // Connections
  connections: {
    list: '/connections',
    get: (id: string) => `/connections/${id}`,
    create: '/connections',
    update: (id: string) => `/connections/${id}`,
    delete: (id: string) => `/connections/${id}`,
    test: (id: string) => `/connections/${id}/test`,
    sysinfo: (id: string) => `/connections/${id}/sysinfo`,
    sshKeyEnsure: '/connections/ssh-key/ensure',
    sshKeyTest: (id: string) => `/connections/${id}/ssh-key/test`,
    sshKeySetup: (id: string) => `/connections/${id}/ssh-key/setup`,
  },
  
  // Docker
  docker: {
    status: '/docker/status',
    info: '/docker/info',
    stats: '/docker/stats',
    containers: '/docker/containers',
    container: (id: string) => `/docker/containers/${id}`,
    start: (id: string) => `/docker/containers/${id}/start`,
    stop: (id: string) => `/docker/containers/${id}/stop`,
    restart: (id: string) => `/docker/containers/${id}/restart`,
    logs: (id: string) => `/docker/containers/${id}/logs`,
    containerStats: (id: string) => `/docker/containers/${id}/stats`,
    images: '/docker/images',
    pullImage: '/docker/images/pull',
  },
  
  // Diagnostics
  diagnostics: {
    ping: '/diagnostics/ping',
    traceroute: '/diagnostics/traceroute',
    port: '/diagnostics/port',
    dns: '/diagnostics/dns',
    rdns: '/diagnostics/rdns',
    whois: '/diagnostics/whois',
    portscan: '/diagnostics/portscan',
    portPresets: '/diagnostics/port-presets',
    interfaces: '/diagnostics/interfaces',
    routes: '/diagnostics/routes',
    connections: '/diagnostics/connections',
  },
  
  // Scripts
  scripts: {
    list: '/scripts',
    get: (id: string) => `/scripts/${id}`,
    create: '/scripts',
    update: (id: string) => `/scripts/${id}`,
    delete: (id: string) => `/scripts/${id}`,
    execute: (id: string) => `/scripts/${id}/execute`,
    executions: (id: string) => `/scripts/${id}/executions`,
  },
  
  // System
  system: {
    info: '/system/info',
    cpu: '/system/cpu',
    memory: '/system/memory',
    disk: '/system/disk',
    network: '/system/network',
    processes: '/system/processes',
    uptime: '/system/uptime',
    auditLogs: '/system/audit-logs',
  },

  // Audit
  audit: {
    list: '/system/audit-logs',
  },

  // Port forwards
  portForwards: {
    list: '/port-forwards',
    create: '/port-forwards',
    toggle: (id: string) => `/port-forwards/${id}/toggle`,
    delete: (id: string) => `/port-forwards/${id}`,
  },

  // Proxmox
  proxmox: {
    status: (target?: string) => {
      const params = new URLSearchParams();
      if (target) params.set('target', target);
      const query = params.toString();
      return `/proxmox/status${query ? `?${query}` : ''}`;
    },
    nodes: (target?: string) => {
      const params = new URLSearchParams();
      if (target) params.set('target', target);
      const query = params.toString();
      return `/proxmox/nodes${query ? `?${query}` : ''}`;
    },
    vms: (node: string, target?: string) => {
      const params = new URLSearchParams();
      params.set('node', node);
      if (target) params.set('target', target);
      return `/proxmox/vms?${params.toString()}`;
    },
    startVm: (node: string, type: 'qemu' | 'lxc', vmid: number | string) =>
      `/proxmox/vms/${encodeURIComponent(node)}/${type}/${encodeURIComponent(String(vmid))}/start`,
    stopVm: (node: string, type: 'qemu' | 'lxc', vmid: number | string) =>
      `/proxmox/vms/${encodeURIComponent(node)}/${type}/${encodeURIComponent(String(vmid))}/stop`,
  },
  
  // Health
  health: '/health',
};
