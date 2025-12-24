/**
 * 图标注册表
 * 只导入项目中实际使用的 lucide-react 图标，避免打包体积过大
 */

import {
  Crown,
  NotebookPen,
  Star,
  Shield,
  Heart,
  Zap,
  Award,
  Gem,
  Sparkles,
  Flame,
  Trophy,
  Target,
  Sword,
  Wand2,
  Verified,
  Medal,
  Users,
  Code,
  Palette,
  MessageCircle,
  ThumbsUp,
  Newspaper,
  AlertTriangle,
  ChefHat,
  Bug,
  ShieldCheck,
  Gavel,
  HelpCircle,
  GitBranch,
  Rocket,
  Compass
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * 图标注册表
 * 键为图标名称，值为 lucide-react 图标组件
 */
export const ICON_REGISTRY: Record<string, LucideIcon> = {
  Crown,
  NotebookPen,
  Star,
  Shield,
  Heart,
  Zap,
  Award,
  Gem,
  Sparkles,
  Flame,
  Trophy,
  Target,
  Sword,
  Wand2,
  Verified,
  Medal,
  Users,
  Code,
  Palette,
  MessageCircle,
  ThumbsUp,
  Newspaper,
  AlertTriangle,
  ChefHat,
  Bug,
  ShieldCheck,
  Gavel,
  HelpCircle,
  GitBranch,
  Rocket,
  Compass
};

/**
 * 获取图标组件
 * @param iconName lucide-react 图标名称
 * @returns 图标组件，如果未找到返回 null
 */
export function getLucideIcon(iconName: string): LucideIcon | null {
  return ICON_REGISTRY[iconName] || null;
}

/**
 * 获取所有可用的图标名称列表
 * @returns 图标名称数组
 */
export function getAvailableIcons(): string[] {
  return Object.keys(ICON_REGISTRY);
}

/**
 * 检查图标是否存在
 * @param iconName 图标名称
 * @returns 是否存在
 */
export function hasIcon(iconName: string): boolean {
  return iconName in ICON_REGISTRY;
}
