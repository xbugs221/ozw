/**
 * PURPOSE: Load optional local .env variables before the server bootstraps.
 * Missing .env files are expected in many deployments, so only unexpected read
 * failures should be surfaced in logs.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolvePackageRoot } from './utils/package-root.js';

const PKG_ROOT = resolvePackageRoot();

/**
 * Merge key/value pairs from the local .env file into process.env when present.
 */
function loadOptionalEnvFile() {
  try {
    const envPath = path.join(PKG_ROOT, '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      if (trimmedLine && !trimmedLine.startsWith('#')) {
        const [key, ...valueParts] = trimmedLine.split('=');
        if (key && valueParts.length > 0 && !process.env[key]) {
          process.env[key] = valueParts.join('=').trim();
        }
      }
    });
  } catch (error) {
    const err = error as NodeJS.ErrnoException | null;
    if (err?.code !== 'ENOENT') {
      console.warn('Failed to load local .env file:', err?.message || String(error));
    }
  }
}

loadOptionalEnvFile();

if (!process.env.DATABASE_PATH) {
  process.env.DATABASE_PATH = path.join(os.homedir(), '.ozw', 'auth.db');
  process.env.OZW_DATABASE_PATH_DEFAULTED = 'true';
}
