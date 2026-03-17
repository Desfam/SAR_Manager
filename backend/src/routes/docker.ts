import { Router, Request, Response } from 'express';
import { DockerService } from '../services/docker.js';
import { SSHService } from '../services/ssh.js';
import { connectionDb } from '../services/database.js';

const router = Router();
const dockerService = new DockerService();

// Remote container actions (via SSH)
router.post('/remote/containers/:hostId/:containerId/start', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const result = await SSHService.executeCommand(connConfig, `docker start ${containerId}`);
    
    if (result.success) {
      res.json({ message: 'Container started successfully' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to start container' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/remote/containers/:hostId/:containerId/stop', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const result = await SSHService.executeCommand(connConfig, `docker stop ${containerId}`);
    
    if (result.success) {
      res.json({ message: 'Container stopped successfully' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to stop container' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/remote/containers/:hostId/:containerId/restart', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const result = await SSHService.executeCommand(connConfig, `docker restart ${containerId}`);
    
    if (result.success) {
      res.json({ message: 'Container restarted successfully' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to restart container' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/remote/containers/:hostId/:containerId', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const force = req.query.force === 'true';
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const command = force ? `docker rm -f ${containerId}` : `docker rm ${containerId}`;
    const result = await SSHService.executeCommand(connConfig, command);
    
    if (result.success) {
      res.json({ message: 'Container removed successfully' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to remove container' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/remote/containers/:hostId/:containerId/logs', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const tail = req.query.tail || '100';
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const result = await SSHService.executeCommand(connConfig, `docker logs --tail ${tail} ${containerId} 2>&1`);
    
    if (result.success) {
      res.json({ logs: result.data?.stdout || '' });
    } else {
      res.status(500).json({ error: result.message || 'Failed to get container logs' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/remote/containers/:hostId/:containerId/inspect', async (req: Request, res: Response) => {
  try {
    const { hostId, containerId } = req.params;
    const conn: any = connectionDb.getById(hostId);
    
    if (!conn) {
      return res.status(404).json({ error: 'Host not found' });
    }

    const connConfig: any = {
      host: conn.host,
      port: conn.port,
      username: conn.username,
      password: conn.password,
      privateKey: conn.private_key_path,
      authType: conn.auth_type,
    };

    const result = await SSHService.executeCommand(connConfig, `docker inspect ${containerId}`);
    
    if (result.success) {
      try {
        const inspectData = JSON.parse(result.data?.stdout || '[]');
        res.json({ data: inspectData[0] || {} });
      } catch {
        res.json({ data: result.data?.stdout || '' });
      }
    } else {
      res.status(500).json({ error: result.message || 'Failed to inspect container' });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Scan all connections for Docker containers
router.get('/scan-all', async (req: Request, res: Response) => {
  try {
    const connections: any[] = connectionDb.getAll();
    const results: any[] = [];

    for (const conn of connections) {
      if (conn.type !== 'ssh') continue; // Only scan SSH connections
      
      try {
        const connConfig: any = {
          host: conn.host,
          port: conn.port,
          username: conn.username,
          password: conn.password,
          privateKey: conn.private_key_path,
          authType: conn.auth_type,
        };

        // Get Docker containers with a timeout (5 seconds per host)
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('SSH connection timeout')), 5000);
        });

        const dockerResult: any = await Promise.race([
          SSHService.executeCommand(
            connConfig,
            'docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}|{{.State}}" 2>/dev/null || echo ""'
          ),
          timeoutPromise
        ]);

        const containers = (dockerResult.data?.stdout || '')
          .split('\n')
          .filter((line: string) => line.trim())
          .map((line: string) => {
            const [id, name, image, status, ports, state] = line.split('|');
            return {
              id: id?.trim() || '',
              name: name?.trim() || 'unknown',
              image: image?.trim() || 'unknown',
              status: state?.toLowerCase() === 'running' ? 'running' : 
                      state?.toLowerCase() === 'exited' ? 'stopped' :
                      state?.toLowerCase() === 'paused' ? 'paused' : 'stopped',
              statusText: status?.trim() || '',
              ports: ports?.trim() || '',
              hostId: conn.id,
              hostName: conn.name,
              hostAddress: `${conn.host}:${conn.port}`,
            };
          })
          .filter((c: any) => c.id); // Filter out empty entries

        if (containers.length > 0) {
          results.push(...containers);
        }
      } catch (err) {
        // Skip hosts that timeout or have no Docker installed
        console.error(`Failed to scan ${conn.name}:`, err instanceof Error ? err.message : 'Unknown error');
      }
    }

    res.json(results);
  } catch (error: any) {
    console.error('[Docker Scan] Error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Check Docker availability
router.get('/status', async (req: Request, res: Response) => {
  try {
    const available = await dockerService.isDockerAvailable();
    res.json({ available, message: available ? 'Docker is available' : 'Docker is not available' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Docker system info
router.get('/info', async (req: Request, res: Response) => {
  try {
    const info = await dockerService.getSystemInfo();
    res.json(info);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get Docker stats
router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await dockerService.getDockerStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List containers
router.get('/containers', async (req: Request, res: Response) => {
  try {
    const all = req.query.all === 'true';
    const containers = await dockerService.listContainers(all);
    res.json(containers);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get container details
router.get('/containers/:id', async (req: Request, res: Response) => {
  try {
    const container = await dockerService.getContainer(req.params.id);
    res.json(container);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Start container
router.post('/containers/:id/start', async (req: Request, res: Response) => {
  try {
    await dockerService.startContainer(req.params.id);
    res.json({ message: 'Container started' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Stop container
router.post('/containers/:id/stop', async (req: Request, res: Response) => {
  try {
    await dockerService.stopContainer(req.params.id);
    res.json({ message: 'Container stopped' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Restart container
router.post('/containers/:id/restart', async (req: Request, res: Response) => {
  try {
    await dockerService.restartContainer(req.params.id);
    res.json({ message: 'Container restarted' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Remove container
router.delete('/containers/:id', async (req: Request, res: Response) => {
  try {
    const force = req.query.force === 'true';
    await dockerService.removeContainer(req.params.id, force);
    res.json({ message: 'Container removed' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get container logs
router.get('/containers/:id/logs', async (req: Request, res: Response) => {
  try {
    const tail = parseInt(req.query.tail as string) || 100;
    const logs = await dockerService.getContainerLogs(req.params.id, tail);
    res.json({ logs });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Get container stats
router.get('/containers/:id/stats', async (req: Request, res: Response) => {
  try {
    const stats = await dockerService.getContainerStats(req.params.id);
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// List images
router.get('/images', async (req: Request, res: Response) => {
  try {
    const images = await dockerService.listImages();
    res.json(images);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Pull image
router.post('/images/pull', async (req: Request, res: Response) => {
  try {
    const { imageName } = req.body;
    
    if (!imageName) {
      return res.status(400).json({ error: 'Image name is required' });
    }
    
    await dockerService.pullImage(imageName);
    res.json({ message: 'Image pulled successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create container
router.post('/containers', async (req: Request, res: Response) => {
  try {
    const id = await dockerService.createContainer(req.body);
    res.status(201).json({ id, message: 'Container created' });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Execute command in container
router.post('/containers/:id/exec', async (req: Request, res: Response) => {
  try {
    const { command } = req.body;
    
    if (!command || !Array.isArray(command)) {
      return res.status(400).json({ error: 'Command array is required' });
    }
    
    const output = await dockerService.execInContainer(req.params.id, command);
    res.json({ output });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
