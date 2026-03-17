import { Client, ConnectConfig } from 'ssh2';
import { promises as fs } from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';

const execAsync = promisify(exec);

export interface SSHConnectionConfig {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'key';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
}

export interface ConnectionResult {
  success: boolean;
  message: string;
  data?: any;
  error?: string;
}

export interface SSHMemoryMetrics {
  total: number;
  used: number;
  available: number;
  percentUsed: number;
}

function parseFreeBytesOutput(stdout: string): SSHMemoryMetrics {
  const memLine = stdout
    .split('\n')
    .find((line) => line.trim().startsWith('Mem:'));

  if (!memLine) {
    throw new Error('Mem line not found in free output');
  }

  const parts = memLine.trim().split(/\s+/);
  const total = parseInt(parts[1] || '0', 10) || 0;
  const available = parseInt(parts[6] || parts[3] || '0', 10) || 0;
  const used = Math.max(0, total - available);
  const percentUsed = total > 0 ? (used / total) * 100 : 0;

  if (total <= 0) {
    throw new Error('Invalid total memory from free output');
  }

  return {
    total,
    used,
    available,
    percentUsed,
  };
}

export async function collectSSHMemoryMetrics(
  config: SSHConnectionConfig
): Promise<SSHMemoryMetrics> {
  const result = await SSHService.executeCommand(
    config,
    [
      'free -b',
      'echo __MEM_SPLIT__',
      'systemd-detect-virt -c 2>/dev/null || true',
      'echo __MEM_SPLIT__',
      'cat /sys/fs/cgroup/memory.current 2>/dev/null || cat /sys/fs/cgroup/memory/memory.usage_in_bytes 2>/dev/null || true',
    ].join(' && ')
  );

  if (!result.success) {
    throw new Error(result.error || 'Failed to collect memory metrics over SSH');
  }

  const [freeOutput = '', virtualization = '', cgroupUsage = ''] = String(
    result.data?.stdout || ''
  ).split('__MEM_SPLIT__');

  const metrics = parseFreeBytesOutput(freeOutput);
  const virt = virtualization.trim().toLowerCase();
  const cgroupCurrent = parseInt(cgroupUsage.trim() || '0', 10) || 0;
  const isContainer = ['lxc', 'docker', 'podman', 'container', 'container-other', 'systemd-nspawn'].includes(virt);

  if (isContainer && cgroupCurrent > 0 && cgroupCurrent <= metrics.total) {
    const used = Math.max(metrics.used, cgroupCurrent);
    return {
      total: metrics.total,
      used,
      available: Math.max(0, metrics.total - used),
      percentUsed: metrics.total > 0 ? (used / metrics.total) * 100 : 0,
    };
  }

  return metrics;
}

export class SSHService {
  private static activeConnections = new Map<string, Client>();
  private static readonly SSH_KEY_PATH = path.join(os.homedir(), '.ssh', 'id_ed25519');
  private static readonly SSH_KEY_PUB_PATH = path.join(os.homedir(), '.ssh', 'id_ed25519.pub');

  /**
   * Ensure SSH key exists, create Ed25519 key if it doesn't
   */
  static async ensureSSHKey(keyPath?: string): Promise<ConnectionResult> {
    try {
      const privateKeyPath = keyPath || this.SSH_KEY_PATH;
      const publicKeyPath = `${privateKeyPath}.pub`;

      // Check if key already exists
      try {
        await fs.access(privateKeyPath);
        await fs.access(publicKeyPath);
        return {
          success: true,
          message: 'SSH key already exists',
          data: { privateKeyPath, publicKeyPath },
        };
      } catch {
        // Key doesn't exist, create it
      }

      // Ensure .ssh directory exists
      const sshDir = path.dirname(privateKeyPath);
      await fs.mkdir(sshDir, { recursive: true, mode: 0o700 });

      // Generate Ed25519 key
      const command = `ssh-keygen -t ed25519 -f "${privateKeyPath}" -N "" -C "homelab-manager"`;
      await execAsync(command);

      // Set proper permissions
      await fs.chmod(privateKeyPath, 0o600);
      await fs.chmod(publicKeyPath, 0o644);

      return {
        success: true,
        message: 'SSH key created successfully',
        data: { privateKeyPath, publicKeyPath },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to create SSH key',
        error: error.message,
      };
    }
  }

  /**
   * Test if SSH key works for a given host
   */
  static async testSSHKey(config: SSHConnectionConfig, keyPath?: string): Promise<ConnectionResult> {
    try {
      const privateKeyPath = keyPath || config.privateKeyPath || this.SSH_KEY_PATH;
      
      // Check if key file exists
      try {
        await fs.access(privateKeyPath);
      } catch {
        return {
          success: false,
          message: 'SSH key file not found',
          error: `Key file does not exist: ${privateKeyPath}`,
        };
      }

      // Read the private key
      const privateKey = await fs.readFile(privateKeyPath);

      const client = new Client();

      return new Promise((resolve) => {
        const connectConfig: ConnectConfig = {
          host: config.host,
          port: config.port,
          username: config.username,
          privateKey,
          readyTimeout: 10000,
        };

        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }

        client.on('ready', () => {
          client.end();
          resolve({
            success: true,
            message: `SSH key authentication successful for ${config.host}`,
            data: { keyPath: privateKeyPath },
          });
        });

        client.on('error', (err) => {
          resolve({
            success: false,
            message: `SSH key authentication failed for ${config.host}`,
            error: err.message,
          });
        });

        client.connect(connectConfig);

        setTimeout(() => {
          client.end();
          resolve({
            success: false,
            message: 'Connection timeout',
            error: 'SSH key test timed out after 10 seconds',
          });
        }, 10000);
      });
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to test SSH key',
        error: error.message,
      };
    }
  }

  /**
   * Setup/copy SSH key to remote host (like ssh-copy-id)
   */
  static async setupSSHKey(config: SSHConnectionConfig, keyPath?: string): Promise<ConnectionResult> {
    try {
      const privateKeyPath = keyPath || this.SSH_KEY_PATH;
      const publicKeyPath = `${privateKeyPath}.pub`;

      // Ensure key exists
      const ensureResult = await this.ensureSSHKey(privateKeyPath);
      if (!ensureResult.success) {
        return ensureResult;
      }

      // Read public key
      const publicKey = (await fs.readFile(publicKeyPath, 'utf8')).trim();

      // Test if key already works
      const testResult = await this.testSSHKey(config, privateKeyPath);
      if (testResult.success) {
        return {
          success: true,
          message: 'SSH key already configured and working',
          data: { keyPath: privateKeyPath },
        };
      }

      // Need to copy the key using password authentication
      if (!config.password) {
        return {
          success: false,
          message: 'Password required to setup SSH key',
          error: 'Initial password authentication needed to copy SSH key',
        };
      }

      const client = new Client();

      return new Promise((resolve) => {
        const connectConfig: ConnectConfig = {
          host: config.host,
          port: config.port,
          username: config.username,
          password: config.password,
          readyTimeout: 10000,
        };

        client.on('ready', () => {
          // Commands to setup the key
          const setupCommands = [
            'mkdir -p ~/.ssh',
            'chmod 700 ~/.ssh',
            `echo "${publicKey}" >> ~/.ssh/authorized_keys`,
            'chmod 600 ~/.ssh/authorized_keys',
            // Remove duplicates
            'awk "!seen[$0]++" ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys',
          ].join(' && ');

          client.exec(setupCommands, (err, stream) => {
            if (err) {
              client.end();
              resolve({
                success: false,
                message: 'Failed to setup SSH key',
                error: err.message,
              });
              return;
            }

            let stdout = '';
            let stderr = '';

            stream.on('close', async (code: number) => {
              client.end();

              if (code === 0) {
                // Verify the key works now
                const verifyResult = await this.testSSHKey(config, privateKeyPath);
                resolve({
                  success: verifyResult.success,
                  message: verifyResult.success 
                    ? `SSH key successfully configured for ${config.host}`
                    : 'SSH key copied but verification failed',
                  data: { 
                    keyPath: privateKeyPath,
                    stdout, 
                    stderr,
                    verified: verifyResult.success,
                  },
                });
              } else {
                resolve({
                  success: false,
                  message: 'Failed to setup SSH key',
                  data: { stdout, stderr, exitCode: code },
                });
              }
            });

            stream.on('data', (data: Buffer) => {
              stdout += data.toString();
            });

            stream.stderr.on('data', (data: Buffer) => {
              stderr += data.toString();
            });
          });
        });

        client.on('error', (err) => {
          resolve({
            success: false,
            message: 'Connection failed',
            error: err.message,
          });
        });

        client.connect(connectConfig);
      });
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to setup SSH key',
        error: error.message,
      };
    }
  }

  /**
   * Test SSH connection
   */
  static async testConnection(config: SSHConnectionConfig): Promise<ConnectionResult> {
    const client = new Client();
    
    return new Promise((resolve) => {
      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 10000,
      };

      if (config.authType === 'password' && config.password) {
        connectConfig.password = config.password;
      } else if (config.authType === 'key' && config.privateKeyPath) {
        fs.readFile(config.privateKeyPath)
          .then((key) => {
            connectConfig.privateKey = key;
            if (config.passphrase) {
              connectConfig.passphrase = config.passphrase;
            }
          })
          .catch((err) => {
            resolve({
              success: false,
              message: 'Failed to read private key',
              error: err.message,
            });
            return;
          });
      }

      client.on('ready', () => {
        client.end();
        resolve({
          success: true,
          message: `Successfully connected to ${config.host}`,
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: `Connection failed to ${config.host}`,
          error: err.message,
        });
      });

      client.connect(connectConfig);

      setTimeout(() => {
        client.end();
        resolve({
          success: false,
          message: 'Connection timeout',
          error: 'Connection attempt timed out after 10 seconds',
        });
      }, 10000);
    });
  }

  /**
   * Execute command via SSH
   */
  static async executeCommand(config: SSHConnectionConfig, command: string): Promise<ConnectionResult> {
    const client = new Client();
    
    return new Promise((resolve) => {
      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 10000,
      };

      if (config.authType === 'password' && config.password) {
        connectConfig.password = config.password;
      }

      client.on('ready', () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to execute command',
              error: err.message,
            });
            return;
          }

          let stdout = '';
          let stderr = '';

          stream.on('close', (code: number) => {
            client.end();
            resolve({
              success: code === 0,
              message: code === 0 ? 'Command executed successfully' : 'Command failed',
              data: { stdout, stderr, exitCode: code },
            });
          });

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection failed',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Get system information via SSH
   */
  static async getSystemInfo(config: SSHConnectionConfig): Promise<ConnectionResult> {
    const commands = [
      'uname -a',
      'uptime',
      'free -h',
      'df -h /',
      'hostname',
    ].join(' && echo "---" && ');

    return this.executeCommand(config, commands);
  }

  /**
   * Create SSH tunnel (port forwarding)
   */
  static async createTunnel(
    config: SSHConnectionConfig,
    localPort: number,
    remoteHost: string,
    remotePort: number
  ): Promise<ConnectionResult> {
    try {
      const keyOption = config.authType === 'key' && config.privateKeyPath
        ? `-i ${config.privateKeyPath}`
        : '';

      const command = `ssh ${keyOption} -L ${localPort}:${remoteHost}:${remotePort} -N -f ${config.username}@${config.host} -p ${config.port}`;

      const { stdout, stderr } = await execAsync(command);

      return {
        success: true,
        message: `SSH tunnel created: localhost:${localPort} -> ${remoteHost}:${remotePort}`,
        data: { stdout, stderr },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Failed to create SSH tunnel',
        error: error.message,
      };
    }
  }

  /**
   * Test RDP connection using xfreerdp
   */
  static async testRDPConnection(host: string, port: number, username: string): Promise<ConnectionResult> {
    try {
      // Check if xfreerdp is installed
      await execAsync('which xfreerdp');

      // Test connection with info mode
      const command = `timeout 5 xfreerdp /v:${host}:${port} /u:${username} /cert:ignore /info 2>&1 || true`;
      const { stdout, stderr } = await execAsync(command);

      const success = !stdout.includes('ERROR') && !stderr.includes('failed');

      return {
        success,
        message: success ? `RDP host ${host} is reachable` : `RDP connection to ${host} failed`,
        data: { stdout, stderr },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'xfreerdp not installed or connection failed',
        error: error.message,
      };
    }
  }

  /**
   * Scan SSH hosts on network
   */
  static async scanSSHHosts(subnet: string): Promise<ConnectionResult> {
    try {
      const command = `nmap -p 22 --open ${subnet} -oG -`;
      const { stdout } = await execAsync(command, { timeout: 60000 });

      const hosts: string[] = [];
      const lines = stdout.split('\n');
      
      for (const line of lines) {
        if (line.includes('22/open')) {
          const match = line.match(/Host: (\S+)/);
          if (match) {
            hosts.push(match[1]);
          }
        }
      }

      return {
        success: true,
        message: `Found ${hosts.length} SSH hosts`,
        data: { hosts },
      };
    } catch (error: any) {
      return {
        success: false,
        message: 'Network scan failed',
        error: error.message,
      };
    }
  }

  /**
   * List directory contents via SFTP
   */
  static async listDirectory(config: SSHConnectionConfig, remotePath: string): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          sftp.readdir(remotePath, (err, list) => {
            client.end();

            if (err) {
              resolve({
                success: false,
                message: 'Failed to read directory',
                error: err.message,
              });
              return;
            }

            const files = list.map((item: any) => ({
              name: item.filename,
              type: item.attrs.isDirectory() ? 'folder' : 'file',
              size: item.attrs.size,
              modified: new Date(item.attrs.mtime * 1000).toISOString(),
              permissions: item.attrs.mode,
              uid: item.attrs.uid,
              gid: item.attrs.gid,
            }));

            resolve({
              success: true,
              message: 'Directory listed successfully',
              data: { files, path: remotePath },
            });
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Read file contents via SFTP
   */
  static async readFile(config: SSHConnectionConfig, remotePath: string): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(remotePath);

          stream.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
          });

          stream.on('end', () => {
            client.end();
            const content = Buffer.concat(chunks).toString('utf8');
            resolve({
              success: true,
              message: 'File read successfully',
              data: { content, path: remotePath },
            });
          });

          stream.on('error', (err: any) => {
            client.end();
            resolve({
              success: false,
              message: 'Failed to read file',
              error: err.message,
            });
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Upload file via SFTP
   */
  static async uploadFile(
    config: SSHConnectionConfig,
    localPath: string,
    remotePath: string
  ): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          sftp.fastPut(localPath, remotePath, (err) => {
            client.end();

            if (err) {
              resolve({
                success: false,
                message: 'Failed to upload file',
                error: err.message,
              });
              return;
            }

            resolve({
              success: true,
              message: 'File uploaded successfully',
              data: { localPath, remotePath },
            });
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Download file via SFTP
   */
  static async downloadFile(
    config: SSHConnectionConfig,
    remotePath: string,
    localPath: string
  ): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          sftp.fastGet(remotePath, localPath, (err) => {
            client.end();

            if (err) {
              resolve({
                success: false,
                message: 'Failed to download file',
                error: err.message,
              });
              return;
            }

            resolve({
              success: true,
              message: 'File downloaded successfully',
              data: { remotePath, localPath },
            });
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Delete file or directory via SFTP
   */
  static async deleteFile(config: SSHConnectionConfig, remotePath: string): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          // Check if it's a directory or file
          sftp.stat(remotePath, (err, stats) => {
            if (err) {
              client.end();
              resolve({
                success: false,
                message: 'Failed to stat file',
                error: err.message,
              });
              return;
            }

            if (stats.isDirectory()) {
              sftp.rmdir(remotePath, (err) => {
                client.end();
                if (err) {
                  resolve({
                    success: false,
                    message: 'Failed to delete directory',
                    error: err.message,
                  });
                  return;
                }
                resolve({
                  success: true,
                  message: 'Directory deleted successfully',
                  data: { path: remotePath },
                });
              });
            } else {
              sftp.unlink(remotePath, (err) => {
                client.end();
                if (err) {
                  resolve({
                    success: false,
                    message: 'Failed to delete file',
                    error: err.message,
                  });
                  return;
                }
                resolve({
                  success: true,
                  message: 'File deleted successfully',
                  data: { path: remotePath },
                });
              });
            }
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Create directory via SFTP
   */
  static async createDirectory(config: SSHConnectionConfig, remotePath: string): Promise<ConnectionResult> {
    const client = new Client();

    return new Promise((resolve) => {
      const connectConfig = this.buildConnectConfig(config);

      client.on('ready', () => {
        client.sftp((err, sftp) => {
          if (err) {
            client.end();
            resolve({
              success: false,
              message: 'Failed to initialize SFTP',
              error: err.message,
            });
            return;
          }

          sftp.mkdir(remotePath, (err) => {
            client.end();

            if (err) {
              resolve({
                success: false,
                message: 'Failed to create directory',
                error: err.message,
              });
              return;
            }

            resolve({
              success: true,
              message: 'Directory created successfully',
              data: { path: remotePath },
            });
          });
        });
      });

      client.on('error', (err) => {
        resolve({
          success: false,
          message: 'Connection error',
          error: err.message,
        });
      });

      client.connect(connectConfig);
    });
  }

  /**
   * Helper method to build SSH connection config
   */
  private static buildConnectConfig(config: SSHConnectionConfig): ConnectConfig {
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.username,
      readyTimeout: 10000,
    };

    if (config.authType === 'password' && config.password) {
      connectConfig.password = config.password;
    } else if (config.authType === 'key' && config.privateKeyPath) {
      try {
        const privateKey = require('fs').readFileSync(config.privateKeyPath);
        connectConfig.privateKey = privateKey;
        if (config.passphrase) {
          connectConfig.passphrase = config.passphrase;
        }
      } catch (error) {
        // Key file reading will fail in the connection attempt
      }
    }

    return connectConfig;
  }
}

