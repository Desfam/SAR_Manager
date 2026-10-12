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

/* ---------- file manager extensions ---------- */

function configFor(connectionId: string) {
  const connection: any = connectionDb.getById(connectionId);
  if (!connection) return null;
  if (connection.type === 'rdp') return null;
  return {
    id: connection.id,
    name: connection.name,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    authType: connection.auth_type as 'password' | 'key',
    password: connection.password,
    privateKeyPath: connection.private_key_path,
  };
}

/** Absolute, normalized POSIX path, or null. */
function cleanPath(value: unknown): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.includes('\0') || value.length > 4096) return null;
  const normalized = path.posix.normalize(value);
  return normalized.length > 1 ? normalized.replace(/\/$/, '') : normalized;
}

const SYSTEM_ROOTS = new Set(['bin', 'boot', 'dev', 'etc', 'lib', 'lib32', 'lib64', 'libx32', 'proc', 'run', 'sbin', 'sys', 'usr', 'var', 'snap']);

/** Refuses deletes that could break the system: "/", top-level dirs, home dirs, shallow system paths. */
function deleteGuard(target: string): string | null {
  const segments = target.split('/').filter(Boolean);
  if (segments.length < 2) return 'Verzeichnisse direkt unter / werden nicht gelöscht.';
  if (segments[0] === 'home' && segments.length < 3) return 'Ein Home-Verzeichnis wird nicht als Ganzes gelöscht.';
  if (SYSTEM_ROOTS.has(segments[0]) && segments.length < 3) return `${target} ist ein Systemverzeichnis und wird nicht als Ganzes gelöscht.`;
  return null;
}

const fail = (res: Response, error: any, fallback: string) => res.status(500).json({ error: error?.message || fallback });

router.get('/preview/:connectionId', async (req: Request, res: Response) => {
  const config = configFor(req.params.connectionId);
  const target = cleanPath(req.query.path);
  if (!config) return res.status(404).json({ error: 'Connection not found' });
  if (!target) return res.status(400).json({ error: 'Invalid path' });
  try {
    return res.json(await SSHService.previewFile(config, target));
  } catch (error: any) {
    return fail(res, error, 'Failed to read file');
  }
});

router.post('/write/:connectionId', async (req: Request, res: Response) => {
  const config = configFor(req.params.connectionId);
  const target = cleanPath(req.body?.path);
  const content = req.body?.content;
  if (!config) return res.status(404).json({ error: 'Connection not found' });
  if (!target) return res.status(400).json({ error: 'Invalid path' });
  if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 2 * 1024 * 1024) {
    return res.status(400).json({ error: 'Content must be text up to 2 MB' });
  }
  try {
    await SSHService.writeTextFile(config, target, content);
    return res.json({ message: 'Saved' });
  } catch (error: any) {
    return fail(res, error, 'Failed to save file');
  }
});

router.post('/rename/:connectionId', async (req: Request, res: Response) => {
  const config = configFor(req.params.connectionId);
  const from = cleanPath(req.body?.from);
  const to = cleanPath(req.body?.to);
  if (!config) return res.status(404).json({ error: 'Connection not found' });
  if (!from || !to || from === '/' || to === '/') return res.status(400).json({ error: 'Invalid path' });
  if (to === from || to.startsWith(`${from}/`)) return res.status(400).json({ error: 'Ein Ordner kann nicht in sich selbst verschoben werden.' });
  try {
    await SSHService.renamePath(config, from, to);
    return res.json({ message: 'Moved' });
  } catch (error: any) {
    return fail(res, error, 'Failed to move');
  }
});

router.post('/chmod/:connectionId', async (req: Request, res: Response) => {
  const config = configFor(req.params.connectionId);
  const target = cleanPath(req.body?.path);
  const mode = typeof req.body?.mode === 'string' && /^[0-7]{3,4}$/.test(req.body.mode) ? parseInt(req.body.mode, 8) : null;
  if (!config) return res.status(404).json({ error: 'Connection not found' });
  if (!target || mode === null) return res.status(400).json({ error: 'Invalid path or mode (e.g. 644)' });
  try {
    await SSHService.chmodPath(config, target, mode);
    return res.json({ message: 'Permissions changed' });
  } catch (error: any) {
    return fail(res, error, 'Failed to change permissions');
  }
});

router.delete('/delete-recursive/:connectionId', async (req: Request, res: Response) => {
  const config = configFor(req.params.connectionId);
  const target = cleanPath(req.query.path);
  if (!config) return res.status(404).json({ error: 'Connection not found' });
  if (!target) return res.status(400).json({ error: 'Invalid path' });
  const blocked = deleteGuard(target);
  if (blocked) return res.status(400).json({ error: blocked });
  try {
    const removed = await SSHService.deleteRecursive(config, target);
    return res.json({ message: 'Deleted', removed });
  } catch (error: any) {
    return fail(res, error, 'Failed to delete');
  }
});
