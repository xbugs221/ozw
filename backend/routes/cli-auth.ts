// PURPOSE: Report local CLI authentication state for supported agent providers.
import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { resolveExecutablePath } from '../executable-resolver.js';

const router = express.Router();

router.get('/claude/status', async (req: express.Request, res: express.Response) => {
  res.status(410).json({
    authenticated: false,
    email: null,
    error: 'Claude CLI authentication is no longer supported'
  });
});

/**
 * Pi CLI status check: only verifies the pi binary is visible to the service
 * process. Does NOT return API keys, tokens, or credentials.
 */
router.get('/pi/status', async (req: express.Request, res: express.Response) => {
  try {
    const commandPath = resolveExecutablePath('pi');
    if (!commandPath) {
      return res.json({
        available: false,
        authenticated: null,
        commandPath: '',
        error: 'pi CLI not found in service PATH',
      });
    }

    // Lightweight version check only - no sensitive data
    const result = spawnSync(commandPath, ['--version'], {
      encoding: 'utf8',
      timeout: 3000,
    });

    const version = (result.stdout || '').trim() || 'unknown';

    res.json({
      available: true,
      authenticated: null,
      commandPath,
      version,
      error: null,
    });
  } catch (error) {
    res.json({
      available: false,
      authenticated: null,
      commandPath: '',
      error: error instanceof Error ? error.message : 'Failed to check Pi CLI',
    });
  }
});

router.get('/codex/status', async (req: express.Request, res: express.Response) => {
  try {
    const result = await checkCodexCredentials();

    res.json({
      authenticated: result.authenticated,
      email: result.email,
      error: result.error
    });

  } catch (error) {
    console.error('Error checking Codex auth status:', error);
    res.status(500).json({
      authenticated: false,
      email: null,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});
export async function checkCodexCredentials() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json');
    const content = await fs.readFile(authPath, 'utf8');
    const auth = JSON.parse(content);

    // Tokens are nested under 'tokens' key
    const tokens = auth.tokens || {};

    // Check for valid tokens (id_token or access_token)
    if (tokens.id_token || tokens.access_token) {
      // Try to extract email from id_token JWT payload
      let email = 'Authenticated';
      if (tokens.id_token) {
        try {
          // JWT is base64url encoded: header.payload.signature
          const parts = tokens.id_token.split('.');
          if (parts.length >= 2) {
            // Decode the payload (second part)
            const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
            email = payload.email || payload.user || 'Authenticated';
          }
        } catch {
          // If JWT decoding fails, use fallback
          email = 'Authenticated';
        }
      }

      return {
        authenticated: true,
        email
      };
    }

    // Also check for OPENAI_API_KEY as fallback auth method
    if (auth.OPENAI_API_KEY) {
      return {
        authenticated: true,
        email: 'API Key Auth'
      };
    }

    return {
      authenticated: false,
      email: null,
      error: 'No valid tokens found'
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return {
        authenticated: false,
        email: null,
        error: 'Codex not configured'
      };
    }
    return {
      authenticated: false,
      email: null,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export default router;
