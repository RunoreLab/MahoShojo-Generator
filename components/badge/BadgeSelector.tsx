import React, { useEffect, useMemo, useState } from 'react';
import Badge from './Badge';
import type { UserBadge } from '@/types/badge';
import { Check } from 'lucide-react';

interface BadgeSelectorProps {
  userBadges: UserBadge[];
  onSave: (equippedBadgeIds: string[]) => Promise<void>;
  maxEquipped?: number;
}

const arraysEqual = (a: string[], b: string[]) => {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

/**
 * 徽章选择器组件
 * 允许用户选择佩戴的徽章（数量由 maxEquipped 控制）
 */
export default function BadgeSelector({
  userBadges,
  onSave,
  maxEquipped = 1
}: BadgeSelectorProps) {
  const equippedFromServer = useMemo(() => {
    return userBadges
      .filter(ub => ub.isEquipped)
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(ub => ub.badgeId)
      .slice(0, maxEquipped);
  }, [userBadges, maxEquipped]);

  const [selected, setSelected] = useState<string[]>(equippedFromServer);
  const [saving, setSaving] = useState(false);

  const hasChanges = useMemo(() => {
    return !arraysEqual(selected, equippedFromServer);
  }, [selected, equippedFromServer]);

  // 当服务端数据刷新（如保存后重新加载）时，同步选择状态
  useEffect(() => {
    if (!hasChanges && !saving) {
      setSelected(equippedFromServer);
    }
  }, [equippedFromServer, hasChanges, saving]);

  /**
   * 切换徽章选择状态
   */
  const toggleBadge = (badgeId: string) => {
    if (selected.includes(badgeId)) {
      // 取消选择
      setSelected(selected.filter(id => id !== badgeId));
      return;
    }

    // 允许在达到上限时直接切换（badge-manager 目前是 max=1）
    if (selected.length >= maxEquipped) {
      if (maxEquipped === 1) {
        setSelected([badgeId]);
      }
      return;
    }

    // 添加选择
    setSelected([...selected, badgeId]);
  };

  /**
   * 保存徽章设置
   */
  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(selected);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* 统计信息 */}
      <div className="text-sm text-gray-600">
        已选择 <span className="font-bold text-pink-600">{selected.length}</span> / {maxEquipped} 个徽章
      </div>

      {/* 状态提示 */}
      <div className="text-xs text-gray-500">
        {maxEquipped === 1 ? (
          hasChanges ? (
            <span className="text-pink-600">已修改，点击“保存设置”后才会生效（可直接点击其它徽章切换）。</span>
          ) : (
            <span>已佩戴时，点击其它徽章可直接切换；点击当前徽章可卸下。</span>
          )
        ) : hasChanges ? (
          <span className="text-pink-600">已修改，记得点击“保存设置”使其生效。</span>
        ) : (
          <span>当前设置已同步。</span>
        )}
      </div>

      {/* 徽章网格 */}
      <div>
        {userBadges.map(userBadge => {
          const isSelected = selected.includes(userBadge.badgeId);

          return (
            <button
              key={userBadge.id}
              type="button"
              onClick={() => toggleBadge(userBadge.badgeId)}
              aria-pressed={isSelected}
              aria-label={`${userBadge.badge.name}${isSelected ? '（已佩戴，点击卸下）' : '（点击佩戴）'}`}
              className={`relative flex w-full align-bottom p-2 my-1 border-2 rounded-lg transition-all text-left ${
                isSelected
                  ? 'border-pink-500 bg-pink-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              {/* 徽章预览 */}
              <div>
                <Badge badge={userBadge.badge} size="sm" />
              </div>

              {/* 选中标记 */}
              {isSelected && (
                <div className="absolute top-2 right-2 flex items-center gap-1 bg-pink-600 text-white px-0.5 py-0.5 rounded-full text-xs font-bold">
                  {/* <span>{order}</span> */}
                  <Check size={12} />
                </div>
              )}

              {/* 徽章描述 */}
              {userBadge.badge.description && (
                <div className="ml-2 text-xs text-gray-500 line-clamp-2">
                  {userBadge.badge.description}
                </div>
              )}

              {/* 获得时间 */}
              {/* <div className="mt-1 text-xs text-gray-400">
                获得于 {new Date(userBadge.obtainedAt).toLocaleDateString()}
              </div> */}
            </button>
          );
        })}
      </div>

      {/* 空状态提示 */}
      {userBadges.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p>你还没有获得任何徽章</p>
          <p className="text-sm mt-1">完成成就或参与活动可以获得徽章</p>
        </div>
      )}

      {/* 保存按钮 */}
      {userBadges.length > 0 && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="w-full px-4 py-2 bg-pink-600 text-white rounded-lg hover:bg-pink-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '保存中...' : hasChanges ? '保存设置' : '已是最新设置'}
        </button>
      )}
    </div>
  );
}
