#!/usr/bin/env node
/**
 * 文件目的：保留 legacy 后端入口的兼容文件名，并把真实运行体委派给后端 runtime 组装模块。
 * 业务意义：启动链路仍可通过旧入口加载，但此文件不再直接承载 HTTP route、WebSocket message 或 watcher 业务逻辑。
 */
import { startBackendServer as startRuntimeBackendServer } from './server-main-runtime.js';

/**
 * 启动后端服务。
 */
export async function startServer(): Promise<void> {
    await startRuntimeBackendServer();
}

/**
 * 兼容 `backend/server-main.ts` 的动态导入入口。
 */
export async function startBackendServer(): Promise<void> {
    await startServer();
}
