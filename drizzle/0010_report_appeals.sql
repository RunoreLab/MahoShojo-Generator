ALTER TABLE report_cases ADD COLUMN resolution_notified_at TEXT;
ALTER TABLE report_cases ADD COLUMN resolution_notified_case_updated_at TEXT;

CREATE TABLE IF NOT EXISTS report_appeals (
  id TEXT PRIMARY KEY,
  report_case_id TEXT NOT NULL,
  appellant_user_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  appeal_reason_code TEXT NOT NULL,
  details TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  resolution_code TEXT,
  resolution_note TEXT,
  case_status_snapshot TEXT NOT NULL,
  case_resolution_code_snapshot TEXT,
  case_updated_at_snapshot TEXT NOT NULL,
  reviewed_by_user_id INTEGER,
  reviewed_at TEXT,
  withdrawn_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_case_id) REFERENCES report_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (appellant_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_appeals_case_active
  ON report_appeals(report_case_id)
  WHERE status IN ('submitted', 'under_review');

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_appeals_case_snapshot_unique
  ON report_appeals(report_case_id, case_updated_at_snapshot)
  WHERE status IN ('submitted', 'under_review', 'resolved');

CREATE INDEX IF NOT EXISTS idx_report_appeals_appellant_created
  ON report_appeals(appellant_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_report_appeals_status_created
  ON report_appeals(status, created_at DESC);

CREATE TABLE IF NOT EXISTS report_appeal_references (
  id TEXT PRIMARY KEY,
  appeal_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  url_snapshot TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (appeal_id) REFERENCES report_appeals(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_appeal_references_sort
  ON report_appeal_references(appeal_id, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_appeal_references_target_unique
  ON report_appeal_references(appeal_id, reference_type, reference_id);
