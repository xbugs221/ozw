import express from 'express';
import { spawn } from 'child_process';
import path from 'path';
import os from 'os';
import { promises as fs } from 'fs';
import crypto from 'crypto';
import { githubTokensDb } from '../../database/db.js';
import { addProjectManually } from '../../projects.js';
import { Octokit } from '@octokit/rest';
import { validateExternalApiKey } from './agent-auth.js';
import { resolveAgentProjectPath } from './agent-project-resolver.js';
import { cloneGitHubRepo } from './github-operations.js';
import { ResponseCollector, SSEStreamWriter } from './agent-response-writer.js';
import { runAgentSession } from './agent-session-runner.js';

type AgentRouteRequest = express.Request & {
  user?: { id: number };
};

type AgentRouteDependencies = {
  validateExternalApiKey: typeof validateExternalApiKey;
  resolveAgentProjectPath: typeof resolveAgentProjectPath;
  runAgentSession: typeof runAgentSession;
};

type GitHubBranchInfo = {
  name: string;
  url: string;
} | {
  error: string;
} | null;

type GitHubPullRequestInfo = {
  number: number;
  url: string;
} | {
  error: string;
} | null;

function getErrorMessage(error: unknown): string {
  /** Normalize unknown thrown values before they cross the HTTP boundary. */
  return error instanceof Error ? error.message : String(error);
}

/**
 * Get the remote URL of a git repository
 * @param {string} repoPath - Path to the git repository
 * @returns {Promise<string>} - Remote URL of the repository
 */
async function getGitRemoteUrl(repoPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['config', '--get', 'remote.origin.url'], {
      cwd: repoPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Failed to get git remote: ${stderr}`));
      }
    });

    gitProcess.on('error', (error) => {
      reject(new Error(`Failed to execute git: ${error.message}`));
    });
  });
}

/**
 * Normalize GitHub URLs for comparison
 * @param {string} url - GitHub URL
 * @returns {string} - Normalized URL
 */
function normalizeGitHubUrl(url: string): string {
  // Remove .git suffix
  let normalized = url.replace(/\.git$/, '');
  // Convert SSH to HTTPS format for comparison
  normalized = normalized.replace(/^git@github\.com:/, 'https://github.com/');
  // Remove trailing slash
  normalized = normalized.replace(/\/$/, '');
  return normalized.toLowerCase();
}

/**
 * Parse GitHub URL to extract owner and repo
 * @param {string} url - GitHub URL (HTTPS or SSH)
 * @returns {{owner: string, repo: string}} - Parsed owner and repo
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } {
  // Handle HTTPS URLs: https://github.com/owner/repo or https://github.com/owner/repo.git
  // Handle SSH URLs: git@github.com:owner/repo or git@github.com:owner/repo.git
  const match = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!match) {
    throw new Error('Invalid GitHub URL format');
  }
  return {
    owner: match[1],
    repo: match[2].replace(/\.git$/, '')
  };
}

/**
 * Auto-generate a branch name from a message
 * @param {string} message - The agent message
 * @returns {string} - Generated branch name
 */
function autogenerateBranchName(message: string): string {
  // Convert to lowercase, replace spaces/special chars with hyphens
  let branchName = message
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens

  // Ensure non-empty fallback
  if (!branchName) {
    branchName = 'task';
  }

  // Generate timestamp suffix (last 6 chars of base36 timestamp)
  const timestamp = Date.now().toString(36).slice(-6);
  const suffix = `-${timestamp}`;

  // Limit length to ensure total length including suffix fits within 50 characters
  const maxBaseLength = 50 - suffix.length;
  if (branchName.length > maxBaseLength) {
    branchName = branchName.substring(0, maxBaseLength);
  }

  // Remove any trailing hyphen after truncation and ensure no leading hyphen
  branchName = branchName.replace(/-$/, '').replace(/^-+/, '');

  // If still empty or starts with hyphen after cleanup, use fallback
  if (!branchName || branchName.startsWith('-')) {
    branchName = 'task';
  }

  // Combine base name with timestamp suffix
  branchName = `${branchName}${suffix}`;

  // Final validation: ensure it matches safe pattern
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branchName)) {
    // Fallback to deterministic safe name
    return `branch-${timestamp}`;
  }

  return branchName;
}

/**
 * Validate a Git branch name
 * @param {string} branchName - Branch name to validate
 * @returns {{valid: boolean, error?: string}} - Validation result
 */
function validateBranchName(branchName: string): { valid: boolean; error?: string } {
  if (!branchName || branchName.trim() === '') {
    return { valid: false, error: 'Branch name cannot be empty' };
  }

  // Git branch name rules
  const invalidPatterns = [
    { pattern: /^\./, message: 'Branch name cannot start with a dot' },
    { pattern: /\.$/, message: 'Branch name cannot end with a dot' },
    { pattern: /\.\./, message: 'Branch name cannot contain consecutive dots (..)' },
    { pattern: /\s/, message: 'Branch name cannot contain spaces' },
    { pattern: /[~^:?*\[\\]/, message: 'Branch name cannot contain special characters: ~ ^ : ? * [ \\' },
    { pattern: /@{/, message: 'Branch name cannot contain @{' },
    { pattern: /\/$/, message: 'Branch name cannot end with a slash' },
    { pattern: /^\//, message: 'Branch name cannot start with a slash' },
    { pattern: /\/\//, message: 'Branch name cannot contain consecutive slashes' },
    { pattern: /\.lock$/, message: 'Branch name cannot end with .lock' }
  ];

  for (const { pattern, message } of invalidPatterns) {
    if (pattern.test(branchName)) {
      return { valid: false, error: message };
    }
  }

  // Check for ASCII control characters
  if (/[\x00-\x1F\x7F]/.test(branchName)) {
    return { valid: false, error: 'Branch name cannot contain control characters' };
  }

  return { valid: true };
}

/**
 * Get recent commit messages from a repository
 * @param {string} projectPath - Path to the git repository
 * @param {number} limit - Number of commits to retrieve (default: 5)
 * @returns {Promise<string[]>} - Array of commit messages
 */
async function getCommitMessages(projectPath: string, limit = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const gitProcess = spawn('git', ['log', `-${limit}`, '--pretty=format:%s'], {
      cwd: projectPath,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    gitProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    gitProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    gitProcess.on('close', (code) => {
      if (code === 0) {
        const messages = stdout.trim().split('\n').filter(msg => msg.length > 0);
        resolve(messages);
      } else {
        reject(new Error(`Failed to get commit messages: ${stderr}`));
      }
    });

    gitProcess.on('error', (error) => {
      reject(new Error(`Failed to execute git: ${error.message}`));
    });
  });
}

/**
 * Create a new branch on GitHub using the API
 * @param {Octokit} octokit - Octokit instance
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Name of the new branch
 * @param {string} baseBranch - Base branch to branch from (default: 'main')
 * @returns {Promise<void>}
 */
async function createGitHubBranch(octokit: Octokit, owner: string, repo: string, branchName: string, baseBranch = 'main'): Promise<void> {
  try {
    // Get the SHA of the base branch
    const { data: ref } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${baseBranch}`
    });

    const baseSha = ref.object.sha;

    // Create the new branch
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha
    });

    console.log(`✅ Created branch '${branchName}' on GitHub`);
  } catch (error) {
    if (error && typeof error === 'object' && 'status' in error && error.status === 422 && getErrorMessage(error).includes('Reference already exists')) {
      console.log(`ℹ️ Branch '${branchName}' already exists on GitHub`);
    } else {
      throw error;
    }
  }
}

/**
 * Create a pull request on GitHub
 * @param {Octokit} octokit - Octokit instance
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branchName - Head branch name
 * @param {string} title - PR title
 * @param {string} body - PR body/description
 * @param {string} baseBranch - Base branch (default: 'main')
 * @returns {Promise<{number: number, url: string}>} - PR number and URL
 */
async function createGitHubPR(octokit: Octokit, owner: string, repo: string, branchName: string, title: string, body: string, baseBranch = 'main'): Promise<{ number: number; url: string }> {
  const { data: pr } = await octokit.pulls.create({
    owner,
    repo,
    title,
    head: branchName,
    base: baseBranch,
    body
  });

  console.log(`✅ Created pull request #${pr.number}: ${pr.html_url}`);

  return {
    number: pr.number,
    url: pr.html_url
  };
}

/**
 * Check whether a path is a temporary external project owned by ozw.
 * @param {string} projectPath - Candidate project directory path
 * @returns {boolean} - Whether the path is inside the external-projects root
 */
function isCbwExternalProjectPath(projectPath: string): boolean {
  const externalProjectsRoot = path.resolve(os.homedir(), '.ozw', 'external-projects');
  const resolvedProjectPath = path.resolve(projectPath);
  const relativeProjectPath = path.relative(externalProjectsRoot, resolvedProjectPath);

  return relativeProjectPath !== ''
    && !relativeProjectPath.startsWith('..')
    && !path.isAbsolute(relativeProjectPath);
}

/**
 * Clean up a temporary project directory.
 * @param {string} projectPath - Path to the project directory
 */
async function cleanupProject(projectPath: string, _sessionIdForCleanup?: string | null): Promise<void> {
  try {
    // Only clean up projects in the external-projects directory
    if (!isCbwExternalProjectPath(projectPath)) {
      console.warn('⚠️ Refusing to clean up non-external project:', projectPath);
      return;
    }

    console.log('🧹 Cleaning up project:', projectPath);
    await fs.rm(projectPath, { recursive: true, force: true });
    console.log('✅ Project cleaned up');
  } catch (error) {
    console.error('❌ Failed to clean up project:', error);
  }
}

// ===============================
// External API Endpoint
// ===============================

/**
 * POST /api/agent
 *
 * Trigger a Codex agent to work on a project.
 * Supports automatic GitHub branch and pull request creation after successful completion.
 *
 * ================================================================================================
 * REQUEST BODY PARAMETERS
 * ================================================================================================
 *
 * @param {string} githubUrl - (Conditionally Required) GitHub repository URL to clone.
 *                             Supported formats:
 *                             - HTTPS: https://github.com/owner/repo
 *                             - HTTPS with .git: https://github.com/owner/repo.git
 *                             - SSH: git@github.com:owner/repo
 *                             - SSH with .git: git@github.com:owner/repo.git
 *
 * @param {string} projectPath - (Conditionally Required) Path to existing project OR destination for cloning.
 *                               Behavior depends on usage:
 *                               - If used alone: Must point to existing project directory
 *                               - If used with githubUrl: Target location for cloning
 *                               - If omitted with githubUrl: Auto-generates temporary path in ~/.ozw/external-projects/
 *
 * @param {string} message - (Required) Task description for the AI agent. Used as:
 *                          - Instructions for the agent
 *                          - Source for auto-generated branch names (if createBranch=true and no branchName)
 *                          - Fallback for PR title if no commits are made
 *
 * @param {string} provider - (Optional) AI provider to use. Options: 'codex'
 *                           Default: 'codex'
 *
 * @param {boolean} stream - (Optional) Enable Server-Sent Events (SSE) streaming for real-time updates.
 *                          Default: true
 *                          - true: Returns text/event-stream with incremental updates
 *                          - false: Returns complete JSON response after completion
 *
 * @param {string} model - (Optional) Model identifier for providers.
 *
 *                        Model IDs are discovered from the selected provider at runtime.
 *
 * @param {boolean} cleanup - (Optional) Auto-cleanup project directory after completion.
 *                           Default: true
 *                           Behavior:
 *                           - Only applies when cloning via githubUrl (not for existing projectPath)
 *                           - Deletes cloned repository after 5 seconds
 *                           - Remote branch and PR remain on GitHub if created
 *
 * @param {string} githubToken - (Optional) GitHub Personal Access Token for authentication.
 *                              Overrides stored token from user settings.
 *                              Required for:
 *                              - Private repositories
 *                              - Branch/PR creation features
 *                              Token must have 'repo' scope for full functionality.
 *
 * @param {string} branchName - (Optional) Custom name for the Git branch.
 *                             If provided, createBranch is automatically set to true.
 *                             Validation rules (errors returned if violated):
 *                             - Cannot be empty or whitespace only
 *                             - Cannot start or end with dot (.)
 *                             - Cannot contain consecutive dots (..)
 *                             - Cannot contain spaces
 *                             - Cannot contain special characters: ~ ^ : ? * [ \
 *                             - Cannot contain @{
 *                             - Cannot start or end with forward slash (/)
 *                             - Cannot contain consecutive slashes (//)
 *                             - Cannot end with .lock
 *                             - Cannot contain ASCII control characters
 *                             Examples: 'feature/user-auth', 'bugfix/login-error', 'refactor/db-optimization'
 *
 * @param {boolean} createBranch - (Optional) Create a new Git branch after successful agent completion.
 *                                Default: false (or true if branchName is provided)
 *                                Behavior:
 *                                - Creates branch locally and pushes to remote
 *                                - If branch exists locally: Checks out existing branch (no error)
 *                                - If branch exists on remote: Uses existing branch (no error)
 *                                - Branch name: Custom (if branchName provided) or auto-generated from message
 *                                - Requires either githubUrl OR projectPath with GitHub remote
 *
 * @param {boolean} createPR - (Optional) Create a GitHub Pull Request after successful completion.
 *                            Default: false
 *                            Behavior:
 *                            - PR title: First commit message (or fallback to message parameter)
 *                            - PR description: Auto-generated from all commit messages
 *                            - Base branch: Always 'main' (currently hardcoded)
 *                            - If PR already exists: GitHub returns error with details
 *                            - Requires either githubUrl OR projectPath with GitHub remote
 *
 * ================================================================================================
 * PATH HANDLING BEHAVIOR
 * ================================================================================================
 *
 * Scenario 1: Only githubUrl provided
 *   Input:  { githubUrl: "https://github.com/owner/repo" }
 *   Action: Clones to auto-generated temporary path: ~/.ozw/external-projects/<hash>/
 *   Cleanup: Yes (if cleanup=true)
 *
 * Scenario 2: Only projectPath provided
 *   Input:  { projectPath: "/home/user/my-project" }
 *   Action: Uses existing project at specified path
 *   Validation: Path must exist and be accessible
 *   Cleanup: No (never cleanup existing projects)
 *
 * Scenario 3: Both githubUrl and projectPath provided
 *   Input:  { githubUrl: "https://github.com/owner/repo", projectPath: "/custom/path" }
 *   Action: Clones githubUrl to projectPath location
 *   Validation:
 *     - If projectPath exists with git repo:
 *       - Compares remote URL with githubUrl
 *       - If URLs match: Reuses existing repo
 *       - If URLs differ: Returns error
 *   Cleanup: Yes (if cleanup=true)
 *
 * ================================================================================================
 * GITHUB BRANCH/PR CREATION REQUIREMENTS
 * ================================================================================================
 *
 * For createBranch or createPR to work, one of the following must be true:
 *
 * Option A: githubUrl provided
 *   - Repository URL directly specified
 *   - Works with both cloning and existing paths
 *
 * Option B: projectPath with GitHub remote
 *   - Project must be a Git repository
 *   - Must have 'origin' remote configured
 *   - Remote URL must point to github.com
 *   - System auto-detects GitHub URL via: git remote get-url origin
 *
 * Additional Requirements:
 *   - Valid GitHub token (from settings or githubToken parameter)
 *   - Token must have 'repo' scope for private repos
 *   - Project must have commits (for PR creation)
 *
 * ================================================================================================
 * VALIDATION & ERROR HANDLING
 * ================================================================================================
 *
 * Input Validations (400 Bad Request):
 *   - Either githubUrl OR projectPath must be provided (not neither)
 *   - message must be non-empty string
 *   - provider must be 'codex'
 *   - createBranch/createPR requires githubUrl OR projectPath (not neither)
 *   - branchName must pass Git naming rules (if provided)
 *
 * Runtime Validations (500 Internal Server Error or specific error in response):
 *   - projectPath must exist (if used alone)
 *   - GitHub URL format must be valid
 *   - Git remote URL must include github.com (for projectPath + branch/PR)
 *   - GitHub token must be available (for private repos and branch/PR)
 *   - Directory conflicts handled (existing path with different repo)
 *
 * Branch Name Validation Errors (returned in response, not HTTP error):
 *   Invalid names return: { branch: { error: "Invalid branch name: <reason>" } }
 *   Examples:
 *   - "my branch" → "Branch name cannot contain spaces"
 *   - ".feature" → "Branch name cannot start with a dot"
 *   - "feature.lock" → "Branch name cannot end with .lock"
 *
 * ================================================================================================
 * RESPONSE FORMATS
 * ================================================================================================
 *
 * Streaming Response (stream=true):
 *   Content-Type: text/event-stream
 *   Events:
 *     - { type: "status", message: "...", projectPath: "..." }
 *     - { type: "codex-response", data: {...} }
 *     - { type: "github-branch", branch: { name: "...", url: "..." } }
 *     - { type: "github-pr", pullRequest: { number: 42, url: "..." } }
 *     - { type: "github-error", error: "..." }
 *     - { type: "done" }
 *
 * Non-Streaming Response (stream=false):
 *   Content-Type: application/json
 *   {
 *     success: true,
 *     sessionId: "session-123",
 *     messages: [...],        // Assistant messages only (filtered)
 *     tokens: {
 *       inputTokens: 150,
 *       outputTokens: 50,
 *       cacheReadTokens: 0,
 *       cacheCreationTokens: 0,
 *       reasoningOutputTokens: 0,
 *       totalTokens: 200,
 *       contextBudget: {...}
 *     },
 *     projectPath: "/path/to/project",
 *     branch: {               // Only if createBranch=true
 *       name: "feature/xyz",
 *       url: "https://github.com/owner/repo/tree/feature/xyz"
 *     } | { error: "..." },
 *     pullRequest: {          // Only if createPR=true
 *       number: 42,
 *       url: "https://github.com/owner/repo/pull/42"
 *     } | { error: "..." }
 *   }
 *
 * Error Response:
 *   HTTP Status: 400, 401, 500
 *   Content-Type: application/json
 *   { success: false, error: "Error description" }
 *
 * ================================================================================================
 * EXAMPLES
 * ================================================================================================
 *
 * Example 1: Clone and process with auto-cleanup
 *   POST /api/agent
 *   { "githubUrl": "https://github.com/user/repo", "message": "Fix bug" }
 *
 * Example 2: Use existing project with custom branch and PR
 *   POST /api/agent
 *   {
 *     "projectPath": "/home/user/project",
 *     "message": "Add feature",
 *     "branchName": "feature/new-feature",
 *     "createPR": true
 *   }
 *
 * Example 3: Clone to specific path with auto-generated branch
 *   POST /api/agent
 *   {
 *     "githubUrl": "https://github.com/user/repo",
 *     "projectPath": "/tmp/work",
 *     "message": "Refactor code",
 *     "createBranch": true,
 *     "cleanup": false
 *   }
 */
function createAgentPostHandler(dependencies: AgentRouteDependencies): express.RequestHandler {
  /** Build the /api/agent handler around injectable runtime boundaries for route-level regression tests. */
  return async (req, res) => {
  const { githubUrl, projectPath, message, provider = 'codex', model, githubToken, branchName } = req.body;

  // Parse stream and cleanup as booleans (handle string "true"/"false" from curl)
  const stream = req.body.stream === undefined ? true : (req.body.stream === true || req.body.stream === 'true');
  const cleanup = req.body.cleanup === undefined ? true : (req.body.cleanup === true || req.body.cleanup === 'true');

  // If branchName is provided, automatically enable createBranch
  const createBranch = branchName ? true : (req.body.createBranch === true || req.body.createBranch === 'true');
  const createPR = req.body.createPR === true || req.body.createPR === 'true';

  // Validate inputs
  if (!githubUrl && !projectPath) {
    return res.status(400).json({ error: 'Either githubUrl or projectPath is required' });
  }

  if (!message || !message.trim()) {
    return res.status(400).json({ error: 'message is required' });
  }

  if (provider !== 'codex') {
    return res.status(400).json({ error: 'provider must be "codex"' });
  }

  // Validate GitHub branch/PR creation requirements
  // Allow branch/PR creation with projectPath as long as it has a GitHub remote
  if ((createBranch || createPR) && !githubUrl && !projectPath) {
    return res.status(400).json({ error: 'createBranch and createPR require either githubUrl or projectPath with a GitHub remote' });
  }

  const agentReq = req as AgentRouteRequest;
  let finalProjectPath: string | null = null;
  let writer: SSEStreamWriter | ResponseCollector | null = null;

  try {
    // Determine the final project path
    if (githubUrl) {
      // Clone repository (to projectPath if provided, otherwise generate path)
      const tokenToUse = githubToken || githubTokensDb.getActiveGithubToken(agentReq.user!.id);

      let targetPath;
      if (projectPath) {
        targetPath = await dependencies.resolveAgentProjectPath(projectPath);
      } else {
        // Generate a unique path for cloning
        const repoHash = crypto.createHash('md5').update(githubUrl + Date.now()).digest('hex');
        targetPath = path.join(os.homedir(), '.ozw', 'external-projects', repoHash);
      }

      finalProjectPath = await cloneGitHubRepo(githubUrl.trim(), tokenToUse, targetPath);
    } else {
      // Use existing project path
      finalProjectPath = await dependencies.resolveAgentProjectPath(projectPath);

      // Verify the path exists
      try {
        await fs.access(finalProjectPath);
      } catch (error) {
        throw new Error(`Project path does not exist: ${finalProjectPath}`);
      }
    }

    // Register the project (or use existing registration)
    let project;
    try {
      project = await addProjectManually(finalProjectPath);
      console.log('📦 Project registered:', project);
    } catch (error) {
      // If project already exists, that's fine - continue with the existing registration
      const errorMessage = getErrorMessage(error);
      if (errorMessage.includes('Project already configured')) {
        console.log('📦 Using existing project registration for:', finalProjectPath);
        project = { path: finalProjectPath };
      } else {
        throw error;
      }
    }

    // Set up writer based on streaming mode
    if (stream) {
      // Set up SSE headers for streaming
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

      writer = new SSEStreamWriter(res);

      // Send initial status
      writer.send({
        type: 'status',
        message: githubUrl ? 'Repository cloned and session started' : 'Session started',
        projectPath: finalProjectPath
      });
    } else {
      // Non-streaming mode: collect messages
      writer = new ResponseCollector();

      // Collect initial status message
      writer.send({
        type: 'status',
        message: githubUrl ? 'Repository cloned and session started' : 'Session started',
        projectPath: finalProjectPath
      });
    }

    console.log('🤖 Starting Codex CLI session');

    await dependencies.runAgentSession({
      projectPath: finalProjectPath,
      message,
      provider,
      model: model || undefined,
    }, writer);

    // Handle GitHub branch and PR creation after successful agent completion
    let branchInfo: GitHubBranchInfo = null;
    let prInfo: GitHubPullRequestInfo = null;

    if (createBranch || createPR) {
      try {
        console.log('🔄 Starting GitHub branch/PR creation workflow...');

        // Get GitHub token
        const tokenToUse = githubToken || githubTokensDb.getActiveGithubToken(agentReq.user!.id);

        if (!tokenToUse) {
          throw new Error('GitHub token required for branch/PR creation. Please configure a GitHub token in settings.');
        }

        // Initialize Octokit
        const octokit = new Octokit({ auth: tokenToUse });

        // Get GitHub URL - either from parameter or from git remote
        let repoUrl = githubUrl;
        if (!repoUrl) {
          console.log('🔍 Getting GitHub URL from git remote...');
          try {
            repoUrl = await getGitRemoteUrl(finalProjectPath);
            if (!repoUrl.includes('github.com')) {
              throw new Error('Project does not have a GitHub remote configured');
            }
            console.log(`✅ Found GitHub remote: ${repoUrl}`);
          } catch (error) {
            throw new Error(`Failed to get GitHub remote URL: ${getErrorMessage(error)}`);
          }
        }

        // Parse GitHub URL to get owner and repo
        const { owner, repo } = parseGitHubUrl(repoUrl);
        console.log(`📦 Repository: ${owner}/${repo}`);

        // Use provided branch name or auto-generate from message
        const finalBranchName = branchName || autogenerateBranchName(message);
        if (branchName) {
          console.log(`🌿 Using provided branch name: ${finalBranchName}`);

          // Validate custom branch name
          const validation = validateBranchName(finalBranchName);
          if (!validation.valid) {
            throw new Error(`Invalid branch name: ${validation.error}`);
          }
        } else {
          console.log(`🌿 Auto-generated branch name: ${finalBranchName}`);
        }

        if (createBranch) {
          const activeProjectPath = finalProjectPath;
          // Create and checkout the new branch locally
          console.log('🔄 Creating local branch...');
          const checkoutProcess = spawn('git', ['checkout', '-b', finalBranchName], {
            cwd: activeProjectPath,
            stdio: 'pipe'
          });

          await new Promise<void>((resolve, reject) => {
            let stderr = '';
            checkoutProcess.stderr.on('data', (data) => { stderr += data.toString(); });
            checkoutProcess.on('close', (code) => {
              if (code === 0) {
                console.log(`✅ Created and checked out local branch '${finalBranchName}'`);
                resolve();
              } else {
                // Branch might already exist locally, try to checkout
                if (stderr.includes('already exists')) {
                  console.log(`ℹ️ Branch '${finalBranchName}' already exists locally, checking out...`);
                  const checkoutExisting = spawn('git', ['checkout', finalBranchName], {
                    cwd: activeProjectPath,
                    stdio: 'pipe'
                  });
                  checkoutExisting.on('close', (checkoutCode: number | null) => {
                    if (checkoutCode === 0) {
                      console.log(`✅ Checked out existing branch '${finalBranchName}'`);
                      resolve();
                    } else {
                      reject(new Error(`Failed to checkout existing branch: ${stderr}`));
                    }
                  });
                } else {
                  reject(new Error(`Failed to create branch: ${stderr}`));
                }
              }
            });
          });

          // Push the branch to remote
          console.log('🔄 Pushing branch to remote...');
          const pushProcess = spawn('git', ['push', '-u', 'origin', finalBranchName], {
            cwd: activeProjectPath,
            stdio: 'pipe'
          });

          await new Promise<void>((resolve, reject) => {
            let stderr = '';
            let stdout = '';
            pushProcess.stdout.on('data', (data) => { stdout += data.toString(); });
            pushProcess.stderr.on('data', (data) => { stderr += data.toString(); });
            pushProcess.on('close', (code) => {
              if (code === 0) {
                console.log(`✅ Pushed branch '${finalBranchName}' to remote`);
                resolve();
              } else {
                // Check if branch exists on remote but has different commits
                if (stderr.includes('already exists') || stderr.includes('up-to-date')) {
                  console.log(`ℹ️ Branch '${finalBranchName}' already exists on remote, using existing branch`);
                  resolve();
                } else {
                  reject(new Error(`Failed to push branch: ${stderr}`));
                }
              }
            });
          });

          branchInfo = {
            name: finalBranchName,
            url: `https://github.com/${owner}/${repo}/tree/${finalBranchName}`
          };
        }

        if (createPR) {
          // Get commit messages to generate PR description
          console.log('🔄 Generating PR title and description...');
          const commitMessages = await getCommitMessages(finalProjectPath, 5);

          // Use the first commit message as the PR title, or fallback to the agent message
          const prTitle = commitMessages.length > 0 ? commitMessages[0] : message;

          // Generate PR body from commit messages
          let prBody = '## Changes\n\n';
          if (commitMessages.length > 0) {
            prBody += commitMessages.map(msg => `- ${msg}`).join('\n');
          } else {
            prBody += `Agent task: ${message}`;
          }
          prBody += '\n\n---\n*This pull request was automatically created by ozw Agent.*';

          console.log(`📝 PR Title: ${prTitle}`);

          // Create the pull request
          console.log('🔄 Creating pull request...');
          prInfo = await createGitHubPR(octokit, owner, repo, finalBranchName, prTitle, prBody, 'main');
        }

        // Send branch/PR info in response
        if (stream) {
          if (branchInfo) {
            writer.send({
              type: 'github-branch',
              branch: branchInfo
            });
          }
          if (prInfo) {
            writer.send({
              type: 'github-pr',
              pullRequest: prInfo
            });
          }
        }

      } catch (error) {
        const errorMessage = getErrorMessage(error);
        console.error('❌ GitHub branch/PR creation error:', error);

        // Send error but don't fail the entire request
        if (stream) {
          writer.send({
            type: 'github-error',
            error: errorMessage
          });
        }
        // Store error info for non-streaming response
        if (!stream) {
          branchInfo = { error: errorMessage };
          prInfo = { error: errorMessage };
        }
      }
    }

    // Handle response based on streaming mode
    if (stream) {
      // Streaming mode: end the SSE stream
      writer.end();
    } else {
      // Non-streaming mode: send filtered messages and token summary as JSON
      const collector = writer as ResponseCollector;
      const assistantMessages = collector.getAssistantMessages();
      const tokenSummary = collector.getTotalTokens();

      const response: {
        success: boolean;
        sessionId: string | null;
        messages: Record<string, unknown>[];
        tokens: Record<string, unknown>;
        projectPath: string;
        branch?: Exclude<GitHubBranchInfo, null>;
        pullRequest?: Exclude<GitHubPullRequestInfo, null>;
      } = {
        success: true,
        sessionId: collector.getSessionId(),
        messages: assistantMessages,
        tokens: tokenSummary,
        projectPath: finalProjectPath
      };

      // Add branch/PR info if created
      if (branchInfo) {
        response.branch = branchInfo;
      }
      if (prInfo) {
        response.pullRequest = prInfo;
      }

      res.json(response);
    }

    // Clean up if requested
    if (cleanup && githubUrl) {
      // Only cleanup if we cloned a repo (not for existing project paths)
      const sessionIdForCleanup = writer.getSessionId();
      const projectPathForCleanup = finalProjectPath;
      setTimeout(() => {
        cleanupProject(projectPathForCleanup, sessionIdForCleanup);
      }, 5000);
    }

  } catch (error) {
    const errorMessage = getErrorMessage(error);
    console.error('❌ External session error:', error);

    // Clean up on error
    if (finalProjectPath && cleanup && githubUrl) {
      const sessionIdForCleanup = writer ? writer.getSessionId() : null;
      cleanupProject(finalProjectPath, sessionIdForCleanup);
    }

    if (stream) {
      // For streaming, send error event and stop
      if (!writer) {
        // Set up SSE headers if not already done
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        writer = new SSEStreamWriter(res);
      }

      if (!res.writableEnded) {
        writer.send({
          type: 'error',
          error: errorMessage,
          message: `Failed: ${errorMessage}`
        });
        writer.end();
      }
    } else if (!res.headersSent) {
      res.status(500).json({
        success: false,
        error: errorMessage
      });
    }
  }
  };
}

function createAgentRouter(dependencies: AgentRouteDependencies): express.Router {
  /** Register agent routes with production dependencies or injected test doubles. */
  const agentRouter = express.Router();
  agentRouter.post('/', dependencies.validateExternalApiKey, createAgentPostHandler(dependencies));
  return agentRouter;
}

const router = createAgentRouter({
  validateExternalApiKey,
  resolveAgentProjectPath,
  runAgentSession,
});

export const __agentRouteInternalsForTest = {
  ResponseCollector,
  createAgentRouter,
  cleanupProject,
  isCbwExternalProjectPath,
  resolveAgentProjectPath,
};

export default router;
