/**
 * 测试: Provider 推送一致性 & 重复通知不重复渲染 (task 5.1, 5.2)
 *
 * 验证 Codex/OpenCode/Pi 三个 provider 的实时内容事件不再直接写入最终 transcript，
 * 同一条消息不会因重复推送而重复渲染。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('Provider 推送内容不再直接写入最终 transcript', () => {
  it('useChatRealtimeHandlers 不再包含 appendRealtimeAssistantMessage 函数', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    // 函数定义已被删除
    assert.doesNotMatch(source, /appendRealtimeAssistantMessage/);
  });

  it('useChatRealtimeHandlers 不再包含 buildCoRealtimeMessageKey 函数', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.doesNotMatch(source, /buildCoRealtimeMessageKey/);
  });

  it('Codex agent_message 事件不直接追加 transcript 但触发 read model 刷新', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.match(source, /codexData\.type === 'item'.*agent_message/);
    assert.doesNotMatch(source, /appendRealtimeAssistantMessage.*codex-realtime/);
    const codexAgentBlock = source.match(/codexData\.type === 'item' && codexData\.itemType === 'agent_message'[\s\S]*?codexData\.type === 'turn_complete'/);
    assert.ok(codexAgentBlock, 'agent_message handler block must exist');
    assert.match(codexAgentBlock![0], /reloadCodexSessionMessages/);
  });

  it('OpenCode agent_message 事件不直接追加 transcript 但触发 read model 刷新', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.match(source, /opencodeData\.type === 'item'.*agent_message/);
    assert.doesNotMatch(source, /appendRealtimeAssistantMessage.*opencode-realtime/);
    const opencodeAgentBlock = source.match(/opencodeData\.type === 'item' && opencodeData\.itemType === 'agent_message'[\s\S]*?opencodeData\.type === 'turn_complete'/);
    assert.ok(opencodeAgentBlock, 'agent_message handler block must exist');
    assert.match(opencodeAgentBlock![0], /reloadCodexSessionMessages/);
  });

  it('Pi agent_message 事件不直接追加 transcript 但触发 read model 刷新', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.match(source, /piData\.type === 'item'.*agent_message/);
    assert.doesNotMatch(source, /appendRealtimeAssistantMessage.*pi-realtime/);
    const piAgentBlock = source.match(/piData\.type === 'item' && piData\.itemType === 'agent_message'[\s\S]*?piData\.type === 'turn_complete'/);
    assert.ok(piAgentBlock, 'agent_message handler block must exist');
    assert.match(piAgentBlock![0], /reloadCodexSessionMessages/);
  });

  it('OpenCode complete 事件会触发 session message reload', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    // OpenCode complete handler 应包含 reloadCodexSessionMessages 调用
    const opencodeCompleteBlock = source.match(/case 'opencode-complete':[\s\S]*?break;/);
    assert.ok(opencodeCompleteBlock, 'opencode-complete handler must exist');
    assert.match(opencodeCompleteBlock![0], /reloadCodexSessionMessages/);
  });

  it('Pi complete 事件会触发 session message reload', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    const piCompleteBlock = source.match(/case 'pi-complete':[\s\S]*?break;/);
    assert.ok(piCompleteBlock, 'pi-complete handler must exist');
    assert.match(piCompleteBlock![0], /reloadCodexSessionMessages/);
  });
});

describe('无重复渲染保护', () => {
  it('markUserMessagesPersisted 函数仍然存在（用于去重）', () => {
    const source = readSource('frontend/components/chat/hooks/useChatRealtimeHandlers.ts');
    assert.match(source, /markUserMessagesPersisted/);
  });

  it('sessionMessages 去重工具仍然可用', () => {
    const dedupSource = readSource('frontend/components/chat/utils/sessionMessageDedup.ts');
    assert.match(dedupSource, /getUniqueIncomingSessionMessages/);
  });

  it('chatMessages 去重工具仍然可用', () => {
    const dedupSource = readSource('frontend/components/chat/utils/messageDedup.ts');
    assert.match(dedupSource, /dedupeAdjacentChatMessages/);
  });
});
