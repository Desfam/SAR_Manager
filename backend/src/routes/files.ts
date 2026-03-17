import { Router, Request, Response } from 'express';
import { SSHService } from '../services/ssh.js';
import { connectionDb } from '../services/database.js';
import multer from 'multer';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: path.join(os.tmpdir(), 'ssh-manager-uploads'),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

/**
 * GET /api/files/list/:connectionId
 * List directory contents
 */
router.get('/list/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath = '/' } = req.query;

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    const result = await SSHService.listDirectory(config, remotePath as string);

    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to list directory', details: error.message });
  }
});

/**
 * GET /api/files/read/:connectionId
 * Read file contents
 */
router.get('/read/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath } = req.query;

    if (!remotePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    const result = await SSHService.readFile(config, remotePath as string);

    if (result.success) {
      res.json(result.data);
    } else {
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to read file', details: error.message });
  }
});

/**
 * POST /api/files/upload/:connectionId
 * Upload file to remote server
 */
router.post('/upload/:connectionId', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    if (!remotePath) {
      // Clean up uploaded file
      await fs.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'Remote path is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      await fs.unlink(file.path).catch(() => {});
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    // Construct full remote path with filename
    const fullRemotePath = path.posix.join(remotePath, file.originalname);

    const result = await SSHService.uploadFile(config, file.path, fullRemotePath);

    // Clean up temporary file
    await fs.unlink(file.path).catch(() => {});

    if (result.success) {
      res.json({
        message: result.message,
        filename: file.originalname,
        remotePath: fullRemotePath,
      });
    } else {
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    // Clean up temporary file on error
    if (req.file) {
      await fs.unlink(req.file.path).catch(() => {});
    }
    res.status(500).json({ error: 'Failed to upload file', details: error.message });
  }
});

/**
 * GET /api/files/download/:connectionId
 * Download file from remote server
 */
router.get('/download/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath } = req.query;

    if (!remotePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    // Create temporary file path
    const tempFilePath = path.join(os.tmpdir(), `download-${Date.now()}-${path.basename(remotePath as string)}`);

    const result = await SSHService.downloadFile(config, remotePath as string, tempFilePath);

    if (result.success) {
      // Send file and clean up after
      res.download(tempFilePath, path.basename(remotePath as string), async (err) => {
        // Clean up temp file
        await fs.unlink(tempFilePath).catch(() => {});
        
        if (err) {
          console.error('Download error:', err);
        }
      });
    } else {
      // Clean up temp file if it exists
      await fs.unlink(tempFilePath).catch(() => {});
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to download file', details: error.message });
  }
});

/**
 * DELETE /api/files/delete/:connectionId
 * Delete file or directory on remote server
 */
router.delete('/delete/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath } = req.query;

    if (!remotePath) {
      return res.status(400).json({ error: 'Path parameter is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    const result = await SSHService.deleteFile(config, remotePath as string);

    if (result.success) {
      res.json({ message: result.message, path: remotePath });
    } else {
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to delete file', details: error.message });
  }
});

/**
 * POST /api/files/mkdir/:connectionId
 * Create directory on remote server
 */
router.post('/mkdir/:connectionId', async (req: Request, res: Response) => {
  try {
    const { connectionId } = req.params;
    const { path: remotePath } = req.body;

    if (!remotePath) {
      return res.status(400).json({ error: 'Path is required' });
    }

    const connection: any = connectionDb.getById(connectionId);
    if (!connection) {
      return res.status(404).json({ error: 'Connection not found' });
    }

    const config = {
      id: connection.id,
      name: connection.name,
      host: connection.host,
      port: connection.port,
      username: connection.username,
      authType: connection.auth_type as 'password' | 'key',
      password: connection.password,
      privateKeyPath: connection.private_key_path,
    };

    const result = await SSHService.createDirectory(config, remotePath);

    if (result.success) {
      res.json({ message: result.message, path: remotePath });
    } else {
      res.status(500).json({ error: result.message, details: result.error });
    }
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to create directory', details: error.message });
  }
});

export default router;
