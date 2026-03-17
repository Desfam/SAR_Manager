import Docker from 'dockerode';
import si from 'systeminformation';
import type { ContainerInfo as DockerContainerInfo } from 'dockerode';

export interface DockerStats {
  containers: {
    total: number;
    running: number;
    stopped: number;
    paused: number;
  };
  images: number;
  volumes: number;
  networks: number;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  status: string;
  state: string;
  created: Date;
  ports: any[];
  labels: any;
  stats?: {
    cpu: number;
    memory: number;
    networkIO: {
      rx: number;
      tx: number;
    };
  };
}

export class DockerService {
  private docker: Docker;

  constructor() {
    this.docker = new Docker({ socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock' });
  }

  /**
   * Check if Docker is available
   */
  async isDockerAvailable(): Promise<boolean> {
    try {
      await this.docker.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get Docker system information
   */
  async getSystemInfo(): Promise<any> {
    try {
      const info = await this.docker.info();
      return info;
    } catch (error: any) {
      throw new Error(`Failed to get Docker info: ${error.message}`);
    }
  }

  /**
   * Get Docker statistics
   */
  async getDockerStats(): Promise<DockerStats> {
    try {
      const [containers, images, volumes, networks] = await Promise.all([
        this.docker.listContainers({ all: true }),
        this.docker.listImages(),
        this.docker.listVolumes(),
        this.docker.listNetworks(),
      ]);

      const running = containers.filter((c: any) => c.State === 'running').length;
      const stopped = containers.filter((c: any) => c.State === 'exited').length;
      const paused = containers.filter((c: any) => c.State === 'paused').length;

      return {
        containers: {
          total: containers.length,
          running,
          stopped,
          paused,
        },
        images: images.length,
        volumes: volumes.Volumes?.length || 0,
        networks: networks.length,
      };
    } catch (error: any) {
      throw new Error(`Failed to get Docker stats: ${error.message}`);
    }
  }

  /**
   * List all containers
   */
  async listContainers(all: boolean = true): Promise<ContainerInfo[]> {
    try {
      const containers = await this.docker.listContainers({ all });

      return containers.map((container: any) => ({
        id: container.Id,
        name: container.Names[0]?.replace('/', '') || '',
        image: container.Image,
        status: container.Status,
        state: container.State,
        created: new Date(container.Created * 1000),
        ports: container.Ports,
        labels: container.Labels,
      }));
    } catch (error: any) {
      throw new Error(`Failed to list containers: ${error.message}`);
    }
  }

  /**
   * Get container details
   */
  async getContainer(id: string): Promise<any> {
    try {
      const container = this.docker.getContainer(id);
      const info = await container.inspect();
      return info;
    } catch (error: any) {
      throw new Error(`Failed to get container: ${error.message}`);
    }
  }

  /**
   * Start container
   */
  async startContainer(id: string): Promise<void> {
    try {
      const container = this.docker.getContainer(id);
      await container.start();
    } catch (error: any) {
      throw new Error(`Failed to start container: ${error.message}`);
    }
  }

  /**
   * Stop container
   */
  async stopContainer(id: string): Promise<void> {
    try {
      const container = this.docker.getContainer(id);
      await container.stop();
    } catch (error: any) {
      throw new Error(`Failed to stop container: ${error.message}`);
    }
  }

  /**
   * Restart container
   */
  async restartContainer(id: string): Promise<void> {
    try {
      const container = this.docker.getContainer(id);
      await container.restart();
    } catch (error: any) {
      throw new Error(`Failed to restart container: ${error.message}`);
    }
  }

  /**
   * Remove container
   */
  async removeContainer(id: string, force: boolean = false): Promise<void> {
    try {
      const container = this.docker.getContainer(id);
      await container.remove({ force });
    } catch (error: any) {
      throw new Error(`Failed to remove container: ${error.message}`);
    }
  }

  /**
   * Get container logs
   */
  async getContainerLogs(id: string, tail: number = 100): Promise<string> {
    try {
      const container = this.docker.getContainer(id);
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail,
        timestamps: true,
      });
      return logs.toString();
    } catch (error: any) {
      throw new Error(`Failed to get container logs: ${error.message}`);
    }
  }

  /**
   * Get container stats
   */
  async getContainerStats(id: string): Promise<any> {
    try {
      const container = this.docker.getContainer(id);
      const stats = await container.stats({ stream: false });
      
      // Calculate CPU percentage
      const cpuDelta = stats.cpu_stats.cpu_usage.total_usage - stats.precpu_stats.cpu_usage.total_usage;
      const systemDelta = stats.cpu_stats.system_cpu_usage - stats.precpu_stats.system_cpu_usage;
      const cpuPercent = (cpuDelta / systemDelta) * stats.cpu_stats.online_cpus * 100;

      // Calculate memory usage
      const memoryUsage = stats.memory_stats.usage;
      const memoryLimit = stats.memory_stats.limit;
      const memoryPercent = (memoryUsage / memoryLimit) * 100;

      // Network I/O
      const networks = stats.networks || {};
      let networkRx = 0;
      let networkTx = 0;
      
      Object.values(networks).forEach((net: any) => {
        networkRx += net.rx_bytes || 0;
        networkTx += net.tx_bytes || 0;
      });

      return {
        cpu: cpuPercent.toFixed(2),
        memory: memoryPercent.toFixed(2),
        memoryUsage: (memoryUsage / 1024 / 1024).toFixed(2) + ' MB',
        memoryLimit: (memoryLimit / 1024 / 1024).toFixed(2) + ' MB',
        networkRx: (networkRx / 1024 / 1024).toFixed(2) + ' MB',
        networkTx: (networkTx / 1024 / 1024).toFixed(2) + ' MB',
      };
    } catch (error: any) {
      throw new Error(`Failed to get container stats: ${error.message}`);
    }
  }

  /**
   * List Docker images
   */
  async listImages(): Promise<any[]> {
    try {
      const images = await this.docker.listImages();
      return images;
    } catch (error: any) {
      throw new Error(`Failed to list images: ${error.message}`);
    }
  }

  /**
   * Pull Docker image
   */
  async pullImage(imageName: string): Promise<void> {
    try {
      await new Promise((resolve, reject) => {
        this.docker.pull(imageName, (err: any, stream: any) => {
          if (err) return reject(err);
          
          this.docker.modem.followProgress(stream, (err: any) => {
            if (err) return reject(err);
            resolve(true);
          });
        });
      });
    } catch (error: any) {
      throw new Error(`Failed to pull image: ${error.message}`);
    }
  }

  /**
   * Create container
   */
  async createContainer(options: any): Promise<string> {
    try {
      const container = await this.docker.createContainer(options);
      return container.id;
    } catch (error: any) {
      throw new Error(`Failed to create container: ${error.message}`);
    }
  }

  /**
   * Execute command in container
   */
  async execInContainer(id: string, cmd: string[]): Promise<string> {
    try {
      const container = this.docker.getContainer(id);
      const exec = await container.exec({
        Cmd: cmd,
        AttachStdout: true,
        AttachStderr: true,
      });
      
      const stream = await exec.start({ hijack: true, stdin: false });
      
      return new Promise((resolve, reject) => {
        let output = '';
        
        stream.on('data', (chunk: Buffer) => {
          output += chunk.toString();
        });
        
        stream.on('end', () => {
          resolve(output);
        });
        
        stream.on('error', reject);
      });
    } catch (error: any) {
      throw new Error(`Failed to exec in container: ${error.message}`);
    }
  }
}
