/**
 * 文件目的：提供单用户访问令牌登录、内部会话查询与退出接口。
 */
import express from 'express';
import { userDb } from '../database/db.js';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import {
  AccessTokenConfigurationError,
  getAccessTokenConfiguration,
  hasExactAccessTokenLength,
  verifyAccessToken,
} from '../security/access-token.js';

const router = express.Router();
const LOGIN_FAILURE_LIMIT = 5;
const LOGIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCK_MS = 15 * 60 * 1000;

type LoginAttemptState = {
  count: number;
  firstFailureAt: number;
  lockedUntil: number;
};

const loginAttempts = new Map<string, LoginAttemptState>();

function getLoginAttemptKey(req: express.Request): string {
  /**
   * PURPOSE: Rate-limit token login attempts by caller address without storing submitted secrets.
   */
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getLoginRetryAfterSeconds(key: string, now = Date.now()): number {
  /**
   * PURPOSE: Return active lock duration and clear expired login attempt state.
   */
  const state = loginAttempts.get(key);
  if (!state) {
    return 0;
  }
  if (state.lockedUntil > now) {
    return Math.ceil((state.lockedUntil - now) / 1000);
  }
  if (now - state.firstFailureAt > LOGIN_FAILURE_WINDOW_MS) {
    loginAttempts.delete(key);
  }
  return 0;
}

function recordLoginFailure(key: string, now = Date.now()): number {
  /**
   * PURPOSE: Track failed access-token attempts and lock repeated failures briefly.
   */
  const current = loginAttempts.get(key);
  const state = current && now - current.firstFailureAt <= LOGIN_FAILURE_WINDOW_MS
    ? current
    : { count: 0, firstFailureAt: now, lockedUntil: 0 };
  state.count += 1;
  if (state.count >= LOGIN_FAILURE_LIMIT) {
    state.lockedUntil = now + LOGIN_LOCK_MS;
  }
  loginAttempts.set(key, state);
  return getLoginRetryAfterSeconds(key, now);
}

function clearLoginFailures(key: string): void {
  /**
   * PURPOSE: Clear throttling state after the caller supplies the correct access token.
   */
  loginAttempts.delete(key);
}

function sendRateLimitedLogin(res: express.Response, retryAfterSeconds: number) {
  /**
   * PURPOSE: Return a stable throttling response for repeated login failures.
   */
  res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
  return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
}

router.get('/status', (_req: express.Request, res: express.Response) => {
  /**
   * PURPOSE: Report deployment readiness without exposing the configured access token.
   */
  const configuration = getAccessTokenConfiguration();
  res.json({
    isAuthenticated: false,
    accessTokenConfigured: configuration.valid,
    error: configuration.error,
  });
});

router.post('/login', (req: express.Request, res: express.Response) => {
  /**
   * PURPOSE: Exchange the fixed deployment access token for an internal JWT session token.
   */
  const loginAttemptKey = getLoginAttemptKey(req);
  const activeRetryAfter = getLoginRetryAfterSeconds(loginAttemptKey);
  if (activeRetryAfter > 0) {
    return sendRateLimitedLogin(res, activeRetryAfter);
  }

  const configuration = getAccessTokenConfiguration();
  if (!configuration.valid) {
    return res.status(503).json({ error: configuration.error });
  }

  const accessToken = req.body?.accessToken;
  if (typeof accessToken !== 'string' || !hasExactAccessTokenLength(accessToken)) {
    const retryAfter = recordLoginFailure(loginAttemptKey);
    if (retryAfter > 0) {
      return sendRateLimitedLogin(res, retryAfter);
    }
    return res.status(401).json({ error: 'Access token must contain exactly 32 characters' });
  }

  try {
    if (!verifyAccessToken(accessToken)) {
      const retryAfter = recordLoginFailure(loginAttemptKey);
      if (retryAfter > 0) {
        return sendRateLimitedLogin(res, retryAfter);
      }
      return res.status(401).json({ error: 'Invalid access token' });
    }

    const user = userDb.getSingleUser();
    const token = generateToken(user);
    userDb.updateLastLogin(user.id);
    clearLoginFailures(loginAttemptKey);
    return res.json({ success: true, user, token });
  } catch (error) {
    if (error instanceof AccessTokenConfigurationError) {
      return res.status(503).json({ error: error.message });
    }
    console.error('Login error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/user', authenticateToken, (req, res) => {
  /**
   * PURPOSE: Return the fixed public identity attached by JWT authentication.
   */
  res.json({ user: req.user });
});

router.post('/logout', authenticateToken, (_req, res) => {
  /**
   * PURPOSE: Acknowledge client-side removal of the internal JWT session token.
   */
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
