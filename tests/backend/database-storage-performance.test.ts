/**
 * PURPOSE: Guard SQLite startup settings and schema-version reuse for slow
 * local disks commonly found in VPS and low-cost cloud deployments.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const REPO_ROOT = process.cwd();
const EXPECTED_SCHEMA_VERSION = 1;
const EXPECTED_SCHEMA_SHA256 = '23b054813a76b2bba5f8e87ce3645cf922dbc0ddd03ca30fd4efd553836321ab';

type DatabaseProbe = {
  schemaReadCount: number;
  version: number;
  journal: string;
  synchronous: number;
  foreignKeys: number;
  busyTimeout: number;
  userCount: number;
};

/** Start a clean process so module-level SQLite configuration is exercised. */
function runDatabaseProbe(databasePath: string): DatabaseProbe {
  /** PURPOSE: Count schema-file reads across repeated initialization without mocking SQLite. */
  const source = `
    const fsModule = await import('node:fs');
    const fs = fsModule.default;
    const originalReadFileSync = fs.readFileSync;
    let schemaReadCount = 0;
    fs.readFileSync = function(filePath, ...args) {
      if (String(filePath).endsWith('/backend/database/init.sql')) schemaReadCount += 1;
      return originalReadFileSync.call(this, filePath, ...args);
    };
    const database = await import('./backend/database/db.ts');
    await database.initializeDatabase();
    await database.initializeDatabase();
    const db = database.db;
    console.log('DB_PROBE=' + JSON.stringify({
      schemaReadCount,
      version: db.pragma('user_version', { simple: true }),
      journal: db.pragma('journal_mode', { simple: true }),
      synchronous: db.pragma('synchronous', { simple: true }),
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
      busyTimeout: db.pragma('busy_timeout', { simple: true }),
      userCount: db.prepare('SELECT COUNT(*) AS count FROM users').get().count,
    }));
  `;
  const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', source], {
    cwd: REPO_ROOT,
    env: { ...process.env, DATABASE_PATH: databasePath },
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const marker = result.stdout.split('\n').find((line) => line.startsWith('DB_PROBE='));
  assert.ok(marker, result.stdout);
  return JSON.parse(marker.slice('DB_PROBE='.length)) as DatabaseProbe;
}

test('fresh v0 database upgrades once and later startups reuse the schema', async () => {
  /** PURPOSE: Avoid repeating many schema metadata operations on every slow-disk startup. */
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-database-startup-'));
  const databasePath = path.join(tempDir, 'ozw.db');
  try {
    const firstProcess = runDatabaseProbe(databasePath);
    assert.equal(firstProcess.schemaReadCount, 1);
    assert.equal(firstProcess.version, EXPECTED_SCHEMA_VERSION);
    assert.equal(firstProcess.userCount, 1);
    assert.equal(firstProcess.journal, 'wal');
    assert.equal(firstProcess.synchronous, 1);
    assert.equal(firstProcess.foreignKeys, 1);
    assert.equal(firstProcess.busyTimeout, 5000);

    const nextProcess = runDatabaseProbe(databasePath);
    assert.equal(nextProcess.schemaReadCount, 0);
    assert.equal(nextProcess.version, EXPECTED_SCHEMA_VERSION);
    assert.equal(nextProcess.userCount, 1);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test('init.sql changes require an explicit schema-version contract update', async () => {
  /** PURPOSE: Fail review when schema SQL changes without revisiting the versioned startup path. */
  const [schema, databaseSource] = await Promise.all([
    fs.readFile(path.join(REPO_ROOT, 'backend', 'database', 'init.sql')),
    fs.readFile(path.join(REPO_ROOT, 'backend', 'database', 'db.ts'), 'utf8'),
  ]);
  const schemaHash = crypto.createHash('sha256').update(schema).digest('hex');
  assert.equal(schemaHash, EXPECTED_SCHEMA_SHA256);
  assert.match(
    databaseSource,
    new RegExp(`CURRENT_DATABASE_SCHEMA_VERSION\\s*=\\s*${EXPECTED_SCHEMA_VERSION}\\b`),
  );
});
