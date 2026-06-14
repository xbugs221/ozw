import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

interface SessionEntry {
  id: string;
  hidden?: boolean;
  archived?: boolean;
  status?: string;
  visibilityReason?: string;
}

async function main() {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-session-visibility-'));
  process.env.HOME = tempHome;

  const existingProjectPath = path.join(tempHome, 'workspace', 'existing-project');
  const missingProjectPath = path.join(tempHome, 'workspace', 'missing-project');

  await fs.mkdir(existingProjectPath, { recursive: true });

  const projectName = 'tmp-project';
  const projectDir = path.join(tempHome, '.claude', 'projects', projectName);
  await fs.mkdir(projectDir, { recursive: true });

  const sessionFile = path.join(projectDir, 'sessions.jsonl');
  const now = new Date();
  const lines = [
    JSON.stringify({
      sessionId: 'session-existing',
      timestamp: new Date(now.getTime() - 10_000).toISOString(),
      cwd: existingProjectPath,
      message: { role: 'user', content: 'hello existing project' }
    }),
    JSON.stringify({
      sessionId: 'session-existing',
      timestamp: new Date(now.getTime() - 8_000).toISOString(),
      cwd: existingProjectPath,
      type: 'summary',
      summary: 'Existing session'
    }),
    JSON.stringify({
      sessionId: 'session-missing',
      timestamp: new Date(now.getTime() - 6_000).toISOString(),
      cwd: missingProjectPath,
      message: { role: 'user', content: 'hello missing project' }
    }),
    JSON.stringify({
      sessionId: 'session-missing',
      timestamp: new Date(now.getTime() - 4_000).toISOString(),
      cwd: missingProjectPath,
      type: 'summary',
      summary: 'Missing session'
    })
  ];

  await fs.writeFile(sessionFile, `${lines.join('\n')}\n`, 'utf8');

  const projectsModule = await import('../backend/projects.js');
  const { getSessions, refreshMissingProjectPathCache } = projectsModule;

  const visibleOnly = await getSessions(projectName, 10, 0);
  assert.equal(visibleOnly.sessions.length, 1, 'default sessions result should hide missing-path sessions');
  assert.equal((visibleOnly.sessions[0] as any).id, 'session-existing');

  const withHidden = await getSessions(projectName, 10, 0, { includeHidden: true });
  assert.equal(withHidden.sessions.length, 2, 'includeHidden should return all sessions');

  const missingSession = (withHidden.sessions as any[]).find((session: any) => session.id === 'session-missing');
  assert.ok(missingSession, 'missing session should be present when includeHidden=true');
  assert.equal(missingSession.hidden, true);
  assert.equal(missingSession.archived, true);
  assert.equal(missingSession.status, 'archived');
  assert.equal(missingSession.visibilityReason, 'missing_project_path');

  const scanStats = await refreshMissingProjectPathCache({ logger: console });
  assert.ok(scanStats.missingPaths >= 1, 'startup scan should detect at least one missing path');

  console.log('[verify-missing-session-visibility] PASS');
  console.log(JSON.stringify(scanStats));
}

main().catch((error) => {
  console.error('[verify-missing-session-visibility] FAIL');
  console.error(error);
  process.exitCode = 1;
});
