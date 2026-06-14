// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Cover ozw XDG state directory migration for project-local and
 * global config persistence. Verify config writes land in state repo directory,
 * legacy .ozw/conf.json files are ignored, and same-basename projects generate
 * distinct repo-keys.
 */
import assert from 'node:assert/strict';
import { describe, test, before, after } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import crypto from 'node:crypto';
import {
  getProjectLocalConfigPath,
  readProjectLocalConfig,
  readProjectLocalConfigFile,
  writeProjectLocalConfig,
  resolveCcflowStateRoot,
  resolveProjectStateKey,
} from '../../../backend/project-config-store.ts';

/**
 * Helper: set up a temp XDG_STATE_HOME and return cleanup function.
 */
async function setupTempStateHome() {
  const stateHome = await mkdtemp(join(tmpdir(), 'ozw-xdg-test-'));
  const originalXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = stateHome;
  return {
    stateHome,
    async cleanup() {
      if (originalXdg === undefined) {
        delete process.env.XDG_STATE_HOME;
      } else {
        process.env.XDG_STATE_HOME = originalXdg;
      }
      await rm(stateHome, { recursive: true, force: true });
    },
  };
}

/**
 * Helper: create old-style .ozw/conf.json in project directory.
 */
async function createOldProjectConfig(projectPath, config) {
  const oldDir = join(projectPath, '.ozw');
  await mkdir(oldDir, { recursive: true });
  await writeFile(join(oldDir, 'conf.json'), JSON.stringify(config, null, 2), 'utf8');
}

// ─── resolveCcflowStateRoot ────────────────────────────────────────────────

describe('resolveCcflowStateRoot', () => {
  test('returns XDG_STATE_HOME/ozw when env var is set', () => {
    const root = resolveCcflowStateRoot({ XDG_STATE_HOME: '/custom/state' });
    assert.equal(root, join('/custom/state', 'ozw'));
  });

  test('falls back to ~/.local/state/ozw when XDG_STATE_HOME is unset', () => {
    // When XDG_STATE_HOME is absent, os.homedir() is used as base.
    // Verifying the suffix pattern is sufficient to prove the fallback works.
    const root = resolveCcflowStateRoot({});
    assert.ok(root.endsWith(join('.local', 'state', 'ozw')), 'root must end with .local/state/ozw');
  });
});

// ─── resolveProjectStateKey ───────────────────────────────────────────────

describe('resolveProjectStateKey', () => {
  test('generates key from basename and sha1 of absolute path', () => {
    const projectPath = '/home/user/projects/my-repo';
    const key = resolveProjectStateKey(projectPath);
    const expectedHash = crypto.createHash('sha1').update(resolve('/home/user/projects/my-repo')).digest('hex').slice(0, 10);
    assert.equal(key, `my-repo-${expectedHash}`);
  });

  test('different absolute paths with same basename produce different keys', () => {
    const key1 = resolveProjectStateKey('/home/user/work/my-repo');
    const key2 = resolveProjectStateKey('/home/user/personal/my-repo');
    assert.notEqual(key1, key2);
  });

  test('same absolute path produces stable key', () => {
    const key1 = resolveProjectStateKey('/home/user/my-repo');
    const key2 = resolveProjectStateKey('/home/user/my-repo');
    assert.equal(key1, key2);
  });
});

// ─── getProjectLocalConfigPath ─────────────────────────────────────────────

describe('getProjectLocalConfigPath', () => {
  let env;

  before(async () => {
    env = await setupTempStateHome();
  });

  after(async () => {
    await env.cleanup();
  });

  test('project config path lives under state repos directory', () => {
    const projectPath = '/home/user/my-project';
    const configPath = getProjectLocalConfigPath(projectPath);
    const repoKey = resolveProjectStateKey(projectPath);
    const expected = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'repos', repoKey, 'conf.json');
    assert.equal(configPath, expected);
  });

  test('global config path lives directly under state root', () => {
    const configPath = getProjectLocalConfigPath('');
    const expected = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'conf.json');
    assert.equal(configPath, expected);
  });
});

// ─── writeProjectLocalConfig ──────────────────────────────────────────────

describe('writeProjectLocalConfig', () => {
  let env, projectPath;

  before(async () => {
    env = await setupTempStateHome();
    projectPath = await mkdtemp(join(tmpdir(), 'ozw-write-project-'));
  });

  after(async () => {
    await rm(projectPath, { recursive: true, force: true });
    await env.cleanup();
  });

  test('writes config to state repo directory, not project .ozw', async () => {
    const config = { schemaVersion: 2, sessions: { c1: { route: '/c1' } } };
    await writeProjectLocalConfig(projectPath, config);

    // Config should exist in state repos directory
    const repoKey = resolveProjectStateKey(projectPath);
    const stateConfigPath = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'repos', repoKey, 'conf.json');
    const raw = await readFile(stateConfigPath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.deepEqual(parsed, config);

    // Project .ozw directory should NOT be created
    await assert.rejects(
      () => access(join(projectPath, '.ozw', 'conf.json')),
      /ENOENT/,
      'project .ozw/conf.json must not be created',
    );
  });

  test('concurrent writes use unique temp files under state directory', async () => {
    await Promise.all(
      Array.from({ length: 12 }, (_, index) => writeProjectLocalConfig(projectPath, {
        schemaVersion: 2,
        marker: index,
      })),
    );

    const repoKey = resolveProjectStateKey(projectPath);
    const stateConfigPath = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'repos', repoKey, 'conf.json');
    const rawConfig = await readFile(stateConfigPath, 'utf8');
    const parsedConfig = JSON.parse(rawConfig);
    assert.equal(parsedConfig.schemaVersion, 2);
    assert.equal(Number.isInteger(parsedConfig.marker), true);
  });
});

// ─── Legacy project config ignored ────────────────────────────────────────

describe('legacy project config ignored', () => {
  let env;

  before(async () => {
    env = await setupTempStateHome();
  });

  after(async () => {
    await env.cleanup();
  });

  test('ignores old project .ozw/conf.json when state config is absent', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'ozw-migrate-'));
    try {
      const oldConfig = {
        sessions: {
          c1: { route: '/c1', model: 'gpt-5', title: 'Test Session' },
          c2: { route: '/c2', providerSessionId: 'prov-sess-1' },
        },
      };
      await createOldProjectConfig(projectPath, oldConfig);

      const { config, exists } = await readProjectLocalConfigFile(projectPath);
      assert.equal(exists, false);
      assert.deepEqual(config, {});

      const repoKey = resolveProjectStateKey(projectPath);
      const stateConfigPath = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'repos', repoKey, 'conf.json');
      await assert.rejects(() => access(stateConfigPath), /ENOENT/);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  test('concurrent first-readers ignore old project config without writing migration files', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'ozw-concurrent-'));
    try {
      const oldConfig = {
        sessions: {
          c1: { route: '/c1', title: 'Concurrent Session' },
          c2: { route: '/c2', providerSessionId: 'concurrent-prov' },
        },
      };
      await createOldProjectConfig(projectPath, oldConfig);

      const results = await Promise.all(
        Array.from({ length: 20 }, () => readProjectLocalConfigFile(projectPath)),
      );

      for (const { config, exists } of results) {
        assert.equal(exists, false);
        assert.deepEqual(config, {});
      }

      const repoKey = resolveProjectStateKey(projectPath);
      const stateConfigPath = join(
        resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }),
        'repos',
        repoKey,
        'conf.json',
      );
      await assert.rejects(() => access(stateConfigPath), /ENOENT/);
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  test('prefers new state config over old .ozw config', async () => {
    const projectPath = await mkdtemp(join(tmpdir(), 'ozw-migrate-prefer-'));
    try {
      // Create old config
      await createOldProjectConfig(projectPath, { sessions: { c1: { route: '/c1' } } });

      // Also write state config directly (simulating new config exists)
      const repoKey = resolveProjectStateKey(projectPath);
      const stateConfigDir = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'repos', repoKey);
      await mkdir(stateConfigDir, { recursive: true });
      await writeFile(
        join(stateConfigDir, 'conf.json'),
        JSON.stringify({ sessions: { c1: { route: '/c99' } } }, null, 2),
        'utf8',
      );

      const { config } = await readProjectLocalConfigFile(projectPath);
      assert.equal(config.sessions?.c1?.route, '/c99', 'must prefer state config route');
    } finally {
      await rm(projectPath, { recursive: true, force: true });
    }
  });

  test('returns empty config when neither old nor new config exists', async () => {
    const emptyProjectPath = await mkdtemp(join(tmpdir(), 'ozw-empty-project-'));
    try {
      const { config, exists } = await readProjectLocalConfigFile(emptyProjectPath);
      assert.equal(exists, false);
      assert.deepEqual(config, {});
    } finally {
      await rm(emptyProjectPath, { recursive: true, force: true });
    }
  });
});

// ─── Legacy global config ignored ─────────────────────────────────────────

describe('legacy global config ignored', () => {
  let env, originalHome;

  before(async () => {
    env = await setupTempStateHome();
    originalHome = process.env.HOME;
    process.env.HOME = env.stateHome;
  });

  after(async () => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    await env.cleanup();
  });

  test('ignores old ~/.ozw/conf.json when state config is absent', async () => {
    const oldGlobalConfig = {
      'project-key-1': {
        manuallyAdded: true,
        displayName: 'My Project',
        originalPath: '/home/user/my-project',
      },
    };
    const oldDir = join(env.stateHome, '.ozw');
    await mkdir(oldDir, { recursive: true });
    await writeFile(join(oldDir, 'conf.json'), JSON.stringify(oldGlobalConfig, null, 2), 'utf8');

    const config = await readProjectLocalConfig('');
    assert.deepEqual(config, {});

    const stateConfigPath = join(resolveCcflowStateRoot({ XDG_STATE_HOME: env.stateHome }), 'conf.json');
    await assert.rejects(() => access(stateConfigPath), /ENOENT/);
  });
});

// ─── Same basename projects do not pollute each other ─────────────────────

describe('same basename projects isolation', () => {
  let env, projectPath1, projectPath2;

  before(async () => {
    env = await setupTempStateHome();
    // Create intermediate directories for mkdtemp prefixes
    await mkdir(join(tmpdir(), 'ozw-work1'), { recursive: true });
    await mkdir(join(tmpdir(), 'ozw-work2'), { recursive: true });
    projectPath1 = await mkdtemp(join(tmpdir(), 'ozw-work1', 'my-repo'));
    projectPath2 = await mkdtemp(join(tmpdir(), 'ozw-work2', 'my-repo'));
  });

  after(async () => {
    await rm(join(tmpdir(), 'ozw-work1'), { recursive: true, force: true });
    await rm(join(tmpdir(), 'ozw-work2'), { recursive: true, force: true });
    await env.cleanup();
  });

  test('different absolute paths with same basename write to different state configs', async () => {
    await writeProjectLocalConfig(projectPath1, { sessions: { c1: { route: '/c1', title: 'Project 1' } } });
    await writeProjectLocalConfig(projectPath2, { sessions: { c2: { route: '/c2', title: 'Project 2' } } });

    const config1 = await readProjectLocalConfig(projectPath1);
    const config2 = await readProjectLocalConfig(projectPath2);

    assert.equal(config1.sessions?.c1?.title, 'Project 1');
    assert.equal(config2.sessions?.c2?.title, 'Project 2');
    assert.equal(config1.sessions?.c2, undefined, 'project1 must not see project2 sessions');
    assert.equal(config2.sessions?.c1, undefined, 'project2 must not see project1 sessions');
  });
});
