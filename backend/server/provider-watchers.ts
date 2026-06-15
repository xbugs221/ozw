/**
 * 文件目的：定义 provider transcript 与 workflow runner watcher 的生命周期边界。
 * 业务意义：文件监听负责广播项目、会话和 workflow 变化，应独立于 HTTP 与 WebSocket handler。
 */
import path from 'path';
import { promises as fsPromises } from 'fs';
import { resolveFlowRunDir } from '../domains/workflows/flow-runtime-paths.js';

type LooseRecord = Record<string, any>;

const WATCHER_DEBOUNCE_MS = 300;
const GO_RUNNER_WATCH_DEPTH = 1;
let projectsWatchers: Array<{ close(): Promise<void> | void }> = [];
let projectsWatcherDebounceTimer: NodeJS.Timeout | null = null;
const goRunnerWatchers = new Map<string, { close(): Promise<void> | void }>();
let goRunnerWatcherDebounceTimer: NodeJS.Timeout | null = null;

/**
 * 创建 provider 与 workflow watcher 控制器。
 */
export function createProviderWatcherController(deps: any) {
    const { PROVIDER_WATCH_PATHS, WATCHER_IGNORED_PATTERNS, clearProjectDirectoryCache, deleteProviderSessionIndexFile, indexProviderSessionFile, resolveProviderSessionChange, broadcastSessionChanged, broadcastWorkflowChanged, attachWorkflowMetadata, getProjects, ensureGoRunnerWatchersForProjects } = deps;
    /**
     * Close all provider filesystem watchers and clear any pending debounce work.
     */
    async function closeProjectsWatchers() {
        if (projectsWatcherDebounceTimer) {
            clearTimeout(projectsWatcherDebounceTimer);
            projectsWatcherDebounceTimer = null;
        }

        await Promise.all(
            projectsWatchers.map(async (watcher) => {
                try {
                    await watcher.close();
                } catch (error: any) {
                    console.error('[WARN] Failed to close watcher:', error);
                }
            })
        );
        projectsWatchers = [];
    }

    /**
     * Close all Go runner state/log watchers and clear pending broadcasts.
     */
    async function closeGoRunnerWatchers() {
        if (goRunnerWatcherDebounceTimer) {
            clearTimeout(goRunnerWatcherDebounceTimer);
            goRunnerWatcherDebounceTimer = null;
        }

        await Promise.all(
            Array.from(goRunnerWatchers.values()).map(async (watcher) => {
                try {
                    await watcher.close();
                } catch (error: any) {
                    console.error('[WARN] Failed to close Go runner watcher:', error);
                }
            })
        );
        goRunnerWatchers.clear();
    }

    /**
     * Debounce Go runner state/log changes into one project refresh broadcast.
     */
    function scheduleGoRunnerProjectUpdate(eventType: string, filePath: string, runDir: string, projectName = '', projectPath = '') {
        if (goRunnerWatcherDebounceTimer) {
            clearTimeout(goRunnerWatcherDebounceTimer);
        }

        goRunnerWatcherDebounceTimer = setTimeout(() => {
            goRunnerWatcherDebounceTimer = null;
            void broadcastWorkflowChanged({
                changeType: eventType,
                projectName,
                projectPath,
                runId: path.basename(runDir),
            });
        }, WATCHER_DEBOUNCE_MS);
    }

    /**
     * Watch one Go-backed workflow run directory for state.json and log/artifact
     * changes that should refresh the workflow read model.
     */
    async function watchGoWorkflowRun(project: LooseRecord, workflow: LooseRecord) {
        const projectPath = project?.fullPath || project?.path || '';
        const runId = String(workflow?.runId || '').trim();
        if (workflow?.runner !== 'go' || !projectPath || !runId) {
            return null;
        }

        const watcherKey = `${projectPath}:${runId}`;
        if (goRunnerWatchers.has(watcherKey)) {
            return goRunnerWatchers.get(watcherKey);
        }

        const chokidar = (await import('chokidar')).default;
        const runDir = resolveFlowRunDir(projectPath, runId);
        await fsPromises.mkdir(runDir, { recursive: true });
        const watcher = chokidar.watch(runDir, {
            persistent: true,
            ignoreInitial: true,
            followSymlinks: false,
            // Go read models are rebuilt from state.json and top-level run artifacts.
            // Deep parallel-member artifact trees can exhaust inotify watches.
            depth: GO_RUNNER_WATCH_DEPTH,
            awaitWriteFinish: {
                stabilityThreshold: 100,
                pollInterval: 50
            }
        });

        const projectName = project?.name || '';

        watcher
            .on('add', (filePath) => scheduleGoRunnerProjectUpdate('add', filePath, runDir, projectName, projectPath))
            .on('change', (filePath) => scheduleGoRunnerProjectUpdate('change', filePath, runDir, projectName, projectPath))
            .on('unlink', (filePath) => scheduleGoRunnerProjectUpdate('unlink', filePath, runDir, projectName, projectPath))
            .on('error', (error) => {
                console.error(`[ERROR] Go runner watcher error for ${runId}:`, error);
            });

        goRunnerWatchers.set(watcherKey, watcher);
        await new Promise<void>((resolve) => {
            const readyTimer = setTimeout(resolve, 1000);
            watcher.once('ready', () => {
                clearTimeout(readyTimer);
                resolve();
            });
        });
        return watcher;
    }

    /**
     * Recreate Go runner watchers for all visible Go-backed workflows on startup.
     */
    async function setupGoRunnerWatchers() {
        await closeGoRunnerWatchers();
        const projects = await attachWorkflowMetadata(await getProjects());
        await ensureGoRunnerWatchersForProjects(projects, watchGoWorkflowRun);
    }

    // Setup file system watchers for Claude and Codex project/session folders
    async function setupProjectsWatcher() {
        const chokidar = (await import('chokidar')).default;

        await closeProjectsWatchers();

        const debouncedUpdate = (eventType: string, filePath: string, provider: string, rootPath: string) => {
            if (projectsWatcherDebounceTimer) {
                clearTimeout(projectsWatcherDebounceTimer);
            }

            projectsWatcherDebounceTimer = setTimeout(async () => {
                try {
                    clearProjectDirectoryCache();
                    if (filePath.endsWith('.jsonl')) {
                        if (eventType === 'unlink') {
                            await deleteProviderSessionIndexFile(provider, filePath);
                        } else if (eventType === 'add' || eventType === 'change') {
                            await indexProviderSessionFile(provider, filePath);
                        }
                    }
                    const sessionChange = await resolveProviderSessionChange({
                        provider,
                        filePath,
                        rootPath,
                        changeType: eventType,
                    });
                    broadcastSessionChanged(sessionChange);
                    // 只发 scoped 事件；transcript 追加不触发全局项目列表刷新

                } catch (error: any) {
                    console.error('[ERROR] Error handling project changes:', error);
                }
            }, WATCHER_DEBOUNCE_MS);
        };

        for (const { provider, rootPath } of PROVIDER_WATCH_PATHS) {
            try {
                // chokidar v4 emits ENOENT via the "error" event for missing roots and will not auto-recover.
                // Ensure provider folders exist before creating the watcher so watching stays active.
                await fsPromises.mkdir(rootPath, { recursive: true });

                // Initialize chokidar watcher with optimized settings
                const watcher = chokidar.watch(rootPath, {
                    ignored: WATCHER_IGNORED_PATTERNS,
                    persistent: true,
                    ignoreInitial: true, // Don't fire events for existing files on startup
                    followSymlinks: false,
                    depth: 10, // Reasonable depth limit
                    awaitWriteFinish: {
                        stabilityThreshold: 100, // Wait 100ms for file to stabilize
                        pollInterval: 50
                    }
                });

                // Set up event listeners
                watcher
                    .on('add', (filePath) => debouncedUpdate('add', filePath, provider, rootPath))
                    .on('change', (filePath) => debouncedUpdate('change', filePath, provider, rootPath))
                    .on('unlink', (filePath) => debouncedUpdate('unlink', filePath, provider, rootPath))
                    .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath, provider, rootPath))
                    .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath, provider, rootPath))
                    .on('error', (error) => {
                        console.error(`[ERROR] ${provider} watcher error:`, error);
                    })
                    .on('ready', () => {
                    });

                projectsWatchers.push(watcher);
            } catch (error: any) {
                console.error(`[ERROR] Failed to setup ${provider} watcher for ${rootPath}:`, error);
            }
        }

        if (projectsWatchers.length === 0) {
            console.error('[ERROR] Failed to setup any provider watchers');
        }
    }



    return {
        closeProjectsWatchers,
        closeGoRunnerWatchers,
        setupProjectsWatcher,
        setupGoRunnerWatchers,
        watchGoWorkflowRun,
    };
}
