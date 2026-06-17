/**
 * 文件目的：导出后端启动装配入口。
 * 业务意义：具体 server 组装保留在 core，边界文件只负责暴露稳定启动 API。
 */
export { startBackendServer } from './server-bootstrap-core.js';
