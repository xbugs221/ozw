/**
 * 文件目的：保留 Codex app-server runtime 的历史导入路径。
 * 业务意义：后端其他模块和历史测试仍从此文件导入实时 Codex 会话 API，实际实现已下沉到可测试边界模块。
 */

export * from './domains/codex-app-server/runtime-facade.js';
