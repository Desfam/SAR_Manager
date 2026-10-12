import { useQuery } from '@tanstack/react-query';
import { alertingApi } from '@/services/alerting';

export const alertingKeys = {
  all: ['infra', 'alerting'] as const,
  settings: ['infra', 'alerting', 'settings'] as const,
  thresholds: ['infra', 'alerting', 'thresholds'] as const,
  active: ['infra', 'alerting', 'active'] as const,
  history: (days: number) => ['infra', 'alerting', 'history', days] as const,
  notifications: ['infra', 'alerting', 'notifications'] as const,
};

export const useAlertSettings = () => useQuery({ queryKey: alertingKeys.settings, queryFn: alertingApi.settings });
export const useThresholds = () => useQuery({ queryKey: alertingKeys.thresholds, queryFn: alertingApi.thresholds });
export const useActiveAlerts = () => useQuery({ queryKey: alertingKeys.active, queryFn: () => alertingApi.alerts('active'), refetchInterval: 15_000 });
export const useAlertHistory = (days: number) => useQuery({ queryKey: alertingKeys.history(days), queryFn: () => alertingApi.alerts('history', days), refetchInterval: 60_000 });
export const useNotificationLog = () => useQuery({ queryKey: alertingKeys.notifications, queryFn: () => alertingApi.notifications(0, 40), refetchInterval: 15_000 });
