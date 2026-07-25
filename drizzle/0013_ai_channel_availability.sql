CREATE TABLE IF NOT EXISTS ai_channel_availability_buckets (
  bucket_start TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  excluded_count INTEGER NOT NULL DEFAULT 0,
  last_error_class TEXT,
  updated_at TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (bucket_start, provider_id, model_id)
);

CREATE INDEX IF NOT EXISTS idx_availability_buckets_scan
  ON ai_channel_availability_buckets (bucket_start);

CREATE TABLE IF NOT EXISTS ai_channel_availability_snapshot (
  id TEXT PRIMARY KEY DEFAULT 'default',
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT '',
  source_bucket_max TEXT
);
