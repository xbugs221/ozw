/**
 * 文件目的：在加载数据库和服务模块前，初始化统一的用户态配置与数据路径。
 */
import { initializeRuntimeUserState } from './runtime-user-state.js';
import path from 'node:path';
import { resolvePackageRoot } from './utils/package-root.js';

/**
 * 保证所有直接后端入口都先完成与 CLI 相同的幂等初始化，并仅一次迁移旧安装目录配置。
 */
export const runtimeUserState = await initializeRuntimeUserState({
  legacyEnvPath: path.join(resolvePackageRoot(), '.env'),
});
