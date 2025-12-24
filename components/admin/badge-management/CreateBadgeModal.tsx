import React, { useState, useEffect } from 'react';
import { X, Award } from 'lucide-react';
import type { BadgeDefinition, ColorConfig, IconConfig } from '@/types/badge';
import Badge from '@/components/badge/Badge';
import ColorPicker from './ColorPicker';

interface BadgeWithMeta extends BadgeDefinition {
  createdAt?: string;
}

interface CreateBadgeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export default function CreateBadgeModal({ onClose, onSuccess }: CreateBadgeModalProps) {
  const [formData, setFormData] = useState({
    id: '',
    name: '',
    description: '',
    iconType: 'lucide' as 'lucide' | 'emoji' | 'null',
    iconValue: 'Award',
    textColorType: 'solid' as 'solid' | 'gradient',
    textColorValue: '#FFFFFF',
    textGradientStart: '#FFFFFF',
    textGradientEnd: '#000000',
    backgroundColorType: 'solid' as 'solid' | 'gradient',
    backgroundColorValue: '#667eea',
    backgroundGradientStart: '#667eea',
    backgroundGradientEnd: '#764ba2',
    borderColorEnabled: false,
    borderColorType: 'solid' as 'solid' | 'gradient',
    borderColorValue: '#667eea',
    borderGradientStart: '#667eea',
    borderGradientEnd: '#764ba2',
    rarity: 50,
    sortOrder: 0,
    isActive: true
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 获取徽章列表并计算默认排序值
  useEffect(() => {
    const fetchBadges = async () => {
      try {
        const response = await fetch('/api/admin/badges');
        if (response.ok) {
          const data = await response.json();
          const badgeList = data.badges || [];

          // 计算最大排序值 + 1
          const maxSortOrder = badgeList.length > 0
            ? Math.max(...badgeList.map((b: BadgeWithMeta) => b.sortOrder || 0))
            : 0;

          setFormData(prev => ({
            ...prev,
            sortOrder: maxSortOrder + 1
          }));
        }
      } catch (error) {
        console.error('获取徽章列表失败:', error);
      }
    };

    fetchBadges();
  }, []);

  // 构建预览徽章对象
  const previewBadge: BadgeDefinition = {
    id: formData.id || 'preview',
    name: formData.name || '预览徽章',
    description: formData.description,
    icon:
      formData.iconType === 'null'
        ? { type: 'null', value: null }
        : formData.iconType === 'emoji'
          ? { type: 'emoji', value: formData.iconValue || '⭐' }
          : { type: 'lucide', name: formData.iconValue || 'Award' },
    textColor: {
      type: formData.textColorType,
      value:
        formData.textColorType === 'gradient'
          ? `linear-gradient(135deg, ${formData.textGradientStart} 0%, ${formData.textGradientEnd} 100%)`
          : formData.textColorValue
    },
    backgroundColor: {
      type: formData.backgroundColorType,
      value:
        formData.backgroundColorType === 'gradient'
          ? `linear-gradient(135deg, ${formData.backgroundGradientStart} 0%, ${formData.backgroundGradientEnd} 100%)`
          : formData.backgroundColorValue
    },
    borderColor: formData.borderColorEnabled
      ? {
        type: formData.borderColorType,
        value:
          formData.borderColorType === 'gradient'
            ? `linear-gradient(135deg, ${formData.borderGradientStart} 0%, ${formData.borderGradientEnd} 100%)`
            : formData.borderColorValue
      }
      : undefined,
    rarity: formData.rarity,
    sortOrder: formData.sortOrder,
    isActive: formData.isActive
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const icon: IconConfig =
        formData.iconType === 'null'
          ? { type: 'null', value: null }
          : formData.iconType === 'emoji'
            ? { type: 'emoji', value: formData.iconValue }
            : { type: 'lucide', name: formData.iconValue };

      const textColor: ColorConfig = {
        type: formData.textColorType,
        value:
          formData.textColorType === 'gradient'
            ? `linear-gradient(135deg, ${formData.textGradientStart} 0%, ${formData.textGradientEnd} 100%)`
            : formData.textColorValue
      };

      const backgroundColor: ColorConfig = {
        type: formData.backgroundColorType,
        value:
          formData.backgroundColorType === 'gradient'
            ? `linear-gradient(135deg, ${formData.backgroundGradientStart} 0%, ${formData.backgroundGradientEnd} 100%)`
            : formData.backgroundColorValue
      };

      const borderColor: ColorConfig | undefined = formData.borderColorEnabled
        ? {
          type: formData.borderColorType,
          value:
            formData.borderColorType === 'gradient'
              ? `linear-gradient(135deg, ${formData.borderGradientStart} 0%, ${formData.borderGradientEnd} 100%)`
              : formData.borderColorValue
        }
        : undefined;

      const response = await fetch('/api/admin/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: formData.id,
          name: formData.name,
          description: formData.description || undefined,
          icon,
          textColor,
          backgroundColor,
          borderColor,
          rarity: formData.rarity,
          sortOrder: formData.sortOrder,
          isActive: formData.isActive
        })
      });

      if (response.ok) {
        onSuccess();
      } else {
        const data = await response.json();
        setError(data.error || '创建失败');
      }
    } catch (err) {
      setError('创建失败: ' + err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-6xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        <div className="p-6 border-b">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-bold text-gray-800">创建新徽章</h2>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-700">
              <X className="w-6 h-6" />
            </button>
          </div>
        </div>

        {error && (
          <div className="mx-6 mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm">{error}</div>
        )}

        <div className="flex-1 overflow-hidden flex">
          {/* 左侧表单 */}
          <div className="flex-1 overflow-y-auto p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  徽章ID <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.id}
                  onChange={(e) => setFormData({ ...formData, id: e.target.value })}
                  placeholder="例如: founder, beta_tester"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  徽章名称 <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="例如: 创始人"
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">描述</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={2}
                  className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    图标类型 <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={formData.iconType}
                    onChange={(e) =>
                      setFormData({
                        ...formData,
                        iconType: e.target.value as 'lucide' | 'emoji' | 'null'
                      })
                    }
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="lucide">Lucide 图标</option>
                    <option value="emoji">Emoji</option>
                    <option value="null">无图标</option>
                  </select>
                </div>

                {formData.iconType !== 'null' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      图标值 <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.iconValue}
                      onChange={(e) => setFormData({ ...formData, iconValue: e.target.value })}
                      placeholder={formData.iconType === 'lucide' ? 'Crown' : '👑'}
                      className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                    />
                    {formData.iconType === 'lucide' && (
                      <p className="mt-1 text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-200">
                        💡 如果使用 Lucide 新图标需要去 <code className="font-mono bg-amber-100 px-1">lib/icon-registry.ts</code> 手动添加哦
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* 颜色配置 */}
              <div className="space-y-4 border-t pt-4">
                <h3 className="text-sm font-semibold text-gray-700">颜色配置</h3>

                {/* 文字颜色 */}
                <ColorPicker
                  label="文字颜色"
                  required
                  type={formData.textColorType}
                  onTypeChange={(type) => setFormData({ ...formData, textColorType: type })}
                  solidValue={formData.textColorValue}
                  onSolidChange={(value) => setFormData({ ...formData, textColorValue: value })}
                  gradientStart={formData.textGradientStart}
                  onGradientStartChange={(value) =>
                    setFormData({ ...formData, textGradientStart: value })
                  }
                  gradientEnd={formData.textGradientEnd}
                  onGradientEndChange={(value) =>
                    setFormData({ ...formData, textGradientEnd: value })
                  }
                />

                {/* 背景颜色 */}
                <ColorPicker
                  label="背景颜色"
                  required
                  type={formData.backgroundColorType}
                  onTypeChange={(type) => setFormData({ ...formData, backgroundColorType: type })}
                  solidValue={formData.backgroundColorValue}
                  onSolidChange={(value) =>
                    setFormData({ ...formData, backgroundColorValue: value })
                  }
                  gradientStart={formData.backgroundGradientStart}
                  onGradientStartChange={(value) =>
                    setFormData({ ...formData, backgroundGradientStart: value })
                  }
                  gradientEnd={formData.backgroundGradientEnd}
                  onGradientEndChange={(value) =>
                    setFormData({ ...formData, backgroundGradientEnd: value })
                  }
                />

                {/* 边框颜色 */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="borderColorEnabled"
                      checked={formData.borderColorEnabled}
                      onChange={(e) =>
                        setFormData({ ...formData, borderColorEnabled: e.target.checked })
                      }
                      className="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500"
                    />
                    <label htmlFor="borderColorEnabled" className="text-sm font-medium text-gray-700">
                      启用边框颜色
                    </label>
                  </div>

                  {formData.borderColorEnabled && (
                    <ColorPicker
                      label="边框颜色"
                      type={formData.borderColorType}
                      onTypeChange={(type) =>
                        setFormData({ ...formData, borderColorType: type })
                      }
                      solidValue={formData.borderColorValue}
                      onSolidChange={(value) =>
                        setFormData({ ...formData, borderColorValue: value })
                      }
                      gradientStart={formData.borderGradientStart}
                      onGradientStartChange={(value) =>
                        setFormData({ ...formData, borderGradientStart: value })
                      }
                      gradientEnd={formData.borderGradientEnd}
                      onGradientEndChange={(value) =>
                        setFormData({ ...formData, borderGradientEnd: value })
                      }
                    />
                  )}
                </div>
              </div>

              {/* 其他属性 */}
              <div className="grid grid-cols-3 gap-4 border-t pt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    稀有度 (0-100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    value={formData.rarity}
                    onChange={(e) => setFormData({ ...formData, rarity: Number(e.target.value) })}
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">排序</label>
                  <input
                    type="number"
                    value={formData.sortOrder}
                    onChange={(e) =>
                      setFormData({ ...formData, sortOrder: Number(e.target.value) })
                    }
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
                  <select
                    value={formData.isActive ? 'active' : 'inactive'}
                    onChange={(e) =>
                      setFormData({ ...formData, isActive: e.target.value === 'active' })
                    }
                    className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="active">启用</option>
                    <option value="inactive">禁用</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 justify-end pt-4 border-t">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={loading}
                  className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
                >
                  {loading ? '创建中...' : '创建'}
                </button>
              </div>
            </form>
          </div>

          {/* 右侧预览 */}
          <div className="w-80 bg-gradient-to-br from-purple-50 to-pink-50 border-l p-6 overflow-y-auto">
            <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
              <Award className="w-4 h-4" />
              实时预览
            </h3>

            <div className="space-y-6">
              {/* 预览卡片 */}
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-xs text-gray-500 mb-3">不同尺寸预览</p>
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-12">Small</span>
                    <Badge badge={previewBadge} size="sm" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-12">Medium</span>
                    <Badge badge={previewBadge} size="md" />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400 w-12">Large</span>
                    <Badge badge={previewBadge} size="lg" />
                  </div>
                </div>
              </div>

              {/* 信息卡片 */}
              <div className="bg-white rounded-lg p-4 shadow-sm">
                <p className="text-xs text-gray-500 mb-2">徽章信息</p>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-gray-500">ID:</span>
                    <span className="font-mono text-gray-700">{previewBadge.id}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">稀有度:</span>
                    <span className="font-medium text-purple-600">{previewBadge.rarity}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">排序:</span>
                    <span className="text-gray-700">{previewBadge.sortOrder}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">状态:</span>
                    <span className={previewBadge.isActive ? 'text-green-600' : 'text-gray-400'}>
                      {previewBadge.isActive ? '启用' : '禁用'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
