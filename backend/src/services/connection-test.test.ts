import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./ssh.js', () => ({
  SSHService: {
    testConnection: vi.fn(),
    executeCommand: vi.fn(),
    getSystemInfo: vi.fn(),
    listDirectory: vi.fn(),
    testRDPConnection: vi.fn(),
  },
}));

import { runConnectionFunctionTest } from './connection-test.js';
import { SSHService } from './ssh.js';

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
      total: 4,
      passed: 4,
      failed: 0,
      warnings: 0,
      skipped: 0,
    });
    expect(result.checks.map((check) => check.status)).toEqual(['passed', 'passed', 'passed', 'passed']);
    expect(result.checks.some((check) => check.key === 'metrics')).toBe(false);
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
      total: 4,
      passed: 0,
      failed: 1,
      warnings: 0,
      skipped: 3,
    });
    expect(result.checks[0]?.status).toBe('failed');
    expect(result.checks.slice(1).every((check) => check.status === 'skipped')).toBe(true);
  });
});