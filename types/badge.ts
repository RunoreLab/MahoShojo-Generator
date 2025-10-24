// 徽章系统类型定义

/**
 * 颜色配置类型
 * 支持纯色和渐变色
 */
export type ColorConfig =
  | { type: 'solid'; value: string }      // 纯色：#FF0000
  | { type: 'gradient'; value: string };  // 渐变：linear-gradient(...)

/**
 * 图标配置类型
 * 支持 lucide-react 图标、自定义 SVG 和 emoji
 */
export type IconConfig =
  | { type: 'lucide'; name: string }      // lucide-react 图标
  | { type: 'svg'; url: string }          // 自定义 SVG URL
  | { type: 'emoji'; value: string }      // Emoji 字符
  | { type: 'null'; value: null };        // 不展示

/**
 * 徽章定义
 * 系统中所有可用的徽章类型
 */
export interface BadgeDefinition {
  id: string;                      // 徽章唯一ID（如：founder, beta_tester）
  name: string;                    // 徽章名称（如：创始人）
  description?: string;            // 徽章描述
  icon: IconConfig;                // 图标配置
  textColor: ColorConfig;          // 文字颜色配置
  backgroundColor: ColorConfig;    // 背景颜色配置
  borderColor?: ColorConfig;       // 边框颜色配置（可选）
  rarity: number;                  // 稀有度（数字越大越稀有）
  sortOrder: number;               // 显示排序
  isActive: boolean;               // 是否可用
}

/**
 * 用户拥有的徽章
 * 关联用户和徽章定义
 */
export interface UserBadge {
  id: number;                      // 记录ID
  userId: number;                  // 用户ID
  badgeId: string;                 // 徽章ID（关联 BadgeDefinition.id）
  isEquipped: boolean;             // 是否佩戴
  displayOrder: number;            // 佩戴后的显示顺序（1-5）
  obtainedAt: string;              // 获得时间
  badge: BadgeDefinition;          // 关联的徽章定义
}

/**
 * 用户完整展示信息
 * 包含用户名、头衔和徽章
 */
export interface UserDisplayInfo {
  username: string;                // 用户名
  prefix?: string | null;          // 头衔字符串
  equippedBadges: UserBadge[];     // 已佩戴的徽章（最多5个）
}

/**
 * 解析后的头衔信息
 */
export interface ParsedTitle {
  icon?: IconConfig;               // 图标配置（可选）
  title: string;                   // 头衔文字
  textColor: string;               // 文字颜色（CSS 值）
  backgroundColor: string;         // 背景颜色（CSS 值）
  borderColor?: string;            // 边框颜色（可选）
}
