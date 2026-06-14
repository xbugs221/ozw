/**
 * 文件目的：提供快速 Playwright e2e smoke 配置。
 * 业务场景：开发者需要先验证真实 fixture、项目入口和 Pi Provider 关键链路，再决定是否运行完整浏览器回归。
 * 失败含义：失败通常代表本地应用启动、鉴权夹具、项目可见性或 Pi 基础业务流已经断裂。
 *
 * PURPOSE: Scope Playwright e2e to critical smoke flows while reusing the
 * production-like fixture and server bootstrap from the main e2e config.
 */
import baseConfig from './playwright.config.ts';

export default {
  ...baseConfig,
  testDir: './tests/e2e',
  testMatch: [
    'project-visibility.spec.ts',
    'pi-provider-business-flow.spec.ts',
  ],
};
