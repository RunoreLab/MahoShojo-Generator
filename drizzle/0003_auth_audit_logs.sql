-- 认证审计日志（注册/登录/改密/改邮箱等）
-- 生成时间：2026-02-27

CREATE TABLE IF NOT EXISTS auth_audit_logs (
  id TEXT PRIMARY KEY NOT NULL,
  business_user_id INTEGER,
  auth_user_id TEXT,
  event_type TEXT NOT NULL,
  auth_source TEXT NOT NULL,
  identifier_type TEXT,
  ip TEXT,
  ip_anonymized TEXT,
  user_agent TEXT,
  result_code TEXT NOT NULL,
  result_message TEXT,
  metadata_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (business_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (auth_user_id) REFERENCES ba_user(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at
  ON auth_audit_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_event_type_created_at
  ON auth_audit_logs(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_business_user_id_created_at
  ON auth_audit_logs(business_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_auth_user_id_created_at
  ON auth_audit_logs(auth_user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_ip_anonymized_created_at
  ON auth_audit_logs(ip_anonymized, created_at);
