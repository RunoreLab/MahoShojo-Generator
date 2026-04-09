CREATE TABLE IF NOT EXISTS crowd_review_inspectors (
  user_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL,
  suspended_until TEXT,
  status_reason_code TEXT,
  status_reason_detail TEXT,
  updated_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inspector_discipline_events (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  reason_code TEXT,
  reason_detail TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_inspector_discipline_events_user_created_at
  ON inspector_discipline_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_inspector_discipline_events_type_created_at
  ON inspector_discipline_events(event_type, created_at DESC);

CREATE TABLE IF NOT EXISTS crowd_review_rounds (
  id TEXT PRIMARY KEY,
  report_case_id TEXT NOT NULL,
  status TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  deadline_at TEXT NOT NULL,
  extension_count INTEGER NOT NULL DEFAULT 0,
  min_valid_votes INTEGER NOT NULL,
  result_code TEXT,
  result_summary_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_case_id) REFERENCES report_cases(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crowd_review_rounds_report_case_active
  ON crowd_review_rounds(report_case_id)
  WHERE status IN ('pending_dispatch', 'active', 'waiting_more_votes');

CREATE INDEX IF NOT EXISTS idx_crowd_review_rounds_status_deadline
  ON crowd_review_rounds(status, deadline_at);

CREATE TABLE IF NOT EXISTS crowd_review_assignments (
  id TEXT PRIMARY KEY,
  crowd_review_round_id TEXT NOT NULL,
  inspector_user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  completed_at TEXT,
  decision TEXT,
  decision_note TEXT,
  post_vote_summary_json TEXT NOT NULL DEFAULT '{}',
  post_vote_summary_seen_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (crowd_review_round_id) REFERENCES crowd_review_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (inspector_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crowd_review_assignments_active_inspector
  ON crowd_review_assignments(inspector_user_id)
  WHERE status = 'assigned';

CREATE UNIQUE INDEX IF NOT EXISTS idx_crowd_review_assignments_round_inspector
  ON crowd_review_assignments(crowd_review_round_id, inspector_user_id);

CREATE INDEX IF NOT EXISTS idx_crowd_review_assignments_inspector_status_expires
  ON crowd_review_assignments(inspector_user_id, status, expires_at);

CREATE INDEX IF NOT EXISTS idx_crowd_review_assignments_round_status_assigned
  ON crowd_review_assignments(crowd_review_round_id, status, assigned_at);

CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT NOT NULL,
  text_color TEXT NOT NULL,
  background_color TEXT NOT NULL,
  border_color TEXT,
  rarity INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT 1,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO badges (
  id,
  name,
  description,
  icon,
  text_color,
  background_color,
  border_color,
  rarity,
  sort_order,
  is_active
) VALUES (
  'crowd_review_inspector',
  '巡查使',
  '持有该徽章且运行时状态为 active 的用户，可参与公开数据卡举报案件的众查。',
  '{"type":"lucide","name":"ShieldCheck"}',
  '{"type":"solid","value":"#ffffff"}',
  '{"type":"gradient","value":"linear-gradient(135deg, #0f766e, #0ea5e9)"}',
  '{"type":"solid","value":"#0f766e"}',
  88,
  31,
  1
);
