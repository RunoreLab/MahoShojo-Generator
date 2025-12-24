import React from 'react';
import { getLucideIcon } from '@/lib/icon-registry';
import type { IconConfig } from '@/types/badge';

interface BadgeIconProps {
  icon: IconConfig;
  size?: number;
  className?: string;
}

/**
 * 徽章图标渲染组件
 * 支持 lucide-react 图标、自定义 SVG 和 emoji
 */
export default function BadgeIcon({ icon, size = 14, className = '' }: BadgeIconProps) {
  // 1. lucide-react 图标
  if (icon.type === 'lucide') {
    const IconComponent = getLucideIcon(icon.name);

    if (!IconComponent) {
      console.warn(`Icon "${icon.name}" not found in registry`);
      return null;
    }

    return <IconComponent size={size} className={className} />;
  }

  // 2. 自定义 SVG
  if (icon.type === 'svg') {
    return (
      <img
        src={icon.url}
        alt="badge icon"
        width={size}
        height={size}
        className={className}
        style={{ display: 'inline-block' }}
      />
    );
  }

  // 3. Emoji
  if (icon.type === 'emoji') {
    return (
      <span
        className={`inline-flex items-center justify-center shrink-0 ${className}`}
        style={{
          fontSize: `${size}px`, // 控制 Emoji 图案的大小
          width: `${size}px`,    // 强制限制宽度
          height: `${size}px`,   // 强制限制高度
          lineHeight: 1,
        }}
        role="img"
        aria-label="badge icon"
      >
        {icon.value}
      </span>
    );
  }

  return null;
}
