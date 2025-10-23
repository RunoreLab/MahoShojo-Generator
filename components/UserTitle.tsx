import React from 'react';
import Badge from './badge/Badge';
import type { UserBadge } from '@/types/badge';

interface UserTitleProps {
  prefix?: string | null;
  badges?: UserBadge[];
  className?: string;
  showBadges?: boolean;
}

// @deprecated
/**
 * 解析用户头衔前缀字符串
 *
 * 新格式（推荐）: "图标配置JSON|头衔名称|文字色|背景色|边框色"
 * 示例: {"type":"lucide","name":"Crown"}|创始人|#FFD700|linear-gradient(135deg, #667eea, #764ba2)|#FFD700
 *
 * 旧格式（兼容）: "头衔名称,文字色,背景色"
 * 示例: "管理员,#FFFFFF,#FF1493"
 *
 * @param prefix 前缀字符串
 * @returns 解析后的头衔对象，如果解析失败返回 null
 */
// function parsePrefix(prefix?: string | null): ParsedTitle | null {
//   if (!prefix || typeof prefix !== 'string') {
//     return null;
//   }

//   let icon: IconConfig | undefined;
//   let title = '';
//   let textColor = '';
//   let backgroundColor = '';
//   let borderColor = '';

//   // 1. 尝试新格式（用 | 分割）
//   if (prefix.includes('|')) {
//     const parts = prefix.split('|').map(p => p.trim());

//     if (parts.length >= 4) {
//       const [iconPart, titlePart, textColorPart, backgroundColorPart, borderColorPart] = parts;

//       // 解析图标配置（JSON 格式）
//       if (iconPart) {
//         try {
//           icon = JSON.parse(iconPart) as IconConfig;
//         } catch {
//           console.warn('Failed to parse icon config:', iconPart);
//         }
//       }

//       title = titlePart;
//       textColor = textColorPart;
//       backgroundColor = backgroundColorPart;
//       borderColor = borderColorPart || '';
//     } else {
//       return null;
//     }
//   }
//   // 2. 兼容旧格式（用 , 分割，无图标）
//   else if (prefix.includes(',')) {
//     const parts = prefix.split(',').map(p => p.trim());

//     if (parts.length !== 3) {
//       return null;
//     }

//     [title, textColor, backgroundColor] = parts;

//     // 旧格式验证：检查是否为纯色十六进制颜色
//     const colorRegex = /^#[0-9A-Fa-f]{6}$/;
//     if (!colorRegex.test(textColor) || !colorRegex.test(backgroundColor)) {
//       return null;
//     }

//     // 自动生成半透明边框（向后兼容）
//     borderColor = textColor + '40';
//   } else {
//     return null;
//   }

//   // 验证必填字段
//   if (!title || !textColor || !backgroundColor) {
//     return null;
//   }

//   return {
//     icon,
//     title,
//     textColor,
//     backgroundColor,
//     borderColor: borderColor && borderColor !== 'none' ? borderColor : undefined
//   };
// }

/**
 * 用户头衔组件
 * 显示用户的头衔标签，支持图标、渐变色和边框
 */
export default function UserTitle({ prefix, badges = [], className = '', showBadges = false }: UserTitleProps) {
  // const parsedPrefix = parsePrefix(prefix);
  // if (!parsedPrefix && (!showBadges || badges.length === 0)) {
  if (!showBadges || badges.length === 0) {
    return prefix && null;
  }

  return (
    <div className={`inline-flex items-center gap-1 ${className}`}>
      {/* 显示头衔 */}
      {/* {parsedPrefix && (
        <span
          className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-medium rounded-md ${parsedPrefix.borderColor ? 'border' : ''}`}
          style={{
            color: parsedPrefix.textColor,
            background: parsedPrefix.backgroundColor,
            ...(parsedPrefix.borderColor && {
              borderColor: parsedPrefix.borderColor,
              borderWidth: '1px',
              borderStyle: 'solid'
            })
          }}
          title={`头衔: ${parsedPrefix.title}`}
        >
          {parsedPrefix.icon && <BadgeIcon icon={parsedPrefix.icon} size={12} />}
          <span>{parsedPrefix.title}</span>
        </span>
      )} */}

      {/* 显示徽章 */}
      {showBadges && badges.length > 0 && (
        <div className="inline-flex items-center gap-1">
          {badges
            .filter(badge => badge.isEquipped)
            .sort((a, b) => a.displayOrder - b.displayOrder)
            .map((userBadge) => (
              <Badge
                key={userBadge.id}
                badge={userBadge.badge}
                size="sm"
              />
            ))}
        </div>
      )}
    </div>
  );
}

/**
 * 用户名和头衔组合组件
 * 显示用户名和头衔（如果存在）
 */
export function UserWithTitle({
  username,
  prefix,
  badges = [],
  className = '',
  usernameClassName = '',
  titleClassName = '',
  showBadges = false
}: {
  username: string;
  prefix?: string | null;
  badges?: UserBadge[];
  className?: string;
  usernameClassName?: string;
  titleClassName?: string;
  showBadges?: boolean;
}) {
  return (
    <div className={`inline-flex  items-center gap-2 ${className}`}>
      <span className={usernameClassName}>{username}</span>
      <UserTitle
        prefix={prefix}
        badges={badges}
        className={titleClassName}
        showBadges={showBadges}
      />
    </div>
  );
}