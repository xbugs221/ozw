/**
 * 文件目的：封装 Hermes Workbench 的工作区、文件树、文件读写 API。
 * 业务边界：只通过 Dashboard SDK 注入的认证客户端访问后端，不读取宿主私有状态。
 */

export type FetchJSON = <T>(url: string, init?: RequestInit) => Promise<T>;
export type AuthedFetch = (url: string, init?: RequestInit) => Promise<Response>;

export type Workspace = {
  id: string;
  name: string;
  path: string;
};

export type FileEntry = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
};

/** 对路径和身份参数编码，避免工作区路径改变请求结构。 */
function query(value: string): string {
  return encodeURIComponent(value);
}

/** 把后端不同版本的工作区响应归一成前端稳定形态。 */
function normalizeWorkspace(value: any): Workspace | null {
  const row = value?.workspace ?? value;
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id ?? row.workspace_id ?? row.path ?? '');
  const path = String(row.path ?? row.root ?? row.root_path ?? '');
  if (!id && !path) return null;
  return {
    id: id || path,
    name: String(row.name ?? row.label ?? path.split('/').filter(Boolean).at(-1) ?? id),
    path,
  };
}

/** 读取会话绑定的唯一工作区；没有绑定时返回 null。 */
export async function loadWorkspace(
  fetchJSON: FetchJSON,
  profile: string,
  sessionId: string,
): Promise<Workspace | null> {
  const response = await fetchJSON<any>(
    `/api/workspace?profile=${query(profile)}&session=${query(sessionId)}`,
  );
  return normalizeWorkspace(response);
}

/** 把扁平或 children 形态的目录响应归一成当前目录的直接子项。 */
function normalizeFiles(value: any, parentPath: string): FileEntry[] {
  const rows = Array.isArray(value) ? value : value?.files ?? value?.entries ?? value?.children ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: any): FileEntry[] => {
    if (typeof row === 'string') {
      const name = row.split('/').filter(Boolean).at(-1) || row;
      const path = parentPath && !row.includes('/') ? `${parentPath}/${row}` : row;
      return [{ name, path, type: row.endsWith('/') ? 'directory' : 'file' }];
    }
    if (!row || typeof row !== 'object') return [];
    const rawPath = String(row.path ?? row.relative_path ?? row.name ?? '');
    if (!rawPath) return [];
    const hasExplicitPath = row.path !== undefined || row.relative_path !== undefined;
    const path = parentPath && !hasExplicitPath ? `${parentPath}/${rawPath}` : rawPath;
    const rawType = String(row.type ?? row.kind ?? '');
    const isDirectory = row.is_directory === true || row.directory === true || rawType === 'directory' || rawType === 'dir';
    return [{
      name: String(row.name ?? path.split('/').filter(Boolean).at(-1) ?? path),
      path,
      type: isDirectory ? 'directory' : 'file',
      size: Number.isFinite(Number(row.size)) ? Number(row.size) : undefined,
    }];
  }).sort((left, right) => {
    if (left.type !== right.type) return left.type === 'directory' ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

/** 浏览工作区中的一个目录。 */
export async function listFiles(
  fetchJSON: FetchJSON,
  workspaceId: string,
  path: string,
): Promise<FileEntry[]> {
  const response = await fetchJSON<any>(
    `/api/files?workspace=${query(workspaceId)}&path=${query(path)}`,
  );
  return normalizeFiles(response, path);
}

/** 读取 UTF-8 文本文件；二进制响应由浏览器替换字符保护。 */
export async function readFile(
  authedFetch: AuthedFetch,
  workspaceId: string,
  path: string,
): Promise<string> {
  const response = await authedFetch(
    `/api/file?workspace=${query(workspaceId)}&path=${query(path)}`,
  );
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
  const contentType = response.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    const payload = await response.json();
    return String(payload?.content ?? payload?.text ?? '');
  }
  return await response.text();
}

/** 使用 PUT 保存编辑器中的完整 UTF-8 文件内容。 */
export async function writeFile(
  authedFetch: AuthedFetch,
  workspaceId: string,
  path: string,
  content: string,
): Promise<void> {
  const response = await authedFetch(
    `/api/file?workspace=${query(workspaceId)}&path=${query(path)}`,
    { method: 'PUT', headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: content },
  );
  if (!response.ok) throw new Error(`${response.status}: ${await response.text()}`);
}

/** 判断文件是否应提供 Markdown 预览。 */
export function isMarkdownPath(path: string): boolean {
  return /(?:^|\/)readme(?:\.[^/]*)?$|\.(?:md|mdown|markdown)$/i.test(path);
}
