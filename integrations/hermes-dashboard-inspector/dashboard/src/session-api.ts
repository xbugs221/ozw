/**
 * 文件目的：通过 Hermes Dashboard 受认证 GET API 读取会话及 compression lineage。
 * 业务边界：不得发送写请求；旧版 messages 路由解析到后代时使用只读 export GET 回退。
 */
import {
  isHermesCompressionContinuation,
  normalizeHermesTranscript,
  type HermesRecord,
  type HermesTurn,
} from '../../../../shared/hermes-transcript-inspector';

type FetchJSON = <T>(url: string, init?: RequestInit) => Promise<T>;
type SessionsResponse = { sessions?: HermesRecord[] };
type MessagesResponse = { session_id?: string; messages?: HermesRecord[]; pagination?: { returned?: number } };
type LatestDescendantResponse = { session_id?: string; path?: unknown[] };
type SearchResponse = { results?: HermesRecord[] };

export type InspectorTranscript = {
  profile: string;
  sessionId: string;
  lineage: HermesRecord[];
  rows: HermesRecord[];
  turns: HermesTurn[];
};

/** 对查询参数编码，避免 profile/session 深链改变请求结构。 */
function query(value: string): string {
  return encodeURIComponent(value);
}

/** 获取 profile 下最近会话，供插件列表和本地搜索使用。 */
export async function listSessions(fetchJSON: FetchJSON, profile: string): Promise<HermesRecord[]> {
  // /api/sessions 会机会性执行 auto-archive；跨 profile 聚合端点明确只读。
  const response = await fetchJSON<SessionsResponse>(`/api/profiles/sessions?limit=100&order=recent&profile=${query(profile)}`);
  return Array.isArray(response.sessions) ? response.sessions : [];
}

/** 使用 Hermes 只读全文索引搜索全部会话，并返回去重后的 compression tip。 */
export async function searchSessions(
  fetchJSON: FetchJSON,
  profile: string,
  search: string,
): Promise<HermesRecord[]> {
  const response = await fetchJSON<SearchResponse>(
    `/api/sessions/search?q=${query(search)}&limit=100&profile=${query(profile)}`,
  );
  return Array.isArray(response.results) ? response.results : [];
}

/** 读取一条完整会话记录。 */
async function sessionDetail(fetchJSON: FetchJSON, profile: string, sessionId: string): Promise<HermesRecord> {
  return await fetchJSON<HermesRecord>(`/api/sessions/${query(sessionId)}?profile=${query(profile)}`);
}

/** 向上收集 compression parent，普通 branch/delegate 在此停止。 */
async function loadLineage(fetchJSON: FetchJSON, profile: string, tipId: string): Promise<HermesRecord[]> {
  const lineage: HermesRecord[] = [];
  const seen = new Set<string>();
  let child = await sessionDetail(fetchJSON, profile, tipId);
  while (!seen.has(String(child.id))) {
    seen.add(String(child.id));
    lineage.unshift(child);
    if (!child.parent_session_id) break;
    const parent = await sessionDetail(fetchJSON, profile, String(child.parent_session_id));
    if (!isHermesCompressionContinuation(child, parent)) break;
    child = parent;
  }
  return lineage;
}

/** latest-descendant 误入 sibling branch 时，用只读 ID 搜索恢复 compression tip。 */
async function searchedCompressionTip(
  fetchJSON: FetchJSON,
  profile: string,
  rootId: string,
): Promise<string | null> {
  try {
    const response = await fetchJSON<SearchResponse>(
      `/api/sessions/search?q=${query(rootId)}&limit=1&profile=${query(profile)}`,
    );
    const candidate = Array.isArray(response.results) ? response.results[0] : undefined;
    const candidateId = String(candidate?.session_id || candidate?.id || '');
    if (!candidateId || candidateId === rootId) return null;
    const lineage = await loadLineage(fetchJSON, profile, candidateId);
    const lineageRoot = String(lineage[0]?.id || '');
    return lineageRoot === rootId ? String(lineage.at(-1)?.id || candidateId) : null;
  } catch {
    return null;
  }
}

/** 校验 latest-descendant 路径，只接受连续 compression 边，拒绝 branch/delegate 跳转。 */
async function inspectionTip(fetchJSON: FetchJSON, profile: string, requestedSessionId: string): Promise<string> {
  const latest = await fetchJSON<LatestDescendantResponse>(
    `/api/sessions/${query(requestedSessionId)}/latest-descendant?profile=${query(profile)}`,
  );
  const pathIds = Array.isArray(latest.path)
    ? latest.path.map(value => String(value)).filter(Boolean)
    : [];
  if (pathIds[0] !== requestedSessionId) pathIds.unshift(requestedSessionId);

  let parent = await sessionDetail(fetchJSON, profile, requestedSessionId);
  const requested = parent;
  const requestedId = String(requested.id || requestedSessionId);
  let tipId = requestedId;
  for (const candidateId of pathIds.slice(1)) {
    const child = await sessionDetail(fetchJSON, profile, candidateId);
    if (!isHermesCompressionContinuation(child, parent)) break;
    tipId = String(child.id || candidateId);
    parent = child;
  }
  if (tipId === requestedId && requested.end_reason === 'compression') {
    return await searchedCompressionTip(fetchJSON, profile, requestedId) || tipId;
  }
  return tipId;
}

/** 读取指定节点的真实消息；如果宿主把 parent 自动解析到 child，则回退到只读导出端点。 */
async function exactMessages(fetchJSON: FetchJSON, profile: string, sessionId: string): Promise<HermesRecord[]> {
  const rows: HermesRecord[] = [];
  let offset = 0;
  while (true) {
    const response = await fetchJSON<MessagesResponse>(
      `/api/sessions/${query(sessionId)}/messages?profile=${query(profile)}&limit=500&offset=${offset}`,
    );
    if (response.session_id && String(response.session_id) !== sessionId) {
      const exported = await fetchJSON<HermesRecord>(`/api/sessions/${query(sessionId)}/export?profile=${query(profile)}`);
      return Array.isArray(exported.messages) ? exported.messages : [];
    }
    const page = Array.isArray(response.messages) ? response.messages : [];
    rows.push(...page);
    if (page.length < 500) return rows;
    offset += page.length;
  }
}

/** 解析深链到最新后代，加载完整 lineage，并生成共享 turn 投影。 */
export async function loadTranscript(
  fetchJSON: FetchJSON,
  profile: string,
  requestedSessionId: string,
): Promise<InspectorTranscript> {
  const sessionId = await inspectionTip(fetchJSON, profile, requestedSessionId);
  const lineage = await loadLineage(fetchJSON, profile, sessionId);
  const pages = await Promise.all(lineage.map(row => exactMessages(fetchJSON, profile, String(row.id))));
  const rows = pages.flatMap((page, index) => page.map(row => ({
    ...row,
    session_id: row.session_id || String(lineage[index].id),
  })));
  const lineageIds = lineage.map(row => String(row.id));
  return { profile, sessionId, lineage, rows, turns: normalizeHermesTranscript(rows, lineageIds) };
}
