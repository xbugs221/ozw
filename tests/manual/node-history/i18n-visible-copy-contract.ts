/**
 * PURPOSE: Ensure zh-CN visible navigation copy resolves to real text instead
 * of leaking i18n keys or major English fallbacks in the ozw sidebar.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();

/**
 * Read a repository source file as UTF-8 text.
 */
function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

test('sidebar search controls do not render an unresolved search.placeholder key', () => {
  const footer = readSource('frontend/components/sidebar/view/subcomponents/SidebarFooter.tsx');
  const collapsed = readSource('frontend/components/sidebar/view/subcomponents/SidebarCollapsed.tsx');

  for (const [fileName, source] of [
    ['SidebarFooter.tsx', footer],
    ['SidebarCollapsed.tsx', collapsed],
  ] as const) {
    assert.doesNotMatch(
      source,
      /t\(['"]search\.placeholder['"]\)/,
      `${fileName} must use a namespaced or locally defined search placeholder translation`,
    );
  }
});

test('zh-CN resources contain user-visible sidebar labels for major English fallbacks', () => {
  const sidebar = JSON.parse(readSource('frontend/i18n/locales/zh-CN/sidebar.json'));
  const common = JSON.parse(readSource('frontend/i18n/locales/zh-CN/common.json'));

  assert.equal(sidebar.sessions.showMore, '显示更多', 'show more sessions must have zh-CN copy');
  assert.equal(sidebar.sessions.newSession, '新建', 'new session must have zh-CN copy');
  assert.equal(common.navigation?.chat, '消息', 'Messages tab should resolve to zh-CN copy');
  assert.equal(common.navigation?.git, undefined, 'removed Source Control tab must not keep zh-CN copy');
});
