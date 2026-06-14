/**
 * 文件目的：封装 Codex app-server 的 JSON-RPC stdio transport。
 * 业务意义：生产环境通过该边界启动 `codex app-server --listen stdio://`，测试可替换 transport 验证实时会话行为。
 */

import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import readline from 'readline';
import {
  CODEX_APPROVAL_POLICY,
  CODEX_SANDBOX_MODE,
} from '../../constants/config.js';
import {
  normalizeCodexApprovalPolicy,
  normalizeCodexSandboxMode,
} from '../../codex-permission-policy.js';

export type CodexAppServerNotification = {
  method: string;
  params: unknown;
};

export type CodexAppServerTransport = {
  request(method: string, params: unknown): Promise<unknown>;
  onNotification(handler: (notification: CodexAppServerNotification) => void): void;
  close(): void;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
};

export type StdioTransportOptions = {
  onFailure?: (message: string) => void;
};

/**
 * 构建 Codex app-server CLI 参数。
 */
export function buildCodexAppServerCliArgs(): string[] {
  return [
    '-c',
    `sandbox_mode=${normalizeCodexSandboxMode(CODEX_SANDBOX_MODE)}`,
    '-c',
    `approval_policy=${normalizeCodexApprovalPolicy(CODEX_APPROVAL_POLICY)}`,
    'app-server',
    '--listen',
    'stdio://',
  ];
}

/**
 * 创建生产 stdio transport，并在首个业务请求前完成 initialize handshake。
 */
export function createStdioAppServerTransport(options: StdioTransportOptions = {}): CodexAppServerTransport {
  const child = spawn('codex', buildCodexAppServerCliArgs(), {
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pendingRequests = new Map<string, PendingRequest>();
  const notificationHandlers: Array<(notification: CodexAppServerNotification) => void> = [];
  let initializedPromise: Promise<unknown> | null = null;

  const rl = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });

  rl.on('line', (line) => {
    if (!line.trim()) return;
    const message = parseJsonRpcLine(line);
    if (!message) return;

    if (typeof message.id === 'string' && pendingRequests.has(message.id)) {
      const pending = pendingRequests.get(message.id)!;
      pendingRequests.delete(message.id);
      if (message.error) {
        pending.reject(new Error(String((message.error as Record<string, unknown>)?.message || message.error)));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (typeof message.method === 'string') {
      const notification = { method: message.method, params: message.params };
      for (const handler of notificationHandlers) {
        try {
          handler(notification);
        } catch (err) {
          console.error('[codex-app-server] notification handler failed', err);
        }
      }
    }
  });

  child.stderr?.on('data', (chunk) => {
    console.error('[codex-app-server]', chunk.toString('utf8'));
  });

  child.on('error', (err) => {
    rejectPendingRequests(pendingRequests, err);
    options.onFailure?.(`Codex app-server process error: ${err.message}`);
  });

  child.on('close', (code) => {
    const err = new Error(`Codex app-server exited with code ${code}`);
    rejectPendingRequests(pendingRequests, err);
    options.onFailure?.(`Codex app-server exited with code ${code}`);
  });

  function sendRawRequest(method: string, params: unknown): Promise<unknown> {
    /**
     * 为每个 JSON-RPC 请求创建唯一 id，并用 pending map 关联响应。
     */
    const id = randomUUID();
    const payload = { jsonrpc: '2.0', id, method, params };
    return new Promise((resolve, reject) => {
      pendingRequests.set(id, { resolve, reject });
      try {
        child.stdin!.write(`${JSON.stringify(payload)}\n`);
      } catch (writeErr) {
        pendingRequests.delete(id);
        reject(writeErr);
      }
    });
  }

  function ensureInitialized(): Promise<unknown> {
    /**
     * Codex app-server 会拒绝未 initialize 的业务请求。
     */
    if (!initializedPromise) {
      initializedPromise = sendRawRequest('initialize', {
        clientInfo: {
          name: 'ozw',
          title: 'CBW',
          version: 'v2026.06.01',
        },
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
          optOutNotificationMethods: [],
        },
      });
    }
    return initializedPromise;
  }

  return {
    async request(method: string, params: unknown): Promise<unknown> {
      if (method !== 'initialize') {
        await ensureInitialized();
      }
      return sendRawRequest(method, params);
    },
    onNotification(handler) {
      notificationHandlers.push(handler);
    },
    close() {
      try {
        child.kill('SIGTERM');
      } catch (err) {
        console.error('[codex-app-server] failed to terminate child process', err);
      }
      rl.close();
    },
  };
}

/**
 * 解析 app-server stdout 中的一行 JSON-RPC 消息。
 */
function parseJsonRpcLine(line: string): Record<string, unknown> | null {
  try {
    return JSON.parse(line) as Record<string, unknown>;
  } catch (err) {
    console.error('[codex-app-server] invalid JSON-RPC line', err);
    return null;
  }
}

/**
 * transport 失败时拒绝所有未完成请求。
 */
function rejectPendingRequests(pendingRequests: Map<string, PendingRequest>, err: Error): void {
  for (const pending of pendingRequests.values()) {
    pending.reject(err);
  }
  pendingRequests.clear();
}
