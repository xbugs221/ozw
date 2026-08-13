/**
 * PURPOSE: Remove ozw-owned authentication and private runtime paths before
 * exposing the server environment to interactive shells or provider processes.
 */

const PRIVATE_CHILD_ENV_KEYS = [
  'API_KEY',
  'DATABASE_PATH',
] as const;

/**
 * Clone an environment while retaining provider credentials and deleting only
 * ozw-owned authentication or filesystem configuration.
 */
export function sanitizeChildProcessEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const sanitizedEnv = { ...baseEnv };
  for (const key of Object.keys(sanitizedEnv)) {
    if (key.startsWith('OZW_') || PRIVATE_CHILD_ENV_KEYS.includes(key as typeof PRIVATE_CHILD_ENV_KEYS[number])) {
      delete sanitizedEnv[key];
    }
  }
  return sanitizedEnv;
}
