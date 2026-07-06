/**
 * 文件目的：约束桌面终端布局和 JSONL 记录/详情视图的分离关系。
 * 业务场景：桌面用户在主工作区平行切换终端和记录，而不是在底部 dock 里操作终端。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const MAIN_CONTENT_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'main-content', 'view', 'MainContent.tsx');
const WORKSPACE_LAYOUT_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'main-content',
  'view',
  'subcomponents',
  'WorkspaceDockLayout.tsx',
);
const WORKSPACE_LAYOUT_STATE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'main-content',
  'hooks',
  'useWorkspaceLayoutState.ts',
);
const CHAT_INTERFACE_PATH = path.join(REPO_ROOT, 'frontend', 'components', 'chat', 'view', 'ChatInterface.tsx');

/**
 * 读取必须存在的生产源码。
 */
function readRequiredSource(filePath: string, businessName: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少${businessName}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

/**
 * 读取桌面工作区布局相关源码。
 */
function readDesktopLayoutSources(): string {
  return [
    readRequiredSource(MAIN_CONTENT_PATH, '主工作区'),
    readRequiredSource(WORKSPACE_LAYOUT_PATH, '工作区 dock 布局'),
    readRequiredSource(WORKSPACE_LAYOUT_STATE_PATH, '工作区布局状态'),
  ].join('\n');
}

test('桌面终端不再作为底部 dock 渲染', () => {
  const layoutSource = readDesktopLayoutSources();

  assert.doesNotMatch(
    layoutSource,
    /bottomDock|BottomDock|dock-panel-bottom|moveTerminalToBottom|onBottomDock/,
    '桌面终端应迁移为主工作区平行视图，不应继续保留 bottom dock 终端状态',
  );
  assert.match(
    layoutSource,
    /activeTab\s*={0,2}\s*['"]shell['"]|terminalMainView|workspaceTerminalView|<StandaloneShell/,
    '桌面主工作区必须仍然能渲染终端视图',
  );
});

test('JSONL 记录/详情视图必须由显式入口打开', () => {
  const chatSource = readRequiredSource(CHAT_INTERFACE_PATH, '会话记录渲染视图');

  assert.match(
    chatSource,
    /chat-render-snapshot-button|renderSnapshot|会话记录|记录视图|查看记录|详情/i,
    '必须保留记录/详情入口，用于用户主动查看 JSONL 渲染内容',
  );
  assert.doesNotMatch(
    chatSource,
    /selectedSession[\s\S]{0,240}loadSessionMessages\(/,
    '默认选中会话不应立即把 JSONL 加载作为唯一主视图',
  );
});
