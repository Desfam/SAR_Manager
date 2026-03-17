import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Clock3, Loader2, PlayCircle, Search, TerminalSquare } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { auditAPI, connectionAPI, scriptsAPI } from '@/services/api';
import type { AuditLog, Script } from '@/types/connection';
import type { ScriptExecution } from '@/services/api';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

type JobStatus = 'running' | 'success' | 'failed';
type JobSource = 'script' | 'operation';

type JobItem = {
  id: string;
  source: JobSource;
  title: string;
  target: string;
  status: JobStatus;
  startedAt: string;
  finishedAt?: string | null;
  description: string;
  output?: string | null;
};

function navigateTab(tab: string) {
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: { tab } }));
}

function toJobStatus(status?: string): JobStatus {
  if (status === 'running') return 'running';
  if (status === 'failed') return 'failed';
  return 'success';
}

function formatTime(value?: string | null) {
  if (!value) return 'n/a';
  return new Date(value).toLocaleString();
}

function formatDuration(startedAt: string, finishedAt?: string | null) {
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 'n/a';

  const totalSeconds = Math.floor((end - start) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function isOperationalAudit(log: AuditLog) {
  return !['LOGIN', 'AUTH_LOGIN', 'AUTH_ME'].includes(log.action || '');
}

export const Jobs: React.FC = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<'all' | JobSource>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');
  const [jobs, setJobs] = useState<JobItem[]>([]);

  useEffect(() => {
    void loadJobs();
  }, []);

  const loadJobs = async () => {
    setLoading(true);
    try {
      const [scripts, auditLogs, connections] = await Promise.all([
        scriptsAPI.getAll(),
        auditAPI.getAll({ limit: 250 }),
        connectionAPI.getAll(),
      ]);

      const executionsByScript = await Promise.all(
        scripts.map(async (script) => ({
          script,
          executions: await scriptsAPI.getExecutions(script.id).catch(() => [] as ScriptExecution[]),
        })),
      );

      const connectionNameById = new Map(connections.map((connection) => [connection.id, connection.name]));

      const scriptJobs = executionsByScript.flatMap(({ script, executions }) => {
        return executions.map((execution) => ({
          id: `script-${execution.id}`,
          source: 'script' as const,
          title: script.name,
          target: connectionNameById.get(execution.connection_id) || execution.connection_id,
          status: toJobStatus(execution.status),
          startedAt: execution.started_at,
          finishedAt: execution.finished_at,
          description: script.description || `${script.type} execution`,
          output: execution.error || execution.output,
        }));
      });

      const operationJobs = auditLogs
        .filter(isOperationalAudit)
        .map((log) => ({
          id: `audit-${log.id}`,
          source: 'operation' as const,
          title: log.action.replace(/_/g, ' '),
          target: log.target || 'system',
          status: toJobStatus(log.status),
          startedAt: log.timestamp,
          finishedAt: log.timestamp,
          description: log.details || 'Operational activity',
          output: undefined,
        }));

      const merged = [...scriptJobs, ...operationJobs].sort((left, right) => {
        return new Date(right.startedAt).getTime() - new Date(left.startedAt).getTime();
      });

      setJobs(merged);
    } catch (error: any) {
      toast({
        title: 'Jobs konnten nicht geladen werden',
        description: error.message || 'Die Operationshistorie ist aktuell nicht verfuegbar.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredJobs = useMemo(() => {
    return jobs.filter((job) => {
      const matchesSource = sourceFilter === 'all' || job.source === sourceFilter;
      const matchesStatus = statusFilter === 'all' || job.status === statusFilter;
      const haystack = `${job.title} ${job.target} ${job.description}`.toLowerCase();
      const matchesSearch = haystack.includes(search.trim().toLowerCase());
      return matchesSource && matchesStatus && matchesSearch;
    });
  }, [jobs, search, sourceFilter, statusFilter]);

  const summary = useMemo(() => {
    return {
      total: jobs.length,
      running: jobs.filter((job) => job.status === 'running').length,
      failed: jobs.filter((job) => job.status === 'failed').length,
      scripts: jobs.filter((job) => job.source === 'script').length,
    };
  }, [jobs]);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-muted-foreground">
            Zentrale Sicht auf Ausfuehrungen, Operationsverlauf und fehlgeschlagene Aktionen.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigateTab('scripts')}>
            <TerminalSquare className="mr-2 h-4 w-4" />
            Scripts
          </Button>
          <Button variant="outline" onClick={() => navigateTab('tasks')}>
            <Clock3 className="mr-2 h-4 w-4" />
            Tasks
          </Button>
          <Button onClick={loadJobs} disabled={loading}>
            {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlayCircle className="mr-2 h-4 w-4" />}
            Aktualisieren
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total</CardDescription>
            <CardTitle className="text-3xl">{summary.total}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Zusammengefuehrte Jobs und Operations-Events.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Running</CardDescription>
            <CardTitle className="text-3xl">{summary.running}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Aktuell laufende oder noch offene Ausfuehrungen.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Failed</CardDescription>
            <CardTitle className="text-3xl">{summary.failed}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Fehler, die unmittelbare Nacharbeit brauchen.</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Script Executions</CardDescription>
            <CardTitle className="text-3xl">{summary.scripts}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">Heute sichtbare Script-runs im gleichen Feed.</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Operations Feed</CardTitle>
          <CardDescription>Ein gemeinsamer Einstiegspunkt statt verteilte Einzelhistorien.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="pl-9"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Suche nach Job, Zielsystem oder Beschreibung..."
              />
            </div>
            <Select value={sourceFilter} onValueChange={(value: 'all' | JobSource) => setSourceFilter(value)}>
              <SelectTrigger className="w-full lg:w-44">
                <SelectValue placeholder="Quelle" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Quellen</SelectItem>
                <SelectItem value="script">Scripts</SelectItem>
                <SelectItem value="operation">Operations</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value: 'all' | JobStatus) => setStatusFilter(value)}>
              <SelectTrigger className="w-full lg:w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Alle Stati</SelectItem>
                <SelectItem value="running">Running</SelectItem>
                <SelectItem value="success">Success</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {loading ? (
            <div className="py-12 text-center">
              <Loader2 className="mx-auto h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Quelle</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Ziel</TableHead>
                  <TableHead>Gestartet</TableHead>
                  <TableHead>Dauer</TableHead>
                  <TableHead>Kontext</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <div className="font-medium">{job.title}</div>
                        <div className="text-xs text-muted-foreground">{job.description}</div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.source === 'script' ? 'Script' : 'Operation'}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        className={cn(
                          job.status === 'success' && 'bg-emerald-500/10 text-emerald-600',
                          job.status === 'running' && 'bg-sky-500/10 text-sky-600',
                          job.status === 'failed' && 'bg-rose-500/10 text-rose-600',
                        )}
                      >
                        {job.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{job.target}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatTime(job.startedAt)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{formatDuration(job.startedAt, job.finishedAt)}</TableCell>
                    <TableCell>
                      {job.output ? (
                        <div className="max-w-[320px] truncate text-xs text-muted-foreground">{job.output}</div>
                      ) : job.status === 'failed' ? (
                        <span className="inline-flex items-center gap-1 text-xs text-rose-600">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          Fehler pruefen
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">Kein Zusatzkontext</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
};