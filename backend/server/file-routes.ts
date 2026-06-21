/**
 * 文件目的：装配项目文件读写、上传、下载和目录浏览 API。
 * 业务意义：把巨型文件 API 实现迁到 files 子模块，当前边界只保留注册入口。
 */
export { shouldSkipProjectTreeEntry, permissionBitsToRwx, expandWorkspacePath } from './files/file-route-helpers.js';
import type { FileRouteDeps as FileRouteDepsImpl } from './files/file-routes-impl.js';
import { registerFileRoutesImpl } from './files/file-routes-impl.js';
import { registerFileTreeRoutes } from './files/file-tree-routes.js';
import { registerFileMutationRoutes } from './files/file-mutation-routes.js';
import { registerFileDownloadRoutes } from './files/file-download-routes.js';

export interface FileRouteDeps extends FileRouteDepsImpl {}

export function registerFileRoutes(deps: FileRouteDeps): void {
  /** 组合文件 tree/mutation/download 子模块并调用完整文件 API 注册器。 */
  registerFileTreeRoutes(deps);
  registerFileMutationRoutes(deps);
  registerFileDownloadRoutes(deps);
  registerFileRoutesImpl(deps);
}
