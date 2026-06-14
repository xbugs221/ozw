import express from 'express';
import bcrypt from 'bcrypt';
import { userDb, db } from '../database/db.js';
import { generateToken, authenticateToken, getTrustedRequestAuthState } from '../middleware/auth.js';

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

function getLoginAttemptKey(req: express.Request, username: string): string {
  /**
   * PURPOSE: Rate-limit login attempts by caller address and normalized
   * username without storing raw passwords or tokens.
   */
  const clientAddress = req.ip || req.socket?.remoteAddress || 'unknown';
  return `${clientAddress}:${String(username || '').trim().toLowerCase()}`;
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
   * PURPOSE: Track failed login attempts and lock repeated failures briefly.
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
   * PURPOSE: Remove failure state after a successful login for the same caller
   * and username.
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

// Check auth status and setup requirements
router.get('/status', async (req: express.Request, res: express.Response) => {
  try {
    const hasUsers = await userDb.hasUsers();
    const trustedAuthState = hasUsers
      ? getTrustedRequestAuthState(req)
      : { isAuthenticated: false, authBypass: false, user: null };

    res.json({
      needsSetup: !hasUsers,
      isAuthenticated: trustedAuthState.isAuthenticated,
      authBypass: trustedAuthState.authBypass,
      user: trustedAuthState.user,
    });
  } catch (error) {
    console.error('Auth status error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// User registration (setup) - only allowed if no users exist
router.post('/register', async (req: express.Request, res: express.Response) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    if (username.length < 3 || password.length < 6) {
      return res.status(400).json({ error: 'Username must be at least 3 characters, password at least 6 characters' });
    }

    // Use a transaction to prevent race conditions
    db.prepare('BEGIN').run();
    try {
      // Check if users already exist (only allow one user)
      const hasUsers = userDb.hasUsers();
      if (hasUsers) {
        db.prepare('ROLLBACK').run();
        return res.status(403).json({ error: 'User already exists. This is a single-user system.' });
      }

      // Hash password
      const saltRounds = 12;
      const passwordHash = await bcrypt.hash(password, saltRounds);

      // Create user
      const user = userDb.createUser(username, passwordHash);

      // Generate token
      const token = generateToken(user);

      db.prepare('COMMIT').run();

      // Update last login (non-fatal, outside transaction)
      userDb.updateLastLogin(user.id);

      res.json({
        success: true,
        user: { id: user.id, username: user.username },
        token
      });
    } catch (error) {
      db.prepare('ROLLBACK').run();
      throw error;
    }

  } catch (error) {
    console.error('Registration error:', error);
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      res.status(409).json({ error: 'Username already exists' });
    } else {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

// User login
router.post('/login', async (req: express.Request, res: express.Response) => {
  try {
    const { username, password } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const loginAttemptKey = getLoginAttemptKey(req, username);
    const activeRetryAfter = getLoginRetryAfterSeconds(loginAttemptKey);
    if (activeRetryAfter > 0) {
      return sendRateLimitedLogin(res, activeRetryAfter);
    }

    // Get user from database
    const user = userDb.getUserByUsername(username) as { id: number; username: string; password_hash: string } | null;
    if (!user) {
      const retryAfter = recordLoginFailure(loginAttemptKey);
      if (retryAfter > 0) {
        return sendRateLimitedLogin(res, retryAfter);
      }
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) {
      const retryAfter = recordLoginFailure(loginAttemptKey);
      if (retryAfter > 0) {
        return sendRateLimitedLogin(res, retryAfter);
      }
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Generate token
    const token = generateToken(user);

    // Update last login
    userDb.updateLastLogin(user.id);
    clearLoginFailures(loginAttemptKey);

    res.json({
      success: true,
      user: { id: user.id, username: user.username },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get current user (protected route)
router.get('/user', authenticateToken, (req, res) => {
  res.json({
    user: req.user
  });
});

// Logout (client-side token removal, but this endpoint can be used for logging)
router.post('/logout', authenticateToken, (req, res) => {
  // In a simple JWT system, logout is mainly client-side
  // This endpoint exists for consistency and potential future logging
  res.json({ success: true, message: 'Logged out successfully' });
});

export default router;
