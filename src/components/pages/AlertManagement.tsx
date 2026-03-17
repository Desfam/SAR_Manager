import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AlertCircle, Bell, CheckCircle, AlertTriangle, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { API_CONFIG } from '@/services/api-config';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Alert {
  id: number;
  connection_id: string;
  alert_type: string;
  actual_value: number;
  threshold_value: number;
  severity: 'warning' | 'critical' | 'info';
  message: string;
  is_resolved: number;
  created_at: string;
  resolved_at: string | null;
}

interface AlertThresholds {
  cpu_warning: number;
  cpu_critical: number;
  memory_warning: number;
  memory_critical: number;
  disk_warning: number;
  disk_critical: number;
}

interface Connection {
  id: string;
  name: string;
  status: string;
}

const ALERTS_CONNECTION_STORAGE_KEY = 'alertsConnectionId';

export const AlertManagement: React.FC = () => {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [selectedConnectionId, setSelectedConnectionId] = useState<string>('');
  const [thresholds, setThresholds] = useState<AlertThresholds>({
    cpu_warning: 70,
    cpu_critical: 85,
    memory_warning: 75,
    memory_critical: 90,
    disk_warning: 80,
    disk_critical: 95,
  });
  const [activeAlerts, setActiveAlerts] = useState<Alert[]>([]);
  const [recentAlerts, setRecentAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchConnections();
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 30000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedConnectionId) {
      fetchThresholds(selectedConnectionId);
    }
  }, [selectedConnectionId]);

  const fetchConnections = async () => {
    try {
      const response = await fetch(`${API_CONFIG.baseURL}/connections`);
      const data = await response.json();
      const allConnections = (data || []) as Connection[];
      setConnections(allConnections);

      const preferredConnectionId = localStorage.getItem(ALERTS_CONNECTION_STORAGE_KEY);
      const preferredExists = !!preferredConnectionId && allConnections.some((conn) => conn.id === preferredConnectionId);

      if (!selectedConnectionId) {
        if (preferredExists && preferredConnectionId) {
          setSelectedConnectionId(preferredConnectionId);
        } else if (allConnections.length > 0) {
          setSelectedConnectionId(allConnections[0].id);
        }
      }

      localStorage.removeItem(ALERTS_CONNECTION_STORAGE_KEY);
    } catch (err) {
      console.error('Failed to fetch connections:', err);
    }
  };

  const fetchThresholds = async (connectionId: string) => {
    try {
      setLoading(true);
      const response = await fetch(
        `${API_CONFIG.baseURL}/connections/${connectionId}/alert-thresholds`
      );
      const data = await response.json();
      setThresholds(data);
    } catch (err) {
      console.error('Failed to fetch thresholds:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAlerts = async () => {
    try {
      const [activeRes, recentRes] = await Promise.all([
        fetch(`${API_CONFIG.baseURL}/connections/alerts/active`),
        fetch(`${API_CONFIG.baseURL}/connections/alerts/recent?hours=24`),
      ]);

      const active = await activeRes.json();
      const recent = await recentRes.json();

      setActiveAlerts(active || []);
      setRecentAlerts(recent || []);
    } catch (err) {
      console.error('Failed to fetch alerts:', err);
    }
  };

  const saveThresholds = async () => {
    if (!selectedConnectionId) return;

    try {
      setSaving(true);
      await fetch(
        `${API_CONFIG.baseURL}/connections/${selectedConnectionId}/alert-thresholds`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(thresholds),
        }
      );
      alert('Thresholds saved successfully!');
    } catch (err) {
      console.error('Failed to save thresholds:', err);
      alert('Failed to save thresholds');
    } finally {
      setSaving(false);
    }
  };

  const resolveAlert = async (alertId: number) => {
    try {
      await fetch(`${API_CONFIG.baseURL}/connections/alerts/${alertId}/resolve`, {
        method: 'POST',
      });
      fetchAlerts();
    } catch (err) {
      console.error('Failed to resolve alert:', err);
    }
  };

  const getSeverityIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-yellow-500" />;
      default:
        return <AlertCircle className="w-4 h-4 text-blue-500" />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-500/20 text-red-700';
      case 'warning':
        return 'bg-yellow-500/20 text-yellow-700';
      default:
        return 'bg-blue-500/20 text-blue-700';
    }
  };

  const selectedConnection = connections.find(c => c.id === selectedConnectionId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-orange-500/20 flex items-center justify-center">
            <Bell className="w-5 h-5 text-orange-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Alert Management</h1>
            <p className="text-sm text-muted-foreground">Configure thresholds and view alerts</p>
          </div>
        </div>
        <Badge variant={activeAlerts.length > 0 ? 'destructive' : 'outline'}>
          {activeAlerts.length} Active
        </Badge>
      </div>

      {/* Active Alerts */}
      {activeAlerts.length > 0 && (
        <Card className="bg-red-50 border-red-200">
          <CardHeader>
            <CardTitle className="text-red-700 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              Active Alerts ({activeAlerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {activeAlerts.map((alert) => (
              <div
                key={alert.id}
                className="flex items-center justify-between p-3 bg-white rounded-lg border border-red-200"
              >
                <div className="flex items-center gap-3">
                  {getSeverityIcon(alert.severity)}
                  <div>
                    <p className="text-sm font-semibold text-foreground">
                      {alert.message || `${alert.alert_type?.toUpperCase()} at ${alert.actual_value?.toFixed(1)}%`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Threshold: {alert.threshold_value}% | {new Date(alert.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => resolveAlert(alert.id)}
                >
                  <CheckCircle className="w-4 h-4 mr-1" />
                  Resolve
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Threshold Configuration */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Threshold Configuration</CardTitle>
          <CardDescription>Set alert thresholds for each connection</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1">
              <Label>Connection</Label>
              <Select value={selectedConnectionId} onValueChange={setSelectedConnectionId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select connection" />
                </SelectTrigger>
                <SelectContent>
                  {connections.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedConnection && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
                {/* CPU Thresholds */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-400" />
                    CPU Usage
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="cpu-warning" className="text-xs">Warning (%)</Label>
                      <Input
                        id="cpu-warning"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.cpu_warning}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, cpu_warning: parseInt(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="cpu-critical" className="text-xs">Critical (%)</Label>
                      <Input
                        id="cpu-critical"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.cpu_critical}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, cpu_critical: parseInt(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Memory Thresholds */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-blue-400" />
                    Memory Usage
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="memory-warning" className="text-xs">Warning (%)</Label>
                      <Input
                        id="memory-warning"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.memory_warning}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, memory_warning: parseInt(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="memory-critical" className="text-xs">Critical (%)</Label>
                      <Input
                        id="memory-critical"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.memory_critical}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, memory_critical: parseInt(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                </div>

                {/* Disk Thresholds */}
                <div className="space-y-3">
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-purple-400" />
                    Disk Usage
                  </h3>
                  <div className="space-y-2">
                    <div>
                      <Label htmlFor="disk-warning" className="text-xs">Warning (%)</Label>
                      <Input
                        id="disk-warning"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.disk_warning}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, disk_warning: parseInt(e.target.value) })
                        }
                      />
                    </div>
                    <div>
                      <Label htmlFor="disk-critical" className="text-xs">Critical (%)</Label>
                      <Input
                        id="disk-critical"
                        type="number"
                        min="0"
                        max="100"
                        value={thresholds.disk_critical}
                        onChange={(e) =>
                          setThresholds({ ...thresholds, disk_critical: parseInt(e.target.value) })
                        }
                      />
                    </div>
                  </div>
                </div>
              </div>

              <Button onClick={saveThresholds} disabled={saving} className="w-full mt-4">
                {saving ? 'Saving...' : 'Save Thresholds'}
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Recent Alerts */}
      <Card className="bg-card border-border">
        <CardHeader>
          <CardTitle>Recent Alerts (Last 24 Hours)</CardTitle>
          <CardDescription>{recentAlerts.length} total alerts</CardDescription>
        </CardHeader>
        <CardContent>
          {recentAlerts.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle className="w-8 h-8 mx-auto mb-2 text-emerald-500" />
              <p>No alerts in the last 24 hours</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-96 overflow-y-auto">
              {recentAlerts.map((alert) => (
                <div
                  key={alert.id}
                  className={cn(
                    'flex items-center justify-between p-3 rounded-lg border',
                    alert.is_resolved ? 'bg-muted/50 border-border' : 'bg-card border-border'
                  )}
                >
                  <div className="flex items-center gap-3">
                    {getSeverityIcon(alert.severity)}
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {alert.message || `${alert.alert_type?.toUpperCase()} at ${alert.actual_value?.toFixed(1)}%`}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {new Date(alert.created_at).toLocaleString()}
                      </p>
                    </div>
                  </div>
                  <Badge className={getSeverityBadge(alert.severity)}>
                    {alert.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};
