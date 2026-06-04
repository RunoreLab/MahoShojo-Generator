'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/useAuth';
import { authStorage } from '@/lib/auth';
import type { UserBadge } from '@/types/badge';
import BadgeGallery from '@/components/badge/BadgeGallery';
import BadgeSelector from '@/components/badge/BadgeSelector';
import { Settings, Grid3x3 } from 'lucide-react';
import Footer from '@/components/Footer';

/**
 * 徽章管理页面
 * 包含徽章展示、佩戴管理等功能
 */
export function BadgeManagerPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [userBadges, setUserBadges] = useState<UserBadge[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'gallery' | 'manage'>('gallery');

  // 加载用户徽章数据
  const loadUserBadges = async () => {
    try {
      setLoading(true);
      const response = await authStorage.fetch('/api/badges/user');

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setUserBadges(data.badges);
        } else {
          console.error('获取徽章失败:', data.error);
        }
      } else {
        console.error('获取徽章失败:', response.status);
      }
    } catch (error) {
      console.error('加载徽章失败:', error);
    } finally {
      setLoading(false);
    }
  };

  // 保存徽章佩戴设置
  const handleSaveEquippedBadges = async (equippedBadgeIds: string[]) => {
    try {
      const response = await authStorage.fetch('/api/badges/equip', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ badgeIds: equippedBadgeIds })
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          // 重新加载徽章数据
          await loadUserBadges();
          alert('徽章设置已保存');
        } else {
          alert(data.error || '保存失败，请重试');
        }
      } else {
        alert('保存失败，请重试');
      }
    } catch (error) {
      console.error('保存徽章设置失败:', error);
      alert('保存失败，请重试');
    }
  };

  // 页面初始化
  useEffect(() => {
    if (!authLoading && !user) {
      // 未登录用户重定向到首页
      router.push('/');
      return;
    }

    if (user) {
      loadUserBadges();
    }
  }, [user, authLoading, router]);

  // 加载状态
  if (authLoading || loading) {
    return (
      <div className="magic-background-white">
        <div className="container">
          <div className="flex items-center justify-center min-h-screen">
            <div className="text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-pink-600 mx-auto mb-4"></div>
              <p className="text-gray-600">加载中...</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // 未登录状态
  if (!user) {
    return null; // useEffect 会处理重定向
  }

  return (
    <>
      <div className="magic-background-white">
        <div className="container">
          <div className="card max-w-4xl mx-auto">
            {/* 返回按钮 */}
            <div className="mb-4">
              <Link
                href="/"
                className="inline-flex items-center text-pink-600 hover:text-pink-700 text-sm font-medium"
              >
                <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                返回首页
              </Link>
            </div>

            <div className="text-center mb-6">
              <h1 className="text-3xl font-bold text-gray-800 mb-2">徽章管理</h1>
              <p className="text-sm text-gray-600">佩戴最多 1 个徽章展示在档案馆内</p>
            </div>

            {/* 用户信息显示 */}
            <div className="mb-6 p-4 bg-pink-50 rounded-lg">
              <p className="text-sm text-gray-600">
                当前登录用户：<span className="font-semibold text-pink-700">{user?.username}</span>
              </p>
            </div>

            {/* 统计信息卡片 */}
            <div className="mb-6 p-6 bg-gray-50 rounded-lg">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="text-center">
                  <div className="text-2xl font-bold text-pink-600">{userBadges.length}</div>
                  <div className="text-sm text-gray-600">总徽章数</div>
                </div>
                <div className="text-center">
                  <div className="text-2xl font-bold text-purple-600">
                    {userBadges.filter(badge => badge.isEquipped).length}
                  </div>
                  <div className="text-sm text-gray-600">已佩戴徽章</div>
                </div>
              </div>
            </div>

            {/* 功能标签页 */}
            <div className="mb-6">
              <div className="flex border-b border-gray-200 bg-white rounded-lg">
                <button
                  onClick={() => setActiveTab('gallery')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'gallery'
                      ? 'text-pink-600 border-b-2 border-pink-600'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  <Grid3x3 size={18} />
                  <span>徽章展示</span>
                </button>
                <button
                  onClick={() => setActiveTab('manage')}
                  className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 font-medium transition-colors ${
                    activeTab === 'manage'
                      ? 'text-pink-600 border-b-2 border-pink-600'
                      : 'text-gray-600 hover:text-gray-800'
                  }`}
                >
                  <Settings size={18} />
                  <span>佩戴管理</span>
                </button>
              </div>

              {/* 标签内容 */}
              <div className="mt-6 bg-white rounded-lg p-6">
                {activeTab === 'gallery' ? (
                  <div>
                    <BadgeGallery userBadges={userBadges} />
                  </div>
                ) : (
                  <div>
                    <p className="text-sm text-gray-600">
                      选择最多 1 个徽章进行佩戴，展示在角色档案中。
                    </p>
                    <BadgeSelector
                      userBadges={userBadges}
                      onSave={handleSaveEquippedBadges}
                      maxEquipped={1}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          <Footer />
        </div>
      </div>
    </>
  );
}
