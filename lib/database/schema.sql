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
  last_login_at DATETIME,
  is_banned TEXT,
  slot_count INTEGER,
  registration_ip TEXT,
  prefix TEXT
);

CREATE INDEX idx_users_username ON users(username);
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_auth_key ON users(auth_key);

-- 数据卡表
CREATE TABLE IF NOT EXISTS data_cards (
  id TEXT PRIMARY KEY NOT NULL,  -- UUID 字符串作为主键
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL CHECK(type IN ('character', 'scenario')),
  name TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,
  is_public BOOLEAN NOT NULL DEFAULT 0,  -- 0 = 私有, 1 = 公开
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
CREATE INDEX idx_data_cards_usage_count ON data_cards(usage_count);
CREATE INDEX idx_data_cards_like_count ON data_cards(like_count);
CREATE INDEX idx_data_cards_favorite_count ON data_cards(favorite_count);
CREATE INDEX idx_data_cards_deleted_at ON data_cards(deleted_at);
CREATE INDEX idx_data_cards_is_recommended ON data_cards(is_recommended);

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

  ip TEXT,                               -- 客户端 IP（来自 CF-Connecting-IP 或 X-Forwarded-For）
  ip_anonymized TEXT,                    -- 脱敏后的 IP（IPv4 /24 或 IPv6 /64）
  user_agent TEXT,
  cf_ray TEXT,
  cf_country TEXT,

  user_id INTEGER,                       -- 已登录用户（若可解析）
  username TEXT,
  user_prefix TEXT,

  mode TEXT NOT NULL,                    -- classic / kizuna / daily / scenario
  scenario_title TEXT,                   -- 情景标题（若有）
  language TEXT,
  selected_level TEXT,
  story_length TEXT,                     -- default / short / standard / detailed / long

  read_arena_history BOOLEAN,
  arena_history_read_limit INTEGER,      -- NULL 表示无限，或未启用
  write_arena_history BOOLEAN,
  read_current_state BOOLEAN,
  write_current_state BOOLEAN,

  user_guidance_preview TEXT,            -- 用户引导（截断预览）
  adjudication_events_preview TEXT,      -- 随机判定器事件（截断预览）

  custom_provider_id TEXT,               -- 自定义供应商ID（来自前端选择器）
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_battle_report_generations_started_at ON battle_report_generations(started_at);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_user_id ON battle_report_generations(user_id);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_winner ON battle_report_generations(winner);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_mode ON battle_report_generations(mode);
CREATE INDEX IF NOT EXISTS idx_battle_report_generations_status ON battle_report_generations(status);
