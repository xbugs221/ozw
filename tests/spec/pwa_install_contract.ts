/**
 * 文件目的：验证 ozw 发布可安装到手机桌面的 PWA 入口。
 * 业务场景：用户在手机浏览器打开 ozw 后，可以添加到主屏幕，并且实时 API 与 websocket 不会被离线缓存影响。
 */
import { describe, it } from 'node:test';
import { deepEqual, equal, match, ok } from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

interface WebManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface WebManifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: WebManifestIcon[];
}

async function readRepoText(relativePath: string): Promise<string> {
  /**
   * Read a repository file as UTF-8 text for static PWA contract assertions.
   */
  return readFile(resolve(REPO_ROOT, relativePath), 'utf8');
}

async function readRepoJson<T>(relativePath: string): Promise<T> {
  /**
   * Parse a repository JSON file so tests verify browser-facing metadata rather
   * than matching raw formatting.
   */
  return JSON.parse(await readRepoText(relativePath)) as T;
}

async function repoFileExists(relativePath: string): Promise<boolean> {
  /**
   * Return whether a referenced static asset exists in the working tree.
   */
  try {
    await stat(resolve(REPO_ROOT, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe('ozw PWA install contract', () => {
  it('HTML exposes mobile install metadata without requesting missing favicon files', async () => {
    const html = await readRepoText('index.html');

    match(html, /<link rel="manifest" href="\/manifest\.webmanifest" \/>/);
    match(html, /name="mobile-web-app-capable" content="yes"/);
    match(html, /name="apple-mobile-web-app-capable" content="yes"/);
    match(html, /rel="apple-touch-icon" href="\/pwa\/icon-192\.png"/);
    match(html, /src="\/frontend\/main\.tsx"/);
    ok(!html.includes('/favicon.ico'), 'index.html must not request the removed favicon.ico');
  });

  it('manifest starts the app at the root and references real PNG icons', async () => {
    const manifest = await readRepoJson<WebManifest>('public/manifest.webmanifest');

    equal(manifest.name, 'ozw');
    equal(manifest.short_name, 'ozw');
    equal(manifest.start_url, '/');
    equal(manifest.scope, '/');
    equal(manifest.display, 'standalone');
    deepEqual(
      manifest.icons.map((icon) => icon.sizes).sort(),
      ['192x192', '512x512'],
    );

    for (const icon of manifest.icons) {
      equal(icon.type, 'image/png');
      match(icon.purpose ?? '', /maskable/);
      ok(
        await repoFileExists(`public${icon.src}`),
        `manifest icon must exist: public${icon.src}`,
      );
    }
  });

  it('frontend registers a realtime-safe service worker only for production builds', async () => {
    const main = await readRepoText('frontend/main.tsx');
    const sw = await readRepoText('public/sw.js');

    match(main, /import\.meta\.env\.PROD/, 'development Vite sessions must not register the worker');
    match(main, /serviceWorker\.register\('\/sw\.js'\)/);
    match(sw, /request\.method !== 'GET'/);
    match(sw, /url\.pathname\.startsWith\('\/api'\)/);
    match(sw, /url\.pathname\.startsWith\('\/ws'\)/);
    match(sw, /url\.pathname\.startsWith\('\/shell'\)/);
    match(sw, /request\.mode === 'navigate'/);
  });
});
