import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

const router = Router();
const execAsync = promisify(exec);

const SSH_KEY_DIR = process.env.SSH_KEY_DIR || '/root/.ssh';
const DEFAULT_KEY_NAME = 'ssh-manager-key';

// Get all SSH keys
router.get('/', async (req, res) => {
  try {
    const files = await fs.readdir(SSH_KEY_DIR);
    const keyFiles = files.filter(f => f.endsWith('.pub'));
    
    const keys = await Promise.all(
      keyFiles.map(async (file) => {
        const pubKeyPath = path.join(SSH_KEY_DIR, file);
        const publicKey = await fs.readFile(pubKeyPath, 'utf8');
        const stats = await fs.stat(pubKeyPath);
        
        return {
          name: file.replace('.pub', ''),
          publicKey: publicKey.trim(),
          createdAt: stats.birthtime,
          path: pubKeyPath.replace('.pub', '')
        };
      })
    );

    res.json(keys);
  } catch (error: any) {
    console.error('Failed to list SSH keys:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate a new SSH key
router.post('/generate', async (req, res) => {
  try {
    const { name, passphrase, comment, type = 'ed25519' } = req.body;
    
    const keyName = name || DEFAULT_KEY_NAME;
    const keyPath = path.join(SSH_KEY_DIR, keyName);
    
    // Check if key already exists
    try {
      await fs.access(keyPath);
      return res.status(400).json({ error: 'Key with this name already exists' });
    } catch {
      // Key doesn't exist, continue
    }

    // Ensure .ssh directory exists
    await fs.mkdir(SSH_KEY_DIR, { recursive: true, mode: 0o700 });

    // Build ssh-keygen command
    const commentStr = comment || `ssh-manager@${os.hostname()}`;
    const passphraseOpt = passphrase ? `-N "${passphrase}"` : '-N ""';
    
    const command = `ssh-keygen -t ${type} ${passphraseOpt} -C "${commentStr}" -f "${keyPath}"`;
    
    await execAsync(command);

    // Set proper permissions
    await fs.chmod(keyPath, 0o600);
    await fs.chmod(`${keyPath}.pub`, 0o644);

    // Read the generated public key
    const publicKey = await fs.readFile(`${keyPath}.pub`, 'utf8');

    res.json({
      name: keyName,
      publicKey: publicKey.trim(),
      privateKeyPath: keyPath,
      publicKeyPath: `${keyPath}.pub`,
      message: 'SSH key generated successfully'
    });
  } catch (error: any) {
    console.error('Failed to generate SSH key:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get a specific SSH key's public key
router.get('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const pubKeyPath = path.join(SSH_KEY_DIR, `${name}.pub`);
    
    const publicKey = await fs.readFile(pubKeyPath, 'utf8');
    
    res.json({
      name,
      publicKey: publicKey.trim(),
      path: pubKeyPath.replace('.pub', '')
    });
  } catch (error: any) {
    if (error.code === 'ENOENT') {
      return res.status(404).json({ error: 'SSH key not found' });
    }
    console.error('Failed to read SSH key:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete an SSH key
router.delete('/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const keyPath = path.join(SSH_KEY_DIR, name);
    const pubKeyPath = `${keyPath}.pub`;

    // Delete both private and public keys
    await Promise.all([
      fs.unlink(keyPath).catch(() => {}),
      fs.unlink(pubKeyPath).catch(() => {})
    ]);

    res.json({ message: 'SSH key deleted successfully' });
  } catch (error: any) {
    console.error('Failed to delete SSH key:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
