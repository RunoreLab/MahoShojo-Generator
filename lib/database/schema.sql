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
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_data_cards_user_id ON data_cards(user_id);
CREATE INDEX idx_data_cards_type ON data_cards(type);
CREATE INDEX idx_data_cards_is_public ON data_cards(is_public);
CREATE INDEX idx_data_cards_usage_count ON data_cards(usage_count);
CREATE INDEX idx_data_cards_like_count ON data_cards(like_count);

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