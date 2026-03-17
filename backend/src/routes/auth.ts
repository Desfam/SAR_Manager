import { Router, Request, Response } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { userDb } from '../services/database.js';
import { isAuthEnabled, requireAuthIfEnabled, signAuthToken, AuthenticatedRequest, requireRoleIfEnabled } from '../middleware/auth.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Please try again later.',
});

router.get('/status', (_req: Request, res: Response) => {
  res.json({ enabled: isAuthEnabled() });
});

router.post('/bootstrap-admin', async (req: Request, res: Response) => {
  try {
    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }

    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    if (userDb.count() > 0) {
      return res.status(409).json({ error: 'Admin already bootstrapped' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    userDb.create({
      id: randomUUID(),
      username,
      email,
      passwordHash,
      role: 'admin',
    });

    return res.status(201).json({ message: 'Admin user created successfully' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to bootstrap admin user' });
  }
});

router.post('/login', loginLimiter, async (req: Request, res: Response) => {
  try {
    if (!isAuthEnabled()) {
      return res.status(400).json({ error: 'Authentication is disabled' });
    }

    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' });
    }

    const user: any = userDb.getByUsername(username);

    if (!user || user.is_active !== 1) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const passwordValid = await bcrypt.compare(password, user.password_hash);

    if (!passwordValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAuthToken({
      id: user.id,
      username: user.username,
      role: user.role,
    });

    userDb.updateLastLogin(user.id);

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Login failed' });
  }
});

router.get('/me', requireAuthIfEnabled, (req: Request, res: Response) => {
  if (!isAuthEnabled()) {
    return res.json({ user: null, enabled: false });
  }

  const authReq = req as AuthenticatedRequest;
  return res.json({ user: authReq.user, enabled: true });
});

router.get('/users', requireAuthIfEnabled, requireRoleIfEnabled(['admin']), (req: Request, res: Response) => {
  try {
    const users = userDb.list();
    return res.json(users);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to list users' });
  }
});

router.post('/users', requireAuthIfEnabled, requireRoleIfEnabled(['admin']), async (req: Request, res: Response) => {
  try {
    const { username, email, password, role } = req.body;

    if (!username || !email || !password) {
      return res.status(400).json({ error: 'username, email and password are required' });
    }

    if (password.length < 12) {
      return res.status(400).json({ error: 'Password must be at least 12 characters' });
    }

    if (userDb.getByUsername(username)) {
      return res.status(409).json({ error: 'Username already exists' });
    }

    if (userDb.getByEmail(email)) {
      return res.status(409).json({ error: 'Email already exists' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const newRole = role === 'readonly' || role === 'user' || role === 'admin' ? role : 'user';

    userDb.create({
      id: randomUUID(),
      username,
      email,
      passwordHash,
      role: newRole,
    });

    return res.status(201).json({ message: 'User created' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to create user' });
  }
});

router.patch('/users/:id', requireAuthIfEnabled, requireRoleIfEnabled(['admin']), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { role, isActive } = req.body;
    const existing: any = userDb.getById(id);

    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (role !== undefined) {
      if (!['admin', 'user', 'readonly'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
      }
      userDb.updateRole(id, role);
    }

    if (isActive !== undefined) {
      userDb.setActive(id, Boolean(isActive));
    }

    return res.json({ message: 'User updated' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to update user' });
  }
});

router.delete('/users/:id', requireAuthIfEnabled, requireRoleIfEnabled(['admin']), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const existing: any = userDb.getById(id);

    if (!existing) {
      return res.status(404).json({ error: 'User not found' });
    }

    const adminCount = userDb.list().filter((u: any) => u.role === 'admin').length;
    if (existing.role === 'admin' && adminCount <= 1) {
      return res.status(400).json({ error: 'Cannot delete the last admin user' });
    }

    userDb.delete(id);
    return res.json({ message: 'User deleted' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to delete user' });
  }
});

export default router;
