// SAR alerting: thresholds, alerts, notification settings and log (backend/src/routes/alerting.ts)
import { API_CONFIG } from './api-config';

export type AlertType = 'cpu' | 'memory' | 'disk' | 'offline';
export type Level = 'warning' | 'critical';

export interface AlertSettings {
  sustainChecks: number;
  offline: { enabled: boolean; afterChecks: number };
  notify: { minSeverity: Level; types: Record<AlertType, boolean>; onResolve: boolean; cooldownMinutes: number };
  channels: {
    desktop: { enabled: boolean; sound: boolean };
    ntfy: { enabled: boolean; server: string; topic: string; token: string };
    discord: { enabled: boolean; webhookUrl: string };
    webhook: { enabled: boolean; url: string };
  };
}

export interface Thresholds {
  cpuWarning: number;
  cpuCritical: number;
  memoryWarning: number;
  memoryCritical: number;
  diskWarning: number;
  diskCritical: number;
}

export interface ThresholdOverview {
  global: Thresholds;
  overrides: Array<Thresholds & { connectionId: string; connectionName: string }>;
}

export interface Alert {
  id: number;
  connectionId: string;
  connectionName: string;
  host?: string;
  type: AlertType | 'service';
  severity: Level | 'info';
  message: string;
  threshold: number | null;
  value: number | null;
  resolved: boolean;
  createdAt: string;
  resolvedAt: string | null;
}

export interface NotificationEntry {
  id: number;
  kind: 'triggered' | 'escalated' | 'resolved' | 'test';
  severity: Level | 'info';
  title: string;
  body: string;
  connectionId?: string;
  alertType?: AlertType;
  channels: Record<string, string>;
  createdAt: string;
  sound: boolean;
  desktop: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_CONFIG.baseURL}/alerting${path}`, { ...init, headers: init?.body ? { 'Content-Type': 'application/json' } : undefined });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data as T;
}

export const alertingApi = {
  settings: () => request<AlertSettings>('/settings'),
  saveSettings: (settings: AlertSettings) => request<AlertSettings>('/settings', { method: 'PUT', body: JSON.stringify(settings) }),
  thresholds: () => request<ThresholdOverview>('/thresholds'),
  saveGlobal: (thresholds: Thresholds) => request<ThresholdOverview>('/thresholds/global', { method: 'PUT', body: JSON.stringify(thresholds) }),
  saveOverride: (connectionId: string, thresholds: Thresholds) => request<ThresholdOverview>(`/thresholds/${encodeURIComponent(connectionId)}`, { method: 'PUT', body: JSON.stringify(thresholds) }),
  deleteOverride: (connectionId: string) => request<ThresholdOverview>(`/thresholds/${encodeURIComponent(connectionId)}`, { method: 'DELETE' }),
  alerts: (status: 'active' | 'history', days = 7) => request<Alert[]>(`/alerts?status=${status}&days=${days}`),
  resolve: (id: number) => request<{ resolved: boolean }>(`/alerts/${id}/resolve`, { method: 'POST' }),
  notifications: (after = 0, limit = 50) => request<NotificationEntry[]>(`/notifications?after=${after}&limit=${limit}`),
  test: () => request<{ id: number; channels: Record<string, string> }>('/notifications/test', { method: 'POST' }),
};
