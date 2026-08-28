-- 数据库 Schema 定义

-- 角色统计表
-- 用于记录每个参战角色的胜、负、参战次数等信息
CREATE TABLE IF NOT EXISTS characters (
  name TEXT PRIMARY KEY NOT NULL,         -- 魔法少女的名字/代号，作为唯一标识
  is_preset BOOLEAN NOT NULL DEFAULT 0,   -- 是否是预设角色 (1 for true, 0 for false)
  wins INTEGER NOT NULL DEFAULT 0,        -- 胜利次数
  losses INTEGER NOT NULL DEFAULT 0,      -- 失败次数
  participations INTEGER NOT NULL DEFAULT 0 -- 总参战次数
);

-- 战斗记录表
-- 用于记录每一场战斗的概要信息
CREATE TABLE IF NOT EXISTS battles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- 唯一ID
  winner_name TEXT NOT NULL,              -- 胜利者名字 (如果是平局，可以存 "平局")
  participants_json TEXT NOT NULL,        -- 参战者列表 (JSON数组格式)
  created_at TEXT NOT NULL                -- 战斗发生时间
);

-- 新增的测试数据表，使用 32 位随机字符串 ID
-- 用于测试自定义 ID 插入功能
CREATE TABLE IF NOT EXISTS player_data (
  id TEXT PRIMARY KEY NOT NULL,           -- 32位随机字符串ID
  data TEXT NOT NULL,                     -- JSON格式的数据
  created_at TEXT NOT NULL,               -- 创建时间
  updated_at TEXT NOT NULL                -- 更新时间
);

-- 用户表
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  auth_key TEXT UNIQUE NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME,
  is_banned TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0,
  is_review_exempt INTEGER NOT NULL DEFAULT 0,
  slot_count INTEGER,
  registration_ip TEXT,
  prefix TEXT,
  signature TEXT,
  avatar_webp_base64 TEXT
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_key ON users(auth_key);

-- 一次性重置令牌表（recover 二段式重置）
CREATE TABLE IF NOT EXISTS auth_password_reset_tokens (
  id TEXT PRIMARY KEY NOT NULL,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  requested_ip TEXT,
  requested_user_agent TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_password_reset_tokens_token_hash_unique
  ON auth_password_reset_tokens(token_hash);
CREATE INDEX IF NOT EXISTS auth_password_reset_tokens_user_id_expires_at_idx
  ON auth_password_reset_tokens(user_id, expires_at);
CREATE INDEX IF NOT EXISTS auth_password_reset_tokens_expires_at_idx
  ON auth_password_reset_tokens(expires_at);

-- 认证审计日志
-- 用于记录注册/登录/改密/改邮箱等认证关键操作，支撑风控与安全提醒能力。
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

-- 数据卡表
CREATE TABLE IF NOT EXISTS data_cards (
  id TEXT PRIMARY KEY NOT NULL,  -- UUID 字符串作为主键
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'scenario', 'history', 'questionnaire')),
  name TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT 0,  -- 0 = 私有, 1 = 公开
  public_since DATETIME,                -- 公开起始时间（私有/封禁为 NULL；用于排位榜单“连续公开时长”门槛）
  usage_count INTEGER DEFAULT 0,
  like_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,
  review_status TEXT DEFAULT 'pending',  -- 审核状态：pending / approved / rejected
  is_recommended BOOLEAN DEFAULT 0,      -- 是否为管理员推荐内容
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  deleted_at DATETIME,                   -- 软删除标记，存在值则表示位于回收站
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_data_cards_user_id ON data_cards(user_id);
CREATE INDEX idx_data_cards_type ON data_cards(type);
CREATE INDEX idx_data_cards_is_public ON data_cards(is_public);
CREATE INDEX idx_data_cards_public_since ON data_cards(public_since);
CREATE INDEX idx_data_cards_usage_count ON data_cards(usage_count);
CREATE INDEX idx_data_cards_like_count ON data_cards(like_count);
CREATE INDEX idx_data_cards_favorite_count ON data_cards(favorite_count);
CREATE INDEX idx_data_cards_deleted_at ON data_cards(deleted_at);
CREATE INDEX idx_data_cards_is_recommended ON data_cards(is_recommended);
CREATE INDEX IF NOT EXISTS idx_data_cards_public_approved_type_created_at
  ON data_cards(type, is_public, review_status, deleted_at, created_at DESC);

CREATE TABLE IF NOT EXISTS data_card_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  data_card_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('like', 'usage')),
  actor_scope TEXT NOT NULL CHECK(actor_scope IN ('auth_user', 'activity_user', 'anonymous')),
  actor_key_hash TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE,
  UNIQUE(data_card_id, event_type, actor_scope, actor_key_hash)
);

CREATE INDEX IF NOT EXISTS idx_data_card_interactions_card_event
  ON data_card_interactions(data_card_id, event_type, created_at);

-- 数据卡更新暂存表：用于存放需要审核的新版本内容
CREATE TABLE IF NOT EXISTS data_card_updates (
  id TEXT PRIMARY KEY NOT NULL,              -- UUID，唯一标识一次更新
  data_card_id TEXT NOT NULL,                -- 关联主表 data_cards.id
  user_id INTEGER NOT NULL,                  -- 提交更新的用户
  name TEXT,                                 -- 新名称（可选）
  description TEXT,                          -- 新描述（可选）
  data TEXT,                                 -- 新内容 JSON 字符串（可选）
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(data_card_id)                       -- 同一张卡同一时间仅保留一条待审核更新
);

CREATE INDEX IF NOT EXISTS idx_data_card_updates_user_id ON data_card_updates(user_id);

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  user_id INTEGER NOT NULL,
  data_card_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, data_card_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE
);

CREATE INDEX idx_favorites_data_card_id ON favorites(data_card_id);

-- 卡组表
-- 用于保存用户创建的卡组（可包含多个数据卡引用）
-- is_public: 0=私有, 1=公开, -1=管理员封禁（与 data_cards 约定一致）
CREATE TABLE IF NOT EXISTS decks (
  id TEXT PRIMARY KEY NOT NULL,           -- UUID 字符串作为主键
  user_id INTEGER NOT NULL,               -- 卡组所有者
  name TEXT NOT NULL,                     -- 卡组名称
  description TEXT,                       -- 描述（可选）
  is_public BOOLEAN NOT NULL DEFAULT 0,   -- 0=私有, 1=公开, -1=封禁
  like_count INTEGER DEFAULT 0,
  favorite_count INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_decks_user_id ON decks(user_id);
CREATE INDEX IF NOT EXISTS idx_decks_is_public ON decks(is_public);
CREATE INDEX IF NOT EXISTS idx_decks_like_count ON decks(like_count);
CREATE INDEX IF NOT EXISTS idx_decks_favorite_count ON decks(favorite_count);

-- 卡组-数据卡关联表
-- 注意：不对 data_cards 建立外键约束，以便在数据卡被硬删除后仍保留占位信息并允许卡组所有者一键清理
CREATE TABLE IF NOT EXISTS deck_cards (
  deck_id TEXT NOT NULL,
  data_card_id TEXT NOT NULL,
  card_name_snapshot TEXT,               -- 加入卡组时的名称快照（用于卡片不可访问/被删除时显示）
  card_type_snapshot TEXT,               -- 'character' | 'scenario' 快照（用于不可访问时提示）
  sort_order INTEGER NOT NULL DEFAULT 0, -- 卡组内排序
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (deck_id, data_card_id),
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deck_cards_deck_id ON deck_cards(deck_id);
CREATE INDEX IF NOT EXISTS idx_deck_cards_sort_order ON deck_cards(deck_id, sort_order);

-- 卡组收藏表（仅允许收藏公开卡组）
CREATE TABLE IF NOT EXISTS deck_favorites (
  user_id INTEGER NOT NULL,
  deck_id TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, deck_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (deck_id) REFERENCES decks(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_deck_favorites_deck_id ON deck_favorites(deck_id);

-- 公开数据卡举报案件表
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
  resolution_notified_at TEXT,
  resolution_notified_case_updated_at TEXT,
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

-- 单条举报记录表
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

-- 举报有效提交事件表
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

-- 举报引用表
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

-- 举报处理结果申诉表
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

-- 兑换码表（用完即删除，无需记录历史）
CREATE TABLE IF NOT EXISTS redemption_codes (
  code TEXT PRIMARY KEY NOT NULL,           -- 兑换码
  slot_count INTEGER NOT NULL,              -- 加的槽位数量
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 徽章定义表
CREATE TABLE IF NOT EXISTS badges (
  id TEXT PRIMARY KEY NOT NULL,              -- 徽章唯一ID（如：founder, beta_tester）
  name TEXT NOT NULL,                        -- 徽章名称
  description TEXT,                          -- 徽章描述
  icon TEXT NOT NULL,                        -- 图标配置（JSON格式）
  text_color TEXT NOT NULL,                  -- 文字颜色配置（JSON格式）
  background_color TEXT NOT NULL,            -- 背景颜色配置（JSON格式）
  border_color TEXT,                         -- 边框颜色配置（JSON格式，可选）
  rarity INTEGER DEFAULT 0,                  -- 稀有度（数字越大越稀有）
  sort_order INTEGER DEFAULT 0,              -- 显示排序
  is_active BOOLEAN DEFAULT 1,               -- 是否可用
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_badges_rarity ON badges(rarity);
CREATE INDEX IF NOT EXISTS idx_badges_is_active ON badges(is_active);

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

-- 用户徽章关联表
CREATE TABLE IF NOT EXISTS user_badges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,                  -- 用户ID
  badge_id TEXT NOT NULL,                    -- 徽章ID（关联 badges.id）
  is_equipped BOOLEAN DEFAULT 0,             -- 是否佩戴（0=未佩戴，1=已佩戴）
  display_order INTEGER DEFAULT 0,           -- 佩戴后的显示顺序（1-5）
  obtained_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 获得时间
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (badge_id) REFERENCES badges(id) ON DELETE CASCADE,
  UNIQUE(user_id, badge_id)                  -- 确保用户不能重复拥有同一徽章
);

CREATE INDEX IF NOT EXISTS idx_user_badges_user_id ON user_badges(user_id);
CREATE INDEX IF NOT EXISTS idx_user_badges_is_equipped ON user_badges(is_equipped);

-- 战报生成记录表
-- 用于记录每次战报生成（含中断但已产出部分内容）的元数据与小型摘要，便于后续排行榜/风控/统计。
CREATE TABLE IF NOT EXISTS battle_report_generations (
  id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  status TEXT NOT NULL,                  -- completed / aborted / failed

  generation_mode TEXT NOT NULL,         -- stream / non-stream
  endpoint TEXT NOT NULL,                -- 写入来源（如 api/arena/generate）

  ip TEXT,                               -- 客户端 IP（来自 CF-Connecting-IP 或 X-Forwarded-For）
  ip_anonymized TEXT,                    -- 脱敏后的 IP（IPv4 /24 或 IPv6 /64）
  user_agent TEXT,
  referer TEXT,
  accept_language TEXT,
  cf_ray TEXT,
  cf_country TEXT,

  user_id INTEGER,                       -- 已登录用户（若可解析）
  username TEXT,
  user_prefix TEXT,

  mode TEXT NOT NULL,                    -- classic / kizuna / daily / scenario
  scenario_title TEXT,                   -- 情景标题（若有）
  scenario_data_card_id TEXT,            -- 情景数据卡ID（若来自数据库）
  scenario_data_card_updated_at TEXT,    -- 情景数据卡更新时间（若来自数据库）
  language TEXT,
  selected_level TEXT,
  story_length TEXT,                     -- default / short / standard / detailed / long

  read_arena_history BOOLEAN,
  arena_history_read_limit INTEGER,      -- NULL 表示无限，或未启用
  write_arena_history BOOLEAN,
  read_current_state BOOLEAN,
  write_current_state BOOLEAN,

  combatant_count INTEGER,
  has_scenario BOOLEAN,
  has_user_guidance BOOLEAN,
  has_adjudication_events BOOLEAN,
  has_teams BOOLEAN,
  input_chars INTEGER,
  input_bytes INTEGER,

  user_guidance_preview TEXT,            -- 用户引导（截断预览）
  adjudication_events_preview TEXT,      -- 随机判定器事件（截断预览）

  combatants_write_ok BOOLEAN,           -- 角色明细是否成功写入
  combatants_row_count INTEGER,          -- 角色明细写入行数（期望值）
  combatants_write_error TEXT,           -- 角色明细写入失败原因（简短）

  custom_provider_id TEXT,               -- 自定义供应商ID（来自前端选择器）
  custom_model_id TEXT,                  -- 用户选择的模型ID（若有）
  is_downgrade BOOLEAN,
  ai_provider_name TEXT,                 -- 实际使用的提供商（系统负载均衡后）
  ai_provider_type TEXT,                 -- openai / google / deepseek
  ai_model TEXT,                         -- 实际使用的模型

  headline TEXT,                         -- 战报标题（若可解析）
  winner TEXT,                           -- 胜利者（若可解析）

  output_chars INTEGER,                  -- 输出正文字符数（近似）
  output_bytes INTEGER,                  -- 输出字节数（近似）

  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  total_tokens INTEGER,
  cached_tokens INTEGER,
  reasoning_tokens INTEGER,

  output_preview TEXT,                   -- 输出正文预览（前后截断）
  output_has_sensitive_words BOOLEAN,    -- 是否检测到敏感词（可能仅基于预览）
  output_has_shield_words BOOLEAN,       -- 是否检测到屏蔽词（可能仅基于预览）

  extra_json TEXT,                       -- 其余扩展数据（JSON，尽量小）

  -- PVP 关联（可空；普通竞技场战报不填）
  pvp_room_id TEXT,
  pvp_match_id TEXT,
  pvp_round_id TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battle_report_generations_started_at ON battle_report_generations(started_at);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_user_id ON battle_report_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_winner ON battle_report_generations(winner);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_mode ON battle_report_generations(mode);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_status ON battle_report_generations(status);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_generation_mode ON battle_report_generations(generation_mode);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_endpoint ON battle_report_generations(endpoint);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_scenario_data_card_id ON battle_report_generations(scenario_data_card_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_room_id ON battle_report_generations(pvp_room_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_match_id ON battle_report_generations(pvp_match_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_pvp_round_id ON battle_report_generations(pvp_round_id);

-- 用户活跃追踪（后台统计用）
-- 说明：用于以较低 D1_ROWS_READ 代价统计「最近24小时/7天活跃用户」等指标。
-- 统计口径：用户在任意业务操作中被“触达”（touch）后会更新 last_seen_at。
CREATE TABLE IF NOT EXISTS user_last_activity (
  user_id INTEGER PRIMARY KEY NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_last_activity_last_seen_at ON user_last_activity(last_seen_at);

-- 后台用户统计日快照
-- 用于承载不可严格回算的窗口型趋势（活跃、覆盖率、高频占比）。
CREATE TABLE IF NOT EXISTS admin_user_analytics_daily (
  metric_date TEXT PRIMARY KEY NOT NULL,                    -- YYYY-MM-DD (UTC)
  total_users INTEGER NOT NULL DEFAULT 0,
  tracked_users INTEGER NOT NULL DEFAULT 0,
  untracked_users INTEGER NOT NULL DEFAULT 0,
  active_users_24h INTEGER NOT NULL DEFAULT 0,
  active_users_7d INTEGER NOT NULL DEFAULT 0,
  active_users_30d INTEGER NOT NULL DEFAULT 0,
  activity_coverage_rate REAL NOT NULL DEFAULT 0,
  generation_total_1d INTEGER NOT NULL DEFAULT 0,
  generation_completed_1d INTEGER NOT NULL DEFAULT 0,
  generation_aborted_1d INTEGER NOT NULL DEFAULT 0,
  generation_failed_1d INTEGER NOT NULL DEFAULT 0,
  generation_distinct_users_1d INTEGER NOT NULL DEFAULT 0,
  auth_success_1d INTEGER NOT NULL DEFAULT 0,
  auth_failed_1d INTEGER NOT NULL DEFAULT 0,
  frequency_trend_lookback_days INTEGER NOT NULL DEFAULT 30,
  frequency_profile TEXT NOT NULL DEFAULT 'v20260209',
  sample_users_active7d INTEGER NOT NULL DEFAULT 0,
  high_plus_users_active7d INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_active7d INTEGER NOT NULL DEFAULT 0,
  extreme_users_active7d INTEGER NOT NULL DEFAULT 0,
  high_plus_share_active7d REAL NOT NULL DEFAULT 0,
  very_high_plus_share_active7d REAL NOT NULL DEFAULT 0,
  extreme_share_active7d REAL NOT NULL DEFAULT 0,
  sample_users_tracked INTEGER NOT NULL DEFAULT 0,
  high_plus_users_tracked INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_tracked INTEGER NOT NULL DEFAULT 0,
  extreme_users_tracked INTEGER NOT NULL DEFAULT 0,
  high_plus_share_tracked REAL NOT NULL DEFAULT 0,
  very_high_plus_share_tracked REAL NOT NULL DEFAULT 0,
  extreme_share_tracked REAL NOT NULL DEFAULT 0,
  sample_users_all INTEGER NOT NULL DEFAULT 0,
  high_plus_users_all INTEGER NOT NULL DEFAULT 0,
  very_high_plus_users_all INTEGER NOT NULL DEFAULT 0,
  extreme_users_all INTEGER NOT NULL DEFAULT 0,
  high_plus_share_all REAL NOT NULL DEFAULT 0,
  very_high_plus_share_all REAL NOT NULL DEFAULT 0,
  extreme_share_all REAL NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_admin_user_analytics_daily_updated_at
  ON admin_user_analytics_daily(updated_at);

-- 大对象索引表（R2 外部化）
-- 用于把大字段（战报正文、PVP 快照、立绘等）外部化到 R2，并在 D1 内保存可查询的索引。
CREATE TABLE IF NOT EXISTS large_objects (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,                    -- 业务类型（如 battle_report_generation_output）
  owner_ref_id TEXT NOT NULL,            -- 业务实体ID（如 generationId / roomId / dataCardId）
  owner_user_id INTEGER,                -- 归属用户（可空）
  r2_key TEXT NOT NULL,                 -- R2 对象 key（不含 bucket）
  bytes INTEGER NOT NULL,               -- 原始内容字节量（未压缩）
  stored_bytes INTEGER,                 -- 存入 R2 的字节量（可空；gzip/流式场景可记录）
  sha256 TEXT,                          -- 可选：内容 hash（用于去重/校验）
  content_type TEXT,                    -- 如 application/json; charset=utf-8 / text/markdown; charset=utf-8 / image/webp
  content_encoding TEXT,                -- 如 gzip
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE(kind, owner_ref_id)
);

CREATE INDEX IF NOT EXISTS idx_large_objects_kind_created_at ON large_objects(kind, created_at);
CREATE INDEX IF NOT EXISTS idx_large_objects_owner_user_id_created_at ON large_objects(owner_user_id, created_at);

-- 战报生成记录-参战者明细表
-- 用于记录每条生成记录中每位角色的可查询信息（未来排行榜/统计的关键维度）。
CREATE TABLE IF NOT EXISTS battle_report_generation_combatants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generation_id TEXT NOT NULL,
  sort_index INTEGER NOT NULL,

  name TEXT NOT NULL,                    -- 角色名/代号（以 codename 优先）
  type TEXT,                             -- magical-girl / canshou / general-character
  template_id TEXT,
  is_native BOOLEAN,
  is_preset BOOLEAN,
  team_id INTEGER,
  character_guidance TEXT,              -- 用户对该角色的行动/想法引导（可选，<=100字）

  data_card_id TEXT,                     -- 角色数据卡ID（若来自数据库）
  data_card_updated_at TEXT,             -- 角色数据卡更新时间（若来自数据库）

  size_chars INTEGER,                    -- 角色 JSON 字符数（近似）
  size_bytes INTEGER,                    -- 角色 JSON 字节数（近似）

  created_at TEXT NOT NULL,
  FOREIGN KEY (generation_id) REFERENCES battle_report_generations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_battle_report_generation_combatants_generation_id ON battle_report_generation_combatants(generation_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generation_combatants_data_card_id ON battle_report_generation_combatants(data_card_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generation_combatants_name ON battle_report_generation_combatants(name);

-- =================================================================
-- PVP 房间制对战（MVP：2人、轮询）
-- =================================================================

-- PVP 房间
CREATE TABLE IF NOT EXISTS pvp_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  host_user_id INTEGER NOT NULL,
  status TEXT NOT NULL,            -- open / closed
  phase TEXT NOT NULL,             -- waiting / submitting / dealing / choosing / resolving / finished / aborted / closed
  rules_json TEXT NOT NULL,
  current_match_id TEXT,
  join_code_hash TEXT,
  join_code_salt TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  last_activity_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_rooms_status ON pvp_rooms(status);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_updated_at ON pvp_rooms(updated_at);
CREATE INDEX IF NOT EXISTS idx_pvp_rooms_current_match_id ON pvp_rooms(current_match_id);

-- PVP 房间玩家
CREATE TABLE IF NOT EXISTS pvp_room_players (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'player', -- player / spectator
  seat INTEGER,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_room_players_room_id ON pvp_room_players(room_id);

-- PVP 房间聊天（仅允许预设文字组合 + 表情包/emoji）
CREATE TABLE IF NOT EXISTS pvp_room_chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_id TEXT NOT NULL,
  sender_user_id INTEGER NOT NULL,
  sender_role TEXT NOT NULL, -- player / spectator
  sender_username TEXT NOT NULL,
  sender_prefix TEXT,
  content_json TEXT NOT NULL,
  rendered_text TEXT,
  sticker_id TEXT,
  emoji_text TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_room_chat_messages_room_id_id ON pvp_room_chat_messages(room_id, id);
CREATE INDEX IF NOT EXISTS idx_pvp_room_chat_messages_room_id_created_at ON pvp_room_chat_messages(room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pvp_room_chat_messages_room_id_sender_user_id_id ON pvp_room_chat_messages(room_id, sender_user_id, id);

-- PVP 提交
CREATE TABLE IF NOT EXISTS pvp_room_submissions (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  submission_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- PVP 手牌
CREATE TABLE IF NOT EXISTS pvp_room_hands (
  room_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  hand_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- PVP 卡快照（保证复盘一致）
CREATE TABLE IF NOT EXISTS pvp_room_card_snapshots (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  owner_user_id INTEGER NOT NULL,
  ref_json TEXT NOT NULL,
  card_type TEXT NOT NULL,
  name TEXT NOT NULL,
  data_json TEXT NOT NULL,
  source_updated_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_room_card_snapshots_room_id ON pvp_room_card_snapshots(room_id);

-- PVP 回合
CREATE TABLE IF NOT EXISTS pvp_rounds (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  match_id TEXT,
  round_index INTEGER NOT NULL,
  status TEXT NOT NULL,           -- pending / resolving / completed / aborted
  battle_generation_id TEXT,
  public_snapshot_json TEXT,
  result_json TEXT,
  winner_user_id INTEGER,
  winner_name TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_rounds_room_id ON pvp_rounds(room_id);
CREATE INDEX IF NOT EXISTS idx_pvp_rounds_match_id ON pvp_rounds(match_id);

-- PVP 对战（整场）记录：用于排行/生涯统计（与 room 可复用解耦）
CREATE TABLE IF NOT EXISTS pvp_matches (
  id TEXT PRIMARY KEY NOT NULL,
  room_id TEXT NOT NULL,
  status TEXT NOT NULL, -- active / completed / aborted
  rules_json TEXT NOT NULL,
  participants INTEGER NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  winner_user_id INTEGER,
  result_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (room_id) REFERENCES pvp_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (winner_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_pvp_matches_room_id ON pvp_matches(room_id);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_status ON pvp_matches(status);
CREATE INDEX IF NOT EXISTS idx_pvp_matches_started_at ON pvp_matches(started_at);

-- PVP 对战参与者快照
CREATE TABLE IF NOT EXISTS pvp_match_players (
  match_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  seat INTEGER NOT NULL,
  username TEXT,
  user_prefix TEXT,
  joined_at TEXT NOT NULL,
  PRIMARY KEY (match_id, user_id),
  FOREIGN KEY (match_id) REFERENCES pvp_matches(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_match_players_match_id ON pvp_match_players(match_id);
CREATE INDEX IF NOT EXISTS idx_pvp_match_players_user_id ON pvp_match_players(user_id);

-- PVP 回合出牌
CREATE TABLE IF NOT EXISTS pvp_round_choices (
  round_id TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  choice_ref_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (round_id, user_id),
  FOREIGN KEY (round_id) REFERENCES pvp_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pvp_round_choices_round_id ON pvp_round_choices(round_id);

-- =================================================================
-- Arena 排位（v0.6.0）
-- =================================================================

CREATE TABLE IF NOT EXISTS arena_ratings (
  entity_type TEXT NOT NULL CHECK(entity_type IN ('data_card', 'preset')),
  entity_id TEXT NOT NULL,
  queue TEXT NOT NULL CHECK(queue IN ('strict', 'free')),

  rating INTEGER NOT NULL DEFAULT 1000,
  games INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  season_peak_rating INTEGER,
  season_peak_games INTEGER,
  season_peak_at TEXT,
  season_peak_tier TEXT,
  season_low_rating INTEGER,
  season_low_games INTEGER,
  season_low_at TEXT,
  last_delta INTEGER,
  last_applied_at TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,

  PRIMARY KEY (entity_type, entity_id, queue)
);

CREATE INDEX IF NOT EXISTS idx_arena_ratings_queue_rating ON arena_ratings(queue, rating DESC);
CREATE INDEX IF NOT EXISTS idx_arena_ratings_queue_games ON arena_ratings(queue, games DESC);
CREATE INDEX IF NOT EXISTS idx_arena_ratings_updated_at ON arena_ratings(updated_at);

CREATE TABLE IF NOT EXISTS arena_rating_events (
  id TEXT PRIMARY KEY NOT NULL,
  generation_id TEXT NOT NULL,
  queue TEXT NOT NULL CHECK(queue IN ('strict', 'free')),

  status TEXT NOT NULL CHECK(status IN ('pending', 'applied', 'skipped', 'failed')),
  skip_reason TEXT,

  user_id INTEGER,
  ip_anonymized TEXT,

  pair_key TEXT NOT NULL,

  a_entity_type TEXT NOT NULL CHECK(a_entity_type IN ('data_card', 'preset')),
  a_entity_id TEXT NOT NULL,
  b_entity_type TEXT NOT NULL CHECK(b_entity_type IN ('data_card', 'preset')),
  b_entity_id TEXT NOT NULL,

  winner_slot INTEGER NOT NULL CHECK(winner_slot IN (0, 1, 2)),

  a_before_rating INTEGER,
  a_after_rating INTEGER,
  a_delta INTEGER,
  a_before_games INTEGER,
  a_after_games INTEGER,

  b_before_rating INTEGER,
  b_after_rating INTEGER,
  b_delta INTEGER,
  b_before_games INTEGER,
  b_after_games INTEGER,

  details_json TEXT,

  created_at TEXT NOT NULL,
  applied_at TEXT,

  FOREIGN KEY (generation_id) REFERENCES battle_report_generations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE (generation_id, queue)
);

CREATE INDEX IF NOT EXISTS idx_arena_rating_events_queue_created_at ON arena_rating_events(queue, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_user_pair_created_at ON arena_rating_events(user_id, pair_key, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_ip_pair_created_at ON arena_rating_events(ip_anonymized, pair_key, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_user_queue_status_created_at
  ON arena_rating_events(user_id, queue, status, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_a_entity_queue_status_created_at
  ON arena_rating_events(a_entity_type, a_entity_id, queue, status, created_at);
CREATE INDEX IF NOT EXISTS idx_arena_rating_events_b_entity_queue_status_created_at
  ON arena_rating_events(b_entity_type, b_entity_id, queue, status, created_at);

-- =================================================================
-- Data Card Metrics（v0.6.0）
-- =================================================================
CREATE TABLE IF NOT EXISTS data_card_metrics (
  data_card_id TEXT PRIMARY KEY NOT NULL,
  tech_score INTEGER NOT NULL,
  tech_level TEXT NOT NULL CHECK(tech_level IN ('L0','L1','L2','L3','L4','L5')),
  is_native BOOLEAN,
  data_card_updated_at TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_data_card_metrics_tech_score ON data_card_metrics(tech_score DESC);
CREATE INDEX IF NOT EXISTS idx_data_card_metrics_tech_level ON data_card_metrics(tech_level);
CREATE INDEX IF NOT EXISTS idx_data_card_metrics_is_native ON data_card_metrics(is_native);

-- =================================================================
-- Tags（v0.6.0）
-- =================================================================
CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  scope TEXT NOT NULL CHECK(scope IN ('user','system','admin')),
  is_active BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_scope ON tags(scope);
CREATE INDEX IF NOT EXISTS idx_tags_is_active ON tags(is_active);
CREATE INDEX IF NOT EXISTS idx_tags_category ON tags(category);

CREATE TABLE IF NOT EXISTS tag_aliases (
  alias TEXT PRIMARY KEY NOT NULL,
  tag_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tag_aliases_tag_id ON tag_aliases(tag_id);

CREATE TABLE IF NOT EXISTS data_card_tags (
  data_card_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (data_card_id, tag_id),
  FOREIGN KEY (data_card_id) REFERENCES data_cards(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_data_card_tags_tag_id ON data_card_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_data_card_tags_data_card_id ON data_card_tags(data_card_id);

-- =================================================================
-- Messages（v0.8.2）
-- =================================================================
CREATE TABLE IF NOT EXISTS site_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  title_text TEXT,
  body_text TEXT,
  action_url TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  expires_at TEXT,
  created_by_user_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_site_messages_active_id ON site_messages(id, expires_at);
CREATE INDEX IF NOT EXISTS idx_site_messages_created_at ON site_messages(created_at);

CREATE TABLE IF NOT EXISTS user_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  recipient_user_id INTEGER NOT NULL,
  actor_user_id INTEGER,
  channel TEXT NOT NULL DEFAULT 'system',
  message_type TEXT NOT NULL,
  template_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  title_text TEXT,
  body_text TEXT,
  action_url TEXT,
  source_entity_type TEXT,
  source_entity_id TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',
  read_at TEXT,
  archived_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_inbox
  ON user_messages(recipient_user_id, archived_at, read_at, id DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_created_at
  ON user_messages(recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_messages_recipient_source
  ON user_messages(recipient_user_id, source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_user_messages_expires_at ON user_messages(expires_at);

CREATE TABLE IF NOT EXISTS user_message_state (
  user_id INTEGER PRIMARY KEY,
  last_read_site_message_id INTEGER NOT NULL DEFAULT 0,
  last_summary_read_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- =================================================================
-- Arena Multiplayer Room Directory（derived discovery index）
-- =================================================================
CREATE TABLE IF NOT EXISTS arena_multiplayer_rooms (
  id TEXT PRIMARY KEY NOT NULL,
  room_epoch TEXT NOT NULL,
  host_user_id INTEGER NOT NULL,
  title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 80),
  visibility TEXT NOT NULL CHECK(visibility IN ('public', 'unlisted')),
  status TEXT NOT NULL CHECK(status IN ('open', 'closed')),
  created_at TEXT NOT NULL,
  last_activity_at TEXT NOT NULL,
  FOREIGN KEY (host_user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_arena_multiplayer_rooms_public_page
  ON arena_multiplayer_rooms (visibility, status, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_arena_multiplayer_rooms_host_page
  ON arena_multiplayer_rooms (host_user_id, status, last_activity_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_arena_multiplayer_rooms_reconcile_page
  ON arena_multiplayer_rooms (status, last_activity_at DESC, id DESC);
