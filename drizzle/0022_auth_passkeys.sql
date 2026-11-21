-- 独立凭据与短效挑战表。已存在的账号、会话和桌面授权 grant 无需转换。
CREATE TABLE IF NOT EXISTS ba_passkey (
  id TEXT PRIMARY KEY NOT NULL,
  rp_id TEXT NOT NULL,
  auth_user_id TEXT NOT NULL REFERENCES ba_user(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  device_type TEXT NOT NULL CHECK (device_type IN ('singleDevice', 'multiDevice')),
  transports TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS ba_passkey_rp_credential_unique ON ba_passkey(rp_id, credential_id);
CREATE INDEX IF NOT EXISTS ba_passkey_owner_idx ON ba_passkey(auth_user_id, rp_id);

CREATE TABLE IF NOT EXISTS ba_passkey_challenge (
  id TEXT PRIMARY KEY NOT NULL,
  rp_id TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('login', 'register', 'confirm-register', 'confirm-delete')),
  binding TEXT NOT NULL,
  challenge TEXT NOT NULL,
  confirmed_by_passkey_id TEXT,
  expires_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS ba_passkey_challenge_expires_idx ON ba_passkey_challenge(expires_at);
