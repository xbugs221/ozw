#!/usr/bin/env node
/**
 * 文件目的：保留后端 HTTP 服务的稳定入口，并把实际装配委托给 bootstrap 运行体。
 * 业务意义：启动脚本和历史导入路径不变，但入口文件不再直接承载业务 API 与 realtime 投递逻辑。
 */

import { startBackendServer as startServerBootstrap } from './server-bootstrap.js';

/**
 * 启动后端服务运行体。
 */
export async function startBackendServer() {
    await startServerBootstrap();
}
