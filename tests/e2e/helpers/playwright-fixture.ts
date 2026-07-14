// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Build an isolated HOME fixture for Playwright end-to-end runs.
 * The fixture keeps e2e independent from the developer's real Codex history,
 * auth database, and long-running local CCUI instances.
 */
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { resolveFlowRunStatePath } from '../../../backend/domains/workflows/flow-runtime-paths.ts';
import { getProjectLocalConfigPath } from '../../../backend/project-config-store.ts';

const FIXTURE_ROOT = path.join(process.cwd(), '.tmp', 'playwright-home');
const FIXTURE_STATE_HOME = path.join(process.cwd(), '.tmp', 'playwright-state-home');
const AUTH_DB_PATH = path.join(FIXTURE_ROOT, '.ozw', 'auth.db');
const INIT_SQL_PATH = path.join(process.cwd(), 'backend', 'database', 'init.sql');
const PROJECT_CONF_PATH = path.join(FIXTURE_ROOT, 'workspace', 'fixture-project', '.ozw', 'conf.json');

const FIXTURE_PROJECTS = [
  {
    label: 'fixture-project',
    path: path.join(FIXTURE_ROOT, 'workspace', 'fixture-project'),
    sessionId: 'fixture-project-session',
    userMessage: 'fixture-project session',
  },
  {
    label: 'alpha',
    path: path.join(FIXTURE_ROOT, 'workspace', 'alpha'),
    sessionId: 'fixture-alpha-session',
    userMessage: 'alpha fixture session',
  },
  {
    label: '.fixture-project',
    path: path.join(FIXTURE_ROOT, 'workspace', '.fixture-project'),
    sessionId: 'fixture-dot-project-session',
    userMessage: 'dot fixture-project session',
  },
  {
    label: 'matx',
    path: path.join(FIXTURE_ROOT, 'workspace', 'matx'),
    sessionId: 'fixture-matx-parent-session',
    userMessage: 'matx parent fixture session',
  },
  {
    label: 'matx-worktree',
    path: path.join(FIXTURE_ROOT, 'workspace', 'matx', '.worktrees', 'refactor-relocate-tests-out-of-src'),
    sessionId: 'fixture-matx-worktree-session',
    userMessage: 'matx worktree fixture session',
  },
  {
    label: 'history-scroll',
    path: path.join(FIXTURE_ROOT, 'workspace', 'history-scroll'),
    sessionId: 'fixture-history-scroll-session',
    userMessage: 'history scroll fixture session',
    messagePairs: 80,
  },
  {
    label: 'zeta',
    path: path.join(FIXTURE_ROOT, 'workspace', 'zeta'),
    sessionId: 'fixture-zeta-session',
    userMessage: 'zeta fixture session',
  },
];

const FIXTURE_PROJECT_EXTRA_SESSIONS = [
  {
    projectLabel: 'fixture-project',
    sessionId: 'fixture-project-manual-session',
    userMessage: 'fixture-project manual-only session',
    baseTimestamp: '2026-04-19T11:30:00.000Z',
  },
  {
    projectLabel: 'fixture-project',
    sessionId: 'fixture-project-execution-session',
    userMessage: 'fixture-project execution fixture session',
    baseTimestamp: '2026-04-18T09:00:00.000Z',
  },
  {
    projectLabel: 'fixture-project',
    sessionId: 'legacy-active-handoff-acceptance',
    userMessage: 'Legacy active handoff acceptance',
    baseTimestamp: '2026-04-18T08:30:00.000Z',
  },
  {
    projectLabel: 'history-scroll',
    sessionId: 'fixture-mixed-long-virtual-session',
    userMessage: 'mixed long virtual',
    messagePairs: 1050,
    baseTimestamp: '2026-04-17T08:00:00.000Z',
  },
  {
    projectLabel: 'history-scroll',
    sessionId: 'fixture-folded-bootstrap-session',
    userMessage: 'folded bootstrap fixture',
    baseTimestamp: '2026-04-16T08:00:00.000Z',
    foldedLongTurn: true,
  },
  {
    projectLabel: 'history-scroll',
    sessionId: 'fixture-filtered-window-session',
    userMessage: 'filtered window fixture',
    baseTimestamp: '2026-04-15T08:00:00.000Z',
    filteredWindow: true,
  },
  {
    projectLabel: 'history-scroll',
    sessionId: 'fixture-filtered-tail-session',
    userMessage: 'filtered tail fixture',
    baseTimestamp: '2026-04-14T08:00:00.000Z',
    filteredTail: true,
  },
];

/**
 * Build a large Markdown code block that must render through the lazy code summary.
 *
 * @param {string} userMessage
 * @returns {string}
 */
function buildLongVirtualCodeBlock(userMessage) {
  const lines = Array.from({ length: 96 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, '0');
    return `const virtualCodeLine${lineNumber} = "mixed long virtual full code line ${lineNumber}";`;
  });
  return [
    `${userMessage} markdown turn 1050`,
    '',
    '```ts',
    ...lines,
    '```',
  ].join('\n');
}

/**
 * Build a large edit payload that must render through DiffViewer's lazy summary.
 *
 * @returns {{old_string: string, new_string: string, file_path: string}}
 */
function buildLongVirtualEditInput() {
  const oldLines = Array.from({ length: 220 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, '0');
    return `old virtual diff line ${lineNumber}`;
  });
  const newLines = Array.from({ length: 220 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, '0');
    return index === 219
      ? 'new virtual diff final hidden line 220'
      : `new virtual diff line ${lineNumber}`;
  });
  return {
    file_path: 'src/virtual-long-diff.ts',
    old_string: oldLines.join('\n'),
    new_string: newLines.join('\n'),
  };
}

/**
 * Build a large tool output that must stay out of the DOM until its result is expanded.
 *
 * @returns {string}
 */
function buildLongVirtualToolOutput() {
  return Array.from({ length: 140 }, (_, index) => {
    const lineNumber = String(index + 1).padStart(3, '0');
    return index === 139
      ? 'mixed long virtual full tool output hidden line 140'
      : `mixed long virtual tool output line ${lineNumber}`;
  }).join('\n');
}

/**
 * Build child tool history for a Task/Agent subagent container.
 *
 * @param {string} timestamp
 * @returns {Array<Record<string, unknown>>}
 */
function buildLongVirtualSubagentTools(timestamp) {
  return Array.from({ length: 25 }, (_, index) => {
    const toolNumber = index + 1;
    return {
      toolId: `mixed-long-subagent-child-${toolNumber}`,
      toolName: toolNumber % 3 === 0 ? 'Edit' : 'Bash',
      toolInput: toolNumber % 3 === 0
        ? {
            file_path: `src/subagent-${toolNumber}.ts`,
            old_string: `old child ${toolNumber}`,
            new_string: `new child ${toolNumber}`,
          }
        : { command: `printf "subagent child ${toolNumber}"` },
      toolResult: {
        content: toolNumber === 25
          ? 'mixed long virtual subagent child hidden output 25'
          : `mixed long virtual subagent child output ${toolNumber}`,
        isError: false,
      },
      timestamp,
    };
  });
}

/**
 * Write a minimal Codex session JSONL file that project discovery can parse quickly.
 * @param {string} projectPath - Absolute project path.
 * @param {string} sessionId - Synthetic session ID.
 * @param {string} userMessage - Session summary source text.
 * @param {number} messagePairs - Number of user/assistant turns to write.
 * @param {boolean} isActive - Whether to stamp the fixture as recently active.
 * @param {string | null} baseTimestamp - Optional fixed ISO timestamp for deterministic ordering.
 */
function writeCodexSessionFixture(projectPath, sessionId, userMessage, messagePairs = 1, isActive = false, baseTimestamp = null) {
  const sessionDir = path.join(FIXTURE_ROOT, '.codex', 'sessions', '2026', '04', '19');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const sessionLines = [];

  fs.mkdirSync(sessionDir, { recursive: true });
  sessionLines.push(JSON.stringify({
    type: 'session_meta',
    timestamp: baseTimestamp || new Date(Date.UTC(2026, 3, 19, 10, 0, 0)).toISOString(),
    payload: {
      id: sessionId,
      cwd: projectPath,
      model: 'gpt-5-codex',
    },
  }));

  for (let index = 0; index < messagePairs; index += 1) {
    const pairNumber = index + 1;
    const baseTimeMs = baseTimestamp ? new Date(baseTimestamp).getTime() : null;
    const timestamp = Number.isFinite(baseTimeMs)
      ? new Date(baseTimeMs - index * 60 * 1000).toISOString()
      : isActive
        ? new Date(Date.now() - index * 60 * 1000).toISOString()
        : new Date(Date.UTC(2026, 2, 28, 16, 10 + index, 0)).toISOString();
    const userContent = index === 0
      ? userMessage
      : `${userMessage} history turn ${String(pairNumber).padStart(2, '0')}`;

    sessionLines.push(JSON.stringify({
      type: 'event_msg',
      timestamp,
      payload: {
        type: 'user_message',
        message: userContent,
      },
    }));

    let assistantContent = `${userMessage} assistant turn ${String(pairNumber).padStart(2, '0')}`;
    if (messagePairs > 1000) {
      const longTurn = String(pairNumber).padStart(4, '0');
      assistantContent = `${userMessage} assistant turn ${longTurn}`;
      if (pairNumber === 520) {
        assistantContent = 'mixed long virtual target needle 520 inside a virtualized offscreen message';
      } else if (pairNumber % 25 === 0) {
        assistantContent = pairNumber === 1050
          ? buildLongVirtualCodeBlock(userMessage)
          : [
              `${userMessage} markdown turn ${longTurn}`,
              '',
              '```ts',
              `const turn${pairNumber} = ${pairNumber};`,
              '```',
            ].join('\n');
      } else if (pairNumber % 40 === 0) {
        assistantContent = `${userMessage} diff turn ${longTurn}\n--- old\n+++ new\n+added line ${pairNumber}`;
      } else if (pairNumber % 55 === 0) {
        assistantContent = `${userMessage} tool output turn ${longTurn}\n${'output line\n'.repeat(20)}`;
      }
    }

    sessionLines.push(JSON.stringify({
      type: 'response_item',
      timestamp: new Date(new Date(timestamp).getTime() + 1000).toISOString(),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: assistantContent }],
      },
    }));

    if (messagePairs > 1000 && pairNumber === 1048) {
      const toolTimestamp = new Date(new Date(timestamp).getTime() + 2000).toISOString();
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: toolTimestamp,
        payload: {
          type: 'function_call',
          call_id: `${sessionId}-long-diff`,
          name: 'Edit',
          arguments: JSON.stringify(buildLongVirtualEditInput()),
        },
      }));
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: new Date(new Date(timestamp).getTime() + 3000).toISOString(),
        payload: {
          type: 'function_call_output',
          call_id: `${sessionId}-long-diff`,
          output: 'edit complete',
        },
      }));
    }

    if (messagePairs > 1000 && pairNumber === 1049) {
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: new Date(new Date(timestamp).getTime() + 2000).toISOString(),
        payload: {
          type: 'function_call',
          call_id: `${sessionId}-long-output`,
          name: 'write_stdin',
          arguments: JSON.stringify({ session_id: 'mixed-long-output', chars: 'run long output' }),
        },
      }));
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: new Date(new Date(timestamp).getTime() + 3000).toISOString(),
        payload: {
          type: 'function_call_output',
          call_id: `${sessionId}-long-output`,
          output: buildLongVirtualToolOutput(),
        },
      }));
    }

    if (messagePairs > 1000 && pairNumber === 1050) {
      const subagentTimestamp = new Date(new Date(timestamp).getTime() + 2000).toISOString();
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: subagentTimestamp,
        payload: {
          type: 'function_call',
          call_id: `${sessionId}-subagent`,
          name: 'Task',
          arguments: JSON.stringify({
            subagent_type: 'Agent',
            description: 'Deep virtual audit',
            prompt: 'Review the long virtual transcript without mounting every child row.',
          }),
        },
      }));
      sessionLines.push(JSON.stringify({
        type: 'response_item',
        timestamp: new Date(new Date(timestamp).getTime() + 3000).toISOString(),
        payload: {
          type: 'function_call_output',
          call_id: `${sessionId}-subagent`,
          output: 'subagent complete',
          subagentTools: buildLongVirtualSubagentTools(subagentTimestamp),
        },
      }));
    }
  }

  fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
  fs.writeFileSync(sessionPath, `${sessionLines.join('\n')}\n`, 'utf8');
}

/**
 * Write one turn whose folded tool rows consume more than the newest raw page.
 * @param {string} projectPath - Absolute project path.
 * @param {string} sessionId - Synthetic session ID.
 * @param {string} baseTimestamp - Stable fixture timestamp.
 */
function writeFoldedBootstrapSessionFixture(projectPath, sessionId, baseTimestamp) {
  /** The newest 50 JSONL rows intentionally contain no turn boundary. */
  const sessionDir = path.join(FIXTURE_ROOT, '.codex', 'sessions', '2026', '04', '19');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const baseTime = new Date(baseTimestamp).getTime();
  const sessionLines = [JSON.stringify({
    type: 'session_meta',
    timestamp: baseTimestamp,
    payload: { id: sessionId, cwd: projectPath, model: 'gpt-5-codex' },
  })];

  for (let index = 0; index < 30; index += 1) {
    sessionLines.push(JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(baseTime - 60000 + index * 1000).toISOString(),
      payload: { type: 'user_message', message: `folded bootstrap older user ${index + 1}` },
    }));
    sessionLines.push(JSON.stringify({
      type: 'response_item',
      timestamp: new Date(baseTime - 59500 + index * 1000).toISOString(),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `folded bootstrap older assistant ${index + 1}` }],
      },
    }));
  }

  sessionLines.push(JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(baseTime + 1000).toISOString(),
    payload: { type: 'user_message', message: 'folded bootstrap fixture user turn' },
  }));

  for (let index = 0; index < 60; index += 1) {
    const callId = `${sessionId}-tool-${index + 1}`;
    sessionLines.push(JSON.stringify({
      type: 'response_item',
      timestamp: new Date(baseTime + 2000 + index * 2000).toISOString(),
      payload: {
        type: 'function_call',
        call_id: callId,
        name: 'exec_command',
        arguments: JSON.stringify({ command: `folded bootstrap command ${index + 1}` }),
      },
    }));
    sessionLines.push(JSON.stringify({
      type: 'response_item',
      timestamp: new Date(baseTime + 3000 + index * 2000).toISOString(),
      payload: {
        type: 'function_call_output',
        call_id: callId,
        output: `folded bootstrap output ${index + 1}`,
      },
    }));
  }
  sessionLines.push(JSON.stringify({
    type: 'response_item',
    timestamp: new Date(baseTime + 123000).toISOString(),
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'folded bootstrap latest assistant message' }],
    },
  }));

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${sessionLines.join('\n')}\n`, 'utf8');
}

/**
 * Write a transcript with one fully filtered raw page between visible history pages.
 * @param {string} projectPath - Absolute project path.
 * @param {string} sessionId - Synthetic session ID.
 * @param {string} baseTimestamp - Stable fixture timestamp.
 */
function writeFilteredWindowSessionFixture(projectPath, sessionId, baseTimestamp) {
  /** Raw lines 4-53 are routine task_complete records and intentionally map to no UI rows. */
  const sessionDir = path.join(FIXTURE_ROOT, '.codex', 'sessions', '2026', '04', '19');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const baseTime = new Date(baseTimestamp).getTime();
  const sessionLines = [JSON.stringify({
    type: 'session_meta',
    timestamp: baseTimestamp,
    payload: { id: sessionId, cwd: projectPath, model: 'gpt-5-codex' },
  }), JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(baseTime + 1000).toISOString(),
    payload: { type: 'user_message', message: 'filtered window oldest user target' },
  }), JSON.stringify({
    type: 'response_item',
    timestamp: new Date(baseTime + 2000).toISOString(),
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'filtered window oldest assistant target' }],
    },
  })];

  for (let index = 0; index < 50; index += 1) {
    sessionLines.push(JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(baseTime + 3000 + index * 1000).toISOString(),
      payload: {
        type: 'task_complete',
        turn_id: `routine-filtered-turn-${index + 1}`,
        last_agent_message: `routine filtered completion ${index + 1}`,
      },
    }));
  }

  for (let index = 0; index < 25; index += 1) {
    const turn = index + 1;
    sessionLines.push(JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(baseTime + 53000 + index * 2000).toISOString(),
      payload: { type: 'user_message', message: `filtered window newest user ${turn}` },
    }));
    sessionLines.push(JSON.stringify({
      type: 'response_item',
      timestamp: new Date(baseTime + 54000 + index * 2000).toISOString(),
      payload: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: `filtered window newest assistant ${turn}` }],
      },
    }));
  }

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${sessionLines.join('\n')}\n`, 'utf8');
}

/**
 * Write a transcript whose newest raw page contains no displayable messages.
 * @param {string} projectPath - Absolute project path.
 * @param {string} sessionId - Synthetic session ID.
 * @param {string} baseTimestamp - Stable fixture timestamp.
 */
function writeFilteredTailSessionFixture(projectPath, sessionId, baseTimestamp) {
  /** Offset zero consumes 50 routine task completions before offset 50 reaches visible history. */
  const sessionDir = path.join(FIXTURE_ROOT, '.codex', 'sessions', '2026', '04', '19');
  const sessionPath = path.join(sessionDir, `${sessionId}.jsonl`);
  const baseTime = new Date(baseTimestamp).getTime();
  const sessionLines = [JSON.stringify({
    type: 'session_meta',
    timestamp: baseTimestamp,
    payload: { id: sessionId, cwd: projectPath, model: 'gpt-5-codex' },
  }), JSON.stringify({
    type: 'event_msg',
    timestamp: new Date(baseTime + 1000).toISOString(),
    payload: { type: 'user_message', message: 'filtered tail visible user target' },
  }), JSON.stringify({
    type: 'response_item',
    timestamp: new Date(baseTime + 2000).toISOString(),
    payload: {
      type: 'message',
      role: 'assistant',
      content: [{ type: 'output_text', text: 'filtered tail visible assistant target' }],
    },
  })];

  for (let index = 0; index < 50; index += 1) {
    sessionLines.push(JSON.stringify({
      type: 'event_msg',
      timestamp: new Date(baseTime + 3000 + index * 1000).toISOString(),
      payload: {
        type: 'task_complete',
        turn_id: `routine-tail-turn-${index + 1}`,
        last_agent_message: `routine tail completion ${index + 1}`,
      },
    }));
  }

  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(sessionPath, `${sessionLines.join('\n')}\n`, 'utf8');
}

function writeManualProjectConfigFixture() {
  const legacyConfigPath = path.join(FIXTURE_ROOT, '.ozw', 'conf.json');
  const stateConfigPath = path.join(FIXTURE_STATE_HOME, 'ozw', 'conf.json');
  const config = {};
  const nextRouteIndexByProject = new Map();

  const nextRouteIndex = (projectLabel) => {
    const next = (nextRouteIndexByProject.get(projectLabel) || 0) + 1;
    nextRouteIndexByProject.set(projectLabel, next);
    return next;
  };

  const addChatRoute = (projectConfig, projectLabel, sessionId, title) => {
    const routeIndex = nextRouteIndex(projectLabel);
    projectConfig.chat ||= {};
    projectConfig.chat[String(routeIndex)] = {
      sessionId,
      title,
      provider: 'codex',
      providerSessionId: sessionId,
      origin: 'manual',
    };
    projectConfig.manualSessionNextRouteIndex = Math.max(
      Number(projectConfig.manualSessionNextRouteIndex || 0),
      routeIndex,
    );
  };

  for (const project of FIXTURE_PROJECTS) {
    const projectName = project.path.replace(/[\\/:\s~_]/g, '-');
    config[projectName] = {
      manuallyAdded: true,
      originalPath: project.path,
      displayName: project.label,
    };
  }

  for (const extraSession of FIXTURE_PROJECT_EXTRA_SESSIONS) {
    const project = FIXTURE_PROJECTS.find((entry) => entry.label === extraSession.projectLabel);
    if (!project) {
      continue;
    }
    const projectName = project.path.replace(/[\\/:\s~_]/g, '-');
    addChatRoute(
      config[projectName],
      project.label,
      extraSession.sessionId,
      extraSession.userMessage,
    );
  }

  for (const configPath of [legacyConfigPath, stateConfigPath]) {
    fs.mkdirSync(path.dirname(configPath), { recursive: true });
    fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  }

  for (const project of FIXTURE_PROJECTS) {
    const projectName = project.path.replace(/[\\/:\s~_]/g, '-');
    const localConfigPath = getProjectLocalConfigPath(project.path);
    fs.mkdirSync(path.dirname(localConfigPath), { recursive: true });
    fs.writeFileSync(localConfigPath, `${JSON.stringify(config[projectName] || {}, null, 2)}\n`, 'utf8');
  }
}

/**
 * Create an auth database with one active user for local token generation.
 * Retries with backoff on transient SQLite I/O errors (disk I/O, SQLITE_BUSY)
 * that can occur when a stale test-server process still holds the DB file open.
 */
function writeAuthDatabaseFixture() {
  const initSql = fs.readFileSync(INIT_SQL_PATH, 'utf8');

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      fs.mkdirSync(path.dirname(AUTH_DB_PATH), { recursive: true });
      const db = new Database(AUTH_DB_PATH);

      try {
        db.exec(initSql);
        db.prepare(
          `
            INSERT OR IGNORE INTO users (
              username,
              password_hash,
              is_active,
              has_completed_onboarding
            ) VALUES (?, ?, 1, 1)
          `,
        ).run('playwright-user', 'playwright-password-hash');
      } finally {
        db.close();
      }

      return; // success
    } catch (error) {
      if (attempt === 4) throw error;
      // Transient SQLite error (disk I/O, busy) — wait and retry.
      const delayMs = (attempt + 1) * 500;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }
}

/**
 * Persist one project-local workflow fixture used by project-workflow acceptance tests.
 */
function writeWorkflowStoreFixture() {
  fs.mkdirSync(path.dirname(PROJECT_CONF_PATH), { recursive: true });
  const fixtureProjectPath = FIXTURE_PROJECTS.find((project) => project.label === 'fixture-project')?.path;
  if (!fixtureProjectPath) {
    return;
  }

  fs.mkdirSync(path.join(fixtureProjectPath, 'workflow-output'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'notes'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'assets'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'data'), { recursive: true });
  fs.mkdirSync(path.join(fixtureProjectPath, 'images'), { recursive: true });
  fs.writeFileSync(path.join(fixtureProjectPath, 'notes', 'todo.md'), '# TODO\n', 'utf8');
  fs.writeFileSync(
    path.join(fixtureProjectPath, 'notes', 'boundary.md'),
    `${'a'.repeat(8191)}中\n\n# 边界标题\n\n这是一段中文正文。\n`,
    'utf8',
  );
  fs.writeFileSync(path.join(fixtureProjectPath, 'assets', 'manual.pdf'), Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0xff, 0x0a]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'assets', 'archive.bin'), Buffer.from([0x10, 0x00, 0xff, 0x7f, 0x42, 0x24]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'data', 'weird.dat'), Buffer.from([0x48, 0x49, 0x00, 0x41, 0x42, 0x43]));
  fs.writeFileSync(path.join(fixtureProjectPath, 'images', 'pixel.png'), Buffer.from('iVBORw0KGgo=', 'base64'));
  fs.writeFileSync(path.join(fixtureProjectPath, 'SUMMARY.md'), '# Workflow summary fixture\n', 'utf8');
  fs.writeFileSync(path.join(fixtureProjectPath, 'workflow-output', 'result.txt'), 'workflow artifact folder fixture\n', 'utf8');
  const fixtureRunStatePath = resolveFlowRunStatePath(fixtureProjectPath, 'run-fixture');
  fs.mkdirSync(path.join(path.dirname(fixtureRunStatePath), 'logs'), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(fixtureRunStatePath), 'logs', 'executor.log'), 'executor log fixture\n', 'utf8');
  fs.writeFileSync(fixtureRunStatePath, `${JSON.stringify({
    run_id: 'run-fixture',
    change_name: '登录升级',
    status: 'running',
    stage: 'review_1',
    stages: {
      planning: 'completed',
      execution: 'completed',
      review_1: 'running',
    },
    paths: {
      executor_log: '.wo/runs/run-fixture/logs/executor.log',
      summary: 'SUMMARY.md',
      workflow_output: 'workflow-output',
    },
    sessions: {
      'codex:planner': 'fixture-project-session',
      'codex:executor': 'fixture-project-execution-session',
    },
    processes: [
      {
        stage: 'planning',
        role: 'executor',
        status: 'completed',
        sessionId: 'fixture-project-session',
      },
      {
        stage: 'execution',
        role: 'executor',
        status: 'completed',
        sessionId: 'fixture-project-execution-session',
        pid: 4321,
        logPath: '.wo/runs/run-fixture/logs/executor.log',
      },
    ],
  }, null, 2)}\n`, 'utf8');

  fs.writeFileSync(
    PROJECT_CONF_PATH,
    `${JSON.stringify({
      schemaVersion: 2,
    }, null, 2)}\n`,
    'utf8',
  );
}

/**
 * Prepare the isolated Playwright fixture tree.
 * @param {{ preserveAuthDatabase?: boolean }} [options]
 * @returns {{ homeDir: string, authDbPath: string, projectPaths: string[] }} Fixture metadata.
 */
export function ensurePlaywrightFixture(options = {}) {
  /**
   * Auth DB can already be open by the Playwright process or web server. Preserve
   * it during per-test fixture resets so sqlite never writes to an unlinked file.
   */
  if (options.preserveAuthDatabase === true) {
    fs.rmSync(path.join(FIXTURE_ROOT, 'workspace'), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(path.join(FIXTURE_ROOT, '.codex'), { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(FIXTURE_STATE_HOME, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  } else {
    fs.rmSync(FIXTURE_ROOT, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
    fs.rmSync(FIXTURE_STATE_HOME, { recursive: true, force: true, maxRetries: 3, retryDelay: 50 });
  }
  process.env.XDG_STATE_HOME = FIXTURE_STATE_HOME;
  fs.mkdirSync(FIXTURE_ROOT, { recursive: true });
  fs.writeFileSync(path.join(FIXTURE_ROOT, '.bashrc'), '# Playwright fixture shell startup\n', 'utf8');
  fs.writeFileSync(path.join(FIXTURE_ROOT, '.zshrc'), '# Playwright fixture shell startup\n', 'utf8');

  for (const project of FIXTURE_PROJECTS) {
    fs.mkdirSync(project.path, { recursive: true });
    writeCodexSessionFixture(
      project.path,
      project.sessionId,
      project.userMessage,
      project.messagePairs || 1,
      project.label === 'fixture-project',
      project.label === 'fixture-project' ? '2026-04-19T10:00:00.000Z' : null,
    );
  }

  for (const extraSession of FIXTURE_PROJECT_EXTRA_SESSIONS) {
    const project = FIXTURE_PROJECTS.find((entry) => entry.label === extraSession.projectLabel);
    if (!project) {
      continue;
    }
    if (extraSession.filteredTail) {
      writeFilteredTailSessionFixture(project.path, extraSession.sessionId, extraSession.baseTimestamp);
    } else if (extraSession.filteredWindow) {
      writeFilteredWindowSessionFixture(project.path, extraSession.sessionId, extraSession.baseTimestamp);
    } else if (extraSession.foldedLongTurn) {
      writeFoldedBootstrapSessionFixture(project.path, extraSession.sessionId, extraSession.baseTimestamp);
    } else {
      writeCodexSessionFixture(
        project.path,
        extraSession.sessionId,
        extraSession.userMessage,
        extraSession.messagePairs || 1,
        false,
        extraSession.baseTimestamp,
      );
    }
  }

  if (options.preserveAuthDatabase !== true) {
    writeAuthDatabaseFixture();
  }
  writeManualProjectConfigFixture();
  writeWorkflowStoreFixture();

  return {
    homeDir: FIXTURE_ROOT,
    authDbPath: AUTH_DB_PATH,
    projectPaths: FIXTURE_PROJECTS.map((project) => project.path),
  };
}

export const PLAYWRIGHT_FIXTURE_HOME = FIXTURE_ROOT;
export const PLAYWRIGHT_FIXTURE_AUTH_DB = AUTH_DB_PATH;
export const PLAYWRIGHT_FIXTURE_PROJECT_PATHS = FIXTURE_PROJECTS.map((project) => project.path);
export const PLAYWRIGHT_FIXTURE_SESSION_IDS = FIXTURE_PROJECTS.map((project) => project.sessionId);
