CREATE TABLE IF NOT EXISTS report_cases (
  id TEXT PRIMARY KEY,
  target_entity_type TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  target_user_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  resolution_code TEXT,
  creator_notified_at TEXT,
  creator_notified_report_count INTEGER NOT NULL DEFAULT 0,
  latest_reported_at TEXT NOT NULL,
  target_card_updated_at_at_notice TEXT,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_cases_target_open
  ON report_cases(target_entity_type, target_entity_id)
  WHERE status IN ('open', 'under_review');

CREATE INDEX IF NOT EXISTS idx_report_cases_status_latest
  ON report_cases(status, latest_reported_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  reporter_user_id INTEGER NOT NULL,
  reason_code TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL,
  evidence_summary_json TEXT NOT NULL DEFAULT '{}',
  normalized_payload_hash TEXT NOT NULL,
  target_name_snapshot TEXT NOT NULL,
  target_description_snapshot TEXT,
  target_data_snapshot TEXT NOT NULL,
  target_updated_at_snapshot TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  withdrawn_at TEXT,
  FOREIGN KEY (case_id) REFERENCES report_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_case_reporter_active
  ON reports(case_id, reporter_user_id)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_reports_case_status_created
  ON reports(case_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_updated_at
  ON reports(reporter_user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_reports_reporter_status_created
  ON reports(reporter_user_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS report_references (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  label_snapshot TEXT NOT NULL,
  url_snapshot TEXT,
  note TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_references_report_sort
  ON report_references(report_id, sort_order, created_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_report_references_report_target_unique
  ON report_references(report_id, reference_type, reference_id);
