/**
 * 文件目的：定义 shell WebSocket 与 PTY session relay 的连接处理边界。
 * 业务意义：终端复连、buffer 和超时清理共享同一 runtime context，不能隐式创建多份状态。
 */
import type { WebSocket } from 'ws';
import { execFile } from 'node:child_process';
import { createTmuxTerminalRuntime } from './terminal-tmux-runtime.js';

type LooseRecord = Record<string, any>;

/**
 * 归一化聊天 TUI provider，保留 Codex/Pi 的 PTY 边界。
 */
function normalizeShellProvider(provider: unknown): 'codex' | 'pi' | 'plain-shell' {
    if (provider === 'pi') {
        return 'pi';
    }
    if (provider === 'plain-shell') {
        return 'plain-shell';
    }
    return 'codex';
}

/**
 * 构建 provider 对应的 CLI 启动或恢复命令。
 */
function buildProviderShellCommand(input: {
    os: any;
    provider: 'codex' | 'pi';
    projectPath: string;
    hasSession: boolean;
    resumeSessionId?: string | null;
}): string {
    const { os, provider, projectPath, hasSession, resumeSessionId } = input;
    const cliName = provider === 'pi' ? 'pi' : 'codex';
    const resumeCommand = provider === 'pi'
        ? `${cliName} --session "${resumeSessionId}"`
        : `${cliName} resume "${resumeSessionId}"`;
    if (os.platform() === 'win32') {
        if (hasSession && resumeSessionId) {
            return `Set-Location -Path "${projectPath}"; ${resumeCommand}; if ($LASTEXITCODE -ne 0) { ${cliName} }`;
        }
        return `Set-Location -Path "${projectPath}"; ${cliName}`;
    }

    if (hasSession && resumeSessionId) {
        return `cd "${projectPath}" && ${resumeCommand} || ${cliName}`;
    }
    return `cd "${projectPath}" && ${cliName}`;
}

/**
 * 生成 POSIX shell 单引号参数，供 tmux 命令安全接收路径和启动命令。
 */
function quotePosixShell(value: string): string {
    return `'${value.replace(/'/g, `'\\''`)}'`;
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
 * 解析 shell init 中用于 resume 和 PTY 隔离的会话身份。
 */
function resolveShellSessionIdentity(data: LooseRecord): {
    routeSessionId: string | null;
    providerSessionId: string | null;
    resumeSessionId: string | null;
    ptyIdentity: string;
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
    const ptyIdentity = [
        routeSessionId || 'no-route-session',
        providerSessionId || 'no-provider-session'
    ].join('_');

    return { routeSessionId, providerSessionId, resumeSessionId, ptyIdentity };
}

/**
 * 关闭并清理所有缓存 PTY session。
 */
export function closeShellPtySessions(runtime: any): void {
    for (const [, session] of runtime.ptySessionsMap.entries()) {
        if (session.timeoutId) {
            clearTimeout(session.timeoutId);
        }
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
        let urlDetectionBuffer = '';
        const announcedAuthUrls = new Set();

        ws.on('message', async (message: Buffer | string) => {
            try {
                const data: LooseRecord = JSON.parse(String(message));
                console.log('📨 Shell message received:', data.type);

                if (data.type === 'init') {
                    const projectPath = data.projectPath || process.cwd();
                    const {
                        routeSessionId,
                        providerSessionId,
                        resumeSessionId,
                        ptyIdentity
                    } = resolveShellSessionIdentity(data);
                    const hasSession = Boolean(data.hasSession && resumeSessionId);
                    const provider = normalizeShellProvider(data.provider);
                    const initialCommand = data.initialCommand;
                    const isPlainShell = data.isPlainShell || (!!initialCommand && !hasSession) || provider === 'plain-shell';
                    urlDetectionBuffer = '';
                    announcedAuthUrls.clear();

                    // Login commands should never reuse cached sessions.
                    const isLoginCommand = initialCommand && (
                        initialCommand.includes('setup-token') ||
                        initialCommand.includes('auth login')
                    );

                    // Include command hash in session key so different commands get separate sessions
                    const commandSuffix = isPlainShell && initialCommand
                        ? `_cmd_${Buffer.from(initialCommand).toString('base64').slice(0, 16)}`
                        : '';
                    ptySessionKey = `${projectPath}_${provider}_${ptyIdentity}${commandSuffix}`;
                    const tmuxRuntime = createTmuxTerminalRuntime(ptySessionKey);

                    // Kill any existing login session before starting fresh
                    if (isLoginCommand) {
                        const oldSession = ptySessionsMap.get(ptySessionKey);
                        if (oldSession) {
                            console.log('🧹 Cleaning up existing login session:', ptySessionKey);
                            if (oldSession.timeoutId) clearTimeout(oldSession.timeoutId);
                            if (oldSession.pty && oldSession.pty.kill) oldSession.pty.kill();
                            ptySessionsMap.delete(ptySessionKey);
                        }
                    }

                    const existingSession = isLoginCommand || isPlainShell ? null : ptySessionsMap.get(ptySessionKey);
                    if (existingSession) {
                        console.log('♻️  Reconnecting to existing PTY session:', ptySessionKey);
                        shellProcess = existingSession.pty;

                        clearTimeout(existingSession.timeoutId);
                        existingSession.timeoutId = null;

                        ws.send(JSON.stringify({
                            type: 'output',
                            data: `\x1b[36m[Reconnected to existing session]\x1b[0m\r\n`
                        }));

                        if (existingSession.buffer && existingSession.buffer.length > 0) {
                            console.log(`📜 Sending ${existingSession.buffer.length} buffered messages`);
                            existingSession.buffer.forEach((bufferedData: string) => {
                                ws.send(JSON.stringify({
                                    type: 'output',
                                    data: bufferedData
                                }));
                            });
                        }

                        existingSession.ws = ws;

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
                        const providerName = provider === 'pi' ? 'Pi' : 'Codex';
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
                        } else if (provider === 'codex' || provider === 'pi') {
                            shellCommand = buildProviderShellCommand({
                                os,
                                provider,
                                projectPath,
                                hasSession,
                                resumeSessionId,
                            });
                        } else {
                            throw new Error(`Unsupported shell provider: ${provider}`);
                        }

                        if (os.platform() !== 'win32') {
                            const sessionName = quotePosixShell(tmuxRuntime.sessionName);
                            const tmuxStartCommand = quotePosixShell(shellCommand);
                            shellCommand = [
                                'command -v tmux >/dev/null 2>&1 || { echo "Error: tmux is required for persistent terminals. Please install tmux."; exit 127; }',
                                `tmux has-session -t ${sessionName} 2>/dev/null || tmux new-session -d -s ${sessionName} ${tmuxStartCommand}`,
                                `tmux attach-session -t ${sessionName}`,
                            ].join(' && ');
                        }

                        console.log('🔧 Executing shell command:', shellCommand);
                        console.log('🧩 tmux session runtime:', {
                            sessionName: tmuxRuntime.sessionName,
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
                            env: {
                                ...process.env,
                                TERM: 'xterm-256color',
                                COLORTERM: 'truecolor',
                                FORCE_COLOR: '3'
                            }
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
                            tmuxSessionName: tmuxRuntime.sessionName
                        });

                        // Handle data output
                        shellProcess.onData((data: string) => {
                            const session = ptySessionsMap.get(ptySessionKey);
                            if (!session) return;

                            if (session.buffer.length < 5000) {
                                session.buffer.push(data);
                            } else {
                                session.buffer.shift();
                                session.buffer.push(data);
                            }

                            if (session.ws && session.ws.readyState === WebSocket.OPEN) {
                                let outputData = data;

                                const cleanChunk = stripAnsiSequences(data);
                                urlDetectionBuffer = `${urlDetectionBuffer}${cleanChunk}`.slice(-SHELL_URL_PARSE_BUFFER_LIMIT);

                                outputData = outputData.replace(
                                    /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                                    '[INFO] Opening in browser: $1'
                                );

                                const emitAuthUrl = (detectedUrl: string, autoOpen = false) => {
                                    const normalizedUrl = normalizeDetectedUrl(detectedUrl);
                                    if (!normalizedUrl) return;

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

                                // Send regular output
                                session.ws.send(JSON.stringify({
                                    type: 'output',
                                    data: outputData
                                }));
                            }
                        });

                        // Handle process exit
                        shellProcess.onExit((exitCode: { exitCode: number; signal?: string }) => {
                            console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
                            const session = ptySessionsMap.get(ptySessionKey);
                            if (session && session.ws && session.ws.readyState === WebSocket.OPEN) {
                                session.ws.send(JSON.stringify({
                                    type: 'output',
                                    data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
                                }));
                            }
                            if (session && session.timeoutId) {
                                clearTimeout(session.timeoutId);
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
                        console.log('🧹 Explicit terminal termination requested:', tmuxRuntime.terminateTerminal().join(' '));
                        const [, ...killSessionArgs] = tmuxRuntime.terminateTerminal();
                        executeTmuxLifecycleCommand(killSessionArgs, 'kill-session');
                        const session = ptySessionsMap.get(ptySessionKey);
                        if (session?.timeoutId) {
                            clearTimeout(session.timeoutId);
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
