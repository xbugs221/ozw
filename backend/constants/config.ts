/**
 * 文件目的：集中导出后端运行模式与内部会话有效期配置。
 */

/** Indicates whether the app runs in hosted platform mode. */
export const IS_PLATFORM = process.env.VITE_IS_PLATFORM === 'true';

/**
 * Token expiry time for JWT auth tokens.
 */
export const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN?.trim() || '24h';
