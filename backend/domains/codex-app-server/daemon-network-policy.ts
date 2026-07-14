/**
 * 文件目的：集中解析 Codex daemon 的代理环境、脱敏诊断与安全重启决策。
 * 业务意义：网络配置只影响独立 daemon，不污染本地 Unix Socket 客户端。
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const PROXY_KEYS = [
  'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY',
  'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
] as const;
const ADDRESS_PROXY_KEYS = PROXY_KEYS.filter((key) => !/no_proxy/i.test(key));

export type CodexProxyMode = 'inherit' | 'off';

export type CodexDaemonNetworkPolicy = {
  networkMode: 'explicit-proxy' | 'proxy-off' | 'system-route';
  daemonEnv: Record<string, string | undefined>;
  diagnostics: Record<string, unknown>;
  fingerprint: string;
  tunDetectionAttempted: false;
};

export type CodexDaemonNetworkState = {
  appliedFingerprint: string;
  pendingFingerprint: string | null;
};

/** 以 Socket 设备号和 inode 识别当前 daemon 实例。 */
function readCodexDaemonSocketIdentity(codexHome: string): string | null {
  try {
    const socket = statSync(path.join(codexHome, 'app-server-control', 'app-server-control.sock'));
    return `${socket.dev}:${socket.ino}`;
  } catch {
    return null;
  }
}

/** 解析代理地址中可安全展示的协议与主机，不返回用户名、密码或路径。 */
function redactProxyAddress(value: string): string {
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'configured';
  }
}

/** 合并 NO_PROXY，并确保环回地址不经过显式代理。 */
function mergeNoProxy(env: Record<string, string | undefined>): string {
  const values = [env.NO_PROXY, env.no_proxy, 'localhost', '127.0.0.1', '::1']
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set(values)].join(',');
}

/** 根据用户模式和进程环境生成 daemon 专属网络策略。 */
export function resolveCodexDaemonNetworkPolicy(input: {
  mode: CodexProxyMode;
  env: Record<string, string | undefined>;
}): CodexDaemonNetworkPolicy {
  const daemonEnv = { ...input.env };
  if (input.mode === 'off') {
    for (const key of PROXY_KEYS) delete daemonEnv[key];
  }

  const configuredProxyKeys = input.mode === 'inherit'
    ? ADDRESS_PROXY_KEYS.filter((key) => Boolean(daemonEnv[key]))
    : [];
  if (configuredProxyKeys.length > 0) {
    const noProxy = mergeNoProxy(daemonEnv);
    daemonEnv.NO_PROXY = noProxy;
    daemonEnv.no_proxy = noProxy;
  }

  const networkMode = input.mode === 'off'
    ? 'proxy-off'
    : configuredProxyKeys.length > 0
      ? 'explicit-proxy'
      : 'system-route';
  const proxyEndpoints = Object.fromEntries(
    configuredProxyKeys.map((key) => [key, redactProxyAddress(String(daemonEnv[key]))]),
  );
  const fingerprintSource = JSON.stringify({
    mode: networkMode,
    proxyValues: configuredProxyKeys.map((key) => [key, String(daemonEnv[key] || '')]),
    noProxy: daemonEnv.NO_PROXY || '',
  });
  const fingerprint = createHash('sha256').update(fingerprintSource).digest('hex').slice(0, 16);

  return {
    networkMode,
    daemonEnv,
    diagnostics: {
      networkMode,
      configuredProxyKeys,
      proxyEndpoints,
      localSocketBypassesProxy: true,
      fingerprint,
    },
    fingerprint,
    tunDetectionAttempted: false,
  };
}

/** 返回 daemon 控制目录内的网络状态文件路径。 */
export function getCodexDaemonNetworkStatePath(codexHome: string): string {
  return path.join(codexHome, 'app-server-control', 'ozw-network-state.json');
}

/** 读取最近一次由 ozw 成功应用的 daemon 网络指纹。 */
export function readCodexDaemonNetworkState(codexHome: string): CodexDaemonNetworkState | null {
  try {
    const value = JSON.parse(readFileSync(getCodexDaemonNetworkStatePath(codexHome), 'utf8')) as Partial<CodexDaemonNetworkState> & { socketIdentity?: string };
    if (!value.socketIdentity || value.socketIdentity !== readCodexDaemonSocketIdentity(codexHome)) return null;
    return typeof value.appliedFingerprint === 'string' && value.appliedFingerprint
      ? {
          appliedFingerprint: value.appliedFingerprint,
          pendingFingerprint: typeof value.pendingFingerprint === 'string' ? value.pendingFingerprint : null,
        }
      : null;
  } catch {
    return null;
  }
}

/** 记录 daemon 实例、已应用及等待确认的网络指纹，不保存代理原值。 */
export function writeCodexDaemonNetworkState(codexHome: string, state: CodexDaemonNetworkState): void {
  const statePath = getCodexDaemonNetworkStatePath(codexHome);
  mkdirSync(path.dirname(statePath), { recursive: true });
  writeFileSync(statePath, `${JSON.stringify({
    ...state,
    socketIdentity: readCodexDaemonSocketIdentity(codexHome),
  }, null, 2)}\n`, { mode: 0o600 });
}

/** 判断代理配置变化能否立刻重启 daemon，保护活动轮次不被静默中断。 */
export function decideCodexDaemonRestart(input: {
  currentNetworkFingerprint: string;
  targetNetworkFingerprint: string;
  activeTurnCount: number;
}): { action: 'none' | 'restart-now' | 'confirm-after-turn'; restartNow: boolean } {
  if (input.currentNetworkFingerprint === input.targetNetworkFingerprint) {
    return { action: 'none', restartNow: false };
  }
  if (input.activeTurnCount > 0) {
    return { action: 'confirm-after-turn', restartNow: false };
  }
  return { action: 'restart-now', restartNow: true };
}
