import { Router } from 'express';
import { Client } from 'ssh2';
import * as fs from 'fs/promises';
import * as path from 'path';

const router = Router();

const SSH_KEY_DIR = process.env.SSH_KEY_DIR || '/root/.ssh';

// Deploy SSH key to a remote server
router.post('/deploy', async (req, res) => {
  try {
    const { connectionId, keyName, password } = req.body;

    if (!connectionId || !keyName || !password) {
      return res.status(400).json({ 
        error: 'Missing required fields: connectionId, keyName, password' 
      });
    }

    // Get connection details
    const { connectionDb } = await import('../services/database.js');
    const connection: any = connectionDb.getById(connectionId);

    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    // Read the public key
    const publicKeyPath = path.join(SSH_KEY_DIR, `${keyName}.pub`);
    const publicKey = await fs.readFile(publicKeyPath, 'utf8');

    // Connect via SSH with password
    const conn = new Client();

    return new Promise((resolve, reject) => {
      conn.on('ready', () => {
        console.log('SSH connection established for key deployment');

        // Escape the public key for safe use in shell
        const escapedKey = publicKey.trim().replace(/'/g, "'\\''");
        
        // Commands to add the public key to authorized_keys
        // First check if key already exists to avoid duplicates
        const commands = [
          'mkdir -p ~/.ssh',
          'chmod 700 ~/.ssh',
          'touch ~/.ssh/authorized_keys',
          'chmod 600 ~/.ssh/authorized_keys',
          `if ! grep -q "${escapedKey}" ~/.ssh/authorized_keys 2>/dev/null; then echo "${escapedKey}" >> ~/.ssh/authorized_keys && echo "Key added successfully"; else echo "Key already exists"; fi`
        ].join(' && ');

        conn.exec(commands, (err, stream) => {
          if (err) {
            conn.end();
            reject(err);
            return;
          }

          let output = '';
          let errorOutput = '';

          stream.on('close', (code: number) => {
            conn.end();
            
            if (code === 0) {
              resolve({
                success: true,
                message: 'SSH key deployed successfully',
                output: output.trim()
              });
            } else {
              reject(new Error(`Command failed with exit code ${code}: ${errorOutput}`));
            }
          });

          stream.on('data', (data: Buffer) => {
            output += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            errorOutput += data.toString();
          });
        });
      });

      conn.on('error', (err) => {
        reject(err);
      });

      // Connect with password authentication
      conn.connect({
        host: connection.host,
        port: connection.port || 22,
        username: connection.username,
        password: password,
        readyTimeout: 10000,
      });
    })
    .then((result: any) => {
      res.json(result);
    })
    .catch((error: any) => {
      console.error('Failed to deploy SSH key:', error);
      res.status(500).json({ 
        error: error.message || 'Failed to deploy SSH key' 
      });
    });

  } catch (error: any) {
    console.error('SSH key deployment error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
