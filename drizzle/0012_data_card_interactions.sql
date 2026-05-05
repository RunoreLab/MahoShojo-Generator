CREATE TABLE IF NOT EXISTS data_card_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  data_card_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('like', 'usage')),
  actor_scope TEXT NOT NULL CHECK(actor_scope IN ('auth_user', 'activity_user', 'anonymous')),
  actor_key_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE,
  UNIQUE(data_card_id, event_type, actor_scope, actor_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_data_card_interactions_card_event
  ON data_card_interactions(data_card_id, event_type, created_at);
