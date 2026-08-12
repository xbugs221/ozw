/**
 * 文件目的：异步探测并缓存 Codex 客户端连接能力。
 * 业务意义：兼容实验命令变化，同时避免 CLI help 阻塞 Node 事件循环或被并发重复执行。
 */

import { execFile } from 'node:child_process';
import { buildPortableCodexSpawnEnv } from './stdio-transport.js';

const DEFAULT_CAPABILITY_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS = 5000;

export type CodexSharedRuntimeCapabilities = {
  proxy: boolean;
  unixSocket: boolean;
  remoteTui: boolean;
};

export type CodexCapabilityProbeOptions = {
  ttlMs?: number;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

type CapabilityCacheEntry = {
  capabilities: CodexSharedRuntimeCapabilities;
  expiresAt: number;
};

const successfulProbeCache = new Map<string, CapabilityCacheEntry>();
const pendingProbes = new Map<string, Promise<CodexSharedRuntimeCapabilities>>();
let cacheGeneration = 0;

/** 从客户端命令帮助文本解析连接独立服务所需能力。 */
export function parseCodexSharedRuntimeCapabilities(input: {
  proxyHelp: string;
  rootHelp: string;
}): CodexSharedRuntimeCapabilities {
  return {
    proxy: /--sock\b/.test(input.proxyHelp) && /app-server proxy/i.test(input.proxyHelp),
    unixSocket: /Unix domain socket|unix:\/\//i.test(`${input.proxyHelp}\n${input.rootHelp}`),
    remoteTui: /--remote\b/.test(input.rootHelp) && /unix:\/\//i.test(input.rootHelp),
  };
}

/** 异步读取一组 CLI help；失败会拒绝，使调用方下一次可以重新探测。 */
function readHelp(command: string, args: string[], options: CodexCapabilityProbeOptions): Promise<string> {
  /** execFile 使用异步子进程回调，不占用 Node 主事件循环。 */
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      encoding: 'utf8',
      env: buildPortableCodexSpawnEnv(options.env || process.env),
      timeout: options.timeoutMs ?? DEFAULT_CAPABILITY_PROBE_TIMEOUT_MS,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`Codex capability probe failed: ${error.message}`));
        return;
      }
      resolve(`${stdout || ''}\n${stderr || ''}`);
    });
  });
}

/** 执行一次完整能力探测，等待两个 help 子进程都收敛后再返回或失败。 */
async function runCapabilityProbe(
  command: string,
  options: CodexCapabilityProbeOptions,
): Promise<CodexSharedRuntimeCapabilities> {
  /** allSettled 避免一个命令先失败时遗留另一条未收敛的探测。 */
  const [proxyHelp, rootHelp] = await Promise.allSettled([
    readHelp(command, ['app-server', 'proxy', '--help'], options),
    readHelp(command, ['--help'], options),
  ]);
  const failure = [proxyHelp, rootHelp].find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
  return parseCodexSharedRuntimeCapabilities({
    proxyHelp: proxyHelp.status === 'fulfilled' ? proxyHelp.value : '',
    rootHelp: rootHelp.status === 'fulfilled' ? rootHelp.value : '',
  });
}

/**
 * 异步探测指定 Codex 可执行文件；并发调用共享一次 Promise，仅缓存成功结果。
 */
export function probeCodexSharedRuntimeCapabilities(
  command = 'codex',
  options: CodexCapabilityProbeOptions = {},
): Promise<CodexSharedRuntimeCapabilities> {
  /** 命令路径是缓存隔离边界，同一可执行文件共享探测结果。 */
  const now = Date.now();
  const cached = successfulProbeCache.get(command);
  if (cached && cached.expiresAt > now) return Promise.resolve(cached.capabilities);
  if (cached) successfulProbeCache.delete(command);

  const pending = pendingProbes.get(command);
  if (pending) return pending;

  const ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_CAPABILITY_CACHE_TTL_MS);
  const probeGeneration = cacheGeneration;
  let probe!: Promise<CodexSharedRuntimeCapabilities>;
  probe = runCapabilityProbe(command, options)
    .then((capabilities) => {
      if (probeGeneration === cacheGeneration) {
        successfulProbeCache.set(command, { capabilities, expiresAt: Date.now() + ttlMs });
      }
      return capabilities;
    })
    .finally(() => {
      if (pendingProbes.get(command) === probe) pendingProbes.delete(command);
    });
  pendingProbes.set(command, probe);
  return probe;
}

/** 清除成功结果与在途引用，供隔离测试验证缓存边界。 */
export function clearCodexCapabilityProbeCacheForTest(command?: string): void {
  /** 清理不会终止已经启动的子进程，只阻止其结果污染后续测试读取。 */
  cacheGeneration += 1;
  if (command) {
    successfulProbeCache.delete(command);
    pendingProbes.delete(command);
    return;
  }
  successfulProbeCache.clear();
  pendingProbes.clear();
}
