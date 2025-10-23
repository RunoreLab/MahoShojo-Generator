/**
 * BadgeGallery 组件使用示例
 * 展示如何在实际页面中使用徽章画廊组件
 */

import React, { useState, useEffect } from 'react';
import BadgeGallery from './BadgeGallery';
import type { UserBadge } from '@/types/badge';

export default function BadgeGalleryExample() {
  const [userBadges, setUserBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchUserBadges();
  }, []);

  const fetchUserBadges = async () => {
    try {
      setLoading(true);
      setError(null);

      // 从 localStorage 获取 authKey（根据实际项目调整）
      const authKey = localStorage.getItem('authKey');

      if (!authKey) {
        setError('请先登录');
        setLoading(false);
        return;
      }

      const response = await fetch('/api/badges/user', {
        headers: {
          'Authorization': `Bearer ${authKey}`
        }
      });

      if (!response.ok) {
        throw new Error('获取徽章失败');
      }

      const data = await response.json();
      setUserBadges(data.badges || []);
    } catch (err) {
      console.error('获取徽章失败:', err);
      setError(err instanceof Error ? err.message : '获取徽章失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="card">
        {/* 标题 */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-800 mb-2">我的徽章收藏</h1>
          <p className="text-gray-600">
            共获得 <span className="font-bold text-pink-600">{userBadges.length}</span> 个徽章
          </p>
        </div>

        {/* 加载状态 */}
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-12 w-12 border-4 border-gray-200 border-t-pink-600"></div>
            <p className="mt-4 text-gray-600">加载中...</p>
          </div>
        )}

        {/* 错误状态 */}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-600">{error}</p>
            <button
              onClick={fetchUserBadges}
              className="mt-4 px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700"
            >
              重试
            </button>
          </div>
        )}

        {/* 徽章画廊 */}
        {!loading && !error && (
          <BadgeGallery userBadges={userBadges} />
        )}

        {/* 说明 */}
        {!loading && !error && userBadges.length > 0 && (
          <div className="mt-6 p-4 bg-gray-50 rounded-lg">
            <h3 className="text-sm font-semibold text-gray-700 mb-2">💡 提示</h3>
            <ul className="text-sm text-gray-600 space-y-1">
              <li>• 点击徽章可以查看详细信息</li>
              <li>• 带粉色边框的徽章表示正在佩戴</li>
              <li>• 底部有黄点的徽章是稀有徽章</li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
