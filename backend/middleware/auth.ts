/**
 * PURPOSE: Authenticate HTTP and WebSocket requests with internal JWT session
 * tokens backed by the automatically managed signing secret.
 */
import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import express from 'express';
import { userDb } from '../database/db.js';
import { JWT_EXPIRES_IN } from '../constants/config.js';
import { getJwtSecret } from '../security/jwt-secret.js';

const SINGLE_USER_NAME = 'ozw';

/**
 * PURPOSE: Reject malformed token lifetime configuration before signing.
 */
const JWT_EXPIRES_IN_INVALID_MESSAGE = 'JWT_EXPIRES_IN is invalid';

const getJwtExpiresIn = (): SignOptions['expiresIn'] => {
  /**
   * PURPOSE: Convert env configuration into jsonwebtoken's typed expiration
   * option while rejecting empty or malformed values.
   */
  const configuredExpiresIn = process.env.JWT_EXPIRES_IN === undefined
    ? JWT_EXPIRES_IN
    : process.env.JWT_EXPIRES_IN.trim();
  if (!configuredExpiresIn) {
    throw new Error(JWT_EXPIRES_IN_INVALID_MESSAGE);
  }

  if (/^\d+$/.test(configuredExpiresIn)) {
    return Number(configuredExpiresIn);
  }

  const durationPattern = /^\d+(?:\.\d+)?\s*(Years?|Yrs?|Y|Weeks?|W|Days?|D|Hours?|Hrs?|H|Minutes?|Mins?|Min|M|Seconds?|Secs?|Sec|s|Milliseconds?|Msecs?|Msec|Ms)$/i;
  if (!durationPattern.test(configuredExpiresIn)) {
    throw new Error(JWT_EXPIRES_IN_INVALID_MESSAGE);
  }

  return configuredExpiresIn as SignOptions['expiresIn'];
};

/**
 * PURPOSE: 统一读取 Authorization bearer token，避免多来源兼容分叉。
 */
function getBearerToken(req: express.Request): string | undefined {
  const header = req.headers.authorization;
  if (!header || typeof header !== 'string') {
    return undefined;
  }

  if (header.startsWith('Bearer ')) {
    return header.substring(7).trim() || undefined;
  }

  return header.trim() || undefined;
}

interface AuthUser {
  id: number;
  username: string;
}

/**
 * PURPOSE: Hide legacy account names behind the fixed public single-user identity.
 */
const toSingleUserIdentity = (user: { id: number }): AuthUser => {
  return { id: user.id, username: SINGLE_USER_NAME };
};

// Optional API key middleware
const validateApiKey = (req: express.Request, res: express.Response, next: express.NextFunction): void => {
  if (!process.env.API_KEY) {
    return next();
  }

  const apiKey = req.headers['x-api-key'];
  if (apiKey !== process.env.API_KEY) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }
  next();
};

// JWT authentication middleware
const authenticateToken = async (req: express.Request, res: express.Response, next: express.NextFunction): Promise<void> => {
  const token = getBearerToken(req);

  if (!token) {
    res.status(401).json({ error: 'Access denied. No token provided.' });
    return;
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as JwtPayload;

    const user = userDb.getUserById(decoded.userId as number);
    if (!user) {
      res.status(401).json({ error: 'Invalid token. User not found.' });
      return;
    }

    (req as any).user = toSingleUserIdentity(user);
    next();
  } catch (error) {
    if (error && (error as { name?: string }).name === 'TokenExpiredError') {
      console.error('Token verification error:', error);
      res.status(401).json({ error: 'Token expired' });
      return;
    }

    console.error('Token verification error:', error);
    res.status(403).json({ error: 'Invalid token' });
    return;
  }
};

// Generate JWT token with configured expiration.
const generateToken = (user: { id: number; username: string }): string => {
  const secret = getJwtSecret();
  const expiresIn = getJwtExpiresIn();
  return jwt.sign(
    {
      userId: user.id,
      username: SINGLE_USER_NAME,
    },
    secret,
    { expiresIn }
  );
};

/**
 * PURPOSE: Expose selected auth internals for backend security tests.
 */
const __authInternalsForTest = {
  getBearerToken,
  getJwtExpiresIn,
  getJwtSecret,
  JWT_EXPIRES_IN,
  JWT_EXPIRES_IN_INVALID_MESSAGE,
};

// WebSocket authentication function
function authenticateWebSocket(token: string | undefined, req: express.Request): { userId: number; username: string } | null {
  if (token && typeof token !== 'string') {
    return null;
  }

  if (!token) {
    return null;
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { userId: number };
    const user = userDb.getUserById(decoded.userId);
    return user ? { userId: user.id, username: SINGLE_USER_NAME } : null;
  } catch (error) {
    console.error('WebSocket token verification error:', error);
    return null;
  }
}

export {
  validateApiKey,
  authenticateToken,
  generateToken,
  authenticateWebSocket,
  __authInternalsForTest,
};
