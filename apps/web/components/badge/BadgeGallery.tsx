import React, { useState } from 'react';
import Badge from './Badge';
import BadgeIcon from './BadgeIcon';
import type { UserBadge, ColorConfig } from '@/types/badge';
import { X } from 'lucide-react';

interface BadgeGalleryProps {
  userBadges: UserBadge[];
  className?: string;
}

/**
 * 解析颜色配置为 CSS 样式值
 */
function parseColorConfig(config: ColorConfig): string {
  if (config.type === 'solid') {
    return config.value;
  } else {
    return config.value;
  }
}

/**
 * 徽章画廊组件
 * 以图标网格形式展示用户拥有的所有徽章
 * 点击徽章显示详细信息悬浮框
 */
export default function BadgeGallery({ userBadges, className = '' }: BadgeGalleryProps) {
  const [selectedBadge, setSelectedBadge] = useState<UserBadge | null>(null);

  if (userBadges.length === 0) {
    return (
      <div className={`text-center py-12 ${className}`}>
        <div className="text-6xl mb-4">🏅</div>
        <p className="text-gray-500 text-lg">还没有获得任何徽章</p>
      </div>
    );
  }

  return (
    <>
      {/* 徽章网格 */}
      <div className={`flex gap-3 flex-wrap justify-center ${className}`}>
        {userBadges.map((userBadge) => {
          const badge = userBadge.badge;

          return (
            <button
              key={userBadge.id}
              onClick={() => setSelectedBadge(userBadge)}
              className={`rounded-lg transition-all hover:scale-110 hover:shadow-lg`}
              title={badge.name}
            >
              {/* 徽章图标 */}
              <Badge badge={userBadge.badge} />
            </button>
          );
        })}
      </div>

      {/* 详细信息悬浮框 */}
      {selectedBadge && (
        <div
          className="fixed inset-0 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedBadge(null)}
        >
          <div
            className="bg-white rounded-lg shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 头部 */}
            <div
              className="p-6 relative"
              style={{
                background: parseColorConfig(selectedBadge.badge.backgroundColor)
              }}
            >
              {/* 关闭按钮 */}
              <button
                onClick={() => setSelectedBadge(null)}
                className="absolute top-3 right-3 p-1 rounded-full bg-white bg-opacity-20 hover:bg-opacity-30 transition-colors"
              >
                <X size={20} className="text-gray-900" />
              </button>

              {/* 徽章预览 */}
              <div className="flex flex-col items-center">
                <div
                  className="p-6 rounded-2xl mb-4"
                  style={{
                    background: 'rgba(255, 255, 255, 0.2)',
                    backdropFilter: 'blur(10px)'
                  }}
                >
                  <BadgeIcon icon={selectedBadge.badge.icon} size={64} />
                </div>

                <h2
                  className="text-2xl font-bold mb-1"
                  style={{ color: parseColorConfig(selectedBadge.badge.textColor) }}
                >
                  {selectedBadge.badge.name}
                </h2>

                {/* 稀有度 */}
                {/* <div className="flex items-center gap-1 mt-2">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div
                      key={i}
                      className={`w-2 h-2 rounded-full ${
                        i < Math.ceil(selectedBadge.badge.rarity / 20)
                          ? 'bg-yellow-300'
                          : 'bg-white bg-opacity-30'
                      }`}
                    />
                  ))}
                </div> */}
              </div>
            </div>

            {/* 内容区 */}
            <div className="p-6 space-y-4">
              {/* 描述 */}
              {selectedBadge.badge.description && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-500 mb-1">描述</h3>
                  <p className="text-gray-700">{selectedBadge.badge.description}</p>
                </div>
              )}

              {/* 获得时间 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">获得时间</h3>
                <p className="text-gray-700">
                  {new Date(selectedBadge.obtainedAt).toLocaleString('zh-CN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </p>
              </div>

              {/* 佩戴状态 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">状态</h3>
                <div className="flex items-center gap-2">
                  {selectedBadge.isEquipped ? (
                    <>
                      <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                      <span className="text-gray-700">
                        已佩戴 (位置 {selectedBadge.displayOrder})
                      </span>
                    </>
                  ) : (
                    <>
                      <div className="w-2 h-2 bg-gray-400 rounded-full"></div>
                      <span className="text-gray-700">未佩戴</span>
                    </>
                  )}
                </div>
              </div>

              {/* 稀有度说明 */}
              <div>
                <h3 className="text-sm font-semibold text-gray-500 mb-1">稀有度</h3>
                <div className="flex items-center gap-2">
                  <div className="flex-1 bg-gray-200 rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-blue-400 via-purple-400 to-yellow-400"
                      style={{ width: `${selectedBadge.badge.rarity}%` }}
                    />
                  </div>
                  <span className="text-sm font-medium text-gray-700">
                    {selectedBadge.badge.rarity}
                  </span>
                </div>
              </div>
            </div>

            {/* 底部操作 */}
            <div className="p-4 bg-gray-50 border-t">
              <button
                onClick={() => setSelectedBadge(null)}
                className="w-full px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 动画样式 */}
      <style jsx>{`
        @keyframes slideInFromBottom {
          from {
            transform: translateY(20px);
            opacity: 0;
          }
          to {
            transform: translateY(0);
            opacity: 1;
          }
        }
      `}</style>
    </>
  );
}
