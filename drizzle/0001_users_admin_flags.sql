-- users 表补齐权限字段，消除代码与 schema 漂移
-- 生成时间：2026-02-25

ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN is_review_exempt INTEGER NOT NULL DEFAULT 0;
