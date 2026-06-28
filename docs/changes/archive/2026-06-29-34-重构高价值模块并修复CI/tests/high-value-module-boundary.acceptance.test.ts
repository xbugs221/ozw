/**
 * PURPOSE: Contract-test high-value module boundaries before refactoring so
 * chat, message pane, and project state changes remain reviewable.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EVIDENCE_PATH = path.join(REPO_ROOT, 'test-results/high-value-refactor/module-audit.json');

const ENTRY_BUDGETS = [
  {
    path: 'frontend/components/chat/view/ChatInterface.tsx',
    maxLines: 1050,
    purpose: '聊天页面编排入口',
  },
  {
    path: 'frontend/components/chat/view/subcomponents/ChatMessagesPane.tsx',
    maxLines: 430,
    purpose: '消息面板渲染入口',
  },
  {
    path: 'frontend/hooks/useProjectsState.ts',
    maxLines: 760,
    purpose: '项目状态 hook 入口',
  },
];

const REQUIRED_FOCUSED_MODULES = [
  {
    path: 'frontend/components/chat/view/chatInterfaceSearchNavigation.ts',
    purpose: '聊天搜索目标解析、逐页加载和消息定位',
  },
  {
    path: 'frontend/components/chat/view/chatInterfaceStatusReconcile.ts',
    purpose: '会话状态校准请求和去重 key',
  },
  {
    path: 'frontend/components/chat/view/subcomponents/chatMessagesPaneLayoutController.ts',
    purpose: '消息面板虚拟窗口、测量和跟随底部策略',
  },
  {
    path: 'frontend/hooks/projectsStateRefreshController.ts',
    purpose: '项目列表刷新、失效和 scoped 更新',
  },
  {
    path: 'frontend/hooks/projectsStateReducers.ts',
    purpose: '项目选择、会话索引和 UI 状态 reducer',
  },
];

function readRepoFile(relativePath: string): string {
  /** 读取真实源码，避免用 fixture 代替生产模块边界。 */
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8');
}

function pathExists(relativePath: string): boolean {
  /** 判断 focused module 是否已经落地。 */
  return fs.existsSync(path.join(REPO_ROOT, relativePath));
}

function countLines(source: string): number {
  /** 统计物理行数，约束入口文件不要继续膨胀。 */
  return source.length === 0 ? 0 : source.split(/\r?\n/).length;
}

function writeModuleAudit(): Array<{
  path: string;
  purpose: string;
  lines?: number;
  maxLines?: number;
  hasTsNoCheck?: boolean;
  exists: boolean;
}> {
  /** 产出 module-boundary-audit，方便执行阶段对比重构前后。 */
  const entryAudits = ENTRY_BUDGETS.map((entry) => {
    const source = readRepoFile(entry.path);
    return {
      path: entry.path,
      purpose: entry.purpose,
      lines: countLines(source),
      maxLines: entry.maxLines,
      hasTsNoCheck: source.includes('@ts-nocheck'),
      exists: true,
    };
  });
  const moduleAudits = REQUIRED_FOCUSED_MODULES.map((module) => ({
    path: module.path,
    purpose: module.purpose,
    exists: pathExists(module.path),
  }));

  fs.mkdirSync(path.dirname(EVIDENCE_PATH), { recursive: true });
  fs.writeFileSync(
    EVIDENCE_PATH,
    `${JSON.stringify({
      evidenceId: 'module-boundary-audit',
      entries: entryAudits,
      focusedModules: moduleAudits,
    }, null, 2)}\n`,
    'utf8',
  );
  return [...entryAudits, ...moduleAudits];
}

test('高价值入口文件保持编排层体量且不新增 TypeScript 逃逸', () => {
  const audit = writeModuleAudit();

  for (const entry of ENTRY_BUDGETS) {
    const item = audit.find((candidate) => candidate.path === entry.path);
    assert.ok(item, `${entry.path} 必须被审计`);
    assert.equal(item?.exists, true, `${entry.path} 必须存在`);
    assert.ok(
      (item?.lines ?? Number.POSITIVE_INFINITY) <= entry.maxLines,
      `${entry.path} 必须低于 ${entry.maxLines} 行，当前为 ${item?.lines}`,
    );
    assert.equal(item?.hasTsNoCheck, false, `${entry.path} 不得新增 @ts-nocheck`);
  }
});

test('复杂逻辑迁入 focused modules，而不是继续塞回入口文件', () => {
  writeModuleAudit();

  for (const module of REQUIRED_FOCUSED_MODULES) {
    assert.equal(
      pathExists(module.path),
      true,
      `${module.purpose} 必须由 focused module 承载：${module.path}`,
    );
    const source = readRepoFile(module.path);
    assert.match(source.slice(0, 240), /PURPOSE|文件目的|业务目的/, `${module.path} 开头必须说明业务目的`);
  }
});
