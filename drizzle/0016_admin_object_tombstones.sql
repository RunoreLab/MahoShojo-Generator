-- A detached key is never reused: R2 deletion has no transactional D1 CAS.
CREATE TABLE admin_object_tombstones (
  r2_key TEXT PRIMARY KEY NOT NULL,
  job_id TEXT NOT NULL REFERENCES admin_jobs(id),
  large_object_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER admin_object_tombstone_insert BEFORE INSERT ON large_objects
WHEN EXISTS (SELECT 1 FROM admin_object_tombstones WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT, 'ADMIN_OBJECT_KEY_RETIRED'); END;
--> statement-breakpoint
CREATE TRIGGER admin_object_tombstone_update BEFORE UPDATE OF r2_key ON large_objects
WHEN EXISTS (SELECT 1 FROM admin_object_tombstones WHERE r2_key=NEW.r2_key)
BEGIN SELECT RAISE(ABORT, 'ADMIN_OBJECT_KEY_RETIRED'); END;
