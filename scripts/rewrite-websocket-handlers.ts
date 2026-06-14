/**
 * PURPOSE: Rewrite legacy WebSocket handler blocks during one-off server
 * migration work.
 */
import fs from 'node:fs';

const file: string = 'backend/index.ts';
let content = fs.readFileSync(file, 'utf8');

// Replace codex-command handler
const codexStart = content.indexOf("} else if (data.type === 'codex-command') {");
const piStart = content.indexOf("} else if (data.type === 'pi-command') {", codexStart);
const codexBlock = content.slice(codexStart, piStart);

const newCodexBlock = `} else if (data.type === 'codex-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Codex request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    ozwSessionId,
                    startRequestId,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const shouldStartCcflowDraft = ozwSessionId && (
                    (!resolvedOptions?.sessionId || isCcflowRouteSessionId(resolvedOptions.sessionId))
                    && (!data.sessionId || isCcflowRouteSessionId(data.sessionId))
                );
                const codexProviderOptions = shouldStartCcflowDraft
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                writer.setSessionIndexContext(ozwSessionId ? {
                    projectName: codexProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                    provider: 'codex',
                    ozwSessionId,
                    startRequestId,
                } : null);
                if (shouldStartCcflowDraft) {
                    const startResult = await startManualSessionDraft(
                        codexProviderOptions?.projectName || data.options?.projectName || '',
                        codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        ozwSessionId,
                        'codex',
                        startRequestId,
                    );
                    if (!startResult.started && startResult.reason !== 'already-started') {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: ozwSessionId,
                            ozwSessionId,
                            provider: 'codex',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                }
                console.log('[DEBUG] Codex request:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', codexProviderOptions?.projectPath || codexProviderOptions?.cwd || 'Unknown');
                console.log('🤖 Model:', codexProviderOptions?.model || 'default');
                const sessionModelState = codexProviderOptions?.sessionId
                    ? await getSessionModelState(
                        codexProviderOptions?.projectPath || codexProviderOptions?.cwd || '',
                        codexProviderOptions.sessionId,
                    ).catch(() => ({}))
                    : {};
                const codexOptions = {
                    ...codexProviderOptions,
                    reasoningEffort: sessionModelState.reasoningEffort || codexProviderOptions?.reasoningEffort,
                };
                const effectiveSessionId = codexOptions?.sessionId || data.sessionId || ozwSessionId;
                await sendNativeMessage({
                    provider: 'codex',
                    sessionId: ozwSessionId || effectiveSessionId || \`codex-\${Date.now()}\`,
                    projectPath: codexOptions?.projectPath || codexOptions?.cwd || '',
                    text: data.command || '',
                    runningBehavior: data.options?.runningBehavior || (data.options?.activePolicy === 'queue' ? 'queue' : undefined),
                    model: codexOptions?.model || '',
                    reasoningEffort: codexOptions?.reasoningEffort || '',
                    permissionMode: codexOptions?.permissionMode || '',
                    clientRequestId: startRequestId || data.clientRequestId || null,
                    writer,
                });
                sendMessageAccepted(writer, {
                    sessionId: ozwSessionId || effectiveSessionId || data.sessionId,
                    ozwSessionId,
                    provider: 'codex',
                    clientRequestId: startRequestId,
                    startRequestId,
                });`;

content = content.slice(0, codexStart) + newCodexBlock + content.slice(piStart);

// Replace pi-command handler
const piStart2 = content.indexOf("} else if (data.type === 'pi-command') {");
const abortStart = content.indexOf("} else if (data.type === 'abort-session') {", piStart2);
const piBlock = content.slice(piStart2, abortStart);

const newPiBlock = `} else if (data.type === 'pi-command') {
                if (!acceptChatRequestId(data.clientRequestId || data.options?.clientRequestId)) {
                    console.warn('[DEBUG] Ignoring duplicate Pi request:', data.clientRequestId || data.options?.clientRequestId);
                    return;
                }
                const resolvedOptions = await resolveChatProjectOptions(data.options, extractProjectDirectory);
                const {
                    ozwSessionId,
                    startRequestId,
                } = resolveCcflowSessionStartContext(data, resolvedOptions);
                const shouldStartCcflowDraft = ozwSessionId && (
                    (!resolvedOptions?.sessionId || isCcflowRouteSessionId(resolvedOptions.sessionId))
                    && (!data.sessionId || isCcflowRouteSessionId(data.sessionId))
                );
                const piProviderOptions = shouldStartCcflowDraft
                    ? { ...resolvedOptions, sessionId: undefined, resume: false }
                    : resolvedOptions;
                writer.setSessionIndexContext(ozwSessionId ? {
                    projectName: piProviderOptions?.projectName || data.options?.projectName || '',
                    projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                    provider: 'pi',
                    ozwSessionId,
                    startRequestId,
                } : null);
                if (shouldStartCcflowDraft) {
                    const startResult = await startManualSessionDraft(
                        piProviderOptions?.projectName || data.options?.projectName || '',
                        piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                        ozwSessionId,
                        'pi',
                        startRequestId,
                    );
                    if (!startResult.started && startResult.reason !== 'already-started') {
                        writer.send({
                            type: 'session-start-rejected',
                            sessionId: ozwSessionId,
                            ozwSessionId,
                            provider: 'pi',
                            reason: startResult.reason,
                            startRequestId: startResult.startRequestId,
                        });
                        return;
                    }
                }
                console.log('[DEBUG] Pi request:', data.command || '[Continue/Resume]');
                console.log('📁 Project:', piProviderOptions?.projectPath || piProviderOptions?.cwd || 'Unknown');
                const effectiveSessionId = piProviderOptions?.sessionId || data.sessionId || ozwSessionId;
                await sendNativeMessage({
                    provider: 'pi',
                    sessionId: ozwSessionId || effectiveSessionId || \`pi-\${Date.now()}\`,
                    projectPath: piProviderOptions?.projectPath || piProviderOptions?.cwd || '',
                    text: data.command || '',
                    runningBehavior: data.options?.runningBehavior || (data.options?.activePolicy === 'steer' ? 'steer' : data.options?.activePolicy === 'followUp' ? 'followUp' : undefined),
                    permissionMode: piProviderOptions?.permissionMode || '',
                    clientRequestId: startRequestId || data.clientRequestId || null,
                    writer,
                });
                sendMessageAccepted(writer, {
                    sessionId: ozwSessionId || effectiveSessionId || data.sessionId,
                    ozwSessionId,
                    provider: 'pi',
                    clientRequestId: startRequestId,
                    startRequestId,
                });`;

content = content.slice(0, piStart2) + newPiBlock + content.slice(abortStart);

// Replace abort-session handler
const abortStart2 = content.indexOf("} else if (data.type === 'abort-session') {");
const claudePermStart = content.indexOf("} else if (data.type === 'claude-permission-response') {", abortStart2);
const abortBlock = content.slice(abortStart2, claudePermStart);

const newAbortBlock = `} else if (data.type === 'abort-session') {
                console.log('[DEBUG] Abort session request:', data.sessionId);
                const provider = normalizeManualProvider(data.provider || 'codex');
                const ozwSessionId = isCcflowRouteSessionId(data.ozwSessionId || data.sessionId)
                    ? (data.ozwSessionId || data.sessionId)
                    : null;
                if (ozwSessionId) {
                    await markManualSessionDraftCancelRequested(
                        data.projectName || '',
                        data.projectPath || '',
                        ozwSessionId,
                        data.startRequestId || '',
                    );
                }
                const result = await abortNativeSession(provider, ozwSessionId || data.sessionId);
                writer.send({
                    type: 'session-aborted',
                    sessionId: data.sessionId,
                    ozwSessionId,
                    provider,
                    success: result.aborted,
                });`;

content = content.slice(0, abortStart2) + newAbortBlock + content.slice(claudePermStart);

// Replace check-session-status handler
const checkStart = content.indexOf("} else if (data.type === 'check-session-status') {");
const getActiveStart = content.indexOf("} else if (data.type === 'get-active-sessions') {", checkStart);
const checkBlock = content.slice(checkStart, getActiveStart);

const newCheckBlock = `} else if (data.type === 'check-session-status') {
                const provider = normalizeManualProvider(data.provider || 'codex');
                const sessionId = data.ozwSessionId || data.ozw_session_id || data.sessionId;
                const status = getNativeSessionStatus(provider, sessionId);
                writer.send({
                    type: 'session-status',
                    sessionId,
                    ozwSessionId: sessionId,
                    ozw_session_id: sessionId,
                    provider,
                    isProcessing: status.isProcessing,
                    turnId: '',
                    turn_id: '',
                });`;

content = content.slice(0, checkStart) + newCheckBlock + content.slice(getActiveStart);

// Replace get-active-sessions handler
const getActiveStart2 = content.indexOf("} else if (data.type === 'get-active-sessions') {");
const pingStart = content.indexOf("} else if (data.type === 'ping') {", getActiveStart2);
const getActiveBlock = content.slice(getActiveStart2, pingStart);

const newGetActiveBlock = `} else if (data.type === 'get-active-sessions') {
                const activeSessions = getActiveNativeSessions();
                writer.send({
                    type: 'active-sessions',
                    sessions: activeSessions,
                });`;

content = content.slice(0, getActiveStart2) + newGetActiveBlock + content.slice(pingStart);

fs.writeFileSync(file, content);
console.log('Rewrote WebSocket handlers in backend/index.ts');
