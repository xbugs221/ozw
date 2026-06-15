// @ts-nocheck -- Test isolation: strict types deferred. Tracked for incremental tightening.
/**
 * PURPOSE: Verify localhost direct access can bypass login while public hostnames still require JWT auth.
 * The test boots a minimal Express app with the real auth middleware and exercises both
 * `/api/auth/status` and a protected endpoint using loopback and public Host headers.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

let homeIsolationQueue = Promise.resolve();

/**
 * Execute each test under an isolated HOME directory and auth database path.
 */
async function withTemporaryAuthHome(testBody, options = {}) {
  const run = async () => {
    const originalHome = process.env.HOME;
    const originalDatabasePath = process.env.DATABASE_PATH;
    const originalLocalhostBypass = process.env.CBW_TRUST_LOCALHOST_AUTH;
    const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-auth-localhost-test-'));
    const tempDatabasePath = path.join(tempHome, '.ozw', 'auth.db');

    process.env.HOME = tempHome;
    process.env.DATABASE_PATH = tempDatabasePath;
    if (Object.prototype.hasOwnProperty.call(options, 'trustLocalhostAuth')) {
      process.env.CBW_TRUST_LOCALHOST_AUTH = String(options.trustLocalhostAuth);
    } else {
      delete process.env.CBW_TRUST_LOCALHOST_AUTH;
    }

    try {
      await initializeTemporaryDatabase(tempDatabasePath);
      await testBody({ tempHome, tempDatabasePath });
    } finally {
      if (originalHome) {
        process.env.HOME = originalHome;
      } else {
        delete process.env.HOME;
      }

      if (originalDatabasePath) {
        process.env.DATABASE_PATH = originalDatabasePath;
      } else {
        delete process.env.DATABASE_PATH;
      }

      if (originalLocalhostBypass) {
        process.env.CBW_TRUST_LOCALHOST_AUTH = originalLocalhostBypass;
      } else {
        delete process.env.CBW_TRUST_LOCALHOST_AUTH;
      }

      await fs.rm(tempHome, { recursive: true, force: true });
    }
  };

  const runPromise = homeIsolationQueue.then(run, run);
  homeIsolationQueue = runPromise.catch(() => {});
  return runPromise;
}

/**
 * Create a fresh auth database so the test never depends on the repo's default auth.db contents.
 */
async function initializeTemporaryDatabase(databasePath) {
  const initSqlPath = path.join(process.cwd(), 'backend', 'database', 'init.sql');
  const initSql = await fs.readFile(initSqlPath, 'utf8');
  await fs.mkdir(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);

  try {
    db.exec(initSql);
  } finally {
    db.close();
  }
}

/**
 * Load the auth modules after the test environment variables are in place.
 */
async function loadAuthModules() {
  const cacheBust = `${Date.now()}-${Math.random()}`;
  const authModule = await import(`../../backend/middleware/auth.js?cache-bust=${cacheBust}`);
  const authRoutesModule = await import(`../../backend/routes/auth.js?cache-bust=${cacheBust}`);
  const dbModule = await import(`../../backend/database/db.js?cache-bust=${cacheBust}`);

  return {
    authenticateToken: authModule.authenticateToken,
    authRoutes: authRoutesModule.default,
    userDb: dbModule.userDb,
  };
}

/**
 * Start a minimal Express app using the real auth routes and middleware.
 */
async function startAuthApp(authRoutes, authenticateToken) {
  const express = (await import('express')).default;
  const app = express();

  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/api/protected', authenticateToken, (req, res) => {
    res.json({ username: req.user.username });
  });

  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

/**
 * Create the single local user account used by trusted localhost requests.
 */
function createSingleUser(userDb) {
  userDb.createUser('local-owner', 'not-used-for-bypass');
}

test('localhost direct access bypasses login by default but public hostnames still require credentials', async () => {
  await withTemporaryAuthHome(async () => {
    const { authenticateToken, authRoutes, userDb } = await loadAuthModules();
    createSingleUser(userDb);

    const { server, baseUrl } = await startAuthApp(authRoutes, authenticateToken);

    try {
      const localhostHost = new URL(baseUrl).host.replace('127.0.0.1', 'localhost');
      const localhostStatus = await fetch(`${baseUrl}/api/auth/status`, {
        headers: { Host: localhostHost },
      });
      assert.equal(localhostStatus.status, 200);
      assert.deepEqual(await localhostStatus.json(), {
        needsSetup: false,
        isAuthenticated: true,
        authBypass: true,
        user: {
          id: 1,
          username: 'local-owner',
        },
      }, 'localhost status should expose trusted auth');

      const localhostProtected = await fetch(`${baseUrl}/api/protected`, {
        headers: { Host: localhostHost },
      });
      assert.equal(localhostProtected.status, 200);
      assert.deepEqual(await localhostProtected.json(), { username: 'local-owner' });

      const publicStatus = await fetch(`${baseUrl}/api/auth/status`, {
        headers: {
          Host: localhostHost,
          'X-Forwarded-Host': 'example.com',
        },
      });
      assert.equal(publicStatus.status, 200);
      assert.deepEqual(await publicStatus.json(), {
        needsSetup: false,
        isAuthenticated: false,
        authBypass: false,
        user: null,
      }, 'public host should keep login enabled');

      const publicProtected = await fetch(`${baseUrl}/api/protected`, {
        headers: {
          Host: localhostHost,
          'X-Forwarded-Host': 'example.com',
        },
      });
      assert.equal(publicProtected.status, 401);
    } finally {
      server.close();
    }
  });
});

test('localhost direct access can be disabled explicitly', async () => {
  const tempHome = await fs.mkdtemp(path.join(os.tmpdir(), 'ozw-auth-localhost-disabled-test-'));
  const tempDatabasePath = path.join(tempHome, '.ozw', 'auth.db');
  await initializeTemporaryDatabase(tempDatabasePath);

  try {
    const script = `
      import assert from 'node:assert/strict';
      import { once } from 'node:events';
      import express from 'express';
      import authRoutes from './backend/routes/auth.ts';
      import { authenticateToken } from './backend/middleware/auth.ts';
      import { userDb } from './backend/database/db.ts';

      (async () => {
        userDb.createUser('local-owner', 'not-used-for-bypass');
        const app = express();
        app.use(express.json());
        app.use('/api/auth', authRoutes);
        app.get('/api/protected', authenticateToken, (req, res) => {
          res.json({ username: req.user.username });
        });
        const server = app.listen(0, '127.0.0.1');
        await once(server, 'listening');
        try {
          const address = server.address();
          const baseUrl = 'http://127.0.0.1:' + address.port;
          const localhostHost = new URL(baseUrl).host.replace('127.0.0.1', 'localhost');
          const status = await fetch(baseUrl + '/api/auth/status', { headers: { Host: localhostHost } });
          assert.equal(status.status, 200);
          assert.deepEqual(await status.json(), {
            needsSetup: false,
            isAuthenticated: false,
            authBypass: false,
            user: null,
          });
          const protectedResponse = await fetch(baseUrl + '/api/protected', { headers: { Host: localhostHost } });
          assert.equal(protectedResponse.status, 401);
        } finally {
          server.close();
        }
      })().catch((error) => {
        console.error(error);
        process.exit(1);
      });
    `;
    const result = spawnSync('pnpm', ['exec', 'tsx', '--eval', script], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: tempHome,
        DATABASE_PATH: tempDatabasePath,
        CBW_TRUST_LOCALHOST_AUTH: 'false',
        JWT_SECRET: process.env.JWT_SECRET || 'localhost-disabled-test-secret',
      },
      encoding: 'utf8',
    });

    assert.equal(
      result.status,
      0,
      `explicit false localhost auth check failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } finally {
    await fs.rm(tempHome, { recursive: true, force: true });
  }
});
