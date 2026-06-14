/**
 * 文件目的：锁定测试集分类、运行入口和源码目录命名，方便审阅者理解仓库结构。
 * 业务场景：审阅者查看测试失败时，应能从目录和 README 判断风险属于后端、规格、端到端还是手动回归。
 * 审阅者风险：如果分类合同退化，非专业审阅者会不知道该跑哪组测试或该看哪份导读。
 * 业务场景：默认测试入口必须继续覆盖后端、规格和端到端回归。
 * 失败含义：失败通常意味着测试被放回根目录、脚本指向旧路径，或 README 继续描述过期入口。
 * 业务场景：源码根目录的业务命名会影响发布、开发脚本和测试说明的一致性。
 * 审阅者收益：这些断言把目录整理变成可执行合同，而不是只靠人工记忆。
 * Sources: 2026-06-05-74-测试集重构中文批注, 2026-06-06-81-增量引入Vitest测试框架, 2026-06-06-84-精简Node测试入口并去除重复构建, 2026-06-06-85-分层Playwright浏览器回归
 *
 * PURPOSE: Stable spec test for repository shape and test-suite taxonomy.
 * It reads the real ozw source tree, test tree, and runner configuration to
 * prove source and tests keep their long-lived business names.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TESTS_DIR = path.join(REPO_ROOT, 'tests');

const EXECUTABLE_TEST_PATTERN = /\.(test|spec)\.ts$/;
const CHINESE_TEXT_PATTERN = /[\u4e00-\u9fff]/;
const COMMENT_LINE_PATTERN = /^\s*(\/\/|\/\*|\*|#)/;
const STALE_TEST_PREFIX_PATTERN = /^(?:test_)?\d{4}-\d{2}-\d{2}-/;
const BACKEND_TEST_GLOB = 'tests/backend/*.test.ts';
const SERVER_SMOKE_TEST_FILES = [
  'tests/backend/pi-session-messages-endpoint.test.ts',
  'tests/backend/pi-sessions-read-model.test.ts',
  'tests/backend/provider-session-change.test.ts',
  'tests/backend/sessions.test.ts',
] as const;
const ACTIVE_PATH_CONTRACT_ROOTS = ['backend', 'frontend', 'tests', 'scripts'];
const CATEGORY_GUIDES = [
  {
    path: 'tests/backend/README.md',
    requiredTerms: ['业务场景', '运行命令', '失败', '新增测试', 'API'],
  },
  {
    path: 'tests/unit/README.md',
    requiredTerms: ['业务场景', '运行命令', '失败', '新增测试', 'Vitest'],
  },
  {
    path: 'tests/spec/README.md',
    requiredTerms: ['业务场景', '运行命令', '失败', '新增测试', '规格'],
  },
  {
    path: 'tests/e2e/README.md',
    requiredTerms: ['业务场景', '运行命令', '失败', '新增测试', '端到端'],
  },
  {
    path: 'tests/manual/README.md',
    requiredTerms: ['业务场景', '运行命令', '失败', '新增测试', '手动'],
  },
] as const;
const REPRESENTATIVE_TESTS_WITH_BUSINESS_COMMENTS = [
  {
    path: 'tests/backend/pi-session-messages-endpoint.test.ts',
    businessTerms: ['业务场景', '失败', '用户'],
  },
  {
    path: 'tests/spec/test_suite_taxonomy.ts',
    businessTerms: ['业务场景', '失败', '审阅者'],
  },
  {
    path: 'tests/e2e/pi-provider-business-flow.spec.ts',
    businessTerms: ['业务场景', '失败', '用户'],
  },
  {
    path: 'tests/manual/node-history/live-transcript-order.contract.test.ts',
    businessTerms: ['业务场景', '失败', '历史回归'],
  },
] as const;

/**
 * Recursively collect files beneath a directory using stable relative paths.
 */
async function collectFiles(dir: string, baseDir = dir): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolutePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return collectFiles(absolutePath, baseDir);
      }
      return [path.relative(baseDir, absolutePath).split(path.sep).join('/')];
    }),
  );
  return files.flat().sort();
}

/**
 * Report whether a repository-relative path exists.
 */
async function pathExists(relativePath: string): Promise<boolean> {
  try {
    await fs.access(path.join(REPO_ROOT, relativePath));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

/**
 * Return executable test files from the repository test tree.
 */
async function collectExecutableTests(): Promise<string[]> {
  const files = await collectFiles(TESTS_DIR);
  return files.filter((filePath) => EXECUTABLE_TEST_PATTERN.test(filePath));
}

/**
 * Render a compact list so taxonomy failures remain readable in CI logs.
 */
function renderSample(paths: string[], limit = 20): string {
  const visible = paths.slice(0, limit).map((filePath) => `  - tests/${filePath}`);
  const hidden = paths.length > limit ? [`  ... and ${paths.length - limit} more`] : [];
  return [...visible, ...hidden].join('\n');
}

/**
 * Read active code, script, test, and packaging files that describe repository paths.
 */
async function readActivePathContractFiles(): Promise<Array<{ file: string; content: string }>> {
  const files = (
    await Promise.all(ACTIVE_PATH_CONTRACT_ROOTS.map((root) => collectFiles(path.join(REPO_ROOT, root), REPO_ROOT)))
  ).flat()
    .filter((filePath) => /\.(ts|tsx|js|jsx|sh)$/.test(filePath));

  files.push('.npmignore');

  return Promise.all(
    files.map(async (filePath) => ({
      file: filePath,
      content: await fs.readFile(path.join(REPO_ROOT, filePath), 'utf8'),
    })),
  );
}

/**
 * Read the root test-suite guide and fail with a business-facing message when
 * the classification guide is missing.
 */
async function readTestGuide(): Promise<string> {
  const readmePath = path.join(TESTS_DIR, 'README.md');
  try {
    return await fs.readFile(readmePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      assert.fail('tests/README.md 必须说明测试分类职责、运行命令和新增测试放置规则');
    }
    throw error;
  }
}

/**
 * Read a repository-relative text file and fail with a business-facing message
 * when required taxonomy documentation is missing.
 */
async function readRequiredText(relativePath: string): Promise<string> {
  // 业务说明：缺少导读或代表性测试源码时，失败信息要直接指出审阅者失去的上下文。
  try {
    return await fs.readFile(path.join(REPO_ROOT, relativePath), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      assert.fail(`${relativePath} 不存在，非专业审阅者缺少测试导读或代表性测试源码`);
    }
    throw error;
  }
}

/**
 * Extract Chinese comment lines from source text.
 */
function collectChineseCommentLines(source: string): string[] {
  // 业务说明：只统计给审阅者看的源码批注，不把测试名或断言文本误算成注释。
  return source
    .split('\n')
    .filter((line) => COMMENT_LINE_PATTERN.test(line) && CHINESE_TEXT_PATTERN.test(line));
}

/**
 * Assert that documentation text contains every required business term.
 */
function assertContainsTerms(text: string, terms: readonly string[], owner: string): void {
  // 业务说明：这些关键词代表读者必须看到的风险、入口和新增规则信息。
  for (const term of terms) {
    assert.match(text, new RegExp(term), `${owner} 必须包含“${term}”`);
  }
}

test('可执行测试不直接位于 tests 根目录', async () => {
  const executableTests = await collectExecutableTests();
  const rootTests = executableTests.filter((filePath) => !filePath.includes('/'));

  // 业务场景：根目录只放导读，不放可执行测试，审阅者才能先按分类理解业务风险。
  // 失败含义：出现根目录测试代表分类边界退化，默认入口和手动入口容易混淆。
  assert.equal(
    rootTests.length,
    0,
    `可执行测试必须归入 tests/backend、tests/spec、tests/e2e 或 tests/manual，当前根目录仍有 ${rootTests.length} 个:\n${renderSample(rootTests)}`,
  );
});

test('源码根目录表达前后端职责', async () => {
  assert.equal(await pathExists('backend'), true, 'backend/ 必须作为后端源码根目录存在');
  assert.equal(await pathExists('frontend'), true, 'frontend/ 必须作为前端源码根目录存在');
  assert.equal(await pathExists('server'), false, 'server/ 不应继续作为源码根目录存在');
  assert.equal(await pathExists('src'), false, 'src/ 不应继续作为源码根目录存在');
});

test('tests/README.md 描述真实分类职责和运行入口', async () => {
  const readme = await readTestGuide();
  const requiredText = [
    '非专业审阅者',
    '阅读顺序',
    '真实业务需求',
    '不要只做组件冒烟检查',
    'tests/backend/README.md',
    'tests/unit/README.md',
    'tests/spec/README.md',
    'tests/e2e/README.md',
    'tests/manual/README.md',
    'tests/backend',
    'tests/unit',
    'tests/spec',
    'tests/e2e',
    'tests/manual',
    'pnpm run test:server',
    BACKEND_TEST_GLOB,
    'pnpm run test:vitest',
    'pnpm run test:spec:node',
    'pnpm run test:spec:browser',
    'pnpm run test:e2e',
    '顶层非 `.spec.ts` 文件由 Node 运行',
    '不要直接放在 tests/ 根目录',
  ];

  for (const text of requiredText) {
    assert.match(readme, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }

  assert.equal(
    readme.includes(['`test_', '*.ts` 由 Node 运行'].join('')),
    false,
    'README 不应继续描述旧 test_*.ts Node 规格入口',
  );
});

test('Vitest 快速入口只覆盖 tests/unit，不吞掉高状态测试', async () => {
  const [packageRaw, vitestConfig] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'vitest.config.ts'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageRaw) as {
    scripts?: Record<string, string>;
  };

  // 业务场景：Vitest 只负责快速纯逻辑反馈，不能替代后端契约、浏览器规格或端到端业务流。
  // 失败含义：include 过宽会把需要 HOME、XDG、端口、WebSocket 或浏览器状态的测试错误并行化。
  assert.equal(packageJson.scripts?.['test:vitest'], 'vitest run --config vitest.config.ts');
  assert.equal(packageJson.scripts?.['test:vitest:watch'], 'vitest --config vitest.config.ts');
  assert.match(packageJson.scripts?.['test:full'] ?? '', /pnpm run test:vitest/);
  assert.match(vitestConfig, /tests\/unit\/\*\*\/\*\.test\.ts/);
  assert.match(vitestConfig, /environment:\s*['"]node['"]/);
  assert.match(vitestConfig, /globals:\s*false/);
  assert.doesNotMatch(vitestConfig, /tests\/backend/);
  assert.doesNotMatch(vitestConfig, /tests\/e2e/);
  assert.doesNotMatch(vitestConfig, /tests\/manual/);
});

test('每个测试分类目录都有中文导读说明业务场景、运行命令和失败含义', async () => {
  for (const guide of CATEGORY_GUIDES) {
    const content = await readRequiredText(guide.path);
    const chineseRatio = content.replace(/[^\u4e00-\u9fff]/g, '').length / Math.max(content.length, 1);

    // 业务场景：分类导读给非专业审阅者使用，不能退化成只有命令的技术清单。
    assert.ok(chineseRatio > 0.15, `${guide.path} 必须以中文说明为主，不能只列命令`);
    assertContainsTerms(content, guide.requiredTerms, guide.path);
  }
});

test('代表性业务测试源码有中文批注解释用户场景和失败风险', async () => {
  for (const representativeTest of REPRESENTATIVE_TESTS_WITH_BUSINESS_COMMENTS) {
    const source = await readRequiredText(representativeTest.path);
    const chineseCommentLines = collectChineseCommentLines(source);

    // 失败含义：批注退化会让审阅者只能读实现细节，难以判断测试保护的真实用户风险。
    assert.ok(
      chineseCommentLines.length >= 8,
      `${representativeTest.path} 至少需要 8 行中文业务批注，当前只有 ${chineseCommentLines.length} 行`,
    );
    assertContainsTerms(chineseCommentLines.join('\n'), representativeTest.businessTerms, representativeTest.path);
  }
});

test('服务端测试 README 和 package 脚本指向同一个真实后端目录', async () => {
  const [packageRaw, readme, backendFiles] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    readTestGuide(),
    collectFiles(path.join(TESTS_DIR, 'backend')),
  ]);
  const packageJson = JSON.parse(packageRaw) as {
    scripts?: Record<string, string>;
  };
  const backendTestCount = backendFiles.filter((filePath) => filePath.endsWith('.test.ts')).length;

  assert.equal(
    packageJson.scripts?.['test:server'],
    `tsx --test ${BACKEND_TEST_GLOB}`,
    'pnpm run test:server 必须运行当前后端测试目录',
  );
  assert.match(readme, /tests\/backend\/\*\.test\.ts/);
  assert.ok(backendTestCount > 0, 'tests/backend 必须存在可执行后端测试，不能只更新文档路径');
});

test('Node 测试入口区分快速 smoke、完整回归和发布构建', async () => {
  const [packageRaw, backendReadme, specReadme] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    readRequiredText('tests/backend/README.md'),
    readRequiredText('tests/spec/README.md'),
  ]);
  const packageJson = JSON.parse(packageRaw) as {
    scripts?: Record<string, string>;
  };

  const scripts = packageJson.scripts ?? {};
  const smokeCommand = `tsx --test ${SERVER_SMOKE_TEST_FILES.join(' ')}`;

  // 业务场景：维护者需要快速 smoke、完整 Node 回归和发布构建三个清楚入口，避免一次规格测试重复构建服务端。
  // 失败含义：入口重新混在一起会让本地验证变慢，且审阅者无法判断失败属于 smoke、完整回归还是发布构建。
  assert.equal(scripts['build:server'], 'tsc -p tsconfig.build.json');
  assert.equal(scripts['test:server:smoke'], smokeCommand);
  assert.equal(scripts['test:server'], `tsx --test ${BACKEND_TEST_GLOB}`);
  assert.equal(scripts['test:node'], 'pnpm run test:server && pnpm run test:spec:node');
  assert.equal(scripts['test:spec:node'], 'tsx --test $(node scripts/list-node-spec-tests.mjs)');
  assert.doesNotMatch(scripts['test:spec:node'] ?? '', /build:server/);
  assert.match(scripts['test:unit'] ?? '', /test:server:smoke/);
  assert.match(backendReadme, /test:server:smoke/);
  assert.match(backendReadme, /不是完整后端回归/);
  assert.match(specReadme, /不默认执行 `build:server`/);
});

test('Playwright 浏览器回归区分快速 smoke、完整回归和失败证据', async () => {
  const [packageRaw, smokeConfig, e2eConfig, e2eReadme] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    readRequiredText('playwright.smoke.config.ts'),
    readRequiredText('playwright.config.ts'),
    readRequiredText('tests/e2e/README.md'),
  ]);
  const packageJson = JSON.parse(packageRaw) as {
    scripts?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};

  // 业务场景：日常开发需要快速真实页面信号，合并前仍要能跑完整 browser spec 和 e2e 回归。
  // 失败含义：入口退化会让维护者为了速度跳过真实用户流程，或在通过时生成过多浏览器重证据。
  assert.equal(scripts['test:e2e:smoke'], 'playwright test --config=playwright.smoke.config.ts');
  assert.equal(scripts['test:browser:full'], 'pnpm run test:spec:browser && pnpm run test:e2e');
  assert.equal(scripts['test:spec:browser'], 'playwright test --config=playwright.spec.config.ts');
  assert.equal(scripts['test:e2e'], 'playwright test');
  assert.match(smokeConfig, /playwright\.config/);
  assert.match(smokeConfig, /testDir:\s*['"]\.\/tests\/e2e['"]/);
  assert.match(smokeConfig, /project-visibility\.spec\.ts/);
  assert.match(smokeConfig, /pi-provider-business-flow\.spec\.ts/);
  assert.doesNotMatch(smokeConfig, /manual\/browser-history/);
  assert.match(e2eConfig, /trace:\s*['"]retain-on-failure['"]/);
  assert.match(e2eConfig, /screenshot:\s*['"]only-on-failure['"]/);
  assert.match(e2eConfig, /video:\s*['"]retain-on-failure['"]/);
  assert.match(e2eReadme, /test:e2e:smoke/);
  assert.match(e2eReadme, /test:browser:full/);
  assert.match(e2eReadme, /真实页面|真实业务|端到端/);
  assert.match(e2eReadme, /smoke|快速|关键/);
});

test('运行和构建配置指向重命名后的源码根目录', async () => {
  const [packageRaw, devWatch, rewriteWebsocketHandlers, npmignore, tsconfigNode, tsconfigBuild, tsconfigWeb, tailwind, indexHtml] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'package.json'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'scripts/dev-watch.sh'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'scripts/rewrite-websocket-handlers.ts'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, '.npmignore'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'tsconfig.node.json'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'tsconfig.build.json'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'tsconfig.web.json'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'tailwind.config.ts'), 'utf8'),
    fs.readFile(path.join(REPO_ROOT, 'index.html'), 'utf8'),
  ]);
  const packageJson = JSON.parse(packageRaw) as {
    main?: string;
    bin?: { ozw?: string };
    files?: string[];
    scripts?: Record<string, string>;
  };

  assert.equal(packageJson.main, 'dist-node/backend/index.js');
  assert.equal(packageJson.bin?.ozw, 'dist-node/backend/cli.js');
  assert.equal(packageJson.scripts?.server, 'tsx backend/index.ts');
  assert.equal(packageJson.scripts?.['dev:watch'], './scripts/dev-watch.sh');
  assert.equal(packageJson.scripts?.['test:server'], `tsx --test ${BACKEND_TEST_GLOB}`);
  assert.equal(packageJson.scripts?.['test:spec:node'], 'tsx --test $(node scripts/list-node-spec-tests.mjs)');
  assert.ok(packageJson.files?.includes('backend/'), 'npm package files 必须包含 backend/');
  assert.equal(packageJson.files?.includes('server/'), false, 'npm package files 不应包含 server/');
  assert.ok(devWatch.includes('pnpm exec tsx watch backend/index.ts'));
  assert.equal(devWatch.includes(['server', 'index.ts'].join('/')), false);
  assert.ok(rewriteWebsocketHandlers.includes("const file: string = 'backend/index.ts';"));
  assert.equal(rewriteWebsocketHandlers.includes(['server', 'index.ts'].join('/')), false);
  assert.ok(npmignore.includes('!backend/**/*.md'));
  assert.equal(npmignore.includes(['!server', '/'].join('')), false);
  assert.ok(tsconfigNode.includes('"backend/**/*.ts"'));
  assert.ok(tsconfigBuild.includes('"backend/**/*.ts"'));
  assert.ok(tsconfigWeb.includes('"frontend"'));
  assert.ok(tailwind.includes('./frontend/**/*.{js,ts,jsx,tsx}'));
  assert.ok(indexHtml.includes('/frontend/main.tsx'));
});

test('Playwright spec 配置不枚举 tests 根目录历史测试', async () => {
  const config = await fs.readFile(path.join(REPO_ROOT, 'playwright.spec.config.ts'), 'utf8');
  const rootHistoricalEntries = config
    .split('\n')
    .filter((line) => /^\s*['"]\d{4}-\d{2}-\d{2}-/.test(line));

  assert.equal(
    rootHistoricalEntries.length,
    0,
    `playwright.spec.config.ts 不应再直接枚举 tests 根目录历史测试:\n${rootHistoricalEntries.join('\n')}`,
  );
});

test('测试文件名不保留日期或 test_日期前缀', async () => {
  const executableTests = await collectExecutableTests();
  const staleNames = executableTests.filter((filePath) =>
    STALE_TEST_PREFIX_PATTERN.test(path.basename(filePath)),
  );

  assert.equal(
    staleNames.length,
    0,
    `测试文件名应表达业务主题，不应保留日期或 test_日期前缀:\n${renderSample(staleNames)}`,
  );
});

test('活跃源码、脚本、发布配置和测试注释不引用重命名前旧路径', async () => {
  const stalePatterns = [
    /server\/index\b/,
    /(^|[^-\w])server\/session/,
    /dist-node\/server/,
    /src\/utils\/session-provider/,
    new RegExp(['!server', '/'].join('')),
  ];
  const files = await readActivePathContractFiles();
  const staleReferences = files.flatMap(({ file, content }) =>
    stalePatterns
      .filter((pattern) => pattern.test(content))
      .map((pattern) => `${file}: ${pattern}`),
  );

  assert.equal(
    staleReferences.length,
    0,
    `活跃源码、脚本、发布配置和测试注释不得再引用旧目录路径:\n${renderSample(staleReferences)}`,
  );
});
