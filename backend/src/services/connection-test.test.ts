import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ssh.js', () => ({
  SSHService: {
    testConnection: vi.fn(),
    executeCommand: vi.fn(),
    getSystemInfo: vi.fn(),
    listDirectory: vi.fn(),
    testRDPConnection: vi.fn(),
  },
  collectSSHMemoryMetrics: vi.fn(),
}));

vi.mock('./node-exporter.js', () => ({
  collectNodeExporterSystemMetrics: vi.fn(),
}));

import { runConnectionFunctionTest } from './connection-test.js';
import { collectNodeExporterSystemMetrics } from './node-exporter.js';
import { collectSSHMemoryMetrics, SSHService } from './ssh.js';

describe('runConnectionFunctionTest', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes all SSH checks when all functions are available', async () => {
    vi.mocked(SSHService.testConnection).mockResolvedValue({
      success: true,
      message: 'connected',
    });
    vi.mocked(SSHService.executeCommand).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { stdout: 'connection-test-ok', stderr: '' },
    });
    vi.mocked(SSHService.getSystemInfo).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { stdout: 'Linux host\n---\nup 1 day' },
    });
    vi.mocked(SSHService.listDirectory).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { path: '.', files: [{ name: 'etc' }, { name: 'var' }] },
    });
    vi.mocked(collectNodeExporterSystemMetrics).mockResolvedValue({
      cpu: { usage: 12 },
      memory: { percentUsed: 34 },
      disk: { percentUsed: 56 },
    } as any);

    const result = await runConnectionFunctionTest({
      type: 'ssh',
      id: 'conn-1',
      name: 'Server 1',
      host: '192.168.1.10',
      port: 22,
      username: 'root',
      authType: 'password',
      password: 'secret',
      useNodeExporter: true,
    });

    expect(result.success).toBe(true);
    expect(result.summary).toMatchObject({
      total: 5,
      passed: 5,
      failed: 0,
      warnings: 0,
      skipped: 0,
    });
    expect(result.checks.map((check) => check.status)).toEqual([
      'passed',
      'passed',
      'passed',
      'passed',
      'passed',
    ]);
  });

  it('returns a warning when node_exporter fails but SSH metrics fallback works', async () => {
    vi.mocked(SSHService.testConnection).mockResolvedValue({
      success: true,
      message: 'connected',
    });
    vi.mocked(SSHService.executeCommand).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { stdout: 'connection-test-ok', stderr: '' },
    });
    vi.mocked(SSHService.getSystemInfo).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { stdout: 'Linux host\n---\nup 1 day' },
    });
    vi.mocked(SSHService.listDirectory).mockResolvedValue({
      success: true,
      message: 'ok',
      data: { path: '.', files: [{ name: 'tmp' }] },
    });
    vi.mocked(collectNodeExporterSystemMetrics).mockRejectedValue(new Error('connection refused'));
    vi.mocked(collectSSHMemoryMetrics).mockResolvedValue({
      total: 1024,
      used: 512,
      available: 512,
      percentUsed: 50,
    });

    const result = await runConnectionFunctionTest({
      type: 'ssh',
      id: 'conn-2',
      name: 'Server 2',
      host: '192.168.1.11',
      port: 22,
      username: 'admin',
      authType: 'password',
      password: 'secret',
      useNodeExporter: true,
    });

    expect(result.success).toBe(true);
    expect(result.summary.warnings).toBe(1);
    expect(result.checks.find((check) => check.key === 'metrics')?.status).toBe('warning');
  });

  it('stops SSH function checks after a failed handshake', async () => {
    vi.mocked(SSHService.testConnection).mockResolvedValue({
      success: false,
      message: 'failed',
      error: 'Authentication failed',
    });

    const result = await runConnectionFunctionTest({
      type: 'ssh',
      id: 'conn-3',
      name: 'Server 3',
      host: '192.168.1.12',
      port: 22,
      username: 'root',
      authType: 'key',
      privateKeyPath: '/tmp/id_ed25519',
      useNodeExporter: false,
    });

    expect(result.success).toBe(false);
    expect(result.summary).toMatchObject({
      total: 5,
      passed: 0,
      failed: 1,
      warnings: 0,
      skipped: 4,
    });
    expect(result.checks[0]?.status).toBe('failed');
    expect(result.checks.slice(1).every((check) => check.status === 'skipped')).toBe(true);
  });
});