/**
 * 文件目的：验证可选 node-pty 的延迟加载、失败隔离与成功缓存语义。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
    createNodePtyLoader,
    TerminalUnavailableError,
} from '../../backend/server/optional-node-pty.ts';
import { handleShellConnection } from '../../backend/server/shell-websocket.ts';

/**
 * 构造只记录消息处理器和服务端输出的最小 WebSocket 测试替身。
 */
function createFakeWebSocket() {
    const handlers = new Map<string, (...args: any[]) => any>();
    const sent: string[] = [];
    return {
        socket: {
            readyState: 1,
            on(event: string, handler: (...args: any[]) => any) {
                /** Preserve each shell connection callback for explicit invocation. */
                handlers.set(event, handler);
            },
            send(payload: string) {
                /** Record public protocol output without requiring a network listener. */
                sent.push(payload);
            },
        },
        handlers,
        sent,
    };
}

test('missing node-pty does not prepare a runtime and returns a stable public error', async () => {
    let prepareCalls = 0;
    const load = createNodePtyLoader({
        importModule: async () => {
            throw new Error('/private/native/path/node-pty.node: wrong architecture');
        },
        prepareRuntime: () => {
            prepareCalls += 1;
        },
    });

    await assert.rejects(load, (error: unknown) => {
        assert.ok(error instanceof TerminalUnavailableError);
        assert.equal(error.code, 'OZW_TERMINAL_UNAVAILABLE');
        assert.equal(error.message.includes('/private/native/path'), false);
        return true;
    });
    assert.equal(prepareCalls, 0);
});

test('successful node-pty load prepares and imports only once', async () => {
    let importCalls = 0;
    let prepareCalls = 0;
    const runtime = { spawn() { return { pid: 7 }; } };
    const load = createNodePtyLoader({
        importModule: async () => {
            importCalls += 1;
            return { default: runtime };
        },
        prepareRuntime: () => {
            prepareCalls += 1;
        },
    });

    const [first, second] = await Promise.all([load(), load()]);
    assert.equal(first, runtime);
    assert.equal(second, runtime);
    assert.equal(await load(), runtime);
    assert.equal(importCalls, 1);
    assert.equal(prepareCalls, 1);
});

test('shell init stops before session state or spawn when node-pty is unavailable', async () => {
    let spawnCalls = 0;
    const ptySessionsMap = new Map();
    const { socket, handlers, sent } = createFakeWebSocket();
    handleShellConnection({
        ptySessionsMap,
        PTY_SESSION_TIMEOUT: 1,
        SHELL_URL_PARSE_BUFFER_LIMIT: 1024,
        stripAnsiSequences: (value: string) => value,
        normalizeDetectedUrl: () => null,
        extractUrlsFromText: () => [],
        shouldAutoOpenUrlFromOutput: () => false,
        os: { platform: () => 'linux' },
        WebSocket: { OPEN: 1 },
        loadNodePtyRuntime: async () => {
            throw new TerminalUnavailableError();
        },
        pty: {
            spawn() {
                spawnCalls += 1;
            },
        },
    }, socket as any);

    await handlers.get('message')?.(JSON.stringify({
        type: 'init',
        projectName: 'must-not-bind',
        projectPath: '/must-not-touch',
        routeSessionId: 'c1',
    }));

    assert.equal(spawnCalls, 0);
    assert.equal(ptySessionsMap.size, 0);
    assert.equal(sent.length, 2);
    const response = JSON.parse(sent[0]);
    assert.deepEqual(response, {
        type: 'terminal-unavailable',
        reason: 'node-pty-unavailable',
        message: 'Web terminal unavailable: optional dependency node-pty could not be loaded. Reinstall Ozw without --omit=optional and restart it.',
    });
});
