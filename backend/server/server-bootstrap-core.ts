/**
 * PURPOSE: Keep backend bootstrap compatibility as a thin boundary.
 * 业务目的：启动装配入口保留旧内部路径，真实 server runtime 已迁出，避免核心边界继续膨胀。
 */
export { startBackendServer } from './server-runtime.js';
