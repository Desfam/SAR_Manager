import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import * as dns from 'dns';
import * as net from 'net';
import ping from 'ping';

const execAsync = promisify(exec);
const dnsResolve = promisify(dns.resolve);

export interface DiagnosticResult {
  success: boolean;
  output: string;
  error?: string;
  timestamp: string;
  duration: number;
}

export class NetworkDiagnosticsService {
  /**
   * Ping a host
   */
  static async ping(host: string, count: number = 4): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const result = await ping.promise.probe(host, {
        timeout: 10,
        min_reply: count,
      });
      
      return {
        success: result.alive,
        output: `Ping to ${host}:\n` +
                `Alive: ${result.alive}\n` +
                `Time: ${result.time}ms\n` +
                `Min: ${result.min}ms\n` +
                `Max: ${result.max}ms\n` +
                `Avg: ${result.avg}ms\n` +
                `Packet Loss: ${result.packetLoss}%`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Traceroute to a host
   */
  static async traceroute(host: string): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync(`traceroute -m 30 ${host}`);
      
      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.stderr || error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Test port connectivity
   */
  static async testPort(host: string, port: number, timeout: number = 5000): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    return new Promise((resolve) => {
      const socket = new net.Socket();
      
      socket.setTimeout(timeout);
      
      socket.on('connect', () => {
        socket.destroy();
        resolve({
          success: true,
          output: `Port ${port} on ${host} is OPEN and accepting connections`,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        });
      });
      
      socket.on('timeout', () => {
        socket.destroy();
        resolve({
          success: false,
          output: `Port ${port} on ${host} is FILTERED (timeout after ${timeout}ms)`,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        });
      });
      
      socket.on('error', (err: any) => {
        socket.destroy();
        const status = err.code === 'ECONNREFUSED' ? 'CLOSED' : 'FILTERED';
        resolve({
          success: false,
          output: `Port ${port} on ${host} is ${status}`,
          error: err.message,
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
        });
      });
      
      socket.connect(port, host);
    });
  }

  /**
   * DNS lookup
   */
  static async dnsLookup(hostname: string): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const addresses = await dnsResolve(hostname);
      
      return {
        success: true,
        output: `DNS Resolution for ${hostname}:\n${addresses.join('\n')}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: `DNS lookup failed: ${error.message}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Reverse DNS lookup
   */
  static async reverseDNS(ip: string): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync(`dig -x ${ip} +short`);
      
      return {
        success: true,
        output: `Reverse DNS for ${ip}:\n${stdout.trim() || 'No PTR record found'}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * WHOIS lookup
   */
  static async whois(target: string): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout, stderr } = await execAsync(`whois ${target}`);
      
      return {
        success: true,
        output: stdout,
        error: stderr || undefined,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: error.stdout || '',
        error: error.stderr || error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Network interface information
   */
  static async getNetworkInterfaces(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('ip addr show');
      
      return {
        success: true,
        output: stdout,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Routing table
   */
  static async getRoutingTable(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('ip route show');
      
      return {
        success: true,
        output: stdout,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Active network connections
   */
  static async getActiveConnections(): Promise<DiagnosticResult> {
    const startTime = Date.now();
    
    try {
      const { stdout } = await execAsync('ss -tunapl');
      
      return {
        success: true,
        output: stdout,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: '',
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Scan ports on a host
   */
  static async portScan(host: string, ports: number[]): Promise<DiagnosticResult> {
    const startTime = Date.now();
    const results: string[] = [];
    
    try {
      const promises = ports.map(port => this.testPort(host, port, 2000));
      const portResults = await Promise.all(promises);
      
      portResults.forEach((result, index) => {
        const status = result.success ? '✓ OPEN' : '✗ CLOSED/FILTERED';
        results.push(`Port ${ports[index]}: ${status}`);
      });
      
      return {
        success: true,
        output: `Port scan results for ${host}:\n${results.join('\n')}`,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      return {
        success: false,
        output: results.join('\n'),
        error: error.message,
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Common port scan presets
   */
  static getCommonPorts(): { [key: string]: number[] } {
    return {
      ssh: [22],
      rdp: [3389],
      web: [80, 443, 8080, 8443],
      database: [3306, 5432, 27017, 6379, 1433],
      mail: [25, 110, 143, 465, 587, 993, 995],
      dns: [53],
      ldap: [389, 636, 3268, 3269],
      windows: [135, 139, 445, 3389],
      common: [21, 22, 23, 25, 80, 110, 143, 443, 445, 3306, 3389, 5432, 8080],
    };
  }
}
