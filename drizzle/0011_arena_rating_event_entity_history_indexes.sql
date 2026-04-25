CREATE INDEX IF NOT EXISTS idx_arena_rating_events_a_entity_queue_status_created_at
  ON arena_rating_events(a_entity_type, a_entity_id, queue, status, created_at);

CREATE INDEX IF NOT EXISTS idx_arena_rating_events_b_entity_queue_status_created_at
  ON arena_rating_events(b_entity_type, b_entity_id, queue, status, created_at);
