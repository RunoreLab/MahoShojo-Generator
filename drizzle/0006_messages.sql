CREATE TABLE IF NOT EXISTS site_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  title_text TEXT,
  body_text TEXT,
  action_url TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  expires_at TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_site_messages_active_id
  ON site_messages(id, expires_at);

CREATE INDEX IF NOT EXISTS idx_site_messages_created_at
  ON site_messages(created_at);

CREATE TABLE IF NOT EXISTS user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'system',
  message_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  title_text TEXT,
  body_text TEXT,
  action_url TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  read_at TEXT,
  archived_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_inbox
  ON user_messages(recipient_user_id, archived_at, read_at, id DESC);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_created_at
  ON user_messages(recipient_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_source
  ON user_messages(recipient_user_id, source_entity_type, source_entity_id);

CREATE INDEX IF NOT EXISTS idx_user_messages_expires_at
  ON user_messages(expires_at);

CREATE TABLE IF NOT EXISTS user_message_state (
  user_id INTEGER PRIMARY KEY,
  last_read_site_message_id INTEGER NOT NULL DEFAULT 0,
  last_summary_read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
