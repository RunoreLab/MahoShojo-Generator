CREATE TABLE auto_review_decisions (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` integer NOT NULL,
  `target_kind` text NOT NULL CHECK (`target_kind` IN ('card', 'update')),
  `data_card_id` text NOT NULL,
  `update_id` text,
  `content_hash` text NOT NULL,
  `reviewed_updated_at` text,
  `backend_id` text NOT NULL,
  `backend_kind` text NOT NULL,
  `model` text,
  `verdict` text NOT NULL CHECK (`verdict` IN ('approve', 'reject', 'uncertain')),
  `action` text NOT NULL CHECK (`action` IN ('approve', 'reject', 'pending')),
  `applied` integer NOT NULL DEFAULT 0,
  `score` real,
  `category` text,
  `reason` text,
  `input_truncated` integer NOT NULL DEFAULT 0,
  `input_parse_error` integer NOT NULL DEFAULT 0,
  `latency_ms` integer,
  `attempted_backends` text,
  `details_json` text,
  `created_at` text NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE
);
CREATE INDEX `idx_auto_review_decisions_card` ON `auto_review_decisions`(`data_card_id`, `created_at`);
CREATE INDEX `idx_auto_review_decisions_user` ON `auto_review_decisions`(`user_id`, `created_at`);
