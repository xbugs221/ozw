/**
 * 文件目的：定义 Vitest 的增量快速测试入口，只覆盖无浏览器、少全局状态的业务逻辑单测。
 * 业务场景：开发者修改共享纯逻辑时，需要比 Playwright 和后端契约更快的反馈，同时不能吞掉高状态测试。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/unit/**/*.test.ts'],
  },
});
