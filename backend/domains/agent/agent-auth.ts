/**
 * PURPOSE: Hold agent route authentication outside the HTTP binding.
 */

import type { NextFunction, Request, Response } from 'express';
import { apiKeysDb } from '../../database/db.js';
import { authenticateToken } from '../../middleware/auth.js';

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

export function validateExternalApiKey(req: AgentRequest, res: Response, next: NextFunction): void | Promise<void> {
  /** Authenticate agent requests with an API key or the existing JWT session contract. */
  const apiKey = req.headers['x-api-key'];
  if (apiKey !== undefined) {
    if (!apiKey || Array.isArray(apiKey)) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    const user = apiKeysDb.validateApiKey(apiKey);
    if (!user) {
      res.status(401).json({ error: 'Invalid or inactive API key' });
      return;
    }

    req.user = user;
    next();
    return;
  }

  if (!req.headers.authorization) {
    res.status(401).json({ error: 'API key or bearer token required' });
    return;
  }

  return authenticateToken(req, res, next);
}
