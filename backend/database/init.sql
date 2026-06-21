-- Initialize authentication database
PRAGMA foreign_keys = ON;

-- Users table (single user system)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

-- API Keys table for external API access
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    api_key_prefix TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(api_key_prefix);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

-- User credentials table for storing various tokens/credentials (GitHub, GitLab, etc.)
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

-- Provider session read model for fast project overview queries.
CREATE TABLE IF NOT EXISTS provider_session_index (
    provider TEXT NOT NULL,
    session_id TEXT NOT NULL,
    source_session_id TEXT,
    origin TEXT,
    project_path TEXT NOT NULL,
    normalized_project_path TEXT NOT NULL,
    summary TEXT,
    title TEXT,
    route_title TEXT,
    model TEXT,
    thread TEXT,
    session_file_name TEXT,
    file_path TEXT NOT NULL,
    created_at TEXT,
    last_activity TEXT NOT NULL,
    message_count INTEGER,
    message_count_known INTEGER DEFAULT 0,
    file_mtime_ms REAL DEFAULT 0,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (provider, session_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_session_project_recent
    ON provider_session_index(provider, normalized_project_path, last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_provider_session_file
    ON provider_session_index(provider, file_path);

-- Project sidebar read model for fast DB-backed /api/projects.
CREATE TABLE IF NOT EXISTS project_index (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    display_name TEXT NOT NULL,
    project_path TEXT NOT NULL,
    normalized_project_path TEXT NOT NULL,
    route_path TEXT NOT NULL,
    source TEXT NOT NULL,
    visible INTEGER NOT NULL DEFAULT 1,
    visibility_reason TEXT,
    last_activity TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    sync_state TEXT
);

CREATE INDEX IF NOT EXISTS idx_project_index_visible_recent
    ON project_index(visible, last_activity DESC, indexed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_index_normalized_path
    ON project_index(normalized_project_path);

-- Workflow overview read model for fast DB-backed project overview cards.
CREATE TABLE IF NOT EXISTS workflow_overview_index (
    normalized_project_path TEXT NOT NULL,
    run_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    workflow_json TEXT NOT NULL,
    updated_at TEXT,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (normalized_project_path, run_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_overview_project_recent
    ON workflow_overview_index(normalized_project_path, visible, updated_at DESC, indexed_at DESC);

-- Workflow batch overview read model for project overview grouping.
CREATE TABLE IF NOT EXISTS workflow_batch_index (
    normalized_project_path TEXT NOT NULL,
    batch_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    batch_json TEXT NOT NULL,
    indexed_at TEXT DEFAULT CURRENT_TIMESTAMP,
    visible INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (normalized_project_path, batch_id)
);

CREATE INDEX IF NOT EXISTS idx_workflow_batch_project_recent
    ON workflow_batch_index(normalized_project_path, visible, batch_id DESC, indexed_at DESC);
