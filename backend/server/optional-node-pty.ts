/**
 * 文件目的：按需加载可选的 node-pty 原生模块，并把加载失败收敛为终端能力降级。
 * 业务意义：node-pty 安装失败时，HTTP、WebUI 和非终端能力仍可正常启动。
 */
import { prepareNodePtyRuntime } from './node-pty-runtime.js';

export type NodePtyRuntime = {
    spawn: (...args: any[]) => any;
};

type NodePtyImporter = () => Promise<unknown>;
type NodePtyPreparer = () => void;

const TERMINAL_UNAVAILABLE_MESSAGE =
    'Web terminal unavailable: optional dependency node-pty could not be loaded. Reinstall Ozw without --omit=optional and restart it.';

/**
 * 表示只有 Web 终端能力不可用，调用方不得把它升级为服务启动失败。
 */
export class TerminalUnavailableError extends Error {
    readonly code = 'OZW_TERMINAL_UNAVAILABLE';

    constructor(cause?: unknown) {
        super(TERMINAL_UNAVAILABLE_MESSAGE, { cause });
        this.name = 'TerminalUnavailableError';
    }
}

/**
 * 从 CommonJS 或 ESM 的 node-pty 导出中提取统一的 spawn 接口。
 */
function normalizeNodePtyModule(moduleValue: unknown): NodePtyRuntime {
    const moduleRecord = moduleValue && typeof moduleValue === 'object'
        ? moduleValue as Record<string, unknown>
        : {};
    const defaultRecord = moduleRecord.default && typeof moduleRecord.default === 'object'
        ? moduleRecord.default as Record<string, unknown>
        : {};
    const candidate = typeof moduleRecord.spawn === 'function' ? moduleRecord : defaultRecord;
    if (typeof candidate.spawn !== 'function') {
        throw new Error('node-pty does not export spawn()');
    }
    return candidate as NodePtyRuntime;
}

/**
 * 创建可注入、仅缓存成功结果的 node-pty loader，便于验证缺失原生模块时的降级路径。
 */
export function createNodePtyLoader(options: {
    importModule?: NodePtyImporter;
    prepareRuntime?: NodePtyPreparer;
} = {}): () => Promise<NodePtyRuntime> {
    const importModule = options.importModule ?? (() => import('node-pty'));
    const prepareRuntime = options.prepareRuntime ?? prepareNodePtyRuntime;
    let cachedRuntime: NodePtyRuntime | null = null;
    let pendingLoad: Promise<NodePtyRuntime> | null = null;

    return async function loadNodePtyRuntime(): Promise<NodePtyRuntime> {
        /** Return a prepared runtime without repeating native-module work. */
        if (cachedRuntime) {
            return cachedRuntime;
        }
        if (!pendingLoad) {
            pendingLoad = importModule()
                .then((moduleValue) => {
                    const runtime = normalizeNodePtyModule(moduleValue);
                    prepareRuntime();
                    cachedRuntime = runtime;
                    return runtime;
                })
                .catch((error) => {
                    throw error instanceof TerminalUnavailableError
                        ? error
                        : new TerminalUnavailableError(error);
                })
                .finally(() => {
                    pendingLoad = null;
                });
        }
        return pendingLoad;
    };
}

export const loadNodePtyRuntime = createNodePtyLoader();
