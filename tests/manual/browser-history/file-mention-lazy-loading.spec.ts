/**
 * PURPOSE: Verify opening a real chat session does not preload the entire
 * repository file tree; file mention data should load only after user intent.
 */
import { expect, test } from '@playwright/test';

const baseUrl = process.env.CBW_BASE_URL || 'http://localhost:5174';

type ProjectSession = {
  id?: string;
  routeIndex?: number;
  __provider?: string;
  provider?: string;
};

type ProjectPayload = {
  name: string;
  routePath?: string;
  codexSessions?: ProjectSession[];
  piSessions?: ProjectSession[];
};

test('chat session does not request project files until user opens file mentions', async ({ page }) => {
  const projectsResponse = await page.request.get(`${baseUrl}/api/projects`);
  expect(projectsResponse.ok()).toBeTruthy();
  const projects = await projectsResponse.json() as ProjectPayload[];

  const project = projects.find((candidate) => (
    [...(candidate.codexSessions || []), ...(candidate.piSessions || [])]
      .some((session) => Number.isInteger(Number(session.routeIndex)))
  ));
  expect(project, 'fixture requires at least one real project session').toBeTruthy();

  const session = [...(project!.codexSessions || []), ...(project!.piSessions || [])]
    .find((candidate) => Number.isInteger(Number(candidate.routeIndex)));
  expect(session, 'fixture requires a route-indexed session').toBeTruthy();

  const filesRequests: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/\/api\/projects\/[^/]+\/files(?:\?|$)/.test(url)) {
      filesRequests.push(url);
    }
  });

  const sessionRoute = `${project!.routePath || `/projects/${encodeURIComponent(project!.name)}`}/c${Number(session!.routeIndex)}`;
  await page.goto(`${baseUrl}${sessionRoute}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-testid="chat-scroll-container"]', { timeout: 15000 });
  await page.waitForTimeout(2500);

  expect(
    filesRequests,
    'opening a chat session must not preload the full project file tree',
  ).toEqual([]);

  await page.getByTitle(/Insert project file|插入项目文件/).click();
  await page.waitForTimeout(1000);

  expect(filesRequests.length, 'opening file mentions should be the first time file data is requested').toBeGreaterThan(0);
  const firstRequest = new URL(filesRequests[0]);
  expect(
    firstRequest.searchParams.has('depth') || firstRequest.pathname.includes('/search'),
    `file mention request must be bounded by depth or routed through search: ${filesRequests[0]}`,
  ).toBeTruthy();
  if (firstRequest.searchParams.has('showHidden')) {
    expect(firstRequest.searchParams.get('showHidden')).toBe('false');
  }
});
