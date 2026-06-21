/**
 * 文件目的：维护 Provider JSONL 会话到项目概要 SQLite 读模型的索引边界。
 * 业务意义：项目首页和项目概要需要快速读取 Codex/Pi 会话归属，不应直接依赖巨型项目模块。
 */

type ProviderName = 'codex' | 'pi' | string;
type ProviderSession = Record<string, any>;

export type ProviderSessionReadModelDependencies = {
  getDb(): Promise<any>;
  getProviderSessionIndexDb(): Promise<any>;
  parseCodexSessionHeader(filePath: string): Promise<ProviderSession | null>;
  parseCodexSessionFile(filePath: string): Promise<ProviderSession | null>;
  buildCodexSessionFromHeader(sessionData: ProviderSession, filePath: string): ProviderSession;
  parsePiSessionHeader(filePath: string): Promise<ProviderSession | null>;
  warn(message: string, error: unknown): void;
};

let dependencies: ProviderSessionReadModelDependencies | null = null;

/**
 * 注入 projects.ts 仍持有的 JSONL 解析依赖，避免 typed 读模型反向导入巨型模块。
 */
export function configureProviderSessionReadModel(nextDependencies: ProviderSessionReadModelDependencies): void {
  dependencies = nextDependencies;
}

/**
 * 读取当前读模型依赖；未配置时给出明确错误，避免静默丢失索引更新。
 */
function getDependencies(): ProviderSessionReadModelDependencies {
  if (!dependencies) {
    throw new Error('Provider session read model dependencies are not configured');
  }
  return dependencies;
}

/**
 * 将一个 Provider 会话头写入 SQLite 项目概要索引。
 */
export async function upsertProviderSessionIndex(provider: ProviderName, session: ProviderSession | null | undefined): Promise<void> {
  if (!session?.id || !session?.filePath) {
    return;
  }
  const deps = getDependencies();
  try {
    const [db, providerSessionIndexDb] = await Promise.all([
      deps.getDb(),
      deps.getProviderSessionIndexDb(),
    ]);
    providerSessionIndexDb.upsert(db, {
      provider,
      id: session.id,
      sourceSessionId: session.sourceSessionId || session.source_session_id || null,
      origin: session.origin || null,
      projectPath: session.projectPath || session.cwd || '',
      summary: session.summary || session.title || null,
      title: session.title || session.summary || null,
      routeTitle: session.routeTitle || session.title || session.summary || null,
      model: session.model || null,
      thread: session.thread || null,
      sessionFileName: session.sessionFileName || session.session_file_name || null,
      filePath: session.filePath,
      createdAt: session.createdAt || session.created_at || null,
      lastActivity: session.lastActivity || session.updated_at || session.updatedAt || null,
      messageCount: typeof session.messageCount === 'number' ? session.messageCount : null,
      messageCountKnown: session.messageCountKnown === true,
      fileMtimeMs: typeof session.fileMtimeMs === 'number' ? session.fileMtimeMs : null,
    });
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not persist ${provider} session ${session.id}:`, error);
  }
}

/**
 * 从 SQLite 索引读取某项目最近的 Provider 会话。
 */
export async function listIndexedProviderSessionsForProject(provider: ProviderName, projectPath: string, limit: number): Promise<ProviderSession[]> {
  const deps = getDependencies();
  try {
    const [db, providerSessionIndexDb] = await Promise.all([
      deps.getDb(),
      deps.getProviderSessionIndexDb(),
    ]);
    return providerSessionIndexDb.listForProject(db, provider, projectPath, limit);
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not read ${provider} sessions for ${projectPath}:`, error);
    return [];
  }
}

/**
 * 将一个变更的 Provider JSONL 文件增量写入项目读模型。
 */
export async function indexProviderSessionFile(provider: ProviderName, filePath: string): Promise<ProviderSession | null> {
  const deps = getDependencies();
  try {
    if (provider === 'codex') {
      const sessionData = await deps.parseCodexSessionHeader(filePath) || await deps.parseCodexSessionFile(filePath);
      if (!sessionData?.id || !sessionData.cwd) {
        return null;
      }
      const session = deps.buildCodexSessionFromHeader(sessionData, filePath);
      await upsertProviderSessionIndex('codex', session);
      return session;
    }
    if (provider === 'pi') {
      const session = await deps.parsePiSessionHeader(filePath);
      if (!session?.id || !session.cwd) {
        return null;
      }
      await upsertProviderSessionIndex('pi', session);
      return session;
    }
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not index ${provider} file ${filePath}:`, error);
  }
  return null;
}

/**
 * 从 SQLite 索引删除已经移除的 Provider JSONL 文件。
 */
export async function getProviderSessionProjectPathForFile(provider: ProviderName, filePath: string): Promise<string> {
  /**
   * 业务目的：在 provider JSONL 删除前找回其项目归属，供项目索引同步使用。
   */
  const deps = getDependencies();
  try {
    const [db, providerSessionIndexDb] = await Promise.all([
      deps.getDb(),
      deps.getProviderSessionIndexDb(),
    ]);
    return providerSessionIndexDb.getProjectPathForFile(db, provider, filePath);
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not locate ${provider} file ${filePath}:`, error);
    return '';
  }
}

/**
 * 统计一个项目当前仍保留的 Provider 会话索引行数。
 */
export async function countProviderSessionsForProject(projectPath: string): Promise<number> {
  /**
   * 业务目的：删除单个 JSONL 后判断 provider-only 项目是否仍应可见。
   */
  const deps = getDependencies();
  try {
    const [db, providerSessionIndexDb] = await Promise.all([
      deps.getDb(),
      deps.getProviderSessionIndexDb(),
    ]);
    return providerSessionIndexDb.countForProject(db, projectPath);
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not count sessions for ${projectPath}:`, error);
    return 0;
  }
}

export async function deleteProviderSessionIndexFile(provider: ProviderName, filePath: string): Promise<void> {
  const deps = getDependencies();
  try {
    const [db, providerSessionIndexDb] = await Promise.all([
      deps.getDb(),
      deps.getProviderSessionIndexDb(),
    ]);
    providerSessionIndexDb.deleteFile(db, provider, filePath);
  } catch (error) {
    deps.warn(`[ProviderIndex] Could not delete ${provider} file ${filePath}:`, error);
  }
}
