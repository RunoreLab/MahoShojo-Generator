ALTER TABLE site_messages ADD COLUMN created_by_admin_principal_id TEXT REFERENCES admin_principals(id);
--> statement-breakpoint
ALTER TABLE user_messages ADD COLUMN created_by_admin_principal_id TEXT REFERENCES admin_principals(id);
--> statement-breakpoint
ALTER TABLE report_appeals ADD COLUMN reviewed_by_admin_principal_id TEXT REFERENCES admin_principals(id);
--> statement-breakpoint
ALTER TABLE inspector_discipline_events ADD COLUMN created_by_admin_principal_id TEXT REFERENCES admin_principals(id);
