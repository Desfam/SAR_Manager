import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export type UserRole = 'admin' | 'user' | 'readonly';

interface TokenPayload {
  id: string;
  username: string;
  role: UserRole;
}

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
}

export function isAuthEnabled(): boolean {
  return process.env.ENABLE_AUTH === 'true';
}

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    throw new Error('JWT_SECRET is required when ENABLE_AUTH=true');
  }

  return secret;
}

export function signAuthToken(payload: TokenPayload): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '12h') as any;

  return jwt.sign(payload, getJwtSecret(), {
    expiresIn,
  });
}

export function requireAuthIfEnabled(req: Request, res: Response, next: NextFunction): void {
  if (!isAuthEnabled()) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as TokenPayload;
    (req as AuthenticatedRequest).user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

const ROLE_PRIORITY: Record<UserRole, number> = {
  readonly: 1,
  user: 2,
  admin: 3,
};

function hasRoleAccess(currentRole: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.some((allowedRole) => ROLE_PRIORITY[currentRole] >= ROLE_PRIORITY[allowedRole]);
}

export function requireRoleIfEnabled(
  allowedRoles: UserRole[],
  options?: { writeOnly?: boolean }
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!isAuthEnabled()) {
      next();
      return;
    }

    if (options?.writeOnly && ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    const authReq = req as AuthenticatedRequest;
    const role = authReq.user?.role;

    if (!role) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    if (!hasRoleAccess(role, allowedRoles)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }

    next();
  };
}
