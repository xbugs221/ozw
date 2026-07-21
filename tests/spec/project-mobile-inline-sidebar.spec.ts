/**
 * PURPOSE: Stable business regression for the mobile project workspace inline sidebar.
 * Sources: 106-移动端侧栏改为内联折叠布局
 */
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

import { authenticatePage } from './helpers/spec-test-helpers.ts';

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const EVIDENCE_DIR = path.resolve(process.cwd(), 'test-results', '106-mobile-inline-sidebar');

test.use({ trace: 'off' });

type ButtonMetric = {
  label: string;
  left: number;
  right: number;
  width: number;
  height: number;
};

async function openMobileWorkspace(page: Page): Promise<void> {
  /**
   * PURPOSE: Open a real fixture manual session directly in a narrow viewport
   * because the root dashboard now keeps its navigation drawer closed by default.
   */
  await page.setViewportSize(MOBILE_VIEWPORT);
  await authenticatePage(page);
  await page.goto('/workspace/fixture-project/c3', { waitUntil: 'networkidle' });
  await expect(getMobileMainSurface(page)).toBeVisible();
}

function getMobileMainSurface(page: Page): Locator {
  /**
   * PURPOSE: Treat the selected chat or shell tab as the main surface because
   * concrete sessions now restore their terminal tab by default.
   */
  return page.locator('[data-testid^="mobile-workspace-"]').first();
}

function ensureEvidenceDir(): void {
  /**
   * PURPOSE: Keep evidence output available for local visual review.
   */
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true });
}

async function getVisibleFooterButtonMetrics(page: Page) {
  /**
   * PURPOSE: Measure visible mobile footer actions so compactness is verified by layout.
   */
  const actions = [
    { label: 'open project', locator: page.getByRole('button', { name: /Open project|打开项目|打开新项目/i }) },
    { label: 'search history', locator: page.getByRole('button', { name: /Search chat history|Search|搜索/i }) },
    { label: 'settings', locator: page.getByRole('button', { name: /Settings|设置/i }) },
    { label: 'collapse sidebar', locator: page.getByRole('button', { name: /Hide sidebar|隐藏侧边栏/i }) },
  ];

  const metrics: ButtonMetric[] = [];
  for (const action of actions) {
    await expect(action.locator).toBeVisible();
    const box = await action.locator.boundingBox();
    expect(box, `${action.label} bounding box`).not.toBeNull();
    if (!box) continue;

    metrics.push({
      label: action.label,
      left: Math.round(box.x),
      right: Math.round(box.x + box.width),
      width: Math.round(box.width),
      height: Math.round(box.height),
    });
  }

  const sorted = [...metrics].sort((a, b) => a.left - b.left);
  const gaps = sorted.slice(1).map((item, index) => Math.max(0, item.left - sorted[index].right));

  return { metrics, gaps };
}

test.describe('移动端项目工作区内联侧栏', () => {
  test.beforeEach(() => {
    ensureEvidenceDir();
  });

  test('展开侧栏时主界面仍可见且不会被覆盖遮罩阻断', async ({ page }) => {
    await openMobileWorkspace(page);

    await page.context().tracing.start({ screenshots: true, snapshots: true, sources: true });
    await page.getByRole('button', { name: /Open menu/i }).click();

    const projectList = page.getByTestId('project-list');
    const mainSurface = getMobileMainSurface(page);

    await expect(projectList).toBeVisible();
    await expect(mainSurface).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'open-with-main-visible.png'), fullPage: true });

    const layout = await page.evaluate(() => {
      const projectList = document.querySelector('[data-testid="project-list"]');
      const mainSurface = document.querySelector('[data-testid^="mobile-workspace-"]');
      const ancestors: Element[] = [];
      let current = projectList?.parentElement ?? null;
      while (current) {
        ancestors.push(current);
        current = current.parentElement;
      }
      const sidebar = ancestors.find((element) => {
        const box = element.getBoundingClientRect();
        return box.height > window.innerHeight * 0.8 && box.width >= 120 && box.width <= 260;
      });
      const overlay = document.querySelector('.fixed.inset-0.z-50');
      const sidebarBox = sidebar?.getBoundingClientRect();
      const mainSurfaceBox = mainSurface?.getBoundingClientRect();

      return {
        hasBlockingOverlay: Boolean(overlay),
        sidebarWidth: sidebarBox ? Math.round(sidebarBox.width) : 0,
        mainSurfaceWidth: mainSurfaceBox ? Math.round(mainSurfaceBox.width) : 0,
      };
    });

    expect(layout.hasBlockingOverlay).toBe(false);
    expect(layout.sidebarWidth).toBeGreaterThan(120);
    expect(layout.sidebarWidth).toBeLessThanOrEqual(224);
    expect(layout.mainSurfaceWidth).toBeGreaterThan(120);

    await page.context().tracing.stop({
      path: path.join(EVIDENCE_DIR, 'open-with-main-visible-trace.zip'),
    });
  });

  test('点击主界面不折叠侧栏，底部折叠按钮才会收起', async ({ page }) => {
    await openMobileWorkspace(page);

    await page.getByRole('button', { name: /Open menu/i }).click();

    const projectList = page.getByTestId('project-list');
    const mainSurface = getMobileMainSurface(page);

    await expect(projectList).toBeVisible();
    const mainSurfaceBox = await mainSurface.boundingBox();
    expect(mainSurfaceBox).not.toBeNull();
    await page.mouse.click((mainSurfaceBox?.x ?? 0) + (mainSurfaceBox?.width ?? 0) - 20, (mainSurfaceBox?.y ?? 0) + 120);
    await expect(projectList).toBeVisible();

    await page.getByRole('button', { name: /Hide sidebar|隐藏侧边栏/i }).click();

    await expect(projectList).toBeHidden();
    await expect(mainSurface).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'collapsed-after-footer-button.png'), fullPage: true });
  });

  test('根路由待处理看板可收起侧栏并重新打开', async ({ page }) => {
    /**
     * PURPOSE: 首页已有独立看板后，移动端不得继续强制常驻旧的项目导航。
     */
    await page.setViewportSize(MOBILE_VIEWPORT);
    await authenticatePage(page);
    await page.goto('/', { waitUntil: 'networkidle' });

    const projectList = page.getByTestId('project-list');
    const board = page.getByTestId('session-attention-board');
    await expect(projectList).toBeHidden();
    await expect(board).toBeVisible();

    await page.getByRole('button', { name: /Open menu/i }).click();
    await expect(projectList).toBeVisible();
    await page.getByRole('button', { name: /Hide sidebar|隐藏侧边栏/i }).click();
    await expect(projectList).toBeHidden();
    await expect(board).toBeVisible();
    await page.screenshot({ path: path.join(EVIDENCE_DIR, 'root-board-sidebar-collapsed.png'), fullPage: true });

    await page.getByRole('button', { name: /Open menu/i }).click();
    await expect(projectList).toBeVisible();
    await expect(board).toBeVisible();
  });

  test('移动端侧栏底部四个动作按钮保持紧凑', async ({ page }) => {
    await openMobileWorkspace(page);

    await page.getByRole('button', { name: /Open menu/i }).click();

    const buttonLayout = await getVisibleFooterButtonMetrics(page);
    fs.writeFileSync(
      path.join(EVIDENCE_DIR, 'footer-button-metrics.json'),
      `${JSON.stringify(buttonLayout, null, 2)}\n`,
      'utf8',
    );

    expect(buttonLayout.metrics).toHaveLength(4);

    for (const metric of buttonLayout.metrics) {
      expect(metric.height, `${metric.label} height`).toBeLessThanOrEqual(38);
      expect(metric.width, `${metric.label} width`).toBeLessThanOrEqual(40);
    }

    for (const gap of buttonLayout.gaps) {
      expect(gap).toBeLessThanOrEqual(8);
    }
  });
});
