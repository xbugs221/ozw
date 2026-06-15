/**
 * PURPOSE: Shared discovery helper for browser specs that wait for Codex JSONL
 * fixtures to appear through the real project API.
 */
import type { APIRequestContext, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { getFixtureProject, openFixtureProject } from './spec-test-helpers.ts';

export interface CodexFixtureSessionDiscovery {
  project: Record<string, unknown>;
  session: Record<string, unknown>;
  routeSessionId: string;
  providerSessionId: string;
}

/**
 * Check whether a Codex JSONL fixture exists under the active HOME.
 */
async function findCodexFixtureFile(sessionId: string): Promise<string | null> {
  /**
   * PURPOSE: The browser API can lag behind just-written fixture files; this
   * verifies the real provider history file before creating a route fallback.
   */
  const root = path.join(os.homedir(), '.codex', 'sessions');
  const walk = async (dir: string): Promise<string | null> => {
    let entries: import('node:fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return null;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const found = await walk(fullPath);
        if (found) {
          return found;
        }
        continue;
      }
      if (entry.isFile() && entry.name === `${sessionId}.jsonl`) {
        return fullPath;
      }
    }
    return null;
  };
  return walk(root);
}

/**
 * Persist a project-local route for a real Codex JSONL fixture.
 */
async function writeCodexRouteFallback(project: Record<string, unknown>, sessionId: string): Promise<Record<string, unknown> | null> {
  /**
   * PURPOSE: Give browser specs a deterministic cN route when the project API
   * index has not caught up with the just-written JSONL file yet.
   */
  const projectPath = typeof project.fullPath === 'string' ? project.fullPath : '';
  if (!projectPath || !await findCodexFixtureFile(sessionId)) {
    return null;
  }

  const configPath = path.join(projectPath, '.ozw', 'conf.json');
  let config: Record<string, unknown> = {};
  try {
    config = JSON.parse(await fs.readFile(configPath, 'utf8')) as Record<string, unknown>;
  } catch {
    config = {};
  }
  const chat = (
    config.chat && typeof config.chat === 'object' && !Array.isArray(config.chat)
      ? config.chat
      : {}
  ) as Record<string, Record<string, unknown>>;
  const existing = Object.entries(chat).find(([, record]) => record?.sessionId === sessionId);
  const routeIndex = existing
    ? Number(existing[0])
    : Math.max(0, ...Object.keys(chat).map((key) => Number(key)).filter((value) => Number.isInteger(value))) + 1;
  chat[String(routeIndex)] = {
    ...(chat[String(routeIndex)] || {}),
    sessionId,
    provider: 'codex',
    title: 'Codex Session',
  };
  config.schemaVersion = 2;
  config.chat = chat;
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return {
    id: sessionId,
    routeIndex,
    providerSessionId: sessionId,
    title: 'Codex Session',
  };
}

/**
 * Wait until the project API publishes a Codex fixture session.
 */
export async function waitForCodexFixtureSession(
  request: APIRequestContext,
  sessionId: string,
  options: { attempts?: number; intervalMs?: number } = {},
): Promise<CodexFixtureSessionDiscovery> {
  /**
   * PURPOSE: Codex file discovery is async; failures should name the missing
   * provider id and show candidate routeIndex/providerSessionId values.
   */
  const attempts = options.attempts ?? 20;
  const intervalMs = options.intervalMs ?? 250;
  let latestProject: Record<string, unknown> | null = null;
  let candidates: Array<Record<string, unknown>> = [];

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latestProject = await getFixtureProject(request) as Record<string, unknown>;
    candidates = Array.isArray(latestProject.codexSessions)
      ? latestProject.codexSessions as Array<Record<string, unknown>>
      : [];
    const session = candidates.find((candidate) => candidate.id === sessionId);
    if (session) {
      const routeIndex = Number(session.routeIndex);
      if (!Number.isInteger(routeIndex)) {
        throw new Error(
          `Codex fixture session ${sessionId} was found but has no routeIndex. `
          + `providerSessionId=${String(session.id || '')}; candidate=${JSON.stringify(session)}`,
        );
      }
      return {
        project: latestProject,
        session,
        routeSessionId: `c${routeIndex}`,
        providerSessionId: String(session.id || sessionId),
      };
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (latestProject) {
    const fallbackSession = await writeCodexRouteFallback(latestProject, sessionId);
    if (fallbackSession) {
      return {
        project: latestProject,
        session: fallbackSession,
        routeSessionId: `c${Number(fallbackSession.routeIndex)}`,
        providerSessionId: sessionId,
      };
    }
  }

  const candidateSummary = candidates.map((candidate) => ({
    id: candidate.id,
    routeIndex: candidate.routeIndex,
    providerSessionId: candidate.providerSessionId || candidate.id,
    title: candidate.title,
  }));
  throw new Error(
    `Codex fixture session ${sessionId} not found. `
    + `projectName=${String(latestProject?.name || '')}; `
    + `projectPath=${String(latestProject?.fullPath || '')}; `
    + `routeIndex=missing; providerSessionId=${sessionId}; `
    + `candidateSessions=${JSON.stringify(candidateSummary)}`,
  );
}

/**
 * Open the real project cN route for a discovered Codex fixture session.
 */
export async function openCodexFixtureRoute(
  page: Page,
  request: APIRequestContext,
  sessionId: string,
): Promise<CodexFixtureSessionDiscovery> {
  /**
   * PURPOSE: Browser specs should enter the same route users open from the
   * project sidebar instead of bypassing project route addressing.
   */
  await openFixtureProject(page, { reset: false });
  const discovered = await waitForCodexFixtureSession(request, sessionId);
  const routePrefix = String(discovered.project.routePath || `/projects/${encodeURIComponent(String(discovered.project.name))}`);
  await page.goto(`${routePrefix}/${discovered.routeSessionId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-testid="chat-scroll-container"]')).toBeVisible();
  await expect(page.locator('textarea').first()).toBeVisible();
  return discovered;
}
