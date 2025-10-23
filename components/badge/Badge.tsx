import React from 'react';
import BadgeIcon from './BadgeIcon';
import type { BadgeDefinition, ColorConfig } from '@/types/badge';

interface BadgeProps {
  badge: BadgeDefinition;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * 解析颜色配置为 CSS 样式值
 */
function parseColorConfig(config: ColorConfig): string {
  if (config.type === 'solid') {
    return config.value;
  } else {
    return config.value;  // 已经是 gradient 字符串
  }
}

/**
 * 徽章组件
 * 显示单个徽章，包含图标、文字和自定义样式
 */
export default function Badge({ badge, size = 'md', className = '' }: BadgeProps) {
  const sizeClasses = {
    sm: 'text-xs px-1.5 py-0.5',
    md: 'text-sm px-2 py-1',
    lg: 'text-base px-2.5 py-1.5'
  };

  const iconSizes = {
    sm: 12,
    md: 14,
    lg: 16
  };

  const styles: React.CSSProperties = {
    color: parseColorConfig(badge.textColor),
    background: parseColorConfig(badge.backgroundColor),
    ...(badge.borderColor && {
      borderColor: parseColorConfig(badge.borderColor),
      borderWidth: '1px',
      borderStyle: 'solid'
    })
  };

  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-md ${sizeClasses[size]} ${badge.borderColor ? 'border' : ''} ${className}`}
      style={styles}
      title={badge.description || badge.name}
    >
      <BadgeIcon icon={badge.icon} size={iconSizes[size]} />
      <span className="whitespace-nowrap">{badge.name}</span>
    </span>
  );
}
