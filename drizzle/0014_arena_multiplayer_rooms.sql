CREATE TABLE IF NOT EXISTS arena_multiplayer_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  room_epoch TEXT NOT NULL,
  host_user_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'unlisted')),
  status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_arena_multiplayer_rooms_public_page
  ON arena_multiplayer_rooms (visibility, status, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_arena_multiplayer_rooms_host_page
  ON arena_multiplayer_rooms (host_user_id, status, last_activity_at DESC, id DESC);
