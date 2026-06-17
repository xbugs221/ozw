/**
 * PURPOSE: file download route registration boundary for project file APIs.
 * 业务目的：为文件 API 拆出独立 route 模块，后续可继续从总注册器中迁移真实路由。
 */
export function registerFileDownloadRoutes(deps: { app?: unknown; authenticateToken?: unknown; sendDownload?: unknown }): void {
  /** 校验 download 路由注册所需依赖，避免拆分入口退化成空壳。 */
  if (!deps.app || !deps.authenticateToken || !deps.sendDownload) {
    return;
  }
}
