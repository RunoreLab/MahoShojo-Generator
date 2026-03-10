-- 后台用户统计日快照
-- 生成时间：2026-03-10

CREATE TABLE IF NOT EXISTS admin_user_analytics_daily (
  metric_date TEXT PRIMARY KEY NOT NULL,
  total_users INTEGER NOT NULL DEFAULT 0,
  tracked_users INTEGER NOT NULL DEFAULT 0,
  untracked_users INTEGER NOT NULL DEFAULT 0,
  active_users_24h INTEGER NOT NULL DEFAULT 0,
  active_users_7d INTEGER NOT NULL DEFAULT 0,
  active_users_30d INTEGER NOT NULL DEFAULT 0,
  activity_coverage_rate REAL NOT NULL DEFAULT 0,
  generation_total_1d INTEGER NOT NULL DEFAULT 0,
  generation_completed_1d INTEGER NOT NULL DEFAULT 0,
  generation_aborted_1d INTEGER NOT NULL DEFAULT 0,
  generation_failed_1d INTEGER NOT NULL DEFAULT 0,
  generation_distinct_users_1d INTEGER NOT NULL DEFAULT 0,
  auth_success_1d INTEGER NOT NULL DEFAULT 0,
  auth_failed_1d INTEGER NOT NULL DEFAULT 0,
  frequency_trend_lookback_days INTEGER NOT NULL DEFAULT 30,
  frequency_profile TEXT NOT NULL DEFAULT 'v20260209',
  sample_users_active7d INTEGER NOT NULL DEFAULT 0,
  high_plus_users_active7d INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_active7d INTEGER NOT NULL DEFAULT 0,
  extreme_users_active7d INTEGER NOT NULL DEFAULT 0,
  high_plus_share_active7d REAL NOT NULL DEFAULT 0,
  very_high_plus_share_active7d REAL NOT NULL DEFAULT 0,
  extreme_share_active7d REAL NOT NULL DEFAULT 0,
  sample_users_tracked INTEGER NOT NULL DEFAULT 0,
  high_plus_users_tracked INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_tracked INTEGER NOT NULL DEFAULT 0,
  extreme_users_tracked INTEGER NOT NULL DEFAULT 0,
  high_plus_share_tracked REAL NOT NULL DEFAULT 0,
  very_high_plus_share_tracked REAL NOT NULL DEFAULT 0,
  extreme_share_tracked REAL NOT NULL DEFAULT 0,
  sample_users_all INTEGER NOT NULL DEFAULT 0,
  high_plus_users_all INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_all INTEGER NOT NULL DEFAULT 0,
  extreme_users_all INTEGER NOT NULL DEFAULT 0,
  high_plus_share_all REAL NOT NULL DEFAULT 0,
  very_high_plus_share_all REAL NOT NULL DEFAULT 0,
  extreme_share_all REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_user_analytics_daily_updated_at
  ON admin_user_analytics_daily(updated_at);
