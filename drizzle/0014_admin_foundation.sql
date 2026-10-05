CREATE TABLE `admin_principals` (
  `id` text PRIMARY KEY NOT NULL,
  `issuer` text NOT NULL,
  `subject` text NOT NULL,
  `kind` text NOT NULL CHECK (`kind` IN ('human', 'service')),
  `status` text NOT NULL DEFAULT 'active' CHECK (`status` IN ('active', 'disabled')),
  `capabilities_json` text NOT NULL CHECK (json_valid(`capabilities_json`) AND json_type(`capabilities_json`) = 'array'),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_principals_identity_idx` ON `admin_principals` (`issuer`, `subject`, `kind`);
--> statement-breakpoint
CREATE TABLE `admin_operations` (
  `id` text PRIMARY KEY NOT NULL,
  `actor_principal_id` text NOT NULL REFERENCES `admin_principals` (`id`),
  `action` text NOT NULL,
  `capability` text NOT NULL,
  `request_id` text NOT NULL,
  `idempotency_key` text NOT NULL,
  `payload_hash` text NOT NULL,
  `reason` text NOT NULL,
  `expected_version` text,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `status` text NOT NULL CHECK (`status` IN ('pending', 'applied', 'succeeded', 'conflict')),
  `result_json` text CHECK (`result_json` IS NULL OR json_valid(`result_json`)),
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `admin_operations_idempotency_idx` ON `admin_operations` (`actor_principal_id`, `idempotency_key`);
--> statement-breakpoint
CREATE TABLE `admin_audit_events` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text REFERENCES `admin_operations` (`id`),
  `actor_principal_id` text REFERENCES `admin_principals` (`id`),
  `authn_context_safe_ref` text NOT NULL,
  `capability` text NOT NULL,
  `action` text NOT NULL,
  `target_type` text NOT NULL,
  `target_id` text NOT NULL,
  `request_id` text NOT NULL,
  `reason` text NOT NULL,
  `expected_version` text,
  `result` text NOT NULL CHECK (`result` IN ('success', 'denied', 'conflict', 'failed')),
  `error_code_safe` text,
  `source_context_safe` text NOT NULL,
  `created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_retention_idx` ON `admin_audit_events` (`created_at`);
--> statement-breakpoint
CREATE INDEX `admin_audit_events_operation_idx` ON `admin_audit_events` (`operation_id`);
--> statement-breakpoint
CREATE TABLE `admin_jobs` (
  `id` text PRIMARY KEY NOT NULL,
  `operation_id` text NOT NULL REFERENCES `admin_operations` (`id`),
  `actor_principal_id` text NOT NULL REFERENCES `admin_principals` (`id`),
  `capability` text NOT NULL,
  `kind` text NOT NULL,
  `scope_json` text NOT NULL CHECK (json_valid(`scope_json`)),
  `status` text NOT NULL CHECK (`status` IN ('queued', 'running', 'succeeded', 'failed', 'cancelled', 'uncertain')),
  `cursor_json` text,
  `processed_count` integer NOT NULL DEFAULT 0,
  `attempts` integer NOT NULL DEFAULT 0,
  `lease_token` text,
  `lease_expires_at` text,
  `next_attempt_at` text NOT NULL,
  `result_ref` text,
  `result_expires_at` text,
  `error_code_safe` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_jobs_retry_idx` ON `admin_jobs` (`status`, `next_attempt_at`);
