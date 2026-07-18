/**
 * 文件目的：定义 shell WebSocket 与 PTY session relay 的连接处理边界。
 * 业务意义：终端复连、buffer 和超时清理共享同一 runtime context，不能隐式创建多份状态。
 */
import type { WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import {
    probeSharedCodexThread,
} from '../domains/codex-app-server/shared-thread-probe.js';
import { beginCodexRemoteTuiThreadCapture } from '../domains/codex-app-server/runtime-facade.js';
import {
    readProviderSessionBinding,
    writeProviderSessionBinding,
} from '../domains/provider-runtime/provider-session-binding.js';
import { finalizeManualSessionRoute } from '../projects.js';
import { resolveCodexTerminalAttachPlan } from './codex-terminal-attach-plan.js';
import {
    flushShellOutput,
    markShellOutputInteractive,
    queueShellOutput,
    resetShellOutputQueue,
    takeShellReplay,
} from './shell-output-batcher.js';
import { createTmuxTerminalRuntime } from './terminal-tmux-runtime.js';

type LooseRecord = Record<string, any>;
type PendingForceHandoffOffer = {
    token: string;
    expiresAt: number;
    projectName: string;
    projectPath: string;
    routeSessionId: string | null;
    providerSessionId: string;
};

const FORCE_HANDOFF_OFFER_TTL_MS = 60_000;

/**
 * 归一化聊天 TUI provider，保留 Codex/Pi 的 PTY 边界。
 */
function normalizeShellProvider(provider: unknown): 'codex' | 'pi' | 'claude' | 'plain-shell' {
    if (provider === 'pi') {
        return 'pi';
    }
    if (provider === 'plain-shell') {
        return 'plain-shell';
    }
    if (provider === 'claude') return 'claude';
    return 'codex';
}

/**
 * 构建 provider 对应的 CLI 启动或恢复命令。
 */
function buildProviderShellCommand(input: {
    os: any;
    provider: 'codex' | 'pi' | 'claude';
    projectPath: string;
    hasSession: boolean;
    resumeSessionId?: string | null;
    codexCommandArgs?: string[] | null;
}): string {
    const { os, provider, projectPath, hasSession, resumeSessionId, codexCommandArgs } = input;
    const cliName = provider === 'pi' ? 'pi' : provider === 'claude' ? 'claude' : 'codex';
    const plannedCodexCommand = provider === 'codex' && codexCommandArgs
        ? `codex${codexCommandArgs.length ? ` ${codexCommandArgs.map(quotePosixShell).join(' ')}` : ''}`
        : '';
    const resumeCommand = plannedCodexCommand || (provider === 'pi'
        ? `${cliName} --session ${quotePosixShell(String(resumeSessionId || ''))}`
        : provider === 'claude'
            ? `${cliName} --resume ${quotePosixShell(String(resumeSessionId || ''))}`
            : `${cliName} resume ${quotePosixShell(String(resumeSessionId || ''))}`);
    if (os.platform() === 'win32') {
        if (hasSession && resumeSessionId) {
            return `Set-Location -Path "${projectPath}"; ${resumeCommand}; powershell.exe -NoExit`;
        }
        return `Set-Location -Path "${projectPath}"; ${cliName}; powershell.exe -NoExit`;
    }

    const providerCommand = plannedCodexCommand || (hasSession && resumeSessionId ? resumeCommand : cliName);
    return `cd ${quotePosixShell(projectPath)} && exec "\${SHELL:-/bin/bash}" -lic ${quotePosixShell(`${buildPortableUserBinPathExport()}; { ${providerCommand}; }; exec "\${SHELL:-/bin/bash}" -l`)}`;
}

/**
 * 生成 POSIX shell 单引号参数，供 tmux 命令安全接收路径和启动命令。
 */
function quotePosixShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 补齐跨平台 CLI 管理器常用的用户级 bin 路径，作为默认 shell 配置之外的兜底。
 */
function buildPortableUserBinPathExport(): string {
    return [
        'export PATH="',
        '$HOME/.local/bin:',
        '$HOME/bin:',
        '${PNPM_HOME:+$PNPM_HOME:}',
        '${PNPM_HOME:+$PNPM_HOME/bin:}',
        '$HOME/.local/share/pnpm:',
        '$HOME/.local/share/pnpm/bin:',
        '$HOME/.bun/bin:',
        '$HOME/.cargo/bin:',
        '$PATH"',
    ].join('');
}

/** 执行一个有界、只读的外部 CLI 能力探测。 */
function runExternalProviderProbe(command: string): Promise<boolean> {
    const probe = `${buildPortableUserBinPathExport()}; ${command}`;
    return new Promise((resolve) => {
        execFile(process.env.SHELL || '/bin/sh', ['-lc', probe], { timeout: 2_000 }, (error) => resolve(!error));
    });
}

/**
 * 探测外部 Provider 的安装、版本与认证能力。
 * OZW 只报告失败项，不安装、登录、升级或托管 Provider。
 */
async function diagnoseExternalProvider(provider: 'pi' | 'claude'): Promise<string[]> {
    const cliName = provider === 'pi' ? 'pi' : 'claude';
    const [cliAvailable, versionReadable, authenticationReady] = await Promise.all([
        runExternalProviderProbe(`command -v ${cliName} >/dev/null 2>&1`),
        runExternalProviderProbe(`${cliName} --version >/dev/null 2>&1`),
        provider === 'claude'
            ? runExternalProviderProbe('claude auth status >/dev/null 2>&1')
            : Promise.resolve(false),
    ]);
    const failures: string[] = [];
    if (!cliAvailable) failures.push('cli-unavailable');
    if (cliAvailable && !versionReadable) failures.push('version-unavailable');
    if (cliAvailable && !authenticationReady) failures.push('authentication-unverified');
    return failures;
}

/**
 * 构建受管终端的环境变量。
 * 业务逻辑：Codex 执行环境可能注入 NO_COLOR；tmux 会在首次创建时固化该变量，
 * 因此在创建 PTY 前移除它，同时明确保留 Ozw 所需的彩色终端能力。
 */
function buildManagedTerminalEnvironment(): NodeJS.ProcessEnv {
    const environment = { ...process.env };
    delete environment.NO_COLOR;

    return {
        ...environment,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        FORCE_COLOR: '3',
    };
}

/**
 * 文件目的：构建受管 tmux 终端的启动命令。
 * 业务逻辑：项目目录可能被测试清理或用户删除；先清理工作目录失效的旧 session，
 * 再创建新 session，避免 shell 启动时调用 getcwd() 失败。
 */
function buildManagedTmuxShellCommand(sessionName: string, projectPath: string, shellCommand: string): string {
    const quotedSessionName = quotePosixShell(sessionName);
    const quotedProjectPath = quotePosixShell(projectPath);
    const quotedShellCommand = quotePosixShell(shellCommand);

    return [
        `if [ ! -d ${quotedProjectPath} ]; then echo "Ozw project directory does not exist: ${quotedProjectPath}" >&2; exit 1; fi`,
        `if tmux has-session -t ${quotedSessionName} 2>/dev/null; then tmux list-panes -t ${quotedSessionName} -F '#{pane_current_path}' 2>/dev/null | while IFS= read -r pane_path; do if [ -z "$pane_path" ] || [ ! -d "$pane_path" ]; then tmux kill-session -t ${quotedSessionName} 2>/dev/null || true; break; fi; done; fi`,
        `tmux has-session -t ${quotedSessionName} 2>/dev/null || tmux new-session -d -s ${quotedSessionName} -e HOME="$HOME" -e USERPROFILE="\${USERPROFILE:-$HOME}" -e PATH="$PATH" -e SHELL="\${SHELL:-/bin/bash}" ${quotedShellCommand}`,
        `tmux attach-session -t ${quotedSessionName}`,
    ].join('; ');
}

/**
 * 执行 tmux 生命周期命令，并把“session 不存在”等幂等结果收敛为日志。
 */
function executeTmuxLifecycleCommand(args: string[], actionLabel: string): void {
    execFile('tmux', args, (error, stdout, stderr) => {
        if (error) {
            const output = String(stderr || stdout || error.message || '').trim();
            console.warn(`tmux ${actionLabel} command finished with warning:`, output);
            return;
        }

        console.log(`tmux ${actionLabel} command completed`);
    });
}

/**
 * 检测一个 tmux session 是否仍存在，供旧 key 兼容复连使用。
 */
function tmuxSessionExists(sessionName: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile('tmux', ['has-session', '-t', sessionName], (error) => {
            resolve(!error);
        });
    });
}

/**
 * 捕获 tmux 当前可见屏幕，重连时用单帧快照替代逐块历史回放。
 */
function captureTmuxPane(sessionName: string): Promise<string> {
    return new Promise((resolve) => {
        execFile('tmux', ['capture-pane', '-p', '-e', '-t', sessionName], (error, stdout) => {
            if (error) {
                resolve('');
                return;
            }
            resolve(String(stdout || ''));
        });
    });
}

/**
 * 返回当前 runtime 已存在的 tmux 名称，兼容短名称和旧 base64 名称。
 */
async function findExistingTmuxSessionName(tmuxRuntime: ReturnType<typeof createTmuxTerminalRuntime>): Promise<string> {
    for (const sessionName of [tmuxRuntime.sessionName, ...tmuxRuntime.legacySessionNames]) {
        if (await tmuxSessionExists(sessionName)) {
            return sessionName;
        }
    }
    return '';
}

/**
 * 解析 shell init 中用于 resume 和 PTY 隔离的会话身份。
 */
function resolveShellSessionIdentity(data: LooseRecord): {
    routeSessionId: string | null;
    providerSessionId: string | null;
    resumeSessionId: string | null;
    ptyIdentity: string;
    legacyPtyIdentities: string[];
} {
    const routeSessionId = typeof data.routeSessionId === 'string' && data.routeSessionId.trim()
        ? data.routeSessionId.trim()
        : null;
    const providerSessionId = typeof data.providerSessionId === 'string' && data.providerSessionId.trim()
        ? data.providerSessionId.trim()
        : typeof data.sessionId === 'string' && data.sessionId.trim() && !/^c\d+$/.test(data.sessionId.trim())
            ? data.sessionId.trim()
            : null;
    const resumeSessionId = providerSessionId;
    const ptyIdentity = routeSessionId
        ? `route:${routeSessionId}`
        : providerSessionId
            ? `provider:${providerSessionId}`
            : 'new-session';
    const legacyPtyIdentities = routeSessionId
        ? [
            `${routeSessionId}_no-provider-session`,
            providerSessionId ? `${routeSessionId}_${providerSessionId}` : '',
        ].filter(Boolean)
        : [];

    return { routeSessionId, providerSessionId, resumeSessionId, ptyIdentity, legacyPtyIdentities };
}

/**
 * 关闭并清理所有缓存 PTY session。
 */
export function closeShellPtySessions(runtime: any): void {
    for (const [, session] of runtime.ptySessionsMap.entries()) {
        if (session.timeoutId) {
            clearTimeout(session.timeoutId);
        }
        resetShellOutputQueue(session);
        if (session.pty && session.pty.kill) {
            session.pty.kill();
        }
    }
    runtime.ptySessionsMap.clear();
}

/**
 * 处理 shell WebSocket 连接、PTY spawn、buffer、resize 和断连保活。
 */
export function handleShellConnection(deps: any, ws: WebSocket): void {
    const { ptySessionsMap, PTY_SESSION_TIMEOUT, SHELL_URL_PARSE_BUFFER_LIMIT, stripAnsiSequences, normalizeDetectedUrl, extractUrlsFromText, shouldAutoOpenUrlFromOutput, os, pty, WebSocket } = deps;
    // Handle shell WebSocket connections
    function runShellConnection(ws: WebSocket) {
        console.log('🐚 Shell client connected');
        let shellProcess: any = null;
        let ptySessionKey: string | null = null;
        let pendingForceHandoffOffer: PendingForceHandoffOffer | null = null;
        let urlDetectionBuffer = '';
        const announcedAuthUrls = new Set();

        ws.on('message', async (message: Buffer | string) => {
            try {
                const data: LooseRecord = JSON.parse(String(message));
                console.log('📨 Shell message received:', data.type);

                if (data.type === 'init') {
                    const projectPath = data.projectPath || process.cwd();
                    const identity = resolveShellSessionIdentity(data);
                    const {
                        routeSessionId,
                        ptyIdentity,
                        legacyPtyIdentities
                    } = identity;
                    let providerSessionId = identity.providerSessionId;
                    let resumeSessionId = identity.resumeSessionId;
                    const provider = normalizeShellProvider(data.provider);
                    const projectName = typeof data.projectName === 'string' ? data.projectName : '';
                    if (routeSessionId && provider !== 'plain-shell') {
                        const persistedBinding = await readProviderSessionBinding(projectName, projectPath, routeSessionId);
                        if (persistedBinding?.provider === provider) {
                            providerSessionId = persistedBinding.providerSessionId;
                            resumeSessionId = persistedBinding.providerSessionId;
                        }
                    }
                    const forceHandoffRequested = data.forceHandoff === true;
                    const forceHandoffToken = typeof data.handoffToken === 'string' ? data.handoffToken : '';
                    const forceHandoffAuthorized = Boolean(
                        forceHandoffRequested
                        && pendingForceHandoffOffer
                        && pendingForceHandoffOffer.expiresAt >= Date.now()
                        && pendingForceHandoffOffer.token === forceHandoffToken
                        && pendingForceHandoffOffer.projectName === projectName
                        && pendingForceHandoffOffer.projectPath === projectPath
                        && pendingForceHandoffOffer.routeSessionId === routeSessionId
                        && pendingForceHandoffOffer.providerSessionId === providerSessionId,
                    );
                    if (forceHandoffRequested && !forceHandoffAuthorized) {
                        ws.send(JSON.stringify({
                            type: 'handoff-force-rejected',
                            reason: 'handoff-confirmation-invalid-or-expired',
                        }));
                        return;
                    }
                    if (forceHandoffAuthorized) {
                        pendingForceHandoffOffer = null;
                    }
                    let hasSession = Boolean(data.hasSession && resumeSessionId) || Boolean(providerSessionId);
                    const initialCommand = data.initialCommand;
                    const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                    const riskConfirmed = data.riskConfirmed === true;
                    urlDetectionBuffer = '';
                    announcedAuthUrls.clear();

                    if (!isPlainShell && (provider === 'claude' || provider === 'pi') && !riskConfirmed) {
                        const failures = await diagnoseExternalProvider(provider);
                        if (hasSession && data.externalSessionState !== 'idle') {
                            failures.push(`session-${data.externalSessionState || 'unknown'}`);
                        }
                        if (failures.length > 0) {
                            ws.send(JSON.stringify({
                                type: 'provider-risk-confirmation-required',
                                provider,
                                reason: failures[0],
                                failures,
                            }));
                            return;
                        }
                    }

                    // Login commands should never reuse cached sessions.
                    const isLoginCommand = initialCommand && (
                        initialCommand.includes('setup-token') ||
                        initialCommand.includes('auth login')
                    );

                    // Include command hash in session key so different commands get separate sessions
                    const commandSuffix = isPlainShell && initialCommand
                        ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                        : '';
                    const primaryPtySessionKey = `${projectPath}_${provider}_${ptyIdentity}${commandSuffix}`;
                    const legacyPtySessionKeys = legacyPtyIdentities.map((identity) => `${projectPath}_${provider}_${identity}${commandSuffix}`);
                    const candidatePtySessionKeys = [primaryPtySessionKey, ...legacyPtySessionKeys];
                    ptySessionKey = primaryPtySessionKey;
                    let tmuxRuntime = createTmuxTerminalRuntime(ptySessionKey);
                    let activeTmuxSessionName = tmuxRuntime.sessionName;
                    let managedTmuxExists = false;

                    // Kill any existing login session before starting fresh
                    if (isLoginCommand) {
                        const oldSession = ptySessionsMap.get(ptySessionKey);
                        if (oldSession) {
                            console.log('🧹 Cleaning up existing login session:', ptySessionKey);
                            if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                            resetShellOutputQueue(oldSession);
                            if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                            ptySessionsMap.delete(ptySessionKey);
                        }
                    }

                    const existingSessionKey = isLoginCommand || isPlainShell
                        ? ''
                        : candidatePtySessionKeys.find((sessionKey) => ptySessionsMap.has(sessionKey)) || '';
                    if (existingSessionKey) {
                        ptySessionKey = existingSessionKey;
                        tmuxRuntime = createTmuxTerminalRuntime(ptySessionKey);
                        activeTmuxSessionName = tmuxRuntime.sessionName;
                    } else if (!isLoginCommand && !isPlainShell && os.platform() !== 'win32') {
                        const existingTmuxSessionName = await findExistingTmuxSessionName(tmuxRuntime);
                        if (existingTmuxSessionName) {
                            activeTmuxSessionName = existingTmuxSessionName;
                            managedTmuxExists = true;
                        } else {
                            for (const legacyPtySessionKey of legacyPtySessionKeys) {
                                const legacyTmuxRuntime = createTmuxTerminalRuntime(legacyPtySessionKey);
                                const legacyTmuxSessionName = await findExistingTmuxSessionName(legacyTmuxRuntime);
                                if (!legacyTmuxSessionName) {
                                    continue;
                                }
                                ptySessionKey = legacyPtySessionKey;
                                tmuxRuntime = legacyTmuxRuntime;
                                activeTmuxSessionName = legacyTmuxSessionName;
                                managedTmuxExists = true;
                                break;
                            }
                        }
                    }

                    const existingSession = isLoginCommand || isPlainShell ? null : ptySessionsMap.get(ptySessionKey);
                    if (existingSession) {
                        console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                        shellProcess = existingSession.pty;

                        clearTimeout(existingSession.timeoutId);
                        existingSession.timeoutId = null;
                        const fallbackReplay = takeShellReplay(existingSession);
                        resetShellOutputQueue(existingSession);
                        existingSession.ws = null;
                        const paneSnapshot = existingSession.tmuxSessionName
                            ? await captureTmuxPane(existingSession.tmuxSessionName)
                            : '';
                        if (ws.readyState !== WebSocket.OPEN) {
                            return;
                        }
                        existingSession.ws = ws;
                        const recoveryOutput = paneSnapshot || fallbackReplay;
                        if (recoveryOutput) {
                            ws.send(JSON.stringify({
                                type: 'output',
                                data: `\x1b[2J\x1b[H${recoveryOutput}`,
                            }));
                        }
                        flushShellOutput(existingSession, WebSocket);

                        return;
                    }

                    console.log('[INFO] Starting shell in:', projectPath);
                    console.log('📋 Session info:', hasSession ? `Resume session ${resumeSessionId}` : (isPlainShell ? 'Plain shell mode' : 'New session'));
                    if (routeSessionId || providerSessionId) {
                        console.log('🧭 Session identity:', { routeSessionId, providerSessionId });
                    }
                    console.log('🤖 Provider:', isPlainShell ? 'plain-shell' : provider);
                    if (initialCommand) {
                        console.log('⚡ Initial command:', initialCommand);
                    }

                    // First send a welcome message
                    let welcomeMsg;
                    if (isPlainShell) {
                        welcomeMsg = `\x1b[36mStarting terminal in: ${projectPath}\x1b[0m\r\n`;
                    } else {
                        const providerName = provider === 'pi' ? 'Pi' : provider === 'claude' ? 'Claude Code' : 'Codex';
                        welcomeMsg = hasSession ?
                            `\x1b[36mResuming ${providerName} session ${resumeSessionId} in: ${projectPath}\x1b[0m\r\n` :
                            `\x1b[36mStarting new ${providerName} session in: ${projectPath}\x1b[0m\r\n`;
                    }

                    ws.send(JSON.stringify({
                        type: 'output',
                        data: welcomeMsg
                    }));

                    try {
                        // Prepare the shell command adapted to the platform and provider
                        let shellCommand;
                        let codexCommandArgs: string[] | null = null;
                        if (!isPlainShell && provider === 'codex') {
                            const codexHome = process.env.CODEX_HOME || path.join(homedir(), '.codex');
                            const socketPath = path.join(codexHome, 'app-server-control', 'app-server-control.sock');

                            /** 启动共享远端终端，并在拿到新线程编号后绑定回当前卡片。 */
                            const startCapturedSharedTui = async (originalProviderSessionId: string | null): Promise<string[]> => {
                                const capture = await beginCodexRemoteTuiThreadCapture({ projectPath });
                                void capture.threadStarted.then(async ({ providerSessionId: capturedSessionId }) => {
                                    if (routeSessionId) {
                                        await writeProviderSessionBinding({
                                            projectName,
                                            projectPath,
                                            routeSessionId,
                                            provider: 'codex',
                                            providerSessionId: capturedSessionId,
                                        });
                                        await finalizeManualSessionRoute(
                                            projectName,
                                            routeSessionId,
                                            capturedSessionId,
                                            'codex',
                                            projectPath,
                                        );
                                    }
                                    if (originalProviderSessionId && ws.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({
                                            type: 'handoff-force-completed',
                                            routeSessionId,
                                            providerSessionId: capturedSessionId,
                                            originalProviderSessionId,
                                        }));
                                    }
                                }).catch((error) => {
                                    const message = error instanceof Error ? error.message : String(error);
                                    console.warn('[Shell] Failed to bind new Codex remote TUI thread:', message);
                                    if (originalProviderSessionId && ws.readyState === WebSocket.OPEN) {
                                        ws.send(JSON.stringify({ type: 'handoff-force-rejected', reason: message }));
                                    }
                                });
                                return ['--remote', capture.endpoint, '-C', projectPath];
                            };

                            if (!providerSessionId && routeSessionId && !managedTmuxExists) {
                                codexCommandArgs = await startCapturedSharedTui(null);
                            }
                            const sharedRuntimeProbe = providerSessionId
                                ? await probeSharedCodexThread(socketPath, providerSessionId)
                                : {
                                    ready: false,
                                    threadOwned: false,
                                    threadReadable: false,
                                    threadState: 'unknown' as const,
                                    activeTurnDetected: false,
                                    activeTurnOwned: false,
                                };
                            const attachPlan = codexCommandArgs ? null : resolveCodexTerminalAttachPlan({
                                providerSessionId,
                                managedTmuxExists,
                                forceHandoff: forceHandoffAuthorized,
                                sharedRuntime: {
                                    ...sharedRuntimeProbe,
                                    endpoint: `unix://${socketPath}`,
                                },
                                externalSessionState: data.externalSessionState === 'running' || data.isProcessing === true
                                    ? 'running'
                                    : data.externalSessionState === 'idle' || data.isProcessing === false
                                        ? 'idle'
                                        : 'unknown',
                            });
                            if (attachPlan?.action === 'blocked') {
                                const canForceHandoff = Boolean(
                                    sharedRuntimeProbe.ready
                                    && providerSessionId,
                                );
                                const blockedMessage = attachPlan.reason === 'external-active-session-not-shared'
                                    ? '警告：该旧式会话仍在原运行时中活动。你可以等待完成，或确认风险后强制接管。'
                                    : '警告：暂时无法核实该旧式会话的活动状态。你可以返回原终端确认，或承担风险强制接管。';
                                if (canForceHandoff && providerSessionId) {
                                    pendingForceHandoffOffer = {
                                        token: randomUUID(),
                                        expiresAt: Date.now() + FORCE_HANDOFF_OFFER_TTL_MS,
                                        projectName,
                                        projectPath,
                                        routeSessionId,
                                        providerSessionId,
                                    };
                                    ws.send(JSON.stringify({
                                        type: 'handoff-warning',
                                        reason: attachPlan.reason,
                                        canForceHandoff: true,
                                        handoffToken: pendingForceHandoffOffer.token,
                                        routeSessionId,
                                        providerSessionId,
                                    }));
                                } else {
                                    pendingForceHandoffOffer = null;
                                    ws.send(JSON.stringify({
                                        type: 'handoff-blocked',
                                        reason: attachPlan.reason,
                                        sessionFailed: attachPlan.sessionFailed,
                                    }));
                                }
                                ws.send(JSON.stringify({
                                    type: 'output',
                                    data: `\x1b[33m${blockedMessage}\x1b[0m\r\n`,
                                }));
                                return;
                            }
                            if (forceHandoffAuthorized && attachPlan) {
                                if (!providerSessionId) {
                                    throw new Error('Force handoff requires the original Codex session ID');
                                }
                                const originalProviderSessionId = providerSessionId;
                                if (attachPlan.action === 'new-shared-tui') {
                                    codexCommandArgs = await startCapturedSharedTui(originalProviderSessionId);
                                    providerSessionId = null;
                                    resumeSessionId = null;
                                    hasSession = false;
                                }
                                ws.send(JSON.stringify({
                                    type: 'handoff-force-started',
                                    routeSessionId,
                                    providerSessionId,
                                    originalProviderSessionId,
                                    action: attachPlan.action,
                                }));
                            }
                            codexCommandArgs = codexCommandArgs || attachPlan?.commandArgs || null;
                        }
                        if (isPlainShell) {
                            // Plain shell mode - open an interactive shell by default, or run the provided command.
                            if (os.platform() === 'win32') {
                                shellCommand = initialCommand
                                    ? `Set-Location -Path "${projectPath}"; ${initialCommand}`
                                    : `Set-Location -Path "${projectPath}"; powershell.exe -NoExit`;
                            } else {
                                shellCommand = initialCommand
                                    ? `cd "${projectPath}" && ${initialCommand}`
                                    : `cd "${projectPath}" && exec "${process.env.SHELL || '/bin/bash'}" -l`;
                            }
                        } else if (provider === 'codex' || provider === 'pi' || provider === 'claude') {
                            shellCommand = buildProviderShellCommand({
                                os,
                                provider,
                                projectPath,
                                hasSession,
                                resumeSessionId,
                                codexCommandArgs,
                            });
                        } else {
                            throw new Error(`Unsupported shell provider: ${provider}`);
                        }

                        if (os.platform() !== 'win32') {
                            const sessionName = activeTmuxSessionName;
                            const managedTmuxCommand = buildManagedTmuxShellCommand(
                                sessionName,
                                projectPath,
                                shellCommand,
                            );
                            shellCommand = [
                                'command -v tmux >/dev/null 2>&1 || { echo "Error: tmux is required for persistent terminals. Please install tmux."; exit 127; }',
                                managedTmuxCommand,
                            ].join(' && ');
                        }

                        console.log('🔧 Executing shell command:', shellCommand);
                        console.log('🧩 tmux session runtime:', {
                            sessionName: tmuxRuntime.sessionName,
                            activeSessionName: activeTmuxSessionName,
                            legacySessionNames: tmuxRuntime.legacySessionNames,
                            hasSession: tmuxRuntime.hasSession().join(' '),
                            newSession: tmuxRuntime.createSession(shellCommand).join(' '),
                            attachSession: tmuxRuntime.attachSession().join(' '),
                            capturePane: tmuxRuntime.capturePane().join(' '),
                            sendKeys: tmuxRuntime.sendKeys('<input>').join(' '),
                        });

                        // Use appropriate shell based on platform
                        const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
                        const shellArgs = os.platform() === 'win32' ? ['-Command', shellCommand] : ['-c', shellCommand];

                        // Use terminal dimensions from client if provided, otherwise use defaults
                        const termCols = data.cols || 80;
                        const termRows = data.rows || 24;
                        console.log('📐 Using terminal dimensions:', termCols, 'x', termRows);

                        shellProcess = pty.spawn(shell, shellArgs, {
                            name: 'xterm-256color',
                            cols: termCols,
                            rows: termRows,
                            cwd: os.homedir(),
                            env: buildManagedTerminalEnvironment(),
                        });

                        console.log('🟢 Shell process started with PTY, PID:', shellProcess.pid);

                        ptySessionsMap.set(ptySessionKey, {
                            pty: shellProcess,
                            ws: ws,
                            buffer: [],
                            timeoutId: null,
                            projectPath,
                            sessionId: resumeSessionId,
                            routeSessionId,
                            providerSessionId,
                            tmuxSessionName: activeTmuxSessionName,
                            isPlainShell,
                            provider,
                            pendingOutput: '',
                            outputFlushTimer: null,
                            interactiveOutputPending: false,
                        });

                        // Handle data output
                        shellProcess.onData((data: string) => {
                            const session = ptySessionsMap.get(ptySessionKey);
                            if (!session) return;

                            let outputData = data;
                            const cleanChunk = stripAnsiSequences(data);
                            urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                            outputData = outputData.replace(
                                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                '[INFO] Opening in browser: $1'
                            );

                            const emitAuthUrl = (detectedUrl: string, autoOpen = false) => {
                                const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                if (!normalizedUrl || !session.ws || session.ws.readyState !== WebSocket.OPEN) return;

                                const isNewUrl = !announcedAuthUrls.has(normalizedUrl);
                                if (isNewUrl) {
                                    announcedAuthUrls.add(normalizedUrl);
                                    session.ws.send(JSON.stringify({
                                        type: 'auth_url',
                                        url: normalizedUrl,
                                        autoOpen
                                    }));
                                }
                            };

                            const normalizedDetectedUrls: string[] = (extractUrlsFromText(urlDetectionBuffer) as string[])
                                .map((url: string) => normalizeDetectedUrl(url))
                                .filter((url: string | null): url is string => Boolean(url));

                            // Prefer the most complete URL if shorter prefix variants are also present.
                            const dedupedDetectedUrls = Array.from(new Set(normalizedDetectedUrls)).filter((url: string, _: number, urls: string[]) =>
                                !urls.some((otherUrl) => otherUrl !== url && otherUrl.startsWith(url))
                            );

                            dedupedDetectedUrls.forEach((url) => emitAuthUrl(url, false));

                            if (shouldAutoOpenUrlFromOutput(cleanChunk) && dedupedDetectedUrls.length > 0) {
                                const bestUrl = dedupedDetectedUrls.reduce((longest: string, current: string) =>
                                    current.length > longest.length ? current : longest
                                );
                                emitAuthUrl(bestUrl, true);
                            }

                            queueShellOutput({
                                session,
                                data: outputData,
                                isPlainShell,
                                WebSocketState: WebSocket,
                            });
                        });

                        // Handle process exit
                        shellProcess.onExit((exitCode: { exitCode: number; signal?: string }) => {
                            console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                            const session = ptySessionsMap.get(ptySessionKey);
                            if (session) {
                                flushShellOutput(session, WebSocket);
                            }
                            if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                                session.ws.send(JSON.stringify({
                                    type: 'output',
                                    data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                                }));
                            }
                            if (session && session.timeoutId) {
                                clearTimeout(session.timeoutId);
                            }
                            if (session) {
                                resetShellOutputQueue(session);
                            }
                            ptySessionsMap.delete(ptySessionKey);
                            shellProcess = null;
                        });

                    } catch (spawnError: any) {
                        console.error('[ERROR] Error spawning process:', spawnError);
                        ws.send(JSON.stringify({
                            type: 'output',
                            data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
                        }));
                    }

                } else if (data.type === 'ping') {
                    ws.send(JSON.stringify({
                        type: 'pong',
                        timestamp: data.timestamp || Date.now()
                    }));
                } else if (data.type === 'input') {
                    // Send input to shell process
                    if (shellProcess && shellProcess.write) {
                        try {
                            if (ptySessionKey) {
                                const session = ptySessionsMap.get(ptySessionKey);
                                if (session && !session.isPlainShell) {
                                    markShellOutputInteractive(session, WebSocket);
                                }
                            }
                            shellProcess.write(data.data);
                        } catch (error: any) {
                            console.error('Error writing to shell:', error);
                        }
                    } else {
                        console.warn('No active shell process to send input to');
                    }
                } else if (data.type === 'resize') {
                    // Handle terminal resize
                    if (shellProcess && shellProcess.resize) {
                        console.log('Terminal resize requested:', data.cols, 'x', data.rows);
                        shellProcess.resize(data.cols, data.rows);
                    }
                } else if (data.type === 'kill_terminal' || data.type === 'terminateTerminal' || data.type === 'deleteTerminal') {
                    if (ptySessionKey) {
                        const tmuxRuntime = createTmuxTerminalRuntime(ptySessionKey);
                        const session = ptySessionsMap.get(ptySessionKey);
                        const targetTmuxSessionName = session?.tmuxSessionName || tmuxRuntime.sessionName;
                        console.log('🧹 Explicit terminal termination requested:', ['tmux', 'kill-session', '-t', targetTmuxSessionName].join(' '));
                        const killSessionArgs = ['kill-session', '-t', targetTmuxSessionName];
                        executeTmuxLifecycleCommand(killSessionArgs, 'kill-session');
                        if (session?.timeoutId) {
                            clearTimeout(session.timeoutId);
                        }
                        if (session) {
                            resetShellOutputQueue(session);
                        }
                        if (session?.pty && session.pty.kill) {
                            session.pty.kill();
                        }
                        ptySessionsMap.delete(ptySessionKey);
                    }
                }
            } catch (error: any) {
                console.error('[ERROR] Shell WebSocket error:', error.message);
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        type: 'output',
                        data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
                    }));
                }
            }
        });

        ws.on('close', () => {
            console.log('🔌 Shell client disconnected');

            if (ptySessionKey) {
                const session = ptySessionsMap.get(ptySessionKey);
                if (session) {
                    console.log('⏳ Terminal websocket detached; tmux session remains available:', ptySessionKey);
                    if (session.ws !== ws) {
                        console.log('ℹ️  Ignoring stale shell socket close because session already moved to a newer websocket');
                        return;
                    }

                    if (session.tmuxSessionName) {
                        executeTmuxLifecycleCommand(['detach-client', '-s', session.tmuxSessionName], 'detach-client');
                    }
                    session.ws = null;
                }
            }
        });

        ws.on('error', (error: Error) => {
            console.error('[ERROR] Shell WebSocket error:', error);
        });
    }
    runShellConnection(ws);
}
