// @ts-nocheck -- Route registration uses a deliberately minimal Express double.
/**
 * 文件目的：锁定系统更新路由的手动升级安全边界。
 * 业务意义：防止 Web UI 或兼容 API 再次在服务进程中执行安装命令。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  getManualUpgradeCommand,
  registerSystemRoutes,
} from '../../backend/server/http/system-routes.ts';

/**
 * Capture the status and JSON body from an Express-style handler.
 */
function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('legacy update route rejects automatic updates and returns npm instructions only', async () => {
  const routes = new Map();
  registerSystemRoutes({
    app: {
      post(routePath, _auth, handler) {
        routes.set(`POST ${routePath}`, handler);
      },
    },
    authenticateToken: (_req, _res, next) => next?.(),
    installMode: 'npm',
  });

  const handler = routes.get('POST /api/system/update');
  assert.equal(typeof handler, 'function');

  const response = createResponseRecorder();
  await handler({}, response);

  assert.equal(response.statusCode, 409);
  assert.deepEqual(response.payload, {
    success: false,
    manual: true,
    code: 'MANUAL_UPDATE_REQUIRED',
    command: 'npm update -g ozw',
    message: 'Automatic updates are disabled. Run the command manually, then restart ozw.',
    error: 'Automatic updates are disabled. Run the command manually, then restart ozw.',
  });
});

test('manual update surfaces contain no automatic update execution path', async () => {
  const [routeSource, modalSource, englishLocaleSource, chineseLocaleSource] = await Promise.all([
    readFile(new URL('../../backend/server/http/system-routes.ts', import.meta.url), 'utf8'),
    readFile(new URL('../../frontend/components/sidebar/view/modals/VersionUpgradeModal.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../../frontend/i18n/locales/en/common.json', import.meta.url), 'utf8'),
    readFile(new URL('../../frontend/i18n/locales/zh-CN/common.json', import.meta.url), 'utf8'),
  ]);
  const englishLocale = JSON.parse(englishLocaleSource);
  const chineseLocale = JSON.parse(chineseLocaleSource);

  assert.equal(getManualUpgradeCommand('git'), 'git pull --ff-only && pnpm install && pnpm run build');
  assert.doesNotMatch(routeSource, /child_process|\bspawn\s*\(|sh\s*['"],\s*\[\s*['"]-c/);
  assert.doesNotMatch(modalSource, /authenticatedFetch|\/api\/system\/update|handleUpdateNow|buttons\.updateNow/);
  assert.match(modalSource, /copyTextToClipboard\(upgradeCommand\)/);
  assert.equal(englishLocale.versionUpdate.npmUpgradeCommand, 'npm update -g ozw');
  assert.equal(chineseLocale.versionUpdate.npmUpgradeCommand, 'npm update -g ozw');
});
