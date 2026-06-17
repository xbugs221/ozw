/**
 * PURPOSE: Shared file route helpers for project tree, permissions, and workspace paths.
 * 业务目的：把文件 API 安全边界中的路径和权限规则集中到可单测模块。
 */
const SKIPPED_TREE_ENTRIES = new Set(['node_modules', 'dist', 'build', '.git', '.svn', '.hg']);

export function shouldSkipProjectTreeEntry(entryName: string): boolean {
  /** 判断目录树接口是否应跳过该条目。 */
  return SKIPPED_TREE_ENTRIES.has(entryName);
}

export function permissionBitsToRwx(perm: number): string {
  /** 把三位权限转换为 rwx 文本。 */
  const r = perm & 4 ? 'r' : '-';
  const w = perm & 2 ? 'w' : '-';
  const x = perm & 1 ? 'x' : '-';
  return r + w + x;
}

export function expandWorkspacePath(inputPath: string, deps: { WORKSPACES_ROOT: string; path: { join: (...parts: string[]) => string } }): string {
  /** 展开用户输入中的 ~/，确保浏览文件系统时使用工作区根目录。 */
  if (!inputPath) return inputPath;
  if (inputPath === '~') return deps.WORKSPACES_ROOT;
  if (inputPath.startsWith('~/') || inputPath.startsWith('~\\')) return deps.path.join(deps.WORKSPACES_ROOT, inputPath.slice(2));
  return inputPath;
}
