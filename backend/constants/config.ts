/**
 * Environment Flag: Is Platform
 * Indicates if the app is running in Platform mode (hosted) or OSS mode (self-hosted)
 */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Environment Flag: Trust loopback hosts
 * Allows localhost/127.0.0.1 requests to reuse the first local account without JWT login.
 * Local desktop access is trusted by default; set CBW_TRUST_LOCALHOST_AUTH=false to require login.
 */
export const TRUST_LOCALHOST_AUTH = process.env.CBW_TRUST_LOCALHOST_AUTH !== 'false';

/**
 * Token expiry time for JWT auth tokens.
 */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '24h';

/**
 * Codex runtime configuration used by codex-app-server.
 */
export const CODEX_SANDBOX_MODE = process.env.CODEX_SANDBOX_MODE?.trim() || 'danger-full-access';
export const CODEX_APPROVAL_POLICY = process.env.CODEX_APPROVAL_POLICY?.trim() || 'never';

/**
 * Encryption key for recoverable credentials.
 */
export const CREDENTIAL_ENCRYPTION_KEY = process.env.CREDENTIAL_ENCRYPTION_KEY?.trim() || '';
