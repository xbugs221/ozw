/**
 * 测试: 路由刷新后从 co 恢复停止按钮状态 & 会话生命周期不依赖前端 processingSessions (task 5.3)
 *
 * 验证前端不在发送后宣告 provider session running，
 * 运行态必须由 co session-status 或 read model 恢复。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('前端不复制 co/wo 生命周期', () => {
  it('useChatComposerState 不再直接 setProcessingStatus', () => {
    const source = readSource('frontend/components/chat/hooks/useChatComposerState.ts');
    // 不应有 setProcessingStatus 调用
    assert.doesNotMatch(source, /setProcessingStatus/);
  });

  it('useChatComposerState 不再主动调用 onSessionProcessing 回调', () => {
    const source = readSource('frontend/components/chat/hooks/useChatComposerState.ts');
    // 不应有 onSessionProcessing?.( 这样的函数调用 (注释中仍可提及)
    assert.doesNotMatch(source, /onSessionProcessing\?\./);
  });

  it('useChatComposerState 仍保留 isLoading 本地 pending 状态', () => {
    const source = readSource('frontend/components/chat/hooks/useChatComposerState.ts');
    // isLoading 在发送时仍设置为 true（本地 pending/stop button）
    assert.match(source, /setIsLoading\(true\)/);
  });

  it('useChatSessionState 不再用 processingSessions 反推 isLoading', () => {
    const source = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
    // processingSessions 不应作为 effect 依赖触发 isLoading
    assert.doesNotMatch(source, /shouldBeProcessing = processingSessions\.has/);
    assert.doesNotMatch(source, /processingSessions,.*selectedSession/);
  });

  it('useChatSessionState 不再维护 processingStatus 状态', () => {
    const source = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
    assert.doesNotMatch(source, /processingStatus/);
    assert.doesNotMatch(source, /setProcessingStatus/);
  });

  it('session-status 事件仍控制 isLoading 和 canAbortSession', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    // session-status 处理中仍有 setIsLoading/setCanAbortSession
    // 从 case 'session-status': 到下一个 case 之间的内容
    const nextCase = source.indexOf('default:', source.indexOf("case 'session-status':"));
    const block = source.substring(
      source.indexOf("case 'session-status':"),
      nextCase > 0 ? nextCase : undefined,
    );
    assert.match(block, /setIsLoading/);
    assert.match(block, /setCanAbortSession/);
  });

  it('check-session-status 在路由切换时被发送', () => {
    const source = readSource('frontend/components/chat/hooks/useChatSessionState.ts');
    // useChatSessionState 在会话加载时发送 check-session-status
    assert.match(source, /check-session-status/);
  });

  it('claude-status 事件处理器已被移除', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.doesNotMatch(source, /'claude-status'/);
  });

  it('ChatComposer 停止按钮仍可用（isLoading true 时显示 stop）', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    // isLoading 为 true 时渲染 stop 按钮
    assert.match(source, /isLoading \?/);
    // 停止按钮仍有 onClick 绑定
    assert.match(source, /guardedAbort/);
  });
});

describe('useSessionProtection 降级', () => {
  it('useSessionProtection 不再维护 processingSessions Set', () => {
    const source = readSource('frontend/hooks/useSessionProtection.ts');
    assert.doesNotMatch(source, /processingSessions/);
  });

  it('useSessionProtection 不再导出 markSessionAsProcessing', () => {
    const source = readSource('frontend/hooks/useSessionProtection.ts');
    assert.doesNotMatch(source, /markSessionAsProcessing/);
  });

  it('useSessionProtection 仍保留 activeSessions 用于离开保护', () => {
    const source = readSource('frontend/hooks/useSessionProtection.ts');
    assert.match(source, /activeSessions/);
  });
});
