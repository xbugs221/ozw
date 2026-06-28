// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Acceptance tests for structured tool rendering of plans, batch execute results, and file changes.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PLAYWRIGHT_FIXTURE_HOME } from '../e2e/helpers/playwright-fixture.ts';
import {
  PRIMARY_FIXTURE_PROJECT_PATH,
  authenticatePage,
  resetWorkspaceProject,
} from './helpers/spec-test-helpers.ts';

/**
 * Write one Codex JSONL session file using the Codex-native format
 * (event_msg / response_item) so the server's mapCodexEntryToMessages can parse it.
 */
async function writeCodexSession({ sessionId, entries }) {
  const sessionDir = path.join(
    PLAYWRIGHT_FIXTURE_HOME,
    '.codex',
    'sessions',
    '2026',
    '04',
    '20',
  );
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);

  await fs.mkdir(sessionDir, { recursive: true });
  await fs.writeFile(sessionPath, entries.join('\n') + '\n', 'utf8');
}

test.beforeEach(async ({ page }) => {
  await resetWorkspaceProject();
  await authenticatePage(page);
});

test('会将 update_plan、ctx_batch_execute、write_stdin 和 FileChanges 渲染为结构化内容', async ({ page }) => {
  const sessionId = 'fixture-structured-tool-rendering';

  await writeCodexSession({
    sessionId,
    entries: [
      // session_meta (top-level type, not nested in event_msg)
      JSON.stringify({
        type: 'session_meta',
        timestamp: '2026-04-20T09:00:00.000Z',
        payload: {
          id: sessionId,
          cwd: PRIMARY_FIXTURE_PROJECT_PATH,
          model: 'gpt-5-codex',
        },
      }),
      // User message
      JSON.stringify({
        type: 'event_msg',
        timestamp: '2026-04-20T09:00:01.000Z',
        payload: {
          type: 'user_message',
          message: '请把工作计划和命令执行结果展示清楚。',
        },
      }),
      // Assistant message with function_call tool_use items
      ...[
        {
          name: 'update_plan',
          arguments: JSON.stringify({
            explanation: '先整理计划，再跑命令，最后检查文件变更。',
            plan: [
              { step: '整理工作计划', status: 'in_progress' },
              { step: '执行批量查询', status: 'pending' },
              { step: '检查文件变更', status: 'pending' },
            ],
          }),
        },
        {
          name: 'ctx_batch_execute',
          arguments: JSON.stringify({
            commands: [
              { label: 'Source Tree', command: 'rg --files src/components/chat/tools' },
              { label: 'Tool Configs', command: 'sed -n "1,120p" src/components/chat/tools/configs/toolConfigs.ts' },
            ],
            queries: ['update_plan renderer', 'filechanges parser success error'],
          }),
        },
        {
          name: 'ctx_execute',
          arguments: JSON.stringify({
            language: 'shell',
            code: 'git status --short',
            intent: '检查工作区变更',
            timeout: 5000,
          }),
        },
        {
          name: 'FileChanges',
          arguments: JSON.stringify({
            status: 'completed',
            changes: [
              { kind: 'added', path: 'src/components/chat/tools/components/ContentRenderers/PlanContent.tsx' },
              { kind: 'modified', path: 'src/components/chat/tools/configs/toolConfigs.ts' },
            ],
          }),
        },
        {
          name: 'functions.write_stdin',
          arguments: JSON.stringify({
            session_id: 68389,
            chars: 'status\\n',
          }),
        },
        {
          name: 'functions.exec_command',
          arguments: JSON.stringify({
            cmd: "/bin/zsh -lc 'pnpm run typecheck'",
            yield_time_ms: 5000,
          }),
        },
      ].map((tool, index) =>
        JSON.stringify({
          type: 'response_item',
          timestamp: '2026-04-20T09:00:02.000Z',
          payload: {
            type: 'function_call',
            call_id: `call-${tool.name}-${index}`,
            name: tool.name,
            arguments: tool.arguments,
          },
        }),
      ),
      // Tool result for update_plan
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-update_plan-0',
          output: JSON.stringify({
            explanation: '先整理计划，再跑命令，最后检查文件变更。',
            plan: [
              { step: '整理工作计划', status: 'completed' },
              { step: '执行批量查询', status: 'in_progress' },
              { step: '检查文件变更', status: 'pending' },
            ],
          }),
        },
      }),
      // Tool result for ctx_batch_execute
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-ctx_batch_execute-1',
          output: [
            'Executed 2 commands (120 lines, 3.0KB). Indexed 4 sections. Searched 2 queries.',
            '',
            '## Indexed Sections',
            '- ToolRenderer (2.0KB)',
            '- toolConfigs (1.0KB)',
            '',
            '## Source Tree',
            'Found files under tools.',
            '',
            '## update_plan renderer',
            '### Source Tree',
            'Plan renderer search hit.',
            '',
            '## filechanges parser success error',
            '### Tool Configs',
            'FileChanges parser search hit.',
          ].join('\n'),
        },
      }),
      // Tool result for ctx_execute
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-ctx_execute-2',
          output: ' M src/components/chat/tools/configs/toolConfigs.ts',
        },
      }),
      // Tool result for write_stdin
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-functions.write_stdin-4',
          output: JSON.stringify({
            output: 'job-42: finished\\nnext poll ready',
          }),
        },
      }),
      // Tool result for functions.exec_command
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:03.000Z',
        payload: {
          type: 'function_call_output',
          call_id: 'call-functions.exec_command-5',
          output: [
            'Chunk ID: typecheck',
            'Wall time: 5.000s',
            'Process exited with code 0',
            'Output:',
            'Typecheck passed',
          ].join('\n'),
        },
      }),
      // Final assistant message
      JSON.stringify({
        type: 'response_item',
        timestamp: '2026-04-20T09:00:04.000Z',
        payload: {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: '结构化渲染已经准备好。' }],
        },
      }),
    ],
  });

  const sessionQuery = new URLSearchParams({
    provider: 'codex',
    projectPath: PRIMARY_FIXTURE_PROJECT_PATH,
  });
  await page.goto(`/session/${sessionId}?${sessionQuery.toString()}`, { waitUntil: 'networkidle' });

  // Wait for the session composer to appear
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible({ timeout: 10_000 });

  // Wait for messages to load and tool content to render
  await page.waitForTimeout(5000);

  await expect(page.getByTestId('tool-plan-content').first()).toContainText('先整理计划，再跑命令，最后检查文件变更。');
  await expect(page.getByTestId('tool-plan-step-0').first()).toContainText('整理工作计划');
  await expect(page.getByTestId('tool-plan-step-0').first()).toContainText('已完成');
  await expect(page.getByTestId('tool-plan-step-1').first()).toContainText('执行批量查询');
  await expect(page.getByTestId('tool-plan-step-1').first()).toContainText('进行中');
  await expect(page.getByTestId('tool-plan-content')).toHaveCount(1);

  await expect(page.getByTestId('tool-batch-execute-content').first()).toContainText('Source Tree');
  await expect(page.getByText('rg --files src/components/chat/tools')).toBeVisible();
  const outputToggle = page.getByRole('button', { name: 'Show output' }).first();
  await expect(outputToggle).toBeVisible();
  await expect(outputToggle).not.toContainText(/Show output|Hide output/);
  await expect(page.getByText('Found files under tools.')).toBeHidden();
  await expect(page.getByText('查询 2 条')).toHaveCount(0);
  await expect(page.getByText('update_plan renderer')).toBeVisible();
  await expect(page.getByText('filechanges parser success error')).toBeVisible();
  await expect(page.getByText('Plan renderer search hit.')).toBeHidden();
  await expect(page.getByText('FileChanges parser search hit.')).toBeHidden();
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).toContainText('Source Tree');
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).toContainText('update_plan renderer');
  await expect(page.getByTestId('tool-batch-command-card').nth(0)).not.toContainText('filechanges parser success error');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).toContainText('Tool Configs');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).toContainText('filechanges parser success error');
  await expect(page.getByTestId('tool-batch-command-card').nth(1)).not.toContainText('update_plan renderer');
  await expect(page.getByTestId('tool-batch-query-result')).toHaveCount(2);
  await expect(page.getByText('Executed 2 commands (120 lines, 3.0KB). Indexed 4 sections. Searched 2 queries.')).toBeHidden();
  await expect(page.getByText('git status --short')).toBeVisible();
  await expect(page.getByText('pnpm run typecheck')).toBeVisible();
  await expect(page.getByText("/bin/zsh -lc 'pnpm run typecheck'")).toHaveCount(0);
  await expect(page.getByText('M src/components/chat/tools/configs/toolConfigs.ts')).toBeHidden();
  await expect(page.locator('text="code": "git status --short"')).toHaveCount(0);
  await expect(page.getByTestId('tool-context-code-card')).toHaveCount(4);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' })).toHaveAttribute('data-single-line', 'true');
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('xpath=ancestor::details')).toHaveCount(0);
  await expect(page.getByTestId('tool-batch-execute-content').locator('xpath=ancestor::details')).toHaveCount(0);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('pre').first()).not.toHaveClass(/context-code-scrollbar-active/);
  await page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).click();
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('pre').first()).toHaveClass(/context-code-scrollbar-active/);
  await expect(page.getByTestId('tool-context-code-card').filter({ hasText: 'git status --short' }).locator('code').first()).toHaveCSS('white-space', 'pre');

  await expect(page.getByText('stdin -> session 68389')).toBeVisible();
  await expect(page.getByText('status\\n')).toBeVisible();

  // The write_stdin result uses collapsible display with defaultOpen: false.
  // Expand it so the pre element with output text is in the DOM.
  await page.getByTestId('codex-tool-card')
    .filter({ hasText: 'functions.write_stdin' })
    .locator('summary')
    .filter({ hasText: 'Output' })
    .click();

  await expect(page.locator('pre').filter({ hasText: 'job-42: finished' }).first()).toContainText('next poll ready');

  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('completed');
  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('PlanContent.tsx');
  await expect(page.getByTestId('tool-file-changes-content').first()).toContainText('toolConfigs.ts');

  await expect(page.locator('text="plan": [')).toHaveCount(0);
  await expect(page.locator('text="commands": [')).toHaveCount(0);
  await expect(page.locator('text="session_id": 68389')).toHaveCount(0);
  await expect(page.locator('text="chars": "status')).toHaveCount(0);
  await expect(page.locator('text="changes": [')).toHaveCount(0);
});
