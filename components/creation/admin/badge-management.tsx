import React, { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { Award, Plus, Edit2, Trash2, Search, Users } from 'lucide-react';
import type { BadgeDefinition } from '@/types/badge';
import Badge from '@/components/badge/Badge';
import BadgeShow from '@/components/badge/BadgeShow';
import CreateBadgeModal from '@/components/admin/badge-management/CreateBadgeModal';
import EditBadgeModal from '@/components/admin/badge-management/EditBadgeModal';
import GrantBadgeModal from '@/components/admin/badge-management/GrantBadgeModal';

interface BadgeWithMeta extends BadgeDefinition {
  createdAt?: string;
}

export default function BadgeManagement() {
  const [badges, setBadges] = useState<BadgeWithMeta[]>([]);
  const [selectedBadge, setSelectedBadge] = useState<BadgeWithMeta | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showGrantModal, setShowGrantModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // 获取所有徽章
  const fetchBadges = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/badges');
      if (response.ok) {
        const data = await response.json();
        setBadges(data.badges || []);
      } else {
        setMessage({ type: 'error', text: '获取徽章列表失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '获取徽章列表失败: ' + error });
    } finally {
      setLoading(false);
    }
  }, []);

  // 删除徽章
  const deleteBadge = async (badgeId: string) => {
    if (!confirm(`确定要删除徽章 "${badgeId}" 吗？这将同时移除所有用户已获得的此徽章。`)) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/admin/badges/${badgeId}`, {
        method: 'DELETE'
      });

      if (response.ok) {
        setMessage({ type: 'success', text: '徽章删除成功' });
        fetchBadges();
        if (selectedBadge?.id === badgeId) {
          setSelectedBadge(null);
        }
      } else {
        const data = await response.json();
        setMessage({ type: 'error', text: data.error || '删除徽章失败' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: '删除徽章失败: ' + error });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBadges();
  }, [fetchBadges]);

  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const filteredBadges = badges.filter(badge =>
    badge.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    badge.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <>
      <Head>
        <title>徽章管理 - MahoShojo Generator</title>
      </Head>
      <div className="min-h-screen bg-gradient-to-br from-purple-50 to-pink-50">
        <div className="w-full px-8 py-8">
          {/* 返回链接 */}
          <div className="mb-6">
            <Link href="/admin">
              <span className="text-sm text-purple-600 hover:underline cursor-pointer">
                &larr; 返回管理后台主页
              </span>
            </Link>
          </div>

          {/* 标题 */}
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-800 mb-2 flex items-center justify-center gap-2">
              <Award className="w-8 h-8 text-purple-600" />
              徽章管理系统
            </h1>
            <p className="text-gray-600">创建、编辑和管理用户徽章</p>
          </div>

          {/* 消息提示 */}
          {message && (
            <div
              className={`mb-6 p-4 rounded-lg ${message.type === 'success'
                ? 'bg-green-100 text-green-700 border border-green-200'
                : 'bg-red-100 text-red-700 border border-red-200'
                }`}
            >
              {message.text}
            </div>
          )}

          {/* 操作栏 */}
          <div className="bg-white rounded-xl shadow-lg p-6 mb-6">
            <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
              <div className="flex-1 w-full md:w-auto">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="搜索徽章ID或名称..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                  />
                </div>
              </div>
              <button
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 whitespace-nowrap"
              >
                <Plus className="w-4 h-4" />
                创建新徽章
              </button>
            </div>
          </div>

          {/* 徽章列表 */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* 左侧列表 */}
            <div className="lg:col-span-1">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <h2 className="text-xl font-bold mb-4 text-gray-800 flex items-center gap-2">
                  <Award className="w-5 h-5" />
                  徽章列表 ({filteredBadges.length})
                </h2>

                <div className="space-y-2 max-h-[600px] overflow-y-auto">
                  {loading ? (
                    <div className="text-center py-4 text-gray-500">加载中...</div>
                  ) : filteredBadges.length === 0 ? (
                    <div className="text-center py-4 text-gray-500">没有找到徽章</div>
                  ) : (
                    filteredBadges.map((badge) => (
                      <div
                        key={badge.id}
                        onClick={() => setSelectedBadge(badge)}
                        className={`p-3 rounded-lg border cursor-pointer transition-colors hover:bg-gray-50 ${selectedBadge?.id === badge.id
                          ? 'border-purple-500 bg-purple-50'
                          : 'border-gray-200'
                          }`}
                      >
                        <div className="flex items-center gap-3">
                          <Badge badge={badge} size="sm" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{badge.name}</div>
                            <div className="text-xs text-gray-500 truncate">{badge.id}</div>
                          </div>
                          {!badge.isActive && (
                            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-1 rounded">
                              禁用
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* 右侧详情 */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-xl shadow-lg p-6">
                <div className="flex justify-between items-center mb-6">
                  <h2 className="text-xl font-bold text-gray-800">徽章详情</h2>
                  {selectedBadge && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setShowGrantModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                      >
                        <Users className="w-4 h-4" />
                        授予用户
                      </button>
                      <button
                        onClick={() => setShowEditModal(true)}
                        className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700"
                      >
                        <Edit2 className="w-4 h-4" />
                        编辑
                      </button>
                      <button
                        onClick={() => selectedBadge && deleteBadge(selectedBadge.id)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
                      >
                        <Trash2 className="w-4 h-4" />
                        删除
                      </button>
                    </div>
                  )}
                </div>

                {selectedBadge ? (
                  <div className="space-y-6 ">
                    {/* 预览 */}
                    <div className="border rounded-lg p-6 bg-gray-50 grid grid-cols-2 gap-4">
                      <div>
                        <h3 className="text-sm font-medium text-gray-700 mb-3">预览</h3>
                        <div className="flex items-center gap-2">
                          <Badge badge={selectedBadge} size="sm" />
                          <Badge badge={selectedBadge} size="md" />
                          <Badge badge={selectedBadge} size="lg" />
                        </div>
                      </div>
                      <div>
                        <BadgeShow badge={selectedBadge} size="lg" />
                      </div>
                    </div>

                    {/* 基本信息 */}
                    <div className="grid md:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          徽章ID
                        </label>
                        <input
                          type="text"
                          value={selectedBadge.id}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          徽章名称
                        </label>
                        <input
                          type="text"
                          value={selectedBadge.name}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          描述
                        </label>
                        <textarea
                          value={selectedBadge.description || ''}
                          disabled
                          rows={2}
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          稀有度
                        </label>
                        <input
                          type="number"
                          value={selectedBadge.rarity}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          排序
                        </label>
                        <input
                          type="number"
                          value={selectedBadge.sortOrder}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          状态
                        </label>
                        <input
                          type="text"
                          value={selectedBadge.isActive ? '启用' : '禁用'}
                          disabled
                          className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                        />
                      </div>
                      {selectedBadge.createdAt && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            创建时间
                          </label>
                          <input
                            type="text"
                            value={new Date(selectedBadge.createdAt).toLocaleString('zh-CN')}
                            disabled
                            className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50"
                          />
                        </div>
                      )}
                    </div>

                    {/* 样式配置 */}
                    <div className="border-t pt-6">
                      <h3 className="text-lg font-semibold mb-4 text-gray-800">样式配置</h3>
                      <div className="grid md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            图标配置
                          </label>
                          <pre className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs overflow-auto">
                            {JSON.stringify(selectedBadge.icon, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            文字颜色
                          </label>
                          <pre className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs overflow-auto">
                            {JSON.stringify(selectedBadge.textColor, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">
                            背景颜色
                          </label>
                          <pre className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs overflow-auto">
                            {JSON.stringify(selectedBadge.backgroundColor, null, 2)}
                          </pre>
                        </div>
                        {selectedBadge.borderColor && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                              边框颜色
                            </label>
                            <pre className="w-full p-3 border border-gray-300 rounded-lg bg-gray-50 text-xs overflow-auto">
                              {JSON.stringify(selectedBadge.borderColor, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-gray-500">
                    <Award className="w-16 h-16 mx-auto mb-4 opacity-50" />
                    <p>请从左侧列表选择一个徽章查看详情</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 模态框 */}
      {showCreateModal && (
        <CreateBadgeModal
          onClose={() => setShowCreateModal(false)}
          onSuccess={() => {
            fetchBadges();
            setShowCreateModal(false);
            setMessage({ type: 'success', text: '徽章创建成功' });
          }}
        />
      )}

      {showEditModal && selectedBadge && (
        <EditBadgeModal
          badge={selectedBadge}
          onClose={() => setShowEditModal(false)}
          onSuccess={() => {
            fetchBadges();
            setShowEditModal(false);
            setMessage({ type: 'success', text: '徽章更新成功' });
          }}
        />
      )}

      {showGrantModal && selectedBadge && (
        <GrantBadgeModal
          badge={selectedBadge}
          onClose={() => setShowGrantModal(false)}
          onSuccess={(message) => {
            setShowGrantModal(false);
            setMessage({ type: 'success', text: message });
          }}
        />
      )}
    </>
  );
}
