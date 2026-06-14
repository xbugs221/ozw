/**
 * PURPOSE: Serve Codex provider configuration, session history, and MCP
 * management HTTP endpoints for the ozw web UI.
 */
import express from 'express';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import TOML from '@iarna/toml';
import { getCodexSessions, getCodexSessionMessages, deleteCodexSession, renameCodexSession } from '../projects.js';
import { getCodexModelCatalog } from '../codex-models.js';
import {
  formatCodexCliNotFoundMessage,
  resolveCodexCliPath,
} from '../codex-cli.js';

const router = express.Router();

function createCliResponder(res: express.Response) {
  let responded = false;
  return (status: number, payload: Record<string, unknown>) => {
    if (responded || res.headersSent) {
      return;
    }
    responded = true;
    res.status(status).json(payload);
  };
}

/**
 * Spawn the resolved Codex CLI for MCP management routes.
 */
function spawnCodexCli(args: string[]) {
  const cliPath = resolveCodexCliPath();
  const proc = spawn(cliPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  return { proc, cliPath };
}

router.get('/config', async (req: express.Request, res: express.Response) => {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');
    const content = await fs.readFile(configPath, 'utf8');
    const config = TOML.parse(content);

    res.json({
      success: true,
      config: {
        model: config.model || null,
        mcpServers: config.mcp_servers || {},
        approvalMode: config.approval_mode || 'suggest'
      }
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') {
      res.json({
        success: true,
        config: {
          model: null,
          mcpServers: {},
          approvalMode: 'suggest'
        }
      });
    } else {
      console.error('Error reading Codex config:', error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error));
      res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
    }
  }
});

router.get('/models', async (_req, res) => {
  try {
    const catalog = await getCodexModelCatalog();
    res.json({ success: true, ...catalog });
  } catch (error) {
    console.error('Error reading Codex model catalog:', error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error));
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/sessions', async (req: express.Request, res: express.Response) => {
  try {
    const { projectPath } = req.query;

    if (!projectPath) {
      return res.status(400).json({ success: false, error: 'projectPath query parameter required' });
    }

    const sessions = await getCodexSessions(projectPath);
    res.json({ success: true, sessions });
  } catch (error) {
    console.error('Error fetching Codex sessions:', error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error));
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/sessions/:sessionId/messages', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId } = req.params;
    const { limit, offset, afterLine } = req.query;
    const limitStr = typeof limit === 'string' ? limit : undefined;
    const offsetStr = typeof offset === 'string' ? offset : undefined;
    const afterLineStr = typeof afterLine === 'string' ? afterLine : undefined;

    const result = await getCodexSessionMessages(
      sessionId,
      (limitStr ? parseInt(limitStr, 10) : null) as any,
      offsetStr ? parseInt(offsetStr, 10) : 0,
      (afterLineStr != null ? parseInt(afterLineStr, 10) : null) as any,
    );

    res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error fetching Codex session messages:', error instanceof Error ? error instanceof Error ? error.message : String(error) : String(error));
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.put('/sessions/:sessionId/rename', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId } = req.params;
    const { projectPath, summary } = req.body;

    if (typeof summary !== 'string' || !summary.trim()) {
      return res.status(400).json({ success: false, error: 'Session summary is required' });
    }

    await renameCodexSession(sessionId, summary, typeof projectPath === 'string' ? projectPath : '');
    res.json({ success: true });
  } catch (error) {
    console.error(`Error renaming Codex session ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

router.delete('/sessions/:sessionId', async (req: express.Request, res: express.Response) => {
  try {
    const { sessionId } = req.params;
    const { projectPath = '' } = req.body || {};
    await deleteCodexSession(sessionId, typeof projectPath === 'string' ? projectPath : '');
    res.json({ success: true });
  } catch (error) {
    console.error(`Error deleting Codex session ${req.params.sessionId}:`, error);
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

// MCP Server Management Routes

router.get('/mcp/cli/list', async (req: express.Request, res: express.Response) => {
  try {
    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnCodexCli(['mcp', 'list']);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, servers: parseCodexListOutput(stdout) });
      } else {
        respond(500, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error: NodeJS.ErrnoException) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: isMissing ? formatCodexCliNotFoundMessage(cliPath) : error instanceof Error ? error.message : String(error),
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to list MCP servers', details: error instanceof Error ? error.message : String(error) });
  }
});

router.post('/mcp/cli/add', async (req: express.Request, res: express.Response) => {
  try {
    const { name, command, args = [], env = {} } = req.body;

    if (!name || !command) {
      return res.status(400).json({ error: 'name and command are required' });
    }

    // Build: codex mcp add <name> [-e KEY=VAL]... -- <command> [args...]
    let cliArgs = ['mcp', 'add', name];

    Object.entries(env).forEach(([key, value]) => {
      cliArgs.push('-e', `${key}=${value}`);
    });

    cliArgs.push('--', command);

    if (args && args.length > 0) {
      cliArgs.push(...args);
    }

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnCodexCli(cliArgs);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, message: `MCP server "${name}" added successfully` });
      } else {
        respond(400, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error: NodeJS.ErrnoException) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: isMissing ? formatCodexCliNotFoundMessage(cliPath) : error instanceof Error ? error.message : String(error),
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to add MCP server', details: error instanceof Error ? error.message : String(error) });
  }
});

router.delete('/mcp/cli/remove/:name', async (req: express.Request, res: express.Response) => {
  try {
    const { name } = req.params;

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnCodexCli(['mcp', 'remove', String(name)]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, message: `MCP server "${name}" removed successfully` });
      } else {
        respond(400, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error: NodeJS.ErrnoException) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: isMissing ? formatCodexCliNotFoundMessage(cliPath) : error instanceof Error ? error.message : String(error),
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to remove MCP server', details: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/mcp/cli/get/:name', async (req: express.Request, res: express.Response) => {
  try {
    const { name } = req.params;

    const respond = createCliResponder(res);
    const { proc, cliPath } = spawnCodexCli(['mcp', 'get', String(name)]);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => { stdout += data.toString(); });
    proc.stderr?.on('data', (data) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      if (code === 0) {
        respond(200, { success: true, output: stdout, server: parseCodexGetOutput(stdout) });
      } else {
        respond(404, { error: 'Codex CLI command failed', details: stderr || `Exited with code ${code}` });
      }
    });

    proc.on('error', (error: NodeJS.ErrnoException) => {
      const isMissing = error?.code === 'ENOENT';
      respond(isMissing ? 503 : 500, {
        error: isMissing ? 'Codex CLI not installed' : 'Failed to run Codex CLI',
        details: isMissing ? formatCodexCliNotFoundMessage(cliPath) : error instanceof Error ? error.message : String(error),
        code: error.code
      });
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get MCP server details', details: error instanceof Error ? error.message : String(error) });
  }
});

router.get('/mcp/config/read', async (req: express.Request, res: express.Response) => {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml');

    let configData = null;

    try {
      const fileContent = await fs.readFile(configPath, 'utf8');
      configData = TOML.parse(fileContent);
    } catch (error) {
      // Config file doesn't exist
    }

    if (!configData) {
      return res.json({ success: true, configPath, servers: [] });    }

    const servers = [];

    if (configData.mcp_servers && typeof configData.mcp_servers === 'object') {
      for (const [name, config] of Object.entries(configData.mcp_servers)) {
        servers.push({
          id: name,
          name: name,
          type: 'stdio',
          scope: 'user',
          config: {
            command: config.command || '',
            args: config.args || [],
            env: config.env || {}
          },
          raw: config
        });
      }
    }

    res.json({ success: true, configPath, servers });
  } catch (error) {
    res.status(500).json({ error: 'Failed to read Codex configuration', details: error instanceof Error ? error.message : String(error) });
  }
});

function parseCodexListOutput(output: string) {
  const servers = [];
  const lines = output.split('\n').filter(line => line.trim());

  for (const line of lines) {
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const name = line.substring(0, colonIndex).trim();

      if (!name) continue;

      const rest = line.substring(colonIndex + 1).trim();
      let description = rest;
      let status = 'unknown';

      if (rest.includes('✓') || rest.includes('✗')) {
        const statusMatch = rest.match(/(.*?)\s*-\s*([✓✗].*)$/);
        if (statusMatch) {
          description = statusMatch[1].trim();
          status = statusMatch[2].includes('✓') ? 'connected' : 'failed';
        }
      }

      servers.push({ name, type: 'stdio', status, description });
    }
  }

  return servers;
}

function parseCodexGetOutput(output: string) {
  try {
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }

    const server: Record<string, string> = { raw_output: output };
    const lines = output.split('\n');

    for (const line of lines) {
      if (line.includes('Name:')) server.name = line.split(':')[1]?.trim();
      else if (line.includes('Type:')) server.type = line.split(':')[1]?.trim();
      else if (line.includes('Command:')) server.command = line.split(':')[1]?.trim();
    }

    return server;
  } catch (error) {
    return { raw_output: output, parse_error: error instanceof Error ? error.message : String(error) };
  }
}

export default router;
