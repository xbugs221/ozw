/**
 * PURPOSE: Hold agent route authentication outside the HTTP binding.
 */

import type { NextFunction, Request, Response } from 'express';
import { IS_PLATFORM } from '../../constants/config.js';
import { apiKeysDb, userDb } from '../../database/db.js';

export type AgentUser = {
  id: number;
  username?: string;
};

type AgentRequest = Request & {
  user?: AgentUser;
};

export function requireAgentUser(user: AgentUser | null | undefined): AgentUser {
  /** Return the authenticated agent user or fail before route work starts. */
  if (!user?.id) {
    throw new Error('Authentication required');
  }
  return user;
}

export function validateExternalApiKey(req: AgentRequest, res: Response, next: NextFunction): void {
  /** Authenticate external agent requests and attach the resolved user. */
  if (IS_PLATFORM) {
    try {
      const user = userDb.getFirstUser();
      if (!user) {
        res.status(500).json({ error: 'Platform mode: No user found in database' });
        return;
      }
      req.user = user;
      next();
      return;
    } catch (error) {
      console.error('Platform mode error:', error);
      res.status(500).json({ error: 'Platform mode: Failed to fetch user' });
      return;
    }
  }

  const apiKey = req.headers['x-api-key'];
  if (!apiKey || Array.isArray(apiKey)) {
    res.status(401).json({ error: 'API key required' });
    return;
  }

  const user = apiKeysDb.validateApiKey(apiKey);
  if (!user) {
    res.status(401).json({ error: 'Invalid or inactive API key' });
    return;
  }

  req.user = user;
  next();
}
