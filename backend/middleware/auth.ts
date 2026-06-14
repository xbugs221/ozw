import jwt, { JwtPayload, SignOptions } from 'jsonwebtoken';
import express from 'express';
import { userDb } from '../database/db.js';
import {
  IS_PLATFORM,
  JWT_EXPIRES_IN,
  TRUST_LOCALHOST_AUTH,
} from '../constants/config.js';

/**
 * PURPOSE: Fail closed in non-trust mode when JWT secret is missing.
 */
const JWT_SECRET_MISSING_MESSAGE = 'JWT_SECRET is not configured';
const JWT_EXPIRES_IN_INVALID_MESSAGE = 'JWT_EXPIRES_IN is invalid';

/**
 * PURPOSE: Resolve the configured secret and fail explicitly when required.
 */
const getJwtSecret = () => {
  const configuredSecret = process.env.JWT_SECRET?.trim();
  if (!configuredSecret) {
    throw new Error(JWT_SECRET_MISSING_MESSAGE);
  }
  return configuredSecret;
};

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

interface TrustedUser {
  id: number;
  username: string;
}

/**
 * Normalize a host header into a plain hostname without port.
 */
const normalizeHostname = (value: string = ''): string => {
  const rawHost = String(value).trim().toLowerCase();
  if (!rawHost) {
    return '';
  }

  if (rawHost.startsWith('[')) {
    const closingBracketIndex = rawHost.indexOf(']');
    if (closingBracketIndex !== -1) {
      return rawHost.slice(1, closingBracketIndex);
    }
  }

  return rawHost.replace(/:\d+$/, '');
};

/**
 * Normalize peer address to detect loopback safely without trusting headers.
 */
const isLoopbackAddress = (address: string | undefined): boolean => {
  if (!address) {
    return false;
  }

  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === '127.0.0.1' || normalized === 'localhost';
};

/**
 * Return whether the incoming request was made through a loopback hostname.
 */
const isLoopbackHostRequest = (req: express.Request): boolean => {
  if (!TRUST_LOCALHOST_AUTH) {
    return false;
  }

  const normalizedHost = normalizeHostname(req?.hostname || req?.headers?.host || '');

  if (normalizedHost !== 'localhost' && normalizedHost !== '127.0.0.1' && normalizedHost !== '::1') {
    return false;
  }

  const remoteAddress = isLoopbackAddress(req.socket?.remoteAddress);
  if (remoteAddress) {
    return true;
  }

  // Fallback for environments with manual socket injection (tests, mocks).
  return isLoopbackAddress(req.ip);
};

/**
 * Resolve the implicit single-user identity for platform mode or trusted localhost requests.
 */
const resolveTrustedRequestUser = (req: express.Request): TrustedUser | null => {
  if (!IS_PLATFORM && !isLoopbackHostRequest(req)) {
    return null;
  }

  return userDb.getFirstUser() as TrustedUser | null;
};

/**
 * Build the public auth status so routes can expose whether a request is already trusted.
 */
const getTrustedRequestAuthState = (req: express.Request) => {
  const user = resolveTrustedRequestUser(req);

  if (!user) {
    return {
      isAuthenticated: false,
      authBypass: false,
      user: null,
    };
  }

  return {
    isAuthenticated: true,
    authBypass: true,
    user: {
      id: user.id,
      username: user.username,
    },
  };
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
  const trustedUser = resolveTrustedRequestUser(req);
  if (trustedUser) {
    try {
      (req as any).user = trustedUser;
      return next();
    } catch (error) {
      console.error('Trusted auth mode error:', error);
      res.status(500).json({ error: 'Trusted auth mode: Failed to fetch user' });
      return;
    }
  }

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

    (req as any).user = user;
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
      username: user.username,
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
  JWT_SECRET_MISSING_MESSAGE,
};

// WebSocket authentication function
function authenticateWebSocket(token: string | undefined, req: express.Request): { userId: number; username: string } | null {
  if (token && typeof token !== 'string') {
    return null;
  }

  const trustedUser = resolveTrustedRequestUser(req);
  if (trustedUser) {
    try {
      return { userId: trustedUser.id, username: trustedUser.username };
    } catch (error) {
      console.error('Trusted auth mode WebSocket error:', error);
      return null;
    }
  }

  if (!token) {
    return null;
  }

  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as { userId: number; username: string };
    return decoded;
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
  getTrustedRequestAuthState,
  __authInternalsForTest,
};
