/**
 * 文件目的：验证浏览器终端生成的 tmux 会话名始终符合 tmux 限制。
 * 业务意义：项目路径含版本号或特殊字符时，终端仍能创建、复连和终止。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createTmuxSessionName } from '../../backend/server/terminal-tmux-runtime.ts';

test('项目路径中的小数点会被归一化', () => {
  /**
   * 版本号目录很常见，但 tmux 明确禁止 session 名含小数点。
   */
  assert.equal(
    createTmuxSessionName('/home/zzl/projects/ald_proj/atom-number-1.9_codex_route:c1'),
    'ozw_ald_proj_atom-number-1_9_c1',
  );
});

test('tmux 会话名只保留安全白名单字符', () => {
  /**
   * 冒号、空白、Unicode、括号及 shell 符号应走同一兜底规则。
   */
  const sessionName = createTmuxSessionName(
    '/home/zzl/projects/特殊 项目:v2/[draft]$x_codex_route:c8',
  );

  assert.match(sessionName, /^[A-Za-z0-9_-]+$/);
  assert.doesNotMatch(sessionName, /[.:]/);
});
