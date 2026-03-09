-- Auth 子域并行表（阶段 A2 基建）
-- 生成时间：2026-02-25

CREATE TABLE IF NOT EXISTS ba_user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE UNIQUE INDEX IF NOT EXISTS ba_user_email_unique ON ba_user(email);

CREATE TABLE IF NOT EXISTS ba_session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES ba_user(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS ba_session_token_unique ON ba_session(token);

CREATE TABLE IF NOT EXISTS ba_account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES ba_user(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ba_verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS user_auth_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
  auth_user_id TEXT NOT NULL,
  business_user_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (auth_user_id) REFERENCES ba_user(id) ON DELETE CASCADE,
  FOREIGN KEY (business_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS user_auth_links_auth_user_id_unique ON user_auth_links(auth_user_id);
CREATE UNIQUE INDEX IF NOT EXISTS user_auth_links_business_user_id_unique ON user_auth_links(business_user_id);
