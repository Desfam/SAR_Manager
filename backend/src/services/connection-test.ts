import { Socket } from 'node:net';
import { collectNodeExporterSystemMetrics } from './node-exporter.js';
import { collectSSHMemoryMetrics, SSHConnectionConfig, SSHService } from './ssh.js';

export type ConnectionTestCheckStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface ConnectionTestCheck {
  key: string;
  label: string;
  status: ConnectionTestCheckStatus;
  success: boolean;
  message: string;
  durationMs: number;
  details?: any;
}

export interface ConnectionTestSummary {
  total: number;
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
}

export interface ConnectionFunctionTestResult {
  success: boolean;
  message: string;
  connectionType: 'ssh' | 'rdp';
  testedAt: string;
  checks: ConnectionTestCheck[];
  summary: ConnectionTestSummary;
  data?: any;
  error?: string;
}

type SSHConnectionTestInput = SSHConnectionConfig & {
  type: 'ssh';
  metricsUrl?: string | null;
  useNodeExporter?: boolean;
};

type RDPConnectionTestInput = {
  type: 'rdp';
  host: string;
  port: number;
  username: string;
};

type ConnectionTestInput = SSHConnectionTestInput | RDPConnectionTestInput;

type CheckOutcome = {
  status?: ConnectionTestCheckStatus;
  message: string;
  details?: any;
};

const SSH_CHECK_SEQUENCE = [
  { key: 'ssh_handshake', label: 'SSH handshake' },
  { key: 'command_execution', label: 'Remote command execution' },
  { key: 'system_info', label: 'System information retrieval' },
  { key: 'file_browser', label: 'SFTP file browser access' },
  { key: 'metrics', label: 'Metrics collection' },
];

function summarizeChecks(checks: ConnectionTestCheck[]): ConnectionTestSummary {
  return {
    total: checks.length,
    passed: checks.filter((check) => check.status === 'passed').length,
    failed: checks.filter((check) => check.status === 'failed').length,
    warnings: checks.filter((check) => check.status === 'warning').length,
    skipped: checks.filter((check) => check.status === 'skipped').length,
  };
}

function buildMessage(connectionType: 'ssh' | 'rdp', summary: ConnectionTestSummary): string {
  const prefix = connectionType === 'ssh' ? 'SSH function test' : 'RDP function test';

  if (summary.failed > 0) {
    return `${prefix} failed: ${summary.failed} check(s) failed, ${summary.skipped} skipped.`;
  }

  if (summary.warnings > 0) {
    return `${prefix} completed with ${summary.warnings} warning(s).`;
  }

  return `${prefix} passed: ${summary.passed}/${summary.total} checks succeeded.`;
}

function skippedCheck(key: string, label: string, message: string): ConnectionTestCheck {
  return {
    key,
    label,
    status: 'skipped',
    success: false,
    message,
    durationMs: 0,
  };
}

async function runCheck(
  key: string,
  label: string,
  handler: () => Promise<CheckOutcome>
): Promise<ConnectionTestCheck> {
  const startedAt = Date.now();

  try {
    const outcome = await handler();
    const status = outcome.status || 'passed';

    return {
      key,
      label,
      status,
      success: status === 'passed' || status === 'warning',
      message: outcome.message,
      details: outcome.details,
      durationMs: Date.now() - startedAt,
    };
  } catch (error: any) {
    return {
      key,
      label,
      status: 'failed',
      success: false,
      message: error?.message || 'Unknown error',
      details: error?.stack,
      durationMs: Date.now() - startedAt,
    };
  }
}

async function testTcpPort(host: string, port: number, timeoutMs: number = 5000): Promise<CheckOutcome> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finalize = (outcome: CheckOutcome) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => {
      finalize({
        message: `TCP port ${port} on ${host} is reachable.`,
        details: { host, port },
      });
    });
    socket.once('timeout', () => {
      finalize({
        status: 'failed',
        message: `TCP port ${port} on ${host} timed out.`,
      });
    });
    socket.once('error', (error) => {
      finalize({
        status: 'failed',
        message: `TCP port ${port} on ${host} is not reachable.`,
        details: { error: error.message },
      });
    });
    socket.connect(port, host);
  });
}

async function runSSHConnectionFunctionTest(
  input: SSHConnectionTestInput
): Promise<ConnectionFunctionTestResult> {
  const checks: ConnectionTestCheck[] = [];
  let runtimeInput: SSHConnectionTestInput = input;

  const handshakeCheck = await runCheck('ssh_handshake', 'SSH handshake', async () => {
    if (input.authType === 'password' && !input.password) {
      return {
        status: 'failed',
        message: 'Connection is configured for password authentication, but no password is stored.',
        details: {
          hint: 'Edit this connection and either set a password or switch to key authentication with a valid private key path.',
        },
      };
    }

    const result = await SSHService.testConnection(input);

    if (!result.success) {
      if (input.authType === 'password') {
        const keyResult = await SSHService.testSSHKey(input);

        if (keyResult.success) {
          const keyPath = String(keyResult.data?.keyPath || input.privateKeyPath || '').trim();

          if (keyPath) {
            runtimeInput = {
              ...input,
              authType: 'key',
              privateKeyPath: keyPath,
            };
          }

          return {
            status: 'warning',
            message: 'Password auth failed, but SSH key auth works. Update this connection to key auth.',
            details: {
              configuredAuthType: input.authType,
              fallbackAuthType: 'key',
              keyPath: keyPath || undefined,
              initialError: result.error || result.message,
            },
          };
        }
      }

      return {
        status: 'failed',
        message: result.error || result.message,
        details: {
          response: result.message,
          ...(input.authType === 'password'
            ? {
                hint:
                  'Configured for password auth. If host password login is disabled, add backend SSH public key on host and switch this connection to key auth.',
              }
            : {}),
        },
      };
    }

    return {
      message: result.message,
    };
  });

  checks.push(handshakeCheck);

  if (handshakeCheck.status === 'failed') {
    for (const skipped of SSH_CHECK_SEQUENCE.slice(1)) {
      checks.push(skippedCheck(skipped.key, skipped.label, 'Skipped because the SSH handshake failed.'));
    }

    const summary = summarizeChecks(checks);
    return {
      success: false,
      message: buildMessage('ssh', summary),
      connectionType: 'ssh',
      testedAt: new Date().toISOString(),
      checks,
      summary,
      error: handshakeCheck.message,
    };
  }

  const [commandCheck, systemInfoCheck, fileBrowserCheck, metricsCheck] = await Promise.all([
    runCheck('command_execution', 'Remote command execution', async () => {
      const result = await SSHService.executeCommand(runtimeInput, 'printf "connection-test-ok"');
      const stdout = String(result.data?.stdout || '').trim();

      if (!result.success || stdout !== 'connection-test-ok') {
        return {
          status: 'failed',
          message: result.error || 'Command execution returned an unexpected result.',
          details: { stdout, stderr: result.data?.stderr },
        };
      }

      return {
        message: 'Remote command execution is working.',
      };
    }),
    runCheck('system_info', 'System information retrieval', async () => {
      const result = await SSHService.getSystemInfo(runtimeInput);
      const stdout = String(result.data?.stdout || '').trim();

      if (!result.success || !stdout) {
        return {
          status: 'failed',
          message: result.error || 'System information could not be retrieved.',
        };
      }

      return {
        message: 'System information can be retrieved.',
        details: {
          preview: stdout.split('---').map((segment) => segment.trim()).filter(Boolean).slice(0, 2),
        },
      };
    }),
    runCheck('file_browser', 'SFTP file browser access', async () => {
      const result = await SSHService.listDirectory(runtimeInput, '.');
      const files = Array.isArray(result.data?.files) ? result.data.files : [];

      if (!result.success) {
        return {
          status: 'failed',
          message: result.error || result.message,
        };
      }

      return {
        message: 'SFTP directory listing is working.',
        details: {
          path: result.data?.path || '.',
          entryCount: files.length,
          sample: files.slice(0, 5).map((file: any) => file.name),
        },
      };
    }),
    runCheck('metrics', 'Metrics collection', async () => {
      const useNodeExporter = input.useNodeExporter !== false;
      const exporterUrl = input.metricsUrl || `http://${input.host}:9100/metrics`;

      if (useNodeExporter) {
        try {
          const metrics = await collectNodeExporterSystemMetrics(exporterUrl);
          return {
            message: `Metrics are available via node_exporter (${exporterUrl}).`,
            details: {
              source: 'node_exporter',
              cpuUsage: metrics.cpu.usage,
              memoryUsage: metrics.memory.percentUsed,
              diskUsage: metrics.disk.percentUsed,
            },
          };
        } catch (nodeExporterError: any) {
          try {
            const sshMetrics = await collectSSHMemoryMetrics(runtimeInput);
            return {
              status: 'warning',
              message: 'node_exporter is unavailable, but SSH metrics fallback works.',
              details: {
                source: 'ssh_fallback',
                nodeExporterError: nodeExporterError?.message || String(nodeExporterError),
                memoryUsage: sshMetrics.percentUsed,
              },
            };
          } catch (sshError: any) {
            return {
              status: 'failed',
              message: 'Metrics collection failed via node_exporter and SSH fallback.',
              details: {
                nodeExporterError: nodeExporterError?.message || String(nodeExporterError),
                sshError: sshError?.message || String(sshError),
              },
            };
          }
        }
      }

      const sshMetrics = await collectSSHMemoryMetrics(runtimeInput);
      return {
        message: 'Metrics are available via SSH fallback.',
        details: {
          source: 'ssh',
          memoryUsage: sshMetrics.percentUsed,
        },
      };
    }),
  ]);

  checks.push(commandCheck, systemInfoCheck, fileBrowserCheck, metricsCheck);

  const summary = summarizeChecks(checks);
  return {
    success: summary.failed === 0,
    message: buildMessage('ssh', summary),
    connectionType: 'ssh',
    testedAt: new Date().toISOString(),
    checks,
    summary,
    data: {
      metricsSource: metricsCheck.details?.source || null,
      systemInfoPreview: systemInfoCheck.details?.preview || [],
    },
  };
}

async function runRDPConnectionFunctionTest(
  input: RDPConnectionTestInput
): Promise<ConnectionFunctionTestResult> {
  const checks = await Promise.all([
    runCheck('rdp_tcp', 'RDP TCP reachability', async () => {
      return testTcpPort(input.host, input.port);
    }),
    runCheck('rdp_probe', 'RDP protocol probe', async () => {
      const result = await SSHService.testRDPConnection(input.host, input.port, input.username);

      if (result.success) {
        return {
          message: result.message,
        };
      }

      return {
        status: 'warning',
        message: result.error || result.message,
      };
    }),
  ]);

  const summary = summarizeChecks(checks);
  return {
    success: summary.failed === 0,
    message: buildMessage('rdp', summary),
    connectionType: 'rdp',
    testedAt: new Date().toISOString(),
    checks,
    summary,
  };
}

export async function runConnectionFunctionTest(
  input: ConnectionTestInput
): Promise<ConnectionFunctionTestResult> {
  if (input.type === 'rdp') {
    return runRDPConnectionFunctionTest(input);
  }

  return runSSHConnectionFunctionTest(input);
}