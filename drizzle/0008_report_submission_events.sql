CREATE TABLE IF NOT EXISTS report_submission_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  reporter_user_id INTEGER NOT NULL,
  submission_decision TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (case_id) REFERENCES report_cases(id) ON DELETE CASCADE,
  FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
  FOREIGN KEY (reporter_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_report_submission_events_reporter_created_at
  ON report_submission_events(reporter_user_id, created_at DESC);
