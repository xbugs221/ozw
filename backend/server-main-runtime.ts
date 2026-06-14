#!/usr/bin/env node
/**
 * 文件目的：作为 legacy 后端运行体的薄组装入口。
 * 业务意义：旧入口只负责加载 typed server 子模块，避免继续在顶层文件承载路由和 WebSocket 业务主体。
 */
import { startBackendServer as startHttpRouteServer } from './server/http-routes.js';

/**
 * 启动后端服务。
 */
export async function startBackendServer(): Promise<void> {
    await startHttpRouteServer();
}
