import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Download, Heart, Share, Info, Ban, AlertTriangle, Clock, XCircle, Star, BadgeCheck } from 'lucide-react';
import { isCardLiked, addLikedCard } from '@/lib/localStorage';
import { getDataCardStatus } from '@/lib/database/data-cards';
import { TechBadge } from '@/components/ranking/TechBadge';
import { TierBadge } from '@/components/ranking/TierBadge';
import { buildTitleDisplay } from '@/lib/text';

interface DataCardProps {
  id: string; // Changed from number to string for UUID
  name: string;
  description: string;
  type: 'character' | 'scenario' | 'history' | 'questionnaire';
  roleType?: 'magical-girl' | 'canshou' | 'general';
  isPublic: boolean | number; // 支持 -1 表示封禁
  reviewStatus?: 'pending' | 'approved' | 'rejected'; // 新增：审查状态属性
  usageCount?: number;
  likeCount?: number;
  favoriteCount?: number;
  author?: string;
  isOwner?: boolean;
  isSelected?: boolean;
  onDownload?: () => void;
  onLike?: () => void;
  onEditInfo?: () => void;
  onEditData?: () => void;
  onDelete?: () => void;
  onShare?: () => void;
  onLikeSuccess?: () => void;
  onViewDetails?: () => void; // 新增查看详情回调
  onAuthorClick?: (authorName: string) => void;
  isFavorited?: boolean;
  canFavorite?: boolean;
  onToggleFavorite?: (nextState: boolean) => Promise<boolean> | boolean;
  isRecommended?: boolean;
  techScore?: number | null;
  techLevel?: string | null;
  strictTier?: string | null;
  isNative?: boolean | null;
  questionnaireNativeAllowed?: boolean;
  hot?: boolean;
  pending?: boolean;
  onReplace?: () => void;
}

const typeMap = {
  character: '角色',
  scenario: '情景',
  history: '叙事历史',
  questionnaire: '问卷',
};

const roleTypeLabelMap: Record<NonNullable<DataCardProps['roleType']>, string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  general: '通用',
};

const roleTypeStyleMap: Record<NonNullable<DataCardProps['roleType']>, string> = {
  'magical-girl': 'bg-pink-100 text-pink-700',
  canshou: 'bg-indigo-100 text-indigo-700',
  general: 'bg-sky-100 text-sky-700',
};

export default function DataCard({
  id,
  name,
  description,
  type,
  roleType,
  isPublic,
  reviewStatus,
  usageCount = 0,
  likeCount = 0,
  favoriteCount = 0,
  author,
  isOwner = false,
  isSelected = false,
  onDownload,
  onLike,
  onEditInfo,
  onEditData,
  onDelete,
  onShare,
  onLikeSuccess,
  onViewDetails,
  onAuthorClick,
  isFavorited = false,
  canFavorite = false,
  onToggleFavorite,
  isRecommended = false,
  techScore = null,
  techLevel = null,
  strictTier = null,
  isNative = null,
  questionnaireNativeAllowed = false,
  hot = false,
  pending = false,
  onReplace,
}: DataCardProps) {
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle');
  const [liked, setLiked] = useState(false);
  const [liking, setLiking] = useState(false);
  const [currentLikeCount, setCurrentLikeCount] = useState(likeCount);
  const [favoriting, setFavoriting] = useState(false);
  const cardStatus = getDataCardStatus({ is_public: isPublic });
  const canDownload = Boolean(onDownload);
  const resolvedName = name?.trim() ? name : '未命名';
  const { display: displayName, full: fullName } = buildTitleDisplay(resolvedName);

  // 检查本地存储中的点赞状态
  useEffect(() => {
    setLiked(isCardLiked(id));
  }, [id]);

  /**
   * 【核心 Bug 修复】
   * 修复无限刷点赞 Bug 的关键在于调整操作顺序，确保客户端操作的原子性。
   *
   * 之前的问题逻辑：
   * 1. 检查组件内部 state `liked` 是否为 true。
   * 2. 发送 API 请求到服务器。
   * 3. API 请求成功后，再调用 `addLikedCard(id)` 写入 localStorage。
   * 这个流程的缺陷在于，多个标签页之间的 `liked` 状态不共享。当一个标签页完成点赞后，
   * 另一个标签页的 `liked` 状态仍然是 false，导致它可以继续发送 API 请求。
   *
   * 修复后的正确逻辑：
   * 1. 用户点击时，首先调用 `addLikedCard(id)` 尝试写入 localStorage。
   * `localStorage` 是浏览器内所有标签页共享的。
   * `addLikedCard` 函数被设计为只有在 cardId 不存在时才会写入并返回 `true`。
   * 如果 cardId 已存在，它会直接返回 `false`。
   * 2. 检查 `addLikedCard` 的返回值。
   * - 如果返回 `true`：证明这是此浏览器第一次点赞该卡片。此时，我们才继续执行后续操作：
   * a. 设置组件内部状态 `setLiked(true)` 和 `setLiking(true)`，立即在UI上禁用按钮。
   * b. 向服务器发送 API 请求以增加点赞数。
   * c. 更新UI上的点赞计数。
   * - 如果返回 `false`：证明其他标签页（或当前页面刷新前）已经点过赞了。此时函数直接返回，
   * 不执行任何操作，从而阻止了重复向服务器发送请求。
   *
   * 这个修改利用 localStorage 作为跨标签页的“锁”，确保了只有一个点赞操作能够成功触发 API 调用，
   * 从根本上解决了无限刷赞的 bug。
   */
  const handleLike = async (e: React.MouseEvent) => {
    e.stopPropagation();
    
    // 获取卡片状态，只有公开且审核通过的卡片才能点赞
    const cardStatus = getDataCardStatus({ is_public: isPublic });
    if (cardStatus.status !== 'public' || liking) return;
    
    const success = addLikedCard(id);

    // 只有当 localStorage 写入成功（即之前未点过赞）时，才继续执行
    if (success) {
      setLiked(true);
      setLiking(true);
      setCurrentLikeCount(prev => prev + 1);

      try {
        // 调用 API 增加点赞数
        const response = await fetch('/api/data-card-stats', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cardId: id, type: 'like' }),
        });

        if (response.ok) {
          const result = await response.json();
          if (result.success) {
            onLike?.();
            onLikeSuccess?.();
          } else {
            // 如果API失败，理论上应该回滚状态，但为了简化UI，暂时只打印错误
            console.error('API call to like card failed, but UI state updated.');
          }
        }
      } catch (error) {
        console.error('点赞失败:', error);
        // 网络等错误发生时，也可以考虑回滚UI状态
        setCurrentLikeCount(prev => prev - 1); 
      } finally {
        setLiking(false);
      }
    } else {
      // 如果 addLikedCard 返回 false，说明已经点过赞了，确保UI状态是正确的
      if (!liked) {
        setLiked(true);
      }
    }
  };

  const handleFavoriteToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (!onToggleFavorite || favoriting || !canFavorite) {
      return;
    }

    if (cardStatus.status !== 'public') {
      return;
    }

    setFavoriting(true);
    try {
      const result = await onToggleFavorite(!isFavorited);
      if (!result) {
        console.warn('收藏操作未成功');
      }
    } catch (error) {
      console.error('收藏操作失败:', error);
    } finally {
      setFavoriting(false);
    }
  };

  // 分享功能 - 复制卡片名称和UUID到剪贴板
  const handleShare = async () => {
    const cardStatus = getDataCardStatus({ is_public: isPublic });
    if (cardStatus.status !== 'public') return;
    
    try {
      const shareText = type === 'history'
        ? `魔法少女竞技场的【${name}】向你分享了一份叙事历史！（ID：${id}）✨\n快来 https://mahoshojo.colanns.me/arena 在「叙事历史」中导入此数据卡，即可继续推演剧情！`
        : `魔法少女竞技场的【${name}】向你发出了邀请！（ID：${id}）✨\n快来 https://mahoshojo.colanns.me/battle 生成新的故事吧！\n在数据库的搜索框粘贴ID即可加载${typeMap[type]}档案！`;
      await navigator.clipboard.writeText(shareText);
      setShareStatus('copied');
      setTimeout(() => setShareStatus('idle'), 2000);
    } catch (error) {
      console.error('复制到剪贴板失败:', error);
      // 降级处理：尝试使用传统方法
      try {
        const textArea = document.createElement('textarea');
        textArea.value = `${name} ${id}`;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        setShareStatus('copied');
        setTimeout(() => setShareStatus('idle'), 2000);
      } catch (fallbackError) {
        console.error('降级复制方法也失败了:', fallbackError);
      }
    }
  };
  const bgColor = type === 'scenario'
    ? 'bg-white border-gray-200 hover:border-green-400'
    : 'bg-white border-gray-200 hover:border-pink-400';

  const selectedStyle = isSelected
    ? (type === 'scenario'
      ? 'ring-2 ring-green-400 bg-green-50 border-green-400'
      : 'ring-2 ring-pink-500 bg-pink-50 border-pink-400')
    : '';

  const textColor = 'text-gray-800';
  const subTextColor = 'text-gray-600';

  return (
    <div
      className={`flex flex-col relative p-4 rounded-lg border-2 transition-all duration-200 h-full ${bgColor} ${selectedStyle}`}
    >
      {/* 主要内容区域 */}
      <div className="flex-1">
        <div className="mb-2">
          <h4 className={`font-semibold text-lg ${textColor}`} title={fullName}>
            {displayName}
          </h4>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {hot && (
              <span className="text-xs px-2 py-1 rounded-full bg-orange-100 text-orange-800 border border-orange-200">
                🔥 热门卡片
              </span>
            )}
            {pending && (
              <Link
                href="/encyclopedia/review"
                onClick={(e) => e.stopPropagation()}
                className="text-xs px-2 py-1 rounded-full flex items-center gap-1 bg-amber-100 text-amber-800 border border-amber-200 hover:underline"
                title="了解公开与审核机制"
              >
                <Clock className="w-3 h-3" /> 更新审核中
              </Link>
            )}
            {reviewStatus === 'pending' && isPublic === 1 && (
              <Link
                href="/encyclopedia/review"
                onClick={(e) => e.stopPropagation()}
                className="text-xs px-2 py-1 rounded-full flex items-center gap-1 bg-yellow-100 text-yellow-800 border border-yellow-200 hover:underline"
                title="了解公开与审核机制"
              >
                <Clock className="w-3 h-3" />
                审查中
              </Link>
            )}
            {reviewStatus === 'rejected' && (
              <Link
                href="/encyclopedia/review"
                onClick={(e) => e.stopPropagation()}
                className="text-xs px-2 py-1 rounded-full flex items-center gap-1 bg-red-100 text-red-800 border border-red-200 hover:underline"
                title="了解公开与审核机制"
              >
                <XCircle className="w-3 h-3" />
                未通过
              </Link>
            )}
            <span className={`text-xs px-2 py-1 rounded flex items-center gap-1 ${
              cardStatus.status === 'banned' 
                ? 'bg-red-100 text-red-700 border border-red-200' 
                : cardStatus.status === 'public' 
                ? 'bg-green-100 text-green-700' 
                : 'bg-gray-100 text-gray-700'
            }`}>
              {cardStatus.status === 'banned' && <Ban className="w-3 h-3" />}
              {cardStatus.label}
            </span>
            {type === 'scenario' && (
              <span className="text-xs px-2 py-1 bg-purple-100 text-purple-700 rounded">
                情景
              </span>
            )}
            {type === 'character' && (
              <span className="text-xs px-2 py-1 bg-pink-100 text-pink-700 rounded">
                角色
              </span>
            )}
            {type === 'history' && (
              <span className="text-xs px-2 py-1 bg-emerald-100 text-emerald-700 rounded">
                叙事历史
              </span>
            )}
            {type === 'character' && roleType && (
              <span className={`text-xs px-2 py-1 rounded ${roleTypeStyleMap[roleType]}`}>
                {roleTypeLabelMap[roleType]}
              </span>
            )}
            {type === 'questionnaire' && questionnaireNativeAllowed === true && (
              <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700">
                原生许可
              </span>
            )}
            {type !== 'questionnaire' && isNative === true && (
              <span className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700">
                原生
              </span>
            )}
            {isRecommended && (
              <span className="text-xs px-2 py-1 bg-amber-100 text-amber-700 rounded flex items-center gap-1">
                <BadgeCheck className="w-3 h-3" /> 推荐
              </span>
            )}
            {typeof techLevel === 'string' && techLevel.trim() ? (
              <span title="技术值等级">
                <TechBadge mode="level" techScore={techScore} techLevel={techLevel} className="whitespace-nowrap" />
              </span>
            ) : null}
            {typeof strictTier === 'string' && strictTier.trim() ? (
              <span title="严格排位段位">
                <TierBadge tier={strictTier} />
              </span>
            ) : null}
          </div>
        </div>

        {/* 描述内容 */}
        <div className='mb-1'>
          {cardStatus.status === 'banned' && (
            <div className="flex items-center gap-1 p-2 mb-2 bg-red-50 border border-red-200 rounded text-red-700 text-xs">
              <AlertTriangle className="w-4 h-4" />
              此数据卡已被封禁，无法进行公开操作
            </div>
          )}
          {description && (
            <p className={`text-sm line-clamp-2 ${subTextColor}`}>
              {description}
            </p>
          )}
        </div>
      </div>

      {/* 底部区域 */}
      <div className="mt-auto flex flex-col gap-2">
        {/* 作者信息现在是单独一行，避免与按钮竞争空间 */}
        {author && (
          onAuthorClick ? (
            <button
              onClick={(e) => {
                e.stopPropagation(); // 阻止事件冒泡，防止触发整个卡片的点击事件
                onAuthorClick(author);
              }}
              className={`text-xs ${subTextColor} hover:text-purple-600 hover:underline transition-colors text-left truncate`}
              title={`筛选作者: ${author}`}
            >
              作者: {author}
            </button>
          ) : (
            <p className={`text-xs leading-[18px] ${subTextColor} truncate`} title={`作者: ${author}`}>
              作者: {author}
            </p>
          )
        )}

        {/* 操作按钮行 */}
        <div className="flex flex-wrap gap-3 text-sm items-center">
          <button
            onClick={handleFavoriteToggle}
            className={`flex items-center gap-1 transition-colors ${
              canFavorite
                ? isFavorited
                  ? 'text-amber-500'
                  : favoriting
                    ? 'text-amber-300'
                    : 'text-gray-500 hover:text-amber-500'
                : 'text-gray-400 cursor-not-allowed'
            }`}
            disabled={!canFavorite || favoriting}
            title={
              !canFavorite
                ? '登录后才能收藏'
                : isFavorited
                  ? '取消收藏'
                  : '收藏'
            }
          >
            <Star className={`w-4 h-4 ${isFavorited ? 'fill-current' : ''}`} />
            <span>{favoriteCount}</span>
          </button>

          <button
            onClick={handleLike}
            className={`flex items-center gap-1 transition-colors ${
              cardStatus.status !== 'public'
                ? 'text-gray-400 cursor-not-allowed'
                : liked
                ? 'text-red-500'
                : liking
                  ? 'text-red-300'
                  : 'text-gray-500 hover:text-red-500'
            }`}
            disabled={cardStatus.status !== 'public' || liked || liking}
            title={
              cardStatus.status === 'banned' ? '封禁数据卡无法点赞' :
              cardStatus.status === 'private' ? '私有数据卡无法点赞' : 
              liked ? '已点赞' : '点赞'
            }
          >
            <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
            <span>{currentLikeCount}</span>
          </button>

          {/* 下载/使用次数 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (canDownload) {
                onDownload?.();
              }
            }}
            className={`flex items-center gap-1 transition-colors ${
              canDownload ? 'text-gray-500 hover:text-blue-500' : 'text-gray-400 cursor-not-allowed'
            }`}
            disabled={!canDownload}
            title={
              canDownload
                ? `下载数据卡（已下载/使用：${usageCount ?? 0}）`
                : '暂不支持保存'
            }
            aria-label="下载数据卡到本地"
          >
            <Download className="w-4 h-4" />
            <span>{usageCount}</span>
          </button>

          {/* 分享按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (cardStatus.status === 'public') {
                handleShare();
                onShare?.();
              }
            }}
            className={`flex items-center gap-1 transition-colors ${
              cardStatus.status === 'public'
                ? 'text-gray-500 hover:text-blue-500'
                : 'text-gray-400 cursor-not-allowed'
            }`}
            title={
              cardStatus.status === 'public' ? `分享：${name} ${id}` :
              cardStatus.status === 'banned' ? '封禁数据卡不允许分享' :
              '私有数据卡不允许分享'
            }
            disabled={cardStatus.status !== 'public'}
          >
            <Share className="w-4 h-4" />
            <span className="text-xs">
              {cardStatus.status !== 'public' ? '不可分享' : (shareStatus === 'copied' ? '已复制！' : '分享')}
            </span>
          </button>

          {/* 详情按钮 */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onViewDetails?.();
            }}
            className="flex items-center gap-1 text-gray-500 hover:text-purple-500 transition-colors"
            title="查看详细设定"
          >
            <Info className="w-4 h-4" />
            <span className="text-xs">详情</span>
          </button>
        </div>
      </div>

      {/* 操作按钮 */}
      {isOwner && (
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDownload?.();
            }}
            className="flex-1 min-w-[80px] text-sm px-3 py-1.5 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors"
          >
            下载
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditInfo?.();
            }}
            className="flex-1 min-w-[80px] text-sm px-3 py-1.5 bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors flex items-center justify-center gap-1"
          >
            修改信息
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.();
            }}
            className="flex-1 min-w-[80px] text-sm px-3 py-1.5 bg-red-100 text-red-700 hover:bg-red-200 rounded transition-colors"
          >
            删除
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onEditData?.();
            }}
            className="flex-1 min-w-[80px] text-sm px-3 py-1.5 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors flex items-center justify-center gap-1"
          >
            编辑档案
          </button>
          {onReplace && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onReplace();
              }}
              className="flex-1 min-w-[80px] text-sm px-3 py-1.5 bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors flex items-center justify-center gap-1"
            >
              替换
            </button>
          )}
        </div>
      )}
    </div>
  );
}
