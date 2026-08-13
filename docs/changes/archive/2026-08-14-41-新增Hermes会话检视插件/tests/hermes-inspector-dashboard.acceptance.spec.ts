/**
 * 文件目的：在真实 Hermes Dashboard、SessionDB、OZW 生产渲染链和浏览器中验收会话检视插件。
 * 业务边界：Hermes 行为只通过插件、Dashboard HTTP 与 SQLite 投影观察；OZW harness 仅生成同语义对照证据。
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import test from 'node:test';
import { chromium, type Locator } from '@playwright/test';
import Database from 'better-sqlite3';
import sharp from 'sharp';
import {
  createServer as createViteServer,
  transformWithEsbuild,
  type Plugin,
  type ViteDevServer,
} from 'vite';

const execFileAsync = promisify(execFile);
const CHANGE_RESULTS = path.resolve('test-results/change-41-hermes-inspector');
const PLUGIN_SOURCE = path.resolve('integrations/hermes-dashboard-inspector');
const USER_PROMPT = '请按顺序检查部署目录、说明判断过程并保持只读';
const CONTINUATION_PROMPT = '继续检查并给出 Markdown 结论';
const R1_FIRST = 'R1 先确认当前目录。';
const R1_LAST = 'R1 再核对目录是否允许只读检查，并确认不会写入状态数据库、不会修改权限、不会触发任何执行操作。';
const T1_COMMAND = 'pwd # inspector-long-command-must-not-be-covered-by-output-or-copy-controls-on-mobile';
const T1_OUTPUT = 'T1_RESULT /srv/demo-project';
const COMMENTARY = 'COMMENTARY 目录已确认，接着检查敏感文件权限。';
const R2_SINGLE = 'R2 权限检查只能读取，不能修改。';
const T2_COMMAND = 'cat /root/secret';
const T2_ERROR = 'permission denied';
const FINAL_HEADING = '部署检查结论';
const FINAL_CODE = "printf '%s\\n' 'inspector-markdown-code-line-that-must-not-expand-the-page'";
const TOOL_ONLY_PROMPT = 'TOOL_ONLY 依次读取、搜索、制定计划并委托审计';
const UNMATCHED_OUTPUT = 'UNMATCHED_RESULT orphan output must remain visible';

type ElementMetrics = {
  fontSize: number;
  lineHeight: number;
  borderRadius: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  height: number;
};

type ParityMetrics = {
  renderer: string;
  transcriptCrop: { width: number; height: number };
  outerSummary: ElementMetrics;
  thinkingSummary: ElementMetrics;
  toolGroupSummary: ElementMetrics;
  commandCard: ElementMetrics;
  userBubble: ElementMetrics;
  verticalGaps: { userToOuter: number; outerToThinking: number };
};

type DashboardProcess = ReturnType<typeof spawn>;

/** 点击 details 的直属 summary，验证真实原生折叠交互而不是组件名字。 */
async function toggleDetails(details: Locator): Promise<void> {
  await details.locator(':scope > summary').click();
}

/** 读取 details 的原生 open 状态。 */
async function isDetailsOpen(details: Locator): Promise<boolean> {
  return await details.evaluate(element => (element as HTMLDetailsElement).open);
}

/** 断言一组真实可见标记在页面上的纵向位置严格递增。 */
async function assertStrictVisualOrder(entries: Array<{ label: string; locator: Locator }>): Promise<void> {
  let previousBottom = Number.NEGATIVE_INFINITY;
  for (const entry of entries) {
    assert.equal(await entry.locator.isVisible(), true, `${entry.label} 必须可见`);
    const box = await entry.locator.boundingBox();
    assert.ok(box, `${entry.label} 必须拥有可测量的布局框`);
    assert.ok(
      box.y >= previousBottom - 1,
      `${entry.label} 的视觉位置必须晚于上一事件，实际 y=${box.y}, previousBottom=${previousBottom}`,
    );
    previousBottom = box.y + Math.min(box.height, 1);
  }
}

/** 断言页面本身没有横向溢出，局部 code/output 滚动不计为整页溢出。 */
async function assertNoPageHorizontalOverflow(page: any, label: string): Promise<void> {
  const widths = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  assert.ok(
    widths.document <= widths.viewport + 1 && widths.body <= widths.viewport + 1,
    `${label} 不得整页横向滚动: ${JSON.stringify(widths)}`,
  );
}

/** 把 Dashboard 主滚动容器恢复到顶部，避免固定顶栏遮住证据截图的页面标题。 */
async function resetInspectorScroll(page: any): Promise<void> {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    let current = document.querySelector('.hti-root')?.parentElement || null;
    while (current) {
      if (current.scrollHeight > current.clientHeight) current.scrollTop = 0;
      current = current.parentElement;
    }
  });
}

/** 读取跨宿主可比较的几何与排版指标；颜色由各自主题决定，不参与相等判断。 */
async function elementMetrics(locator: Locator): Promise<ElementMetrics> {
  return await locator.evaluate(element => {
    const style = getComputedStyle(element);
    const fontSize = Number.parseFloat(style.fontSize);
    const rawLineHeight = Number.parseFloat(style.lineHeight);
    return {
      fontSize,
      lineHeight: Number.isFinite(rawLineHeight) ? rawLineHeight : fontSize * 1.2,
      borderRadius: Number.parseFloat(style.borderTopLeftRadius) || 0,
      paddingTop: Number.parseFloat(style.paddingTop) || 0,
      paddingRight: Number.parseFloat(style.paddingRight) || 0,
      paddingBottom: Number.parseFloat(style.paddingBottom) || 0,
      paddingLeft: Number.parseFloat(style.paddingLeft) || 0,
      height: element.getBoundingClientRect().height,
    };
  });
}

/** 收集同一展开状态的 transcript DOM/geometry/style 合同。 */
async function collectParityMetrics(
  renderer: string,
  surface: Locator,
  parts: {
    outerSummary: Locator;
    thinkingSummary: Locator;
    toolGroupSummary: Locator;
    commandCard: Locator;
    userBubble: Locator;
  },
): Promise<ParityMetrics> {
  await surface.evaluate(element => {
    const target = element as HTMLElement;
    target.style.width = '760px';
    target.style.minWidth = '760px';
    target.style.maxWidth = '760px';
    target.style.minHeight = '640px';
  });
  const [surfaceBox, outerBox, thinkingBox, userBox] = await Promise.all([
    surface.boundingBox(),
    parts.outerSummary.boundingBox(),
    parts.thinkingSummary.boundingBox(),
    parts.userBubble.boundingBox(),
  ]);
  assert.ok(surfaceBox && outerBox && thinkingBox && userBox, `${renderer} parity 元素必须可测量`);
  return {
    renderer,
    transcriptCrop: { width: 760, height: 640 },
    outerSummary: await elementMetrics(parts.outerSummary),
    thinkingSummary: await elementMetrics(parts.thinkingSummary),
    toolGroupSummary: await elementMetrics(parts.toolGroupSummary),
    commandCard: await elementMetrics(parts.commandCard),
    userBubble: await elementMetrics(parts.userBubble),
    verticalGaps: {
      userToOuter: outerBox.y - (userBox.y + userBox.height),
      outerToThinking: thinkingBox.y - (outerBox.y + outerBox.height),
    },
  };
}

/** 保存固定 760×640 transcript crop，使三方对比不受宿主导航宽度影响。 */
async function screenshotTranscriptCrop(page: any, surface: Locator, fileName: string): Promise<void> {
  await surface.evaluate(element => {
    const target = element as HTMLElement;
    target.style.width = '760px';
    target.style.minWidth = '760px';
    target.style.maxWidth = '760px';
    target.style.height = '640px';
    target.style.minHeight = '640px';
    target.style.maxHeight = '640px';
    target.style.overflow = 'hidden';
  });
  const box = await surface.boundingBox();
  assert.ok(box, `${fileName} transcript surface 必须可见`);
  const viewport = page.viewportSize();
  assert.ok(viewport && box.width >= 760, `${fileName} 必须容纳固定 parity crop`);
  const outputPath = path.join(CHANGE_RESULTS, fileName);
  const screenshot = await surface.screenshot();
  const normalized = await sharp(screenshot)
    .resize(760, 640, { fit: 'cover', position: 'left top' })
    .png()
    .toBuffer();
  await writeFile(outputPath, normalized);
  const png = await readFile(outputPath);
  assert.equal(png.readUInt32BE(16), 760, `${fileName} 输出宽度必须为 760px`);
  assert.equal(png.readUInt32BE(20), 640, `${fileName} 输出高度必须为 640px`);
}

/** 以窄容差比较结构尺寸；宿主主题颜色允许不同。 */
function assertParityMetrics(reference: ParityMetrics, candidate: ParityMetrics): void {
  const tolerances: Record<keyof ElementMetrics, number> = {
    fontSize: 2,
    lineHeight: 4,
    borderRadius: 5,
    paddingTop: 6,
    paddingRight: 6,
    paddingBottom: 6,
    paddingLeft: 6,
    height: 14,
  };
  for (const part of ['outerSummary', 'thinkingSummary', 'toolGroupSummary', 'commandCard', 'userBubble'] as const) {
    for (const metric of Object.keys(tolerances) as Array<keyof ElementMetrics>) {
      const delta = Math.abs(reference[part][metric] - candidate[part][metric]);
      assert.ok(
        delta <= tolerances[metric],
        `${candidate.renderer}.${part}.${metric} 与 ${reference.renderer} 偏差 ${delta}，上限 ${tolerances[metric]}`,
      );
    }
  }
  for (const gap of ['userToOuter', 'outerToThinking'] as const) {
    const delta = Math.abs(reference.verticalGaps[gap] - candidate.verticalGaps[gap]);
    assert.ok(delta <= 12, `${candidate.renderer}.${gap} 与 ${reference.renderer} 纵向 gap 偏差 ${delta}，上限 12`);
  }
}

type Rgba = { r: number; g: number; b: number; a: number };

/** 将前景 alpha 合成到已知背景，供 Node 侧复算浏览器实际颜色。 */
function compositeColor(front: Rgba, back: Rgba): Rgba {
  const alpha = front.a + back.a * (1 - front.a);
  if (alpha === 0) return { r: 0, g: 0, b: 0, a: 0 };
  return {
    r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
    g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
    b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
    a: alpha,
  };
}

/** 计算 sRGB 相对亮度。 */
function relativeLuminance(color: Rgba): number {
  const channels = [color.r, color.g, color.b];
  const linear: number[] = [];
  for (const channel of channels) {
    const value = channel / 255;
    linear.push(value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  }
  return .2126 * linear[0] + .7152 * linear[1] + .0722 * linear[2];
}

/** 计算真实渲染后的前景/有效背景 WCAG 对比度，支持透明色和 color-mix 结果。 */
async function renderedContrast(locator: Locator): Promise<number> {
  const colors = await locator.evaluate(element => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('contrast canvas unavailable');
    const ancestors: Element[] = [];
    for (let current: Element | null = element; current; current = current.parentElement) ancestors.unshift(current);
    const backgrounds: Rgba[] = [];
    let opacity = 1;
    for (const ancestor of ancestors) {
      const style = getComputedStyle(ancestor);
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = style.backgroundColor;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      backgrounds.push({ r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 });
      opacity *= Number.parseFloat(style.opacity) || 1;
    }
    context.clearRect(0, 0, 1, 1);
    context.fillStyle = getComputedStyle(element).color;
    context.fillRect(0, 0, 1, 1);
    const pixel = context.getImageData(0, 0, 1, 1).data;
    return {
      foreground: { r: pixel[0], g: pixel[1], b: pixel[2], a: pixel[3] / 255 },
      backgrounds,
      opacity,
    };
  });
  let background: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (const layer of colors.backgrounds) background = compositeColor(layer, background);
  const foreground = { ...colors.foreground, a: colors.foreground.a * colors.opacity };
  const visibleForeground = compositeColor(foreground, background);
  const first = relativeLuminance(visibleForeground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
}

/** 对当前主题的实际像素颜色执行 WCAG 阈值，而不是只比较 CSS token 名字。 */
async function assertContrast(locator: Locator, minimum: number, label: string): Promise<void> {
  await locator.waitFor();
  const ratio = await renderedContrast(locator);
  assert.ok(ratio >= minimum, `${label} 对比度 ${ratio.toFixed(2)} 低于 ${minimum}:1`);
}

type Rect = { x: number; y: number; width: number; height: number };

/** 计算两个轴对齐矩形的相交面积。 */
function overlapArea(left: Rect, right: Rect): number {
  return Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x))
    * Math.max(0, Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y));
}

/** 读取元素内真实可见文字的 Range 矩形。 */
async function visibleTextRectangles(locator: Locator): Promise<Rect[]> {
  return await locator.evaluate(target => {
    const targetRect = target.getBoundingClientRect();
    const rectangles: Rect[] = [];
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      const clientRects = range.getClientRects();
      for (let index = 0; index < clientRects.length; index += 1) {
        const textRect = clientRects[index];
        const x = Math.max(textRect.left, targetRect.left);
        const y = Math.max(textRect.top, targetRect.top);
        const right = Math.min(textRect.right, targetRect.right);
        const bottom = Math.min(textRect.bottom, targetRect.bottom);
        if (right > x && bottom > y) rectangles.push({ x, y, width: right - x, height: bottom - y });
      }
    }
    return rectangles;
  });
}

/** 验证命令左右控制位于最上层、互不相交，并且不覆盖命令或 output 文本。 */
async function assertCommandControlsDoNotCoverText(card: Locator): Promise<void> {
  await card.hover();
  const code = card.locator('.hti-command-code');
  const outputControl = card.locator('.hti-command-output > summary');
  const copyControl = card.locator('.hti-command-copy');
  const outputText = card.locator('.hti-command-output pre');
  const [cardBox, codeBox, outputBox, copyBox] = await Promise.all([
    card.boundingBox(), code.boundingBox(), outputControl.boundingBox(), copyControl.boundingBox(),
  ]);
  assert.ok(cardBox && codeBox && outputBox && copyBox, 'command controls 必须拥有可测量布局框');
  const outputTextBox = await outputText.count() > 0 ? await outputText.boundingBox() : null;
  const codeTextRects = await visibleTextRectangles(code);
  const outputTextRects = await outputText.count() > 0 ? await visibleTextRectangles(outputText) : [];
  const outputTopmost = await outputControl.evaluate(control => {
    const rect = control.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === control || control.contains(hit)));
  });
  const copyTopmost = await copyControl.evaluate(control => {
    const rect = control.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return Boolean(hit && (hit === control || control.contains(hit)));
  });
  const padding = await code.evaluate(element => {
    const style = getComputedStyle(element);
    return { left: Number.parseFloat(style.paddingLeft), right: Number.parseFloat(style.paddingRight) };
  });
  let outputHitsText = 0;
  let copyHitsText = 0;
  for (const textRect of [...codeTextRects, ...outputTextRects]) {
    outputHitsText = Math.max(outputHitsText, overlapArea(outputBox, textRect));
    copyHitsText = Math.max(copyHitsText, overlapArea(copyBox, textRect));
  }
  const result = {
    controlsOverlap: overlapArea(outputBox, copyBox),
    outputHitsText,
    copyHitsText,
    outputTopmost,
    copyTopmost,
    outputInside: outputBox.x >= cardBox.x && outputBox.x + outputBox.width <= cardBox.x + cardBox.width
      && outputBox.y >= cardBox.y && outputBox.y + outputBox.height <= cardBox.y + cardBox.height,
    copyInside: copyBox.x >= cardBox.x && copyBox.x + copyBox.width <= cardBox.x + cardBox.width
      && copyBox.y >= cardBox.y && copyBox.y + copyBox.height <= cardBox.y + cardBox.height,
    safeLeftPadding: padding.left >= outputBox.width + 8,
    safeRightPadding: padding.right >= copyBox.width + 8,
    outputBelowCommand: !outputTextBox || outputTextBox.y >= codeBox.y + codeBox.height - 1,
  };
  assert.equal(result.outputTopmost, true, 'Output control 中心必须由自身命中');
  assert.equal(result.copyTopmost, true, 'Copy control 中心必须由自身命中');
  assert.equal(result.outputInside && result.copyInside, true, '左右 control 必须完整位于 command card 内');
  assert.ok(result.controlsOverlap <= 1, `左右 control 不得交叠，实际 ${result.controlsOverlap}px²`);
  assert.ok(result.outputHitsText <= 1 && result.copyHitsText <= 1, `command control 不得遮挡文字：${JSON.stringify(result)}`);
  assert.equal(result.safeLeftPadding && result.safeRightPadding, true, 'command 必须为左右 control 保留安全内边距');
  assert.equal(result.outputBelowCommand, true, '展开 output 后正文必须位于 command 行下方');
}

/** 移动端 summary 必须展示完整文本，不能用 ellipsis 或单行裁切掩盖内容。 */
async function assertMobileSummaryNotTruncated(locator: Locator, label: string): Promise<void> {
  await locator.waitFor();
  const state = await locator.evaluate(element => {
    const style = getComputedStyle(element);
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const textBox = range.getBoundingClientRect();
    return {
      clientWidth: (element as HTMLElement).clientWidth,
      scrollWidth: (element as HTMLElement).scrollWidth,
      clientHeight: (element as HTMLElement).clientHeight,
      scrollHeight: (element as HTMLElement).scrollHeight,
      textRight: textBox.right,
      boxRight: box.right,
      textBottom: textBox.bottom,
      boxBottom: box.bottom,
      textOverflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  assert.ok(state.scrollWidth <= state.clientWidth + 1, `${label} 横向内容被截断：${JSON.stringify(state)}`);
  assert.ok(state.scrollHeight <= state.clientHeight + 1, `${label} 纵向内容被截断：${JSON.stringify(state)}`);
  assert.ok(state.textRight <= state.boxRight + 1 && state.textBottom <= state.boxBottom + 1, `${label} 文字超出可见框`);
  assert.notEqual(state.textOverflow, 'ellipsis', `${label} 不得使用 ellipsis 隐藏正文`);
  assert.notEqual(state.whiteSpace, 'nowrap', `${label} 必须允许移动端换行`);
}

/** 单独录制只停留 Inspector 的稳定交付视频，禁止原生路由/TUI/错误页进入成片。 */
async function captureStableHermesVideo(browser: any, inspectorUrl: string, videoDir: string): Promise<void> {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const problems: string[] = [];
  const navigations: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      const text = message.text();
      if (!/^\[\.WebGL-.*GL Driver Message/.test(text)) problems.push(`${message.type()}: ${text}`);
    }
  });
  page.on('pageerror', error => problems.push(`pageerror: ${String(error)}`));
  page.on('requestfailed', request => {
    const error = request.failure()?.errorText || 'failed';
    if (error !== 'net::ERR_ABORTED') problems.push(`requestfailed: ${request.url()} ${error}`);
  });
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame() && frame.url() !== 'about:blank') navigations.push(frame.url());
  });
  const assertInspectorState = async (label: string) => {
    assert.equal(new URL(page.url()).pathname, '/render', `${label} 必须停留渲染页`);
    assert.equal(await page.locator('[data-component="HermesTranscriptInspector"]').isVisible(), true, `${label} 必须显示 Inspector 根节点`);
    assert.equal(await page.locator('[role="alert"]').count(), 0, `${label} 不得出现错误 alert`);
    assert.deepEqual(problems, [], `${label} 不得出现浏览器问题：${problems.join('\n')}`);
  };
  const response = await page.goto(inspectorUrl);
  assert.ok(response?.ok(), `稳定视频 Inspector 必须返回 2xx，实际 ${response?.status()}`);
  const timeline = page.getByTestId('hermes-inspector-timeline');
  await timeline.waitFor();
  await page.getByRole('heading', { name: FINAL_HEADING, exact: true }).waitFor();
  await page.waitForTimeout(750);
  await assertInspectorState('录制开始');
  const outer = timeline.locator('details[data-testid="turn-non-body-group"]').first();
  const thinking = outer.locator('details.hti-thinking-details').filter({ hasText: R1_LAST });
  const toolGroup = outer.locator('details.hti-tool-group').first();
  assert.equal(await isDetailsOpen(outer), false, '视频开始时 outer 默认闭合');
  await toggleDetails(outer); await page.waitForTimeout(400); assert.equal(await isDetailsOpen(outer), true); await assertInspectorState('outer 展开后');
  await toggleDetails(thinking); await page.waitForTimeout(400); assert.equal(await isDetailsOpen(thinking), true); await assertInspectorState('thinking 展开后');
  await toggleDetails(toolGroup); await page.waitForTimeout(400); assert.equal(await isDetailsOpen(toolGroup), true); await assertInspectorState('T1 group 展开后');
  const tool = toolGroup.locator('.hti-command-card').filter({ hasText: T1_COMMAND });
  const output = tool.locator('details.hti-command-output');
  await output.waitFor({ state: 'attached' });
  await toggleDetails(output); await page.waitForTimeout(500); assert.equal(await isDetailsOpen(output), true); await assertInspectorState('Output 展开后');
  assert.equal(await tool.getByText(T1_OUTPUT, { exact: true }).isVisible(), true, '视频必须展示 T1 output');
  await toggleDetails(output); await page.waitForTimeout(350); assert.equal(await isDetailsOpen(output), false);
  await toggleDetails(toolGroup); await page.waitForTimeout(350); assert.equal(await isDetailsOpen(toolGroup), false);
  await toggleDetails(thinking); await page.waitForTimeout(350); assert.equal(await isDetailsOpen(thinking), false);
  await toggleDetails(outer); await page.waitForTimeout(500); assert.equal(await isDetailsOpen(outer), false);
  await assertInspectorState('录制结束');
  assert.ok(navigations.length > 0 && navigations.every(url => new URL(url).pathname === '/render'), `视频禁止进入其他路由：${navigations.join(', ')}`);
  const video = page.video();
  await page.close();
  await context.close();
  if (!video) throw new Error('稳定 Hermes video 未创建');
  const recordedPath = await video.path();
  const targetPath = path.join(CHANGE_RESULTS, 'inspector-browser-demo.webm');
  await copyFile(recordedPath, targetPath);
  assert.ok((await stat(targetPath)).size > 10_000, '稳定 Hermes video 必须包含有效动态内容');
  await rm(recordedPath, { force: true });
}

/** 记录证据是否完成，防止失败运行沿用旧视频或截图。 */
async function writeEvidenceStatus(status: 'running' | 'complete' | 'failed', runId: string, error?: unknown): Promise<void> {
  await mkdir(CHANGE_RESULTS, { recursive: true });
  await writeFile(
    path.join(CHANGE_RESULTS, 'evidence-status.json'),
    JSON.stringify({ runId, status, error: error ? String(error) : undefined }, null, 2),
    'utf8',
  );
}

/**
 * 用当前仓库的真实 OZW TurnNonBodyGroup/MessageComponent/ToolRenderer 建立
 * Codex 与 Claude 同语义对照页；只用于验收证据，不复制一套伪造样式。
 */
function ozwParityHarnessPlugin(): Plugin {
  const publicId = 'virtual:ozw-hermes-parity';
  const resolvedId = '\0virtual:ozw-hermes-parity.tsx';
  const source = [
    "import React from 'react';",
    "import { createRoot } from 'react-dom/client';",
    "import { I18nextProvider } from 'react-i18next';",
    "import i18n from '/frontend/i18n/config.ts';",
    "import { ThemeProvider } from '/frontend/contexts/ThemeContext.tsx';",
    "import '/frontend/index.css';",
    "import MessageComponent from '/frontend/components/chat/view/subcomponents/MessageComponent.tsx';",
    "import TurnNonBodyGroup from '/frontend/components/chat/view/subcomponents/TurnNonBodyGroup.tsx';",
    "import { buildTurnDisplayBlocks } from '/frontend/components/chat/utils/turnNonBodyCollapse.ts';",
    "const provider = new URLSearchParams(location.search).get('provider') || 'codex';",
    "const tick = String.fromCharCode(96);",
    `const finalMarkdown = '## ${FINAL_HEADING}\\n\\n- 已确认目录为 ' + tick + '/srv/demo-project' + tick + '\\n- 未执行任何写操作\\n\\n1. 保持 ' + tick + 'state.db' + tick + ' 只读\\n2. 记录权限错误';`,
    `const messages = [
      { type: 'user', content: ${JSON.stringify(USER_PROMPT)}, timestamp: '2026-08-14T08:00:00.000Z', messageKey: 'compare-user', deliveryStatus: 'persisted', provider },
      { type: 'thinking', content: ${JSON.stringify(`${R1_FIRST}\n${R1_LAST}`)}, timestamp: '2026-08-14T08:00:01.000Z', messageKey: 'compare-r1', isThinking: true, provider },
      { type: 'assistant', content: '', timestamp: '2026-08-14T08:00:02.000Z', messageKey: 'compare-t1', isToolUse: true, toolName: 'Bash', toolCallId: 'compare-t1', toolInput: { command: ${JSON.stringify(T1_COMMAND)} }, toolResult: { content: ${JSON.stringify(T1_OUTPUT)}, isError: false }, provider },
      { type: 'assistant', content: ${JSON.stringify(COMMENTARY)}, timestamp: '2026-08-14T08:00:03.000Z', messageKey: 'compare-commentary', isThinking: true, phase: 'commentary', provider },
      { type: 'thinking', content: ${JSON.stringify(R2_SINGLE)}, timestamp: '2026-08-14T08:00:04.000Z', messageKey: 'compare-r2', isThinking: true, provider },
      { type: 'assistant', content: '', timestamp: '2026-08-14T08:00:05.000Z', messageKey: 'compare-t2', isToolUse: true, toolName: 'Bash', toolCallId: 'compare-t2', toolInput: { command: ${JSON.stringify(T2_COMMAND)} }, toolResult: { content: ${JSON.stringify(T2_ERROR)}, isError: true }, provider },
      { type: 'assistant', content: finalMarkdown, timestamp: '2026-08-14T08:00:06.000Z', messageKey: 'compare-final', provider },
    ];`,
    "const blocks = buildTurnDisplayBlocks(messages);",
    "const common = { createDiff: () => [], provider, selectedProject: null, showThinking: true };",
    "function renderBlock(block, index) { if (block.kind === 'turn-non-body-group') return <TurnNonBodyGroup key={'process-' + index} block={block} blockIndex={index} {...common} />; const sourceIndex = messages.findIndex(message => message.messageKey === block.message.messageKey); return <MessageComponent key={block.message.messageKey || index} message={block.message} index={sourceIndex} prevMessage={sourceIndex > 0 ? messages[sourceIndex - 1] : null} {...common} />; }",
    `function App() { return <ThemeProvider><I18nextProvider i18n={i18n}><main className="min-h-screen bg-white px-8 py-6 text-gray-900 dark:bg-gray-950 dark:text-gray-100" data-testid="ozw-parity-transcript"><h1 className="mb-5 text-lg font-semibold">OZW {provider === 'claude' ? 'Claude' : 'Codex'} 同语义对照</h1><div className="mx-auto max-w-4xl space-y-3" data-testid="ozw-parity-surface">{blocks.map(renderBlock)}</div></main></I18nextProvider></ThemeProvider>; }`,
    "createRoot(document.getElementById('root')).render(<App />);",
  ].join('\n');
  return {
    name: 'ozw-hermes-parity-harness',
    enforce: 'pre',
    resolveId(id) {
      return id === publicId ? resolvedId : null;
    },
    load(id) {
      return id === resolvedId ? source : null;
    },
    async transform(code, id) {
      if (id !== resolvedId) return null;
      return await transformWithEsbuild(code, id, {
        loader: 'tsx',
        jsx: 'automatic',
      });
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith('/ozw-hermes-parity')) return next();
        try {
          const rawHtml = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@id/${publicId}"></script></body></html>`;
          const html = await server.transformIndexHtml(request.url, rawHtml);
          response.statusCode = 200;
          response.setHeader('Content-Type', 'text/html; charset=utf-8');
          response.end(html);
        } catch (error) {
          next(error as Error);
        }
      });
    },
  };
}

/** 用真实 OZW 组件逐层操作同语义 Codex/Claude turn，并保存独立截图和视频。 */
async function captureOzwParityEvidence(context: any, baseUrl: string, provider: 'codex' | 'claude'): Promise<ParityMetrics> {
  const page = await context.newPage();
  page.setDefaultTimeout(5_000);
  const browserProblems: string[] = [];
  page.on('console', message => {
    if (message.type() === 'error' || message.type() === 'warning') {
      browserProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on('pageerror', error => browserProblems.push(`pageerror: ${String(error)}`));
  page.on('requestfailed', request => {
    browserProblems.push(`requestfailed: ${request.url()} ${request.failure()?.errorText || 'failed'}`);
  });
  const response = await page.goto(`${baseUrl}/ozw-hermes-parity?provider=${provider}`);
  assert.ok(response?.ok(), `OZW ${provider} 对照页必须返回 2xx`);
  try {
    await page.getByTestId('ozw-parity-transcript').waitFor();
  } catch (error) {
    throw new Error(`OZW ${provider} 对照页未渲染：${browserProblems.join('\n')}\n${String(error)}`);
  }
  const outer = page.getByTestId('turn-non-body-group');
  try {
    await outer.waitFor();
  } catch (error) {
    const rootText = await page.getByTestId('ozw-parity-transcript').innerText().catch(() => 'missing root');
    const testIds = await page.locator('[data-testid]').evaluateAll(elements =>
      elements.map(element => element.getAttribute('data-testid')),
    ).catch(() => []);
    throw new Error(`OZW ${provider} 缺少 turn outer：${browserProblems.join('\n')}\nids=${JSON.stringify(testIds)}\ntext=${rootText}\n${String(error)}`);
  }
  await page.waitForTimeout(500);
  if (await outer.count() === 0) {
    const rootText = await page.getByTestId('ozw-parity-transcript').innerText().catch(() => 'missing root');
    throw new Error(`OZW ${provider} turn outer 异步消失：${browserProblems.join('\n')}\ntext=${rootText}`);
  }
  assert.equal(await isDetailsOpen(outer), false, `OZW ${provider} completed outer 默认闭合`);
  await toggleDetails(outer);
  await page.waitForTimeout(300);
  if (await outer.count() === 0) {
    throw new Error(`OZW ${provider} outer 展开后渲染失败：${browserProblems.join('\n')}`);
  }
  assert.equal(await isDetailsOpen(outer), true, `OZW ${provider} outer 必须可展开`);

  const thinking = outer.locator('details').filter({ hasText: R1_LAST }).first();
  await thinking.waitFor();
  assert.equal(await isDetailsOpen(thinking), false, `OZW ${provider} 多行 thinking 默认闭合`);
  await toggleDetails(thinking);
  assert.equal(await isDetailsOpen(thinking), true, `OZW ${provider} 多行 thinking 必须可独立展开`);

  const toolGroups = outer.getByTestId('turn-tool-group');
  assert.equal(await toolGroups.count(), 2, `OZW ${provider} 必须保留被 commentary/reasoning 隔开的两个工具组`);
  const firstGroup = toolGroups.nth(0);
  const secondGroup = toolGroups.nth(1);
  assert.equal(await isDetailsOpen(firstGroup), false, `OZW ${provider} T1 group 默认闭合`);
  assert.equal(await isDetailsOpen(secondGroup), false, `OZW ${provider} T2 group 默认闭合`);
  await toggleDetails(firstGroup);
  assert.equal(await isDetailsOpen(firstGroup), true, `OZW ${provider} T1 group 必须展开`);
  assert.equal(await isDetailsOpen(secondGroup), false, `OZW ${provider} T1 展开不得影响 T2`);
  await firstGroup.getByText(T1_COMMAND, { exact: true }).waitFor();

  const output = firstGroup.locator('details#tool-result-compare-t1');
  await output.waitFor({ state: 'attached' });
  assert.equal(await isDetailsOpen(output), false, `OZW ${provider} T1 output 默认闭合`);
  await toggleDetails(output);
  assert.equal(await isDetailsOpen(output), true, `OZW ${provider} T1 output 必须可独立展开`);
  await firstGroup.getByText(T1_OUTPUT, { exact: true }).waitFor();
  assert.equal(await isDetailsOpen(secondGroup), false, `OZW ${provider} output 展开仍不得影响 T2 group`);
  await assertNoPageHorizontalOverflow(page, `OZW ${provider} parity`);
  const surface = page.getByTestId('ozw-parity-surface');
  const commandCard = firstGroup.getByTestId('tool-context-code-card');
  const userBubble = page.getByText(USER_PROMPT, { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]');
  const metrics = await collectParityMetrics(`ozw-${provider}`, surface, {
    outerSummary: outer.locator(':scope > summary'),
    thinkingSummary: thinking.locator(':scope > summary'),
    toolGroupSummary: firstGroup.locator(':scope > summary'),
    commandCard,
    userBubble,
  });
  await screenshotTranscriptCrop(page, surface, `compare-ozw-${provider}-process-open.png`);

  const video = page.video();
  await page.close();
  if (video) {
    const recordedPath = await video.path();
    await copyFile(recordedPath, path.join(CHANGE_RESULTS, `ozw-${provider}-folding.webm`));
    await rm(recordedPath, { force: true });
  }
  return metrics;
}

/** 获取一个当前可绑定的回环端口，减少并行验收之间的碰撞。 */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      const port = address.port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

/** 等待真实 Dashboard 状态接口就绪，并在失败时保留子进程日志。 */
async function waitForDashboard(url: string, child: DashboardProcess, logs: string[]): Promise<void> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Hermes Dashboard 提前退出 (${child.exitCode})\n${logs.join('')}`);
    }
    try {
      const response = await fetch(`${url}/api/status`);
      if (response.ok) return;
    } catch {
      // Dashboard 尚在导入模块或绑定端口，继续轮询。
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Hermes Dashboard 未在 30 秒内就绪\n${logs.join('')}`);
}

/** 创建故意交错的真实 Hermes compression lineage，禁止按事件类型分桶也能过关。 */
async function seedHermesState(python: string, hermesRepo: string, hermesHome: string): Promise<void> {
  const script = String.raw`
import json
from hermes_state import SessionDB

db = SessionDB()
try:
    db.create_session(
        "inspector-parent",
        "tui",
        model="test/model",
        cwd="/srv/demo-project",
        profile_name="default",
    )
    db.append_message("inspector-parent", "user", "请按顺序检查部署目录、说明判断过程并保持只读")
    db.append_message(
        "inspector-parent",
        "assistant",
        reasoning_content="R1 先确认当前目录。\nR1 再核对目录是否允许只读检查，并确认不会写入状态数据库、不会修改权限、不会触发任何执行操作。",
    )
    db.append_message(
        "inspector-parent",
        "assistant",
        tool_calls=[{
            "id": "call-pwd-1",
            "type": "function",
            "function": {
                "name": "terminal",
                "arguments": json.dumps({"command": "pwd # inspector-long-command-must-not-be-covered-by-output-or-copy-controls-on-mobile"}),
            },
        }],
    )
    db.append_message(
        "inspector-parent",
        "tool",
        "T1_RESULT /srv/demo-project",
        tool_name="terminal",
        tool_call_id="call-pwd-1",
    )
    db.append_message(
        "inspector-parent",
        "assistant",
        "COMMENTARY 目录已确认，接着检查敏感文件权限。",
    )
    db.append_message(
        "inspector-parent",
        "assistant",
        reasoning_content="R2 权限检查只能读取，不能修改。",
    )
    db.append_message(
        "inspector-parent",
        "assistant",
        tool_calls=[{
            "id": "call-fail-1",
            "type": "function",
            "function": {
                "name": "terminal",
                "arguments": json.dumps({"command": "cat /root/secret"}),
            },
        }],
    )
    db.append_message(
        "inspector-parent",
        "tool",
        json.dumps({"success": False, "error": "permission denied"}),
        tool_name="terminal",
        tool_call_id="call-fail-1",
        effect_disposition="unknown",
    )
    db.append_message(
        "inspector-parent",
        "assistant",
        """## 部署检查结论

---

| 检查项 | 状态 |
| --- | --- |
| 配置 | 通过 |

- [x] 已确认只读
- [ ] 等待复核

1. 保持 \x60state.db\x60 只读
2. 记录权限错误

\x60\x60\x60bash
printf '%s\\n' 'inspector-markdown-code-line-that-must-not-expand-the-page'
\x60\x60\x60

[查看只读说明](https://example.com/hermes-readonly)
""",
    )
    db.append_message("inspector-parent", "user", "继续检查并给出 Markdown 结论")
    db.end_session("inspector-parent", "compression")

    db.create_session(
        "inspector-child",
        "tui",
        model="test/model",
        parent_session_id="inspector-parent",
        cwd="/srv/demo-project",
        profile_name="default",
    )
    db.append_message("inspector-child", "user", "继续检查并给出 Markdown 结论")
    db.append_message("inspector-child", "assistant", "压缩后的 continuation 仍然可见。")
    db.append_message("inspector-child", "user", "TOOL_ONLY 依次读取、搜索、制定计划并委托审计")
    db.append_message(
        "inspector-child",
        "assistant",
        tool_calls=[
            {
                "id": "call-read-1",
                "type": "function",
                "function": {"name": "read_file", "arguments": json.dumps({"path": "src/app.ts"})},
            },
            {
                "id": "call-search-1",
                "type": "function",
                "function": {"name": "search", "arguments": json.dumps({"query": "TODO", "path": "src"})},
            },
            {
                "id": "call-plan-1",
                "type": "function",
                "function": {"name": "plan", "arguments": json.dumps({"steps": ["检查现状", "输出报告"]})},
            },
            {
                "id": "call-subagent-1",
                "type": "function",
                "function": {"name": "subagent", "arguments": json.dumps({"description": "审核部署流程", "prompt": "只读核查并返回结论"})},
            },
        ],
    )
    db.append_message("inspector-child", "tool", "READ_RESULT export function app() {}", tool_name="read_file", tool_call_id="call-read-1")
    db.append_message("inspector-child", "tool", "SEARCH_RESULT src/app.ts:7 TODO", tool_name="search", tool_call_id="call-search-1")
    db.append_message("inspector-child", "tool", "PLAN_RESULT 2 steps accepted", tool_name="plan", tool_call_id="call-plan-1")
    db.append_message("inspector-child", "tool", "SUBAGENT_RESULT audit complete", tool_name="subagent", tool_call_id="call-subagent-1")
    db.append_message(
        "inspector-child",
        "tool",
        "UNMATCHED_RESULT orphan output must remain visible",
        tool_name="legacy_tool",
        tool_call_id="missing-call-1",
    )
    db.create_session(
        "ordinary-branch",
        "tui",
        model="test/model",
        model_config={"_branched_from": "inspector-child"},
        parent_session_id="inspector-child",
        cwd="/srv/other-branch",
        profile_name="default",
    )
    db.append_message("ordinary-branch", "assistant", "普通分支内容不得替代目标会话")
    db.create_session(
        "sibling-branch",
        "tui",
        model="test/model",
        model_config={"_branched_from": "inspector-parent"},
        parent_session_id="inspector-parent",
        cwd="/srv/sibling-branch",
        profile_name="default",
    )
    db.append_message("sibling-branch", "assistant", "更新 sibling 不得截断 compression lineage")
finally:
    db.close()
`;
  await execFileAsync(python, ['-c', script], {
    cwd: hermesRepo,
    env: { ...process.env, HERMES_HOME: hermesHome },
  });
}

/** 读取会话业务表的稳定投影，避免把 WAL 元数据或 Dashboard 自身状态误判为插件写入。 */
function businessSnapshot(dbPath: string): Record<string, unknown> {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return {
      sessions: db.prepare('SELECT * FROM sessions ORDER BY id').all(),
      messages: db.prepare('SELECT * FROM messages ORDER BY id').all(),
    };
  } finally {
    db.close();
  }
}

/** 有界关闭本测试启动的 Dashboard，避免失败分支遗留 VPS/本机进程。 */
async function stopDashboard(child: DashboardProcess): Promise<void> {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    new Promise<void>(resolve => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}

test('真实 Dashboard 按 OZW 当前行为检视有序 Hermes 执行流程', { timeout: 120_000 }, async () => {
  /**
   * 业务场景：VPS 操作者从 Inspector 深链打开复杂会话，通过与 ozw 相同的
   * turn 级折叠和工具层级理解真实跨行顺序；整个流程不提供 ozw 运行时，
   * 并证明浏览器只发 GET 且会话业务数据未被修改。
   */
  const hermesRepo = path.resolve(process.env.HERMES_AGENT_REPO || '../hermes-agent');
  const python = process.env.HERMES_PYTHON || path.join(hermesRepo, '.venv/bin/python');
  const runId = `${Date.now()}-${process.pid}`;
  await rm(CHANGE_RESULTS, { recursive: true, force: true });
  await writeEvidenceStatus('running', runId);
  await stat(path.join(hermesRepo, 'hermes_cli/web_dist/index.html'));
  await stat(python);

  await execFileAsync('pnpm', ['run', 'build:hermes-inspector'], { cwd: process.cwd() });
  const distPath = path.join(PLUGIN_SOURCE, 'dashboard/dist');
  await stat(path.join(distPath, 'index.js'));
  assert.deepEqual((await readdir(distPath)).sort(), ['index.js', 'style.css'], '独立插件不得夹带 ozw 公共资源');

  const root = await mkdtemp(path.join(tmpdir(), 'ozw-hermes-inspector-'));
  const hermesHome = path.join(root, '.hermes');
  const pluginTarget = path.join(hermesHome, 'plugins/render');
  const dbPath = path.join(hermesHome, 'state.db');
  const videoDir = path.join(root, 'video');
  const logs: string[] = [];
  let dashboard: DashboardProcess | null = null;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null;
  let viteServer: ViteDevServer | null = null;
  let parityBaseUrl = '';
  let evidenceComplete = false;
  let failure: unknown;

  try {
    await mkdir(path.dirname(pluginTarget), { recursive: true });
    await cp(PLUGIN_SOURCE, pluginTarget, { recursive: true });
    await writeFile(
      path.join(hermesHome, 'config.yaml'),
      'plugins:\n  enabled:\n    - render\n',
      'utf8',
    );
    await seedHermesState(python, hermesRepo, hermesHome);
    const before = businessSnapshot(dbPath);

    const port = await freePort();
    const baseUrl = `http://127.0.0.1:${port}`;
    const restrictedPath = [path.dirname(python), '/usr/bin', '/bin'].join(path.delimiter);
    dashboard = spawn(
      python,
      ['-m', 'hermes_cli.main', 'dashboard', '--host', '127.0.0.1', '--port', String(port), '--no-open', '--skip-build'],
      {
        cwd: hermesRepo,
        env: {
          ...process.env,
          HOME: root,
          HERMES_HOME: hermesHome,
          PATH: restrictedPath,
          OZW_HOME: '',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    dashboard.stdout?.on('data', chunk => logs.push(String(chunk).slice(-8_000)));
    dashboard.stderr?.on('data', chunk => logs.push(String(chunk).slice(-8_000)));
    await waitForDashboard(baseUrl, dashboard, logs);

    const parityPort = await freePort();
    parityBaseUrl = `http://127.0.0.1:${parityPort}`;
    viteServer = await createViteServer({
      root: process.cwd(),
      logLevel: 'error',
      plugins: [ozwParityHarnessPlugin()],
      server: { host: '127.0.0.1', port: parityPort, strictPort: true },
    });
    await viteServer.listen();

    await mkdir(videoDir, { recursive: true });
    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      recordVideo: { dir: videoDir, size: { width: 1440, height: 900 } },
    });
    const page = await context.newPage();
    page.setDefaultTimeout(5_000);
    const consoleProblems: string[] = [];
    const pageErrors: string[] = [];
    const requestFailures: string[] = [];
    const inspectorApiRequests: Array<{ method: string; url: string }> = [];
    let recordInspectorRequests = true;
    page.on('console', message => {
      if (message.type() === 'error' || message.type() === 'warning') {
        const text = message.text();
        if (!/^\[\.WebGL-.*GL Driver Message/.test(text)) {
          consoleProblems.push(`${message.type()}: ${text}`);
        }
      }
    });
    page.on('pageerror', error => pageErrors.push(String(error)));
    page.on('requestfailed', request => {
      const errorText = request.failure()?.errorText || 'failed';
      if (errorText !== 'net::ERR_ABORTED') {
        requestFailures.push(`${request.method()} ${request.url()}: ${errorText}`);
      }
    });
    page.on('request', request => {
      if (!recordInspectorRequests) return;
      const url = new URL(request.url());
      if (url.origin === baseUrl && url.pathname.startsWith('/api/')) {
        inspectorApiRequests.push({ method: request.method(), url: url.pathname + url.search });
      }
    });

    const inspectorUrl = `${baseUrl}/render?profile=default&session=inspector-child`;
    const inspectorResponse = await page.goto(inspectorUrl);
    assert.ok(inspectorResponse?.ok(), `Inspector 深链必须返回 2xx，实际 ${inspectorResponse?.status()}`);
    assert.equal(new URL(page.url()).pathname, '/render', '浏览器必须停留在渲染深链');
    assert.ok((await page.title()).trim(), 'Dashboard 页面必须有标题');
    await page.getByRole('link', { name: '渲染' }).waitFor();
    const timeline = page.getByTestId('hermes-inspector-timeline');
    await timeline.waitFor();

    // 默认阅读面：user/final 可见，完成 turn 的过程闭合且内容不可见。
    await page.getByText(USER_PROMPT, { exact: true }).waitFor();
    assert.equal(await page.getByText(CONTINUATION_PROMPT, { exact: true }).count(), 1, 'compression echo 只能显示一次');
    assert.equal(await page.getByText('普通分支内容不得替代目标会话').count(), 0, '普通 branch 不得混入目标时间线');
    assert.equal(await page.getByText('更新 sibling 不得截断 compression lineage').count(), 0, 'sibling branch 不得混入目标时间线');
    const finalHeading = page.getByRole('heading', { name: FINAL_HEADING, exact: true });
    await finalHeading.waitFor();
    const processDetails = timeline.locator('details[data-testid="turn-non-body-group"]').first();
    await processDetails.waitFor();
    assert.equal(await isDetailsOpen(processDetails), false, 'completed turn 的外层过程必须默认闭合');
    assert.equal(await page.getByText(R1_FIRST, { exact: true }).isVisible(), false, '闭合时不得泄露多行 reasoning 正文');
    assert.equal(await page.getByText(T1_OUTPUT, { exact: true }).isVisible(), false, '闭合时不得泄露工具 output');
    assert.equal(await finalHeading.isVisible(), true, 'final Markdown 必须默认可见');
    assert.ok(await timeline.locator('.hti-rich-text hr').count(), 'CommonMark 分割线必须渲染为 hr');
    const markdownTable = timeline.locator('.hti-rich-text table').first();
    await markdownTable.waitFor();
    assert.equal(await markdownTable.getByRole('columnheader', { name: '检查项' }).count(), 1, 'GFM 表格必须渲染语义表头');
    assert.equal(await markdownTable.getByRole('cell', { name: '通过' }).count(), 1, 'GFM 表格必须渲染语义单元格');
    assert.equal(await timeline.locator('.hti-rich-text input[type="checkbox"][checked]').count(), 1, 'GFM 任务列表必须保留完成状态');
    assert.equal(await timeline.locator('details.hti-raw-panel').count(), 0, 'raw 默认不得渲染');
    await assertNoPageHorizontalOverflow(page, 'desktop default');
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'desktop-default.png'), fullPage: false });

    // 外层过程展开后，先验证单行/多行 thinking，再逐层展开工具组与同卡 output。
    await toggleDetails(processDetails);
    assert.equal(await isDetailsOpen(processDetails), true, '点击后外层过程必须展开');
    const r1Event = processDetails.locator('details.hti-thinking-details').filter({ hasText: R1_LAST });
    const r2Event = processDetails.locator('.hti-thinking-single').filter({ hasText: R2_SINGLE });
    await r1Event.waitFor();
    await r2Event.waitFor();
    assert.equal(await page.getByText(R1_LAST, { exact: true }).isVisible(), true, '多行 thinking 折叠摘要必须显示最后一条非空行');
    assert.equal(await page.getByText(R1_FIRST, { exact: true }).isVisible(), false, '多行 thinking 展开前只显示摘要');
    const r1Details = r1Event;
    assert.equal(await isDetailsOpen(r1Details), false, '多行 thinking 内层默认闭合');
    assert.equal(await r2Event.locator('details').count(), 0, '单行 thinking 必须直接显示，不能制造无意义内层折叠');
    assert.equal(await page.getByText(R2_SINGLE, { exact: true }).isVisible(), true, '单行 thinking 必须可直接阅读');
    await toggleDetails(r1Details);
    const r1Body = r1Details.locator('.hti-thinking-body');
    await r1Body.waitFor();
    assert.match(await r1Body.innerText(), new RegExp(`${R1_FIRST}[\\s\\S]*${R1_LAST}`), '多行 thinking 展开后必须显示完整原文');

    const toolGroups = processDetails.locator('details.hti-tool-group');
    assert.equal(await toolGroups.count(), 2, '被 commentary/reasoning 隔开的两次工具活动必须保持两个有序工具组');
    const firstToolGroup = toolGroups.nth(0);
    const secondToolGroup = toolGroups.nth(1);
    assert.equal(await isDetailsOpen(firstToolGroup), false, 'T1 工具组默认闭合');
    assert.equal(await isDetailsOpen(secondToolGroup), false, 'T2 工具组默认闭合');
    await toggleDetails(firstToolGroup);
    assert.equal(await isDetailsOpen(secondToolGroup), false, '展开 T1 不能连带展开 T2');
    const firstTool = firstToolGroup.locator('.hti-command-card').filter({ hasText: T1_COMMAND });
    await firstTool.waitFor();
    assert.equal(await firstTool.getAttribute('data-tool-name'), 'terminal', '命令卡必须保留 terminal 语义');
    assert.match(await firstTool.innerText(), /pwd/i, 'output 关闭时命令也必须直接可见');
    const firstOutput = firstTool.locator('details.hti-command-output');
    await firstOutput.waitFor({ state: 'attached' });
    assert.equal(await isDetailsOpen(firstOutput), false, 'T1 output 必须默认闭合');
    assert.equal(await page.getByText(T1_OUTPUT, { exact: true }).isVisible(), false, 'T1 output 展开前不可见');
    await toggleDetails(firstOutput);
    await page.getByText(T1_OUTPUT, { exact: true }).waitFor();
    assert.equal(await secondToolGroup.isVisible(), true, '打开 T1 output 后后续工具组仍存在');
    await assertCommandControlsDoNotCoverText(firstTool);
    await assertContrast(firstTool.locator('.hti-command-code'), 4.5, 'terminal command');
    await assertContrast(firstOutput.locator(':scope > summary'), 4.5, 'Output control');
    await assertContrast(firstTool.locator('.hti-command-copy'), 4.5, 'Copy control');
    await resetInspectorScroll(page);
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'desktop-tool-output-open.png'), fullPage: true });
    const hermesMetrics = await collectParityMetrics('hermes-dashboard', timeline, {
      outerSummary: processDetails.locator(':scope > summary'),
      thinkingSummary: r1Details.locator(':scope > summary'),
      toolGroupSummary: firstToolGroup.locator(':scope > summary'),
      commandCard: firstTool,
      userBubble: timeline.locator('.hti-user-bubble').first(),
    });
    await screenshotTranscriptCrop(page, timeline, 'compare-hermes-process-open.png');

    await toggleDetails(secondToolGroup);
    const secondTool = secondToolGroup.locator('.hti-command-card').filter({ hasText: T2_COMMAND });
    await secondTool.waitFor();
    assert.equal(await secondTool.getAttribute('data-tool-name'), 'terminal', '失败命令卡必须保留 terminal 语义');
    assert.match(await secondTool.innerText(), /cat \/root\/secret/i, '失败 output 关闭时命令也必须直接可见');
    assert.equal(await secondTool.getAttribute('data-tool-status'), '错误', '失败 output 关闭时卡片状态也必须暴露错误');
    const secondOutput = secondTool.locator('details.hti-command-output');
    assert.equal(await secondOutput.locator(':scope > summary').getAttribute('aria-label'), 'Show output', '错误 output 必须有可访问的独立展开入口');
    await secondOutput.waitFor({ state: 'attached' });
    assert.equal(await isDetailsOpen(secondOutput), false, 'T2 error output 必须默认闭合');
    assert.equal(await page.getByText(T2_ERROR, { exact: true }).isVisible(), false, '错误正文展开前不可见');
    await toggleDetails(secondOutput);
    const errorText = secondOutput.locator('pre').filter({ hasText: T2_ERROR });
    await errorText.waitFor();
    assert.equal(await firstTool.getByText(T2_ERROR, { exact: true }).count(), 0, 'T2 错误不得归到 T1 卡中');
    await resetInspectorScroll(page);
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'desktop-error-output-open.png'), fullPage: true });

    const firstCommand = firstTool.getByText(T1_COMMAND, { exact: true });
    const commentary = page.getByText(COMMENTARY, { exact: true });
    const secondCommand = secondTool.getByText(T2_COMMAND, { exact: true });
    await assertStrictVisualOrder([
      { label: 'R1', locator: r1Body },
      { label: 'T1 command', locator: firstCommand },
      { label: 'T1 result', locator: page.getByText(T1_OUTPUT, { exact: true }) },
      { label: 'assistant commentary', locator: commentary },
      { label: 'R2', locator: page.getByText(R2_SINGLE, { exact: true }) },
      { label: 'T2 command', locator: secondCommand },
      { label: 'T2 error', locator: errorText },
      { label: 'final Markdown', locator: finalHeading },
    ]);
    await resetInspectorScroll(page);
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'desktop-process-open.png'), fullPage: true });

    // Markdown 必须是语义 DOM，而不是手写字符串或 fenced 文本。
    assert.equal(await finalHeading.evaluate(element => element.tagName), 'H2', '## 必须渲染为 h2');
    const finalMessage = finalHeading.locator('xpath=ancestor::*[@data-role="assistant"][1]');
    await finalMessage.waitFor();
    assert.equal(await finalMessage.locator('ul > li').count(), 2, '无序列表必须成为 ul/li');
    assert.equal(await finalMessage.locator('ol > li').count(), 2, '有序列表必须成为 ol/li');
    assert.equal(await finalMessage.locator('code', { hasText: 'state.db' }).count(), 1, '行内代码必须成为 code');
    const fencedCode = finalMessage.locator('pre > code', { hasText: FINAL_CODE });
    await fencedCode.waitFor();
    const link = finalMessage.getByRole('link', { name: '查看只读说明', exact: true });
    assert.equal(await link.getAttribute('href'), 'https://example.com/hermes-readonly', 'Markdown 链接必须保留安全 href');
    assert.equal((await finalMessage.innerText()).includes('```'), false, 'fenced code 标记不得原样泄露');
    await assertContrast(page.locator('.hti-header h1'), 3, 'Inspector 大标题');
    await assertContrast(page.locator('.hti-notice'), 4.5, '持久化 reasoning 提示');
    await assertContrast(timeline.locator('.hti-user-content').first(), 4.5, '用户气泡正文');
    await assertContrast(timeline.locator('.hti-user-bubble time').first(), 4.5, '用户气泡时间');
    await assertContrast(processDetails.locator(':scope > summary'), 4.5, '过程 summary');
    await assertContrast(r1Details.locator(':scope > summary'), 4.5, 'thinking summary');
    await assertContrast(firstToolGroup.locator(':scope > summary'), 4.5, '工具组 summary');
    await assertContrast(commentary.locator('xpath=ancestor::*[contains(@class,"hti-thinking-single")][1]'), 4.5, 'commentary');
    await assertContrast(finalHeading, 3, 'Markdown 大标题');
    await assertContrast(finalMessage.locator('li').first(), 4.5, 'assistant 正文');
    await assertContrast(finalMessage.locator('code', { hasText: 'state.db' }), 4.5, 'Markdown 行内代码');
    await assertContrast(errorText, 4.5, '错误 output');
    await resetInspectorScroll(page);
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'desktop-markdown.png'), fullPage: true });

    // raw 是辅助层：打开/关闭不能改变已有折叠状态或语义顺序。
    const controlledDetails = [processDetails, r1Details, firstToolGroup, firstOutput, secondToolGroup, secondOutput];
    const openBeforeRaw = await Promise.all(controlledDetails.map(isDetailsOpen));
    await page.getByTestId('hermes-inspector-raw-toggle').click();
    const rawPanels = timeline.locator('details.hti-raw-panel');
    assert.ok(await rawPanels.count() > 0, '显式开启后必须出现 raw 辅助面板');
    await rawPanels.first().getByText('call-pwd-1', { exact: false }).waitFor();
    assert.deepEqual(await Promise.all(controlledDetails.map(isDetailsOpen)), openBeforeRaw, '开启 raw 不得改变任何折叠状态');
    await assertStrictVisualOrder([
      { label: 'R1 after raw', locator: r1Body },
      { label: 'T1 after raw', locator: firstCommand },
      { label: 'commentary after raw', locator: commentary },
      { label: 'R2 after raw', locator: page.getByText(R2_SINGLE, { exact: true }) },
      { label: 'T2 after raw', locator: secondCommand },
      { label: 'final after raw', locator: finalHeading },
    ]);
    await page.getByTestId('hermes-inspector-raw-toggle').click();
    assert.equal(await rawPanels.count(), 0, '关闭 raw 后辅助面板必须消失');
    assert.deepEqual(await Promise.all(controlledDetails.map(isDetailsOpen)), openBeforeRaw, '关闭 raw 也不得改变折叠状态');
    await page.getByText('仅展示已持久化的 reasoning，不代表模型隐藏推理。').waitFor();

    // 纯工具 turn 必须对齐 OZW tool-only outer → tool list 双层折叠。
    const toolOnlyTurn = timeline.locator('article').filter({ hasText: TOOL_ONLY_PROMPT });
    await toolOnlyTurn.waitFor();
    const toolOnlyOuter = toolOnlyTurn.locator('details[data-testid="turn-tool-list-group"]');
    await toolOnlyOuter.waitFor();
    assert.equal(await isDetailsOpen(toolOnlyOuter), false, '纯工具 turn 的外层必须默认闭合');
    assert.equal(await toolOnlyTurn.locator('details[data-testid="turn-tool-list"]').count(), 0, '外层闭合时内层工具列表不得提前渲染');
    await toggleDetails(toolOnlyOuter);
    assert.equal(await isDetailsOpen(toolOnlyOuter), true, '纯工具外层必须可独立展开');
    const toolOnlyList = toolOnlyTurn.locator('details[data-testid="turn-tool-list"]');
    await toolOnlyList.waitFor();
    assert.equal(await isDetailsOpen(toolOnlyList), false, '展开纯工具外层不能连带展开内层工具列表');
    await toggleDetails(toolOnlyList);
    assert.equal(await isDetailsOpen(toolOnlyOuter), true, '展开工具列表不能改变外层 open 状态');
    assert.equal(await isDetailsOpen(toolOnlyList), true, '内层工具列表必须可独立展开');

    const knownToolSummaries: Array<{ name: string; expected: RegExp }> = [
      { name: 'read_file', expected: /read_file[\s\S]*src\/app\.ts/i },
      { name: 'search', expected: /search[\s\S]*TODO[\s\S]*src/i },
      { name: 'plan', expected: /plan[\s\S]*(?:2 steps|2 步)/i },
      { name: 'subagent', expected: /subagent[\s\S]*审核部署流程/i },
    ];
    for (const known of knownToolSummaries) {
      const card = toolOnlyList.locator(`[data-tool-name="${known.name}"]`);
      await card.waitFor();
      const summary = card.locator('summary').first();
      const summaryText = (await summary.innerText()).trim();
      assert.match(summaryText, known.expected, `${known.name} 主摘要必须表达业务语义`);
      assert.equal(/[{}"]|"(?:path|query|steps|description)"/.test(summaryText), false, `${known.name} 主摘要不得退化为 JSON`);
    }

    const unmatched = toolOnlyList.locator('[data-tool-unmatched="true"]');
    await unmatched.waitFor();
    const unmatchedSummary = (await unmatched.locator('summary').first().innerText()).trim();
    assert.match(unmatchedSummary, /未匹配|unmatched/i, '孤立 tool result 必须显示可见边界');
    assert.match(unmatchedSummary, /legacy_tool[\s\S]*missing-call-1/i, '边界摘要必须说明工具名和缺失 call id');
    assert.equal(await unmatched.getByText(UNMATCHED_OUTPUT, { exact: true }).isVisible(), false, '孤立 output 正文仍由自己的 disclosure 控制');
    await toggleDetails(toolOnlyList);
    assert.equal(await isDetailsOpen(toolOnlyList), false, '内层工具列表必须可单独收起');
    assert.equal(await isDetailsOpen(toolOnlyOuter), true, '收起内层不得连带收起外层');

    const search = page.getByLabel('搜索会话');
    await search.fill(T2_ERROR);
    await page.getByRole('button', { name: 'inspector-child', exact: true }).waitFor();
    await search.fill('');

    // 从 compression parent 深链也必须恢复真正 tip，而不是最新 sibling branch。
    await page.goto(`${baseUrl}/render?profile=default&session=inspector-parent`);
    await page.getByTestId('hermes-inspector-timeline').waitFor();
    await page.getByRole('heading', { name: FINAL_HEADING, exact: true }).waitFor();
    assert.equal(await page.getByText('更新 sibling 不得截断 compression lineage').count(), 0, '父深链不得跳入 sibling branch');

    for (const forbidden of ['发送', 'Steer', '停止', '审批', '删除', '重命名']) {
      assert.equal(await page.getByRole('button', { name: forbidden, exact: true }).count(), 0, `只读页面不得出现 ${forbidden}`);
    }
    assert.ok(inspectorApiRequests.length > 0, '必须捕获 Inspector 的真实 API 请求');
    assert.deepEqual(
      [...new Set(inspectorApiRequests.map(request => request.method))],
      ['GET'],
      `Inspector 全部 API 都必须只读：${JSON.stringify(inspectorApiRequests, null, 2)}`,
    );

    // 移动端：session picker 默认收起，第一屏可进入 transcript，整页无横向溢出。
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(inspectorUrl);
    const mobileTimeline = page.getByTestId('hermes-inspector-timeline');
    await mobileTimeline.waitFor();
    const sessionPickerToggle = page.locator('button.hti-picker-toggle');
    await sessionPickerToggle.waitFor();
    const sessionList = page.getByRole('navigation', { name: 'Hermes 会话' });
    assert.equal(await sessionList.isVisible(), false, '移动端 session picker 默认必须收起');
    await sessionPickerToggle.click();
    assert.equal(await sessionList.isVisible(), true, '移动端 session picker 必须可展开');
    await sessionPickerToggle.click();
    assert.equal(await sessionList.isVisible(), false, '移动端 session picker 必须可再次收起');
    const mobileUserBox = await page.getByText(USER_PROMPT, { exact: true }).boundingBox();
    const mobileProcess = mobileTimeline.locator('details[data-testid="turn-non-body-group"]').first();
    const mobileProcessBox = await mobileProcess.boundingBox();
    assert.ok(mobileUserBox && mobileUserBox.y + mobileUserBox.height < 700, '移动端用户气泡必须进入第一屏主要区域');
    assert.ok(mobileProcessBox && mobileProcessBox.y + mobileProcessBox.height <= 844, '移动端 process summary 必须完整进入第一屏');
    assert.equal(await isDetailsOpen(mobileProcess), false, '移动端 completed process 仍默认闭合');
    await assertNoPageHorizontalOverflow(page, 'mobile default');
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'mobile-default.png'), fullPage: false });
    await toggleDetails(mobileProcess);
    await assertMobileSummaryNotTruncated(mobileProcess.locator('.hti-thinking-preview').first(), '移动端 thinking summary');
    const mobileFirstToolGroup = mobileProcess.locator('details.hti-tool-group').first();
    await assertMobileSummaryNotTruncated(mobileFirstToolGroup.locator(':scope > summary'), '移动端工具组 summary');
    await toggleDetails(mobileFirstToolGroup);
    const mobileFirstTool = mobileFirstToolGroup.locator('.hti-command-card').filter({ hasText: T1_COMMAND });
    await toggleDetails(mobileFirstTool.locator('details.hti-command-output'));
    await page.getByText(T1_OUTPUT, { exact: true }).waitFor();
    await assertCommandControlsDoNotCoverText(mobileFirstTool);
    await assertNoPageHorizontalOverflow(page, 'mobile process/tool open');
    const mobileCodeBox = await page.getByRole('heading', { name: FINAL_HEADING, exact: true })
      .locator('xpath=ancestor::*[@data-role="assistant"][1]')
      .locator('pre > code')
      .boundingBox();
    assert.ok(mobileCodeBox && mobileCodeBox.x >= 0 && mobileCodeBox.x < 390, '移动端 fenced code 必须留在页面范围内');
    await page.screenshot({ path: path.join(CHANGE_RESULTS, 'mobile-process-open.png'), fullPage: true });

    // 原生路由必须真实返回有效页面；仅 URL 不等 Inspector 不足以证明未被覆盖。
    recordInspectorRequests = false;
    await page.setViewportSize({ width: 1440, height: 900 });
    const sessionsResponse = await page.goto(`${baseUrl}/sessions`);
    assert.ok(sessionsResponse?.ok(), `原生 Sessions 必须返回 2xx，实际 ${sessionsResponse?.status()}`);
    assert.equal(new URL(page.url()).pathname, '/sessions');
    assert.equal(await page.locator('[data-component="HermesTranscriptInspector"]').count(), 0, 'Sessions 不得渲染插件根节点');
    await page.getByRole('heading', { name: 'Sessions', exact: false }).first().waitFor();
    const chatResponse = await page.goto(`${baseUrl}/chat`);
    assert.ok(chatResponse?.ok(), `原生 Chat 必须返回 2xx，实际 ${chatResponse?.status()}`);
    assert.equal(new URL(page.url()).pathname, '/chat');
    assert.equal(await page.locator('[data-component="HermesTranscriptInspector"]').count(), 0, 'Chat 不得渲染插件根节点');
    await page.getByRole('heading', { name: 'Chat', exact: false }).first().waitFor();

    // 同一浏览器、viewport 和语义 fixture，分别操作真实 OZW Codex/Claude 渲染器。
    const codexMetrics = await captureOzwParityEvidence(context, parityBaseUrl, 'codex');
    const claudeMetrics = await captureOzwParityEvidence(context, parityBaseUrl, 'claude');
    assertParityMetrics(codexMetrics, claudeMetrics);
    assertParityMetrics(codexMetrics, hermesMetrics);
    await writeFile(
      path.join(CHANGE_RESULTS, 'parity-metrics.json'),
      JSON.stringify({
        runId,
        scope: 'renderer parity only; Codex/Claude native raw normalizers are outside this harness',
        crop: { width: 760, height: 640, state: 'outer + multiline thinking + T1 group + T1 output open; T2 group closed' },
        tolerances: {
          fontSize: 2,
          lineHeight: 4,
          borderRadius: 5,
          padding: 6,
          height: 14,
          verticalGap: 12,
          colorsCompared: false,
        },
        metrics: { codex: codexMetrics, claude: claudeMetrics, hermes: hermesMetrics },
      }, null, 2),
      'utf8',
    );

    await context.close();
    await captureStableHermesVideo(browser, inspectorUrl, path.join(root, 'stable-hermes-video'));

    const after = businessSnapshot(dbPath);
    const unchanged = JSON.stringify(after) === JSON.stringify(before);
    assert.equal(unchanged, true, '检视前后 sessions/messages 业务投影必须一致');
    await writeFile(
      path.join(CHANGE_RESULTS, 'inspector-readonly-state.json'),
      JSON.stringify({
        runId,
        ozwRuntimeProvided: false,
        apiRequests: inspectorApiRequests,
        apiMethods: [...new Set(inspectorApiRequests.map(request => request.method))],
        sessionRows: (after.sessions as unknown[]).length,
        messageRows: (after.messages as unknown[]).length,
        unchanged,
        before,
        after,
      }, null, 2),
      'utf8',
    );
    const evidence = JSON.parse(await readFile(path.join(CHANGE_RESULTS, 'inspector-readonly-state.json'), 'utf8'));
    assert.equal(evidence.runId, runId);
    assert.equal(evidence.unchanged, true);
    assert.equal(evidence.ozwRuntimeProvided, false);
    assert.deepEqual(evidence.apiMethods, ['GET']);
    assert.deepEqual(consoleProblems, [], `Dashboard 控制台不得出现 error/warning：${consoleProblems.join('\n')}`);
    assert.deepEqual(pageErrors, [], `Dashboard 不得出现 pageerror：${pageErrors.join('\n')}`);
    assert.deepEqual(requestFailures, [], `Dashboard 不得出现 requestfailed：${requestFailures.join('\n')}`);
    await writeEvidenceStatus('complete', runId);
    evidenceComplete = true;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    await viteServer?.close().catch(() => undefined);
    if (dashboard) await stopDashboard(dashboard);
    await rm(root, { recursive: true, force: true });
    if (!evidenceComplete) await writeEvidenceStatus('failed', runId, failure);
  }
});
