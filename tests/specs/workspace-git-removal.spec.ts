/**
 * Sources: 2026-06-13-105-彻底移除Git功能
 *
 * 文件目的：稳定验证主工作区彻底移除 Git 功能后的长期业务契约。
 * 业务场景：用户打开工作区或携带旧本地布局状态进入工作区时，界面、源码状态模型和后端 API 都不能继续暴露 Git 功能。
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

function repoPath(relativePath: string): string {
  /**
   * PURPOSE: Resolve one repository-relative path from the stable specs folder.
   */
  return path.join(REPO_ROOT, relativePath);
}

function readRepoFile(relativePath: string): string {
  /**
   * PURPOSE: Read production source so the test verifies the real application,
   * not a copied fixture.
   */
  return readFileSync(repoPath(relativePath), 'utf8');
}

function collectTextFiles(relativeDir: string): string[] {
  /**
   * PURPOSE: Scan active source and tests for stale Git panel contracts while
   * excluding archived proposals and generated test results.
   */
  const root = repoPath(relativeDir);
  if (!existsSync(root)) {
    return [];
  }

  const output: string[] = [];
  const walk = (absoluteDir: string) => {
    for (const entry of readdirSync(absoluteDir)) {
      const absolutePath = path.join(absoluteDir, entry);
      const relativePath = path.relative(REPO_ROOT, absolutePath).split(path.sep).join('/');
      if (
        relativePath.startsWith('docs/changes/archive/')
        || relativePath.includes('/test-results/')
        || relativePath.includes('/node_modules/')
        || relativePath === 'tests/specs/workspace-git-removal.spec.ts'
        || relativePath === 'tests/spec/workspace-git-removal-evidence.spec.ts'
      ) {
        continue;
      }

      const stat = statSync(absolutePath);
      if (stat.isDirectory()) {
        walk(absolutePath);
        continue;
      }
      if (/\.(ts|tsx|js|jsx|json|md)$/.test(entry)) {
        output.push(relativePath);
      }
    }
  };

  walk(root);
  return output;
}

test('主工作区不再注册或渲染 Git tab 和 GitPanel', () => {
  /**
   * 用户可见契约：主导航只保留聊天、文件、终端等仍支持的工作区能力。
   */
  const tabSwitcher = readRepoFile('frontend/components/main-content/view/subcomponents/MainContentTabSwitcher.tsx');
  const mainContent = readRepoFile('frontend/components/main-content/view/MainContent.tsx');
  const title = readRepoFile('frontend/components/main-content/view/subcomponents/MainContentTitle.tsx');
  const appTypes = readRepoFile('frontend/types/app.ts');

  for (const [label, source] of Object.entries({ tabSwitcher, mainContent, title, appTypes })) {
    assert.equal(source.includes('tab-git'), false, `${label} must not expose data-testid="tab-git"`);
    assert.equal(source.includes('tabs.git'), false, `${label} must not use tabs.git i18n key`);
    assert.equal(source.includes('GitPanel'), false, `${label} must not import or render GitPanel`);
    assert.equal(source.includes("activeTab === 'git'"), false, `${label} must not branch on activeTab === 'git'`);
    assert.equal(source.includes("'git'"), false, `${label} must not keep git in active tab unions or definitions`);
  }
});

test('Git panel 组件树和 dock 状态模型被删除', () => {
  /**
   * 维护契约：不能留下死组件或可恢复旧 Git dock 的状态分支。
   */
  assert.equal(existsSync(repoPath('frontend/components/git-panel')), false, 'frontend/components/git-panel must be removed');

  const layoutState = readRepoFile('frontend/components/main-content/hooks/useWorkspaceLayoutState.ts');
  assert.equal(layoutState.includes("'git'"), false, 'workspace layout state must not accept git panels');
  assert.equal(layoutState.includes('oldTab === \'git\''), false, 'old activeTab migration must not restore git');
  assert.equal(layoutState.includes('activePanel: \'git\''), false, 'persisted layout migration must not set git activePanel');
});

test('后端不再暴露 /api/git', () => {
  /**
   * API 契约：删除前端入口时必须同步移除后端 Git route 暴露面。
   */
  assert.equal(existsSync(repoPath('backend/routes/git.ts')), false, 'backend/routes/git.ts must be removed');

  const server = readRepoFile('backend/server/http-routes.ts');
  assert.equal(server.includes('routes/git'), false, 'server must not import Git routes');
  assert.equal(server.includes('/api/git'), false, 'server must not mount /api/git');
});

test('活动源码和测试不再保留 Git panel 专用契约', () => {
  /**
   * 清理契约：旧测试不能继续要求 Git panel 存在。
   */
  const stalePatterns = [
    /git-panel/i,
    /GitPanel/,
    /tab-git/,
    /tabs\.git/,
    /\/api\/git/,
  ];
  const offenders = collectTextFiles('frontend')
    .concat(collectTextFiles('backend'))
    .concat(collectTextFiles('tests'))
    .filter((relativePath) => {
      const source = readRepoFile(relativePath);
      return stalePatterns.some((pattern) => pattern.test(source));
    });

  assert.deepEqual(offenders, [], `active code/tests must not keep Git panel references: ${offenders.join(', ')}`);
});
