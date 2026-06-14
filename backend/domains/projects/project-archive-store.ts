/**
 * 文件目的：读写隐藏项目的归档索引文件。
 * 业务意义：项目归档是项目列表 read model 的存储边界，独立后可减少项目发现模块职责。
 */

import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

const PROJECT_ARCHIVE_FILE_NAME = 'project-archive.json';
const PROJECT_ARCHIVE_VERSION = 1;

export type ProjectArchiveIndex = {
  version: number;
  archivedProjects: Record<string, any>;
};

/**
 * 构建归档索引默认结构。
 */
export function createDefaultProjectArchiveIndex(): ProjectArchiveIndex {
  return {
    version: PROJECT_ARCHIVE_VERSION,
    archivedProjects: {},
  };
}

/**
 * 归一化归档文件内容，兼容缺字段或旧格式数据。
 */
export function normalizeProjectArchiveIndex(rawIndex: unknown): ProjectArchiveIndex {
  if (!rawIndex || typeof rawIndex !== 'object') {
    return createDefaultProjectArchiveIndex();
  }
  const candidate = rawIndex as Partial<ProjectArchiveIndex>;
  return {
    version: Number.isInteger(candidate.version) ? candidate.version as number : PROJECT_ARCHIVE_VERSION,
    archivedProjects: candidate.archivedProjects && typeof candidate.archivedProjects === 'object'
      ? candidate.archivedProjects
      : {},
  };
}

/**
 * 解析归档索引文件路径，默认位于 ~/.claude/project-archive.json。
 */
export function getProjectArchiveFilePath(homeDir = os.homedir()): string {
  return path.join(homeDir, '.claude', PROJECT_ARCHIVE_FILE_NAME);
}

/**
 * 从磁盘读取项目归档索引，文件缺失或损坏时返回默认结构。
 */
export async function loadProjectArchiveIndex(options: { archivePath?: string; homeDir?: string } = {}): Promise<ProjectArchiveIndex> {
  const archivePath = options.archivePath || getProjectArchiveFilePath(options.homeDir);
  try {
    const archiveData = await fs.readFile(archivePath, 'utf8');
    const parsed = JSON.parse(archiveData);
    return normalizeProjectArchiveIndex(parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`Failed to parse project archive index (${archivePath}):`, (error as Error).message);
    }
    return createDefaultProjectArchiveIndex();
  }
}

/**
 * 将项目归档索引写回磁盘。
 */
export async function saveProjectArchiveIndex(
  archiveIndex: ProjectArchiveIndex,
  options: { archivePath?: string; homeDir?: string } = {},
): Promise<void> {
  const archivePath = options.archivePath || getProjectArchiveFilePath(options.homeDir);
  const normalizedArchive = normalizeProjectArchiveIndex(archiveIndex);
  await fs.mkdir(path.dirname(archivePath), { recursive: true });
  await fs.writeFile(archivePath, JSON.stringify(normalizedArchive, null, 2), 'utf8');
}
