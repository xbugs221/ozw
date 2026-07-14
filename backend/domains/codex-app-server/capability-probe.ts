/**
 * 文件目的：通过实际 CLI help 输出探测 Codex 共享 app-server 能力。
 * 业务意义：兼容实验命令变化，不使用脆弱的版本字符串判断。
 */

import { spawnSync } from 'node:child_process';

export type CodexSharedRuntimeCapabilities = {
  daemon: boolean;
  proxy: boolean;
  unixSocket: boolean;
  remoteTui: boolean;
};

/** 从三组真实 help 文本解析共享运行时能力。 */
export function parseCodexSharedRuntimeCapabilities(input: {
  daemonHelp: string;
  proxyHelp: string;
  rootHelp: string;
}): CodexSharedRuntimeCapabilities {
  return {
    daemon: /\bstart\b/.test(input.daemonHelp) && /app-server daemon/i.test(input.daemonHelp),
    proxy: /--sock\b/.test(input.proxyHelp) && /app-server proxy/i.test(input.proxyHelp),
    unixSocket: /Unix domain socket|unix:\/\//i.test(`${input.proxyHelp}\n${input.rootHelp}`),
    remoteTui: /--remote\b/.test(input.rootHelp) && /unix:\/\//i.test(input.rootHelp),
  };
}

/** 执行 Codex help 命令并返回能力矩阵；命令失败时对应能力保持 false。 */
export function probeCodexSharedRuntimeCapabilities(command = 'codex'): CodexSharedRuntimeCapabilities {
  const readHelp = (args: string[]): string => {
    /** 将 stdout/stderr 合并，因为部分 CLI 会把 help 写到 stderr。 */
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 5000 });
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  };
  return parseCodexSharedRuntimeCapabilities({
    daemonHelp: readHelp(['app-server', 'daemon', '--help']),
    proxyHelp: readHelp(['app-server', 'proxy', '--help']),
    rootHelp: readHelp(['--help']),
  });
}
