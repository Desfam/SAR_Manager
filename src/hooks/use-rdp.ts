import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { API_CONFIG } from '@/services/api-config';

/** Opens Remmina on this desktop for a stored RDP connection (see backend route /connections/:id/rdp/launch). */
export function useRdpLaunch() {
  return useMutation({
    mutationFn: async (connection: { id: string; name: string }) => {
      const response = await fetch(`${API_CONFIG.baseURL}/connections/${encodeURIComponent(connection.id)}/rdp/launch`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
      return data as { withPassword: boolean };
    },
    onSuccess: (data, connection) =>
      toast.success(`Remmina öffnet ${connection.name}`, { description: data.withPassword ? undefined : 'Kein Passwort gespeichert, Remmina fragt danach.' }),
    onError: (failure: Error, connection) => toast.error(`RDP zu ${connection.name} fehlgeschlagen`, { description: failure.message }),
  });
}
