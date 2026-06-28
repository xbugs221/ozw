/**
 * PURPOSE: Contract-test UI integration points for turn-level non-body
 * collapse without depending on final visual styling.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const TURN_GROUP_COMPONENT_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'view',
  'subcomponents',
  'TurnNonBodyGroup.tsx',
);
const CHAT_MESSAGES_PANE_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'view',
  'subcomponents',
  'ChatMessagesPane.tsx',
);
const TOOL_RENDERER_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'tools',
  'ToolRenderer.tsx',
);
const COLLAPSIBLE_SECTION_PATH = path.join(
  REPO_ROOT,
  'frontend',
  'components',
  'chat',
  'tools',
  'components',
  'CollapsibleSection.tsx',
);

/**
 * Read a required production source file with a clear business failure.
 */
function readRequiredSource(filePath: string, name: string): string {
  assert.equal(fs.existsSync(filePath), true, `缺少 ${name}: ${path.relative(REPO_ROOT, filePath)}`);
  return fs.readFileSync(filePath, 'utf8');
}

test('TurnNonBodyGroup 暴露外层、思考组、工具组和命令级展开入口', () => {
  const source = readRequiredSource(TURN_GROUP_COMPONENT_PATH, 'turn 级非正文折叠组件');

  assert.match(source, /data-testid=["']turn-non-body-group["']/, '外层非正文组必须可测试定位');
  assert.match(source, /data-testid=["']turn-non-body-toggle["']/, '外层展开按钮必须可测试定位');
  assert.match(source, /data-testid=["']turn-thinking-group["']/, '思考组必须可测试定位');
  assert.match(source, /data-testid=["']turn-tool-group["']/, '工具组必须可测试定位');
  assert.match(source, /data-testid=["']turn-tool-command["']/, '组内命令必须可测试定位');
  assert.match(source, /ToolRenderer|MessageComponent/, '组内工具详情必须复用现有工具渲染能力');
  assert.match(source, /defaultOpen/, '组件必须支持 live 阶段展开、正文后折叠的默认状态');
});

test('ChatMessagesPane 接入 turn 分组，同时保留现有工具输出折叠能力', () => {
  const paneSource = readRequiredSource(CHAT_MESSAGES_PANE_PATH, '聊天消息面板');
  const toolRendererSource = readRequiredSource(TOOL_RENDERER_PATH, '工具渲染器');
  const collapsibleSource = readRequiredSource(COLLAPSIBLE_SECTION_PATH, '工具折叠区');

  assert.match(
    paneSource,
    /buildTurnDisplayBlocks|TurnNonBodyGroup/,
    'ChatMessagesPane 或相邻渲染层必须使用 turn 级 display blocks 渲染非正文组',
  );
  assert.match(
    paneSource,
    /visibleMessages/,
    'turn 分组必须建立在当前可见消息窗口上，不能绕过现有虚拟滚动',
  );
  assert.match(
    toolRendererSource,
    /CollapsibleDisplay|CollapsibleSection/,
    '工具详情必须继续走现有可折叠工具渲染能力',
  );
  assert.match(
    collapsibleSource,
    /<details|open=/,
    '单个工具输出仍应保留 details/open 折叠语义',
  );
});
