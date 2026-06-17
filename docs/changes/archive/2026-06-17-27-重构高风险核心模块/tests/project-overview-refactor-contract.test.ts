/**
 * 文件目的：锁定 ProjectOverviewPanel 高风险页面的重构目标。
 * 业务风险：项目首页同时承载会话入口、workflow 入口和操作入口，过长组件会让后续重构难以保证用户仍能进入正确工作流。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const REPO_ROOT = process.cwd();
const PANEL_PATH = 'frontend/components/main-content/view/subcomponents/ProjectOverviewPanel.tsx';

const REQUIRED_MODULES = [
  {
    path: 'frontend/components/main-content/project-overview/projectOverviewViewModel.ts',
    purpose: /project overview|项目总览|workflow|session/i,
    exports: ['buildProjectOverviewSections', 'buildManualSessionCards', 'buildWorkflowGroups'],
  },
  {
    path: 'frontend/components/main-content/project-overview/ProjectOverviewWorkflowGroups.tsx',
    purpose: /workflow|工作流|group/i,
    exports: ['ProjectOverviewWorkflowGroups'],
  },
  {
    path: 'frontend/components/main-content/project-overview/ProjectOverviewSessionCards.tsx',
    purpose: /session|会话|card/i,
    exports: ['ProjectOverviewSessionCards'],
  },
  {
    path: 'frontend/components/main-content/project-overview/ProjectOverviewActions.tsx',
    purpose: /action|操作|session/i,
    exports: ['ProjectOverviewActions'],
  },
] as const;

async function readRepoFile(relativePath: string): Promise<string> {
  /**
   * 读取仓库内源码，用于重构边界合同断言。
   */
  return readFile(path.join(REPO_ROOT, relativePath), 'utf8');
}

function countLines(source: string): number {
  /**
   * 统计源码行数，避免组合层重新膨胀成巨型文件。
   */
  return source.split(/\r?\n/).length;
}

test('P0 ProjectOverviewPanel becomes a composition layer with focused project-overview modules', async () => {
  const panelSource = await readRepoFile(PANEL_PATH);
  assert.ok(countLines(panelSource) <= 700, `ProjectOverviewPanel.tsx 必须降到 700 行以内，当前 ${countLines(panelSource)} 行`);

  for (const module of REQUIRED_MODULES) {
    assert.equal(existsSync(path.join(REPO_ROOT, module.path)), true, `${module.path} 必须存在`);
    const source = await readRepoFile(module.path);
    assert.match(source, module.purpose, `${module.path} 必须说明业务目的`);
    for (const exportName of module.exports) {
      assert.match(source, new RegExp(`export\\s+(function|const)\\s+${exportName}\\b`), `${module.path} 必须导出 ${exportName}`);
      assert.match(panelSource, new RegExp(`\\b${exportName}\\b`), `ProjectOverviewPanel.tsx 必须组合使用 ${exportName}`);
    }
  }

  assert.doesNotMatch(panelSource, /const\s+(ChevronDown|ChevronRight|Clock|FolderOpen|MessageSquarePlus|Star|Trash2|X)\s*=/, 'ProjectOverviewPanel.tsx 不应继续内联 SVG icon 组件');
  assert.doesNotMatch(panelSource, /function\s+renderWorkflowCard\b/, 'workflow card 渲染必须迁出组合层');
});
