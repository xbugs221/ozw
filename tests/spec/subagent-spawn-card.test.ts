/**
 * PURPOSE: Verify spawn-subagent cards expose only the task name and delegated
 * command instead of leaking their JavaScript transport wrapper.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import {
  isSubagentToolName,
  summarizeSubagentToolInput,
} from '../../shared/subagent-tool-utils.ts';

test('结构化 spawn_subagent 参数提取任务名和 cmd', () => {
  /** The compact card contract must prefer task_name and cmd verbatim. */
  const summary = summarizeSubagentToolInput({
    task_name: 'review_styles',
    cmd: '检查工具卡片的视觉层级',
    reasoning_effort: 'high',
  });

  assert.equal(summary.taskName, 'review_styles');
  assert.equal(summary.command, '检查工具卡片的视觉层级');
  assert.equal(isSubagentToolName('spawn_subagent'), true);
  assert.equal(isSubagentToolName('collaboration.spawn_agent'), true);
});

test('JavaScript 包装只提取 cmd，不把内部函数交给渲染层', () => {
  /** Legacy wrappers are parsed as data and must never be evaluated or displayed whole. */
  const wrapper = [
    'const result = await tools.spawn_subagent({',
    '  task_name: "ui_review",',
    '  cmd: "检查标题\\n只返回建议",',
    '});',
    'text(result.output);',
  ].join('\n');
  const summary = summarizeSubagentToolInput(wrapper);

  assert.equal(summary.taskName, 'ui_review');
  assert.equal(summary.command, '检查标题\n只返回建议');
  assert.doesNotMatch(summary.command, /tools\.spawn_subagent|text\(result/);
});

test('紧凑卡片只声明 Agent 图标、任务名称和 cmd 区域', () => {
  /** Source boundary protects the intentionally small presentation contract. */
  const source = fs.readFileSync(
    path.join(process.cwd(), 'frontend/components/chat/tools/components/SubagentContainer.tsx'),
    'utf8',
  );

  assert.match(source, /data-testid="spawn-subagent-card"/);
  assert.match(source, /data-testid="spawn-subagent-task-name"/);
  assert.match(source, /data-testid="spawn-subagent-command"/);
  assert.match(source, /<Bot className="h-4 w-4"/);
  assert.match(source, /\{displayCommand\}/);
}
);
