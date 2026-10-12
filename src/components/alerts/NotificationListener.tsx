import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { alertingKeys } from '@/hooks/use-alerting';
import { alertingApi } from '@/services/alerting';

/**
 * In-app side of alert notifications: a toast for every new entry of the notification log.
 * In the desktop app the native notification comes from the Electron main process; in a plain browser
 * this also shows a browser notification (after permission).
 */
export function NotificationListener() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const lastId = useRef<number | null>(null);
  const latest = useQuery({ queryKey: [...alertingKeys.notifications, 'feed'], queryFn: () => alertingApi.notifications(0, 10), refetchInterval: 10_000, retry: false });

  useEffect(() => window.sarDesktop?.onNavigate?.((path) => navigate(path)), [navigate]);

  useEffect(() => {
    const entries = latest.data;
    if (!entries) return;
    const newest = entries[0]?.id ?? 0;
    // first load: remember the position, don't replay
    if (lastId.current === null) {
      lastId.current = newest;
      return;
    }
    const fresh = entries.filter((entry) => entry.id > lastId.current!).reverse();
    if (!fresh.length) return;
    lastId.current = newest;
    void queryClient.invalidateQueries({ queryKey: alertingKeys.all });
    void queryClient.invalidateQueries({ queryKey: ['infra', 'host-alerts'] });
    fresh.forEach((entry) => {
      const show = entry.kind === 'resolved' ? toast.success : entry.severity === 'critical' ? toast.error : entry.severity === 'warning' ? toast.warning : toast.info;
      show(entry.title, { description: entry.body, duration: entry.severity === 'critical' ? 15_000 : 6_000, action: { label: 'Alerts', onClick: () => navigate('/alerts') } });
      if (!window.sarDesktop && entry.desktop && 'Notification' in window) {
        if (Notification.permission === 'granted') new Notification(entry.title, { body: entry.body });
        else if (Notification.permission === 'default') void Notification.requestPermission();
      }
    });
  }, [latest.data, navigate, queryClient]);

  return null;
}
