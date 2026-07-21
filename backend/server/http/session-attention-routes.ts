/**
 * 文件目的：注册跨项目会话待处理看板的认证 HTTP 接口。
 * 业务意义：将有界列表、批量确认和手动待处理统一到 SQLite 真值源。
 */
import type Database from 'better-sqlite3';
import { sessionAttentionDb } from '../../session-attention-store.js';
import type { AuthMiddleware, HttpRouteApp } from './route-deps.js';

export interface SessionAttentionRouteDeps {
  app: HttpRouteApp;
  authenticateToken: AuthMiddleware;
  db: Database.Database;
}

/**
 * 注册待处理会话列表与显式状态写入路由。
 */
export function registerSessionAttentionRoutes(deps: SessionAttentionRouteDeps): void {
  /** 业务目的：所有看板操作都经过既有认证中间件且共用单一数据库连接。 */
  const { app, authenticateToken, db } = deps;

  const listHandler = (req: any, res: any) => {
    /** 最多返回 100 条索引摘要，拒绝无界查询。 */
    try {
      const rawLimit = Number(req.query?.limit ?? 100);
      if (!Number.isInteger(rawLimit) || rawLimit < 1 || rawLimit > 100) {
        return res.status(400).json({ error: 'limit 必须在 1 到 100 之间' });
      }
      return res.json({ items: sessionAttentionDb.list(db, { limit: rawLimit }) });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || '读取待处理会话失败' });
    }
  };

  const markHandledHandler = (req: any, res: any) => {
    /** 一次事务只接受 1–200 个用户已观察版本。 */
    try {
      const items = req.body?.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 200) {
        return res.status(400).json({ error: '批量处理数量必须在 1 到 200 之间' });
      }
      return res.json(sessionAttentionDb.markHandled(db, items));
    } catch (error: any) {
      const status = error instanceof RangeError ? 400 : 500;
      return res.status(status).json({ error: error?.message || '处理待处理会话失败' });
    }
  };

  const setPendingHandler = (req: any, res: any) => {
    /** 手动待处理标志不改变 Provider 会话历史或活动版本。 */
    try {
      const provider = String(req.params?.provider || '').trim();
      const sessionId = String(req.params?.sessionId || '').trim();
      if (!['codex', 'claude', 'pi'].includes(provider) || !sessionId || typeof req.body?.pending !== 'boolean') {
        return res.status(400).json({ error: 'provider、sessionId 和 pending 无效' });
      }
      sessionAttentionDb.setManualPending(db, provider, sessionId, req.body.pending);
      return res.json({ success: true });
    } catch (error: any) {
      const status = error?.message === '会话不存在' ? 404 : 500;
      return res.status(status).json({ error: error?.message || '更新待处理状态失败' });
    }
  };

  app.get('/api/session-attention', authenticateToken, listHandler);
  app.post('/api/session-attention/handled', authenticateToken, markHandledHandler);
  app.put('/api/session-attention/:provider/:sessionId/pending', authenticateToken, setPendingHandler);
}
