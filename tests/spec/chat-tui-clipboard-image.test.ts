/**
 * PURPOSE: Verify the TUI clipboard action uploads only image payloads and
 * gives the upload API stable, correctly typed files.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  getPastedClipboardImageFiles,
  readClipboardImageFiles,
  type ClipboardImageReader,
} from '../../frontend/components/chat/tui/clipboardImageFiles.ts';

test('TUI 顶栏接入剪贴板按钮和终端路径插入链路', () => {
  /** Guard the user-visible button and its reuse of the existing upload flow. */
  const source = fs.readFileSync(
    path.join(process.cwd(), 'frontend/components/chat/view/ChatInterface.tsx'),
    'utf8',
  );

  assert.match(source, /chat-tui-paste-clipboard-image-button/);
  assert.match(source, /readClipboardImageFiles\(clipboard\)/);
  assert.match(source, /handleTuiAttachmentUpload\(imageFiles\)/);
  assert.match(source, /onTerminalPaste=\{handleTuiTerminalPaste\}/);
  assert.match(source, /tuiTerminalInputRef\.current\?\.\(insertion\)/);
});

test('Ctrl+V 从原生 paste 事件读取图片，不依赖安全上下文剪贴板 API', () => {
  /** Model the synchronous clipboard payload available on public HTTP pages. */
  const pastedImage = new File(['image bytes'], 'screenshot.png', { type: 'image/png' });
  const pastedText = new File(['text'], 'notes.txt', { type: 'text/plain' });
  const imageFiles = getPastedClipboardImageFiles({
    files: [pastedImage, pastedText],
    items: [
      { type: 'text/plain', getAsFile: () => pastedText },
      { type: 'image/png', getAsFile: () => pastedImage },
    ],
  });

  assert.deepEqual(imageFiles, [pastedImage]);

  const terminalSource = fs.readFileSync(
    path.join(process.cwd(), 'frontend/components/shell/hooks/useShellTerminal.ts'),
    'utf8',
  );
  assert.doesNotMatch(terminalSource, /navigator\.clipboard\s*\.\s*readText/);
  assert.match(
    terminalSource,
    /event\.key\?\.toLowerCase\(\) === 'v'[\s\S]*?browser default intact[\s\S]*?return false/,
  );
});

test('剪贴板图片会转换为可上传文件，并忽略文本内容', async () => {
  /** Simulate the browser ClipboardItem contract without accessing host data. */
  const requestedTypes: string[] = [];
  const reader: ClipboardImageReader = {
    read: async () => [
      {
        types: ['text/plain'],
        getType: async (type) => {
          requestedTypes.push(type);
          return new Blob(['ignore me'], { type });
        },
      },
      {
        types: ['text/plain', 'image/png'],
        getType: async (type) => {
          requestedTypes.push(type);
          return new Blob(['png image bytes'], { type });
        },
      },
    ],
  };

  const files = await readClipboardImageFiles(reader);

  assert.equal(files.length, 1);
  assert.equal(files[0].name, 'clipboard-image-1.png');
  assert.equal(files[0].type, 'image/png');
  assert.deepEqual(requestedTypes, ['image/png']);
});

test('没有图片的剪贴板会静默返回空列表', async () => {
  /** Non-image clipboard data must never be uploaded to the temporary folder. */
  const reader: ClipboardImageReader = {
    read: async () => [{
      types: ['text/plain', 'text/html'],
      getType: async (type) => new Blob(['ignore me'], { type }),
    }],
  };

  assert.deepEqual(await readClipboardImageFiles(reader), []);
});
