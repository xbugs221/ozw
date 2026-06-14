/**
 * 文件目的：用 Vitest 覆盖后端聊天请求项目路径解析的低状态业务规则。
 * 业务场景：用户从指定项目发起聊天时，provider 必须使用项目目录而不是服务进程目录。
 * 失败含义：失败通常表示 cwd/projectPath 回填退化，可能导致会话跑到错误工作区。
 */
import { describe, expect, test } from 'vitest';

import { resolveChatProjectOptions } from '../../backend/chat-project-path';

describe('chat project path resolution', () => {
  test('显式 cwd/projectPath 优先于 projectName 查找结果', async () => {
    /**
     * docstring: Explicit user-selected paths are authoritative for new chat requests.
     */
    const result = await resolveChatProjectOptions(
      {
        cwd: '/tmp/feature-a',
        projectPath: '/tmp/feature-a',
        projectName: 'ignored-project',
      },
      async () => '/tmp/other-project',
    );

    expect(result.cwd).toBe('/tmp/feature-a');
    expect(result.projectPath).toBe('/tmp/feature-a');
  });

  test('缺少路径时从 projectName 回填 cwd 和 projectPath', async () => {
    /**
     * docstring: Project-name lookup keeps new session payloads bound to the selected workspace.
     */
    const result = await resolveChatProjectOptions(
      {
        projectName: 'feature-a',
        sessionId: 'session-1',
      } as any,
      async (projectName: string) => `/workspace/${projectName}`,
    );

    expect(result.cwd).toBe('/workspace/feature-a');
    expect(result.projectPath).toBe('/workspace/feature-a');
    expect((result as any).sessionId).toBe('session-1');
  });

  test('projectName 查找失败时保留原始 payload', async () => {
    /**
     * docstring: Lookup failures should not mutate unrelated chat options.
     */
    const options = {
      projectName: 'missing-project',
      model: 'gpt-5',
    };

    const result = await resolveChatProjectOptions(options, async () => {
      throw new Error('missing project');
    });

    expect(result).toEqual(options);
  });
});
