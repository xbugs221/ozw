/**
 * 测试: 底部状态条删除 - ProcessingStatus 不再渲染 (task 5.5)
 *
 * 验证发送后底部不出现 ProcessingStatus 条，
 * 停止按钮仍然可用，其他控件不受影响。
 */
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readSource(relativePath: string): string {
  return readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

describe('ProcessingStatus 底部状态条已删除', () => {
  it('ProcessingStatus.tsx 文件已删除', () => {
    assert.equal(
      existsSync(path.join(REPO_ROOT, 'frontend/components/chat/view/subcomponents/ProcessingStatus.tsx')),
      false,
      'ProcessingStatus.tsx 必须已被删除',
    );
  });

  it('ChatComposer 不再 import ProcessingStatus', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.doesNotMatch(source, /ProcessingStatus/);
  });

  it('ChatComposer 不再渲染 ProcessingStatus 组件', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.doesNotMatch(source, /<ProcessingStatus/);
  });

  it('ChatComposer 不再接收 processingStatus prop', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.doesNotMatch(source, /processingStatus/);
  });

  it('ChatInterface 不再传递 processingStatus 给 ChatComposer', () => {
    const source = readSource('frontend/components/chat/view/ChatInterface.tsx');
    assert.doesNotMatch(source, /processingStatus/);
  });

  it('ChatComposer 停止按钮仍然可用', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    // 确认 isLoading 为 true 时渲染 stop button
    assert.match(source, /isLoading/);
    assert.match(source, /guardedAbort/);
  });

  it('ChatComposer 连接断线提示仍然存在', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.match(source, /isConnected/);
    // 断线提示文本
    assert.match(source, /Disconnected/);
  });

  it('ChatComposer 附件上传功能不受影响', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.match(source, /onAttachmentSelection/);
    assert.match(source, /attachedUploads/);
  });

  it('ChatComposer follow latest 控件不受影响', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.match(source, /isFollowingLatest/);
    assert.match(source, /chat-follow-latest/);
  });

  it('ChatComposer 模型选择控件不受影响 (Codex)', () => {
    const source = readSource('frontend/components/chat/view/subcomponents/ChatComposer.tsx');
    assert.match(source, /SessionModelControls/);
  });
});
