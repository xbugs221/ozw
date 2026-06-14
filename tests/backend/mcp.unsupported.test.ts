/**
 * PURPOSE: Verify legacy Claude MCP REST endpoints are explicitly unsupported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';

import mcpRoutes from '../../backend/routes/mcp.ts';

async function request(pathname: string, method = 'GET') {
  const app = express();
  app.use(express.json());
  app.use('/api/mcp', mcpRoutes);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no port');
  const { port } = addr;

  try {
    const response = await fetch(`http://127.0.0.1:${port}${pathname}`, { method });
    return {
      status: response.status,
      body: await response.json(),
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('legacy Claude MCP CLI endpoints return unsupported', async () => {
  const response = await request('/api/mcp/cli/list');

  assert.equal(response.status, 410);
  assert.equal(response.body.error, 'Claude MCP endpoints are no longer supported');
});

test('legacy Claude MCP config read endpoint returns unsupported', async () => {
  const response = await request('/api/mcp/config/read');

  assert.equal(response.status, 410);
  assert.equal(response.body.error, 'Claude MCP endpoints are no longer supported');
});
