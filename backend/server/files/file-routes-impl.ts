/**
 * PURPOSE: Keep file routes compatibility as a thin boundary.
 * 业务目的：文件树、下载和修改路由运行时迁到 file-routes-runtime，本文件只保留旧内部入口。
 */
export { registerFileRoutesImpl } from './file-routes-runtime.js';
export type { FileRouteDeps } from './file-routes-runtime.js';
