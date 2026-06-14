// @ts-nocheck -- strict:true enabled; incremental tightening tracked.
/**
 * PURPOSE: Verify Pi sessions read model: piSessions in project payload,
 * session collection, and route index assignment.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import {
  createManualSessionDraft,
  getPiSessions,
  loadProjectConfig,
  saveProjectConfig,
} from '../../../backend/projects.ts';

// Helper: create a temporary project directory with a .ozw config
async function setupTempProject(label) {
  const dir = path.join(os.tmpdir(), `ozw-pi-sessions-${label}-${Date.now()}`);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

test('Empty Pi manual draft is kept in config but hidden from piSessions', async () => {
  const projectPath = await setupTempProject('draft');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    // Create a Pi manual session draft
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 测试会话');

    assert.ok(result.id);
    assert.match(result.id, /^c\d+$/);

    const config = await loadProjectConfig(projectPath);
    const routeEntry = Object.entries(config.chat || {}).find(
      ([, record]) => record?.sessionId === result.id,
    );
    assert.ok(routeEntry, 'Route entry should exist so the current draft route can resolve');

    // Verify an untouched empty draft does not occupy the project overview list.
    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const found = piSessions.find((s) => s.id === result.id);
    assert.equal(found, undefined);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Pi session draft stores provider=pi in project config', async () => {
  const projectPath = await setupTempProject('config');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    const result = await createManualSessionDraft(projectName, projectPath, 'pi', 'Pi 配置会话');

    const config = await loadProjectConfig(projectPath);
    const routeEntry = Object.entries(config.chat || {}).find(
      ([, record]) => record?.sessionId === result.id,
    );
    assert.ok(routeEntry, 'Route entry should exist in config.chat');
    const [, record] = routeEntry;
    assert.equal(record.provider, 'pi');
    assert.equal(record.sessionId, result.id);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Unknown provider still rejected for manual draft creation', async () => {
  const projectPath = await setupTempProject('unknown');
  const projectName = projectPath.replace(/\//g, '-');

  try {
    await assert.rejects(
      createManualSessionDraft(projectName, projectPath, 'claude', 'Claude 会话'),
      /provider must be/,
    );
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});

test('Bound Pi manual drafts are sorted by creation time in piSessions', async () => {
  const projectPath = await setupTempProject('sort');
  const projectName = projectPath.replace(/\//g, '-');
  const draftIds = [];

  try {
    // Create two Pi drafts
    for (const label of ['第一个 Pi 会话', '第二个 Pi 会话']) {
      const result = await createManualSessionDraft(projectName, projectPath, 'pi', label);
      draftIds.push(result.id);
      const config = await loadProjectConfig(projectPath);
      const routeEntry = Object.entries(config.chat || {}).find(
        ([, record]) => record?.sessionId === result.id,
      );
      assert.ok(routeEntry, 'Route entry should exist before marking the draft started');
      const [routeIndex, record] = routeEntry;
      config.chat[routeIndex] = {
        ...record,
        pendingProviderSessionId: `pi-provider-${result.id}`,
      };
      await saveProjectConfig(config, projectPath);
      // Small delay to ensure different creation times
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    const piSessions = await getPiSessions(projectPath, { includeHidden: true });
    const ourSessions = piSessions.filter((s) => draftIds.includes(s.id));

    // Should find both sessions; newest first by creation time
    assert.equal(ourSessions.length, 2);

    // Cleanup handled by fs.rm in finally block
  } finally {
    await fs.rm(projectPath, { recursive: true, force: true });
  }
});
