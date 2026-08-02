/**
 * 文件目的：读取并校验部署者配置的单用户访问令牌，为登录接口提供恒定时间比较。
 */
import crypto from 'node:crypto';

export const ACCESS_TOKEN_LENGTH = 32;
export const ACCESS_TOKEN_MISSING_MESSAGE = 'OZW_ACCESS_TOKEN is not configured';
export const ACCESS_TOKEN_INVALID_MESSAGE = 'OZW_ACCESS_TOKEN must contain exactly 32 characters';

export class AccessTokenConfigurationError extends Error {
  /**
   * PURPOSE: Distinguish deployment configuration failures from rejected login attempts.
   */
  constructor(message: string) {
    super(message);
    this.name = 'AccessTokenConfigurationError';
  }
}

/**
 * PURPOSE: Count Unicode characters consistently for environment and request validation.
 */
export function hasExactAccessTokenLength(value: string): boolean {
  return Array.from(value).length === ACCESS_TOKEN_LENGTH;
}

/**
 * PURPOSE: Return the configured access token or fail clearly when deployment configuration is invalid.
 */
export function getConfiguredAccessToken(): string {
  const configuredToken = process.env.OZW_ACCESS_TOKEN;
  if (configuredToken === undefined || configuredToken === '') {
    throw new AccessTokenConfigurationError(ACCESS_TOKEN_MISSING_MESSAGE);
  }
  if (!hasExactAccessTokenLength(configuredToken)) {
    throw new AccessTokenConfigurationError(ACCESS_TOKEN_INVALID_MESSAGE);
  }
  return configuredToken;
}

/**
 * PURPOSE: Describe whether login can operate without exposing the configured secret.
 */
export function getAccessTokenConfiguration(): { valid: boolean; error: string | null } {
  try {
    getConfiguredAccessToken();
    return { valid: true, error: null };
  } catch (error) {
    if (error instanceof AccessTokenConfigurationError) {
      return { valid: false, error: error.message };
    }
    throw error;
  }
}

/**
 * PURPOSE: Compare a submitted token with the configured token without content-dependent early exit.
 */
export function verifyAccessToken(candidate: unknown): boolean {
  const configuredToken = getConfiguredAccessToken();
  const submittedToken = typeof candidate === 'string' ? candidate : '';
  const configuredDigest = crypto.createHash('sha256').update(configuredToken, 'utf8').digest();
  const submittedDigest = crypto.createHash('sha256').update(submittedToken, 'utf8').digest();
  const contentMatches = crypto.timingSafeEqual(configuredDigest, submittedDigest);
  return hasExactAccessTokenLength(submittedToken) && contentMatches;
}
