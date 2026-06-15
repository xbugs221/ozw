/**
 * 文件目的：定义项目列表 invalidation 的 debounce bus 边界。
 * 业务意义：文件 watcher 可能产生突发事件，公共刷新必须合并后广播给客户端。
 */

/**
 * 创建项目 invalidation bus。
 */
export function createProjectInvalidationBus(deps: any) {
    const { pendingProjectListInvalidations, debounceMs = 100, publish } = deps;

    return {
        invalidate({ reason = 'change', changedProjectPath = '' } = {}) {
            const scopeKey = `${reason}:${changedProjectPath}`;
            const existingTimer = pendingProjectListInvalidations.get(scopeKey);
            if (existingTimer) {
                clearTimeout(existingTimer);
            }
            const timer = setTimeout(() => {
                pendingProjectListInvalidations.delete(scopeKey);
                publish?.({ reason, changedProjectPath });
            }, debounceMs);
            pendingProjectListInvalidations.set(scopeKey, timer);
        },
    };
}
