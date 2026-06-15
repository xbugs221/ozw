/**
 * 文件目的：定义后端启动完成后的控制台输出。
 * 业务意义：启动日志属于运维展示，不应和数据库初始化、HTTP 装配、WebSocket 生命周期混在同一入口实现。
 */

/**
 * 输出服务就绪 banner。
 */
export function printStartupBanner(deps: any): void {
    /**
     * PURPOSE: Preserve the existing operator-facing output while keeping the
     * bootstrap listen callback focused on follow-up startup work.
     */
    const { c, appInstallPath, displayHost, port } = deps;

    console.log('');
    console.log(c.dim('═'.repeat(63)));
    console.log(`  ${c.bright('ozw Server - Ready')}`);
    console.log(c.dim('═'.repeat(63)));
    console.log('');
    console.log(`${c.info('[INFO]')} Server URL:  ${c.bright('http://' + displayHost + ':' + port)}`);
    console.log(`${c.info('[INFO]')} Installed at: ${c.dim(appInstallPath)}`);
    console.log(`${c.tip('[TIP]')}  Run "ozw status" for full configuration details`);
    console.log('');
}
