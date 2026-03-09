-- Auth 一次性重置令牌表（阶段 A：recover 升级）
-- 生成时间：2026-02-25

CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_password_reset_tokens_token_hash_unique
  ON auth_password_reset_tokens(token_hash);

CREATE INDEX IF NOT EXISTS auth_password_reset_tokens_user_id_expires_at_idx
  ON auth_password_reset_tokens(user_id, expires_at);

CREATE INDEX IF NOT EXISTS auth_password_reset_tokens_expires_at_idx
  ON auth_password_reset_tokens(expires_at);
