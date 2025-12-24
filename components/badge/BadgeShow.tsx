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
 * 徽章组件 - 卡片样式
 * 展示长方形，左侧图标，右侧名字和简介
 */
export default function BadgeShow({ badge, size = 'md', className = '' }: BadgeProps) {
    // 针对长方形卡片布局调整尺寸配置
    const layoutConfig = {
        sm: {
            container: 'p-2 gap-2',
            iconSize: 20,
            nameClass: 'text-sm font-bold',
            descClass: 'text-xs'
        },
        md: {
            container: 'p-3 gap-2',
            iconSize: 32,
            nameClass: 'text-base font-bold',
            descClass: 'text-sm'
        },
        lg: {
            container: 'p-4 gap-4',
            iconSize: 48,
            nameClass: 'text-lg font-bold',
            descClass: 'text-sm'
        }
    };

    const currentSize = layoutConfig[size];

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
        <div
            className={`
                relative flex items-center w-full shadow-sm overflow-hidden
                ${currentSize.container} 
                ${badge.borderColor ? 'border' : ''} 
                ${className}
            `}
            style={styles}
        >
            {/* 左侧：图标区域 */}
            <div className="flex-shrink-0 flex items-center justify-center">
                {badge.icon.type !== 'null' && (
                    <BadgeIcon
                        icon={badge.icon}
                        size={currentSize.iconSize}
                    />
                )}
            </div>

            {/* 右侧：文字信息区域 (名字 + 简介) */}
            <div className="flex flex-col justify-center min-w-0 flex-1">
                {/* 名字 */}
                <div className={`${currentSize.nameClass} leading-tight truncate`}>
                    {badge.name}
                </div>

                {/* 简介 - 只有当简介存在时才显示 */}
                {badge.description && (
                    <div className={`${currentSize.descClass} opacity-80 mt-1 leading-snug line-clamp-3`}>
                        {badge.description}
                    </div>
                )}
            </div>
        </div>
    );
}