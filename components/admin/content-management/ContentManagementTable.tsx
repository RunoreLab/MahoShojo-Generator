import type { ChangeEvent, ReactElement } from 'react';

import { AdminTableScroll } from '@/components/admin/AdminTableScroll';
import type { ContentManagementFilters, DataCard } from '@/components/admin/content-management/shared';
import { MAX_DATA_CARD_BYTES, formatKilobytes } from '@/lib/data-card-size';

type ContentManagementTableProps = {
  dataCards: DataCard[];
  loading: boolean;
  selectedIds: Set<string>;
  nativeUpdatingId: string | null;
  total: number;
  totalPages: number;
  filters: ContentManagementFilters;
  getReviewStatusBadge: (status: DataCard['review_status']) => ReactElement;
  getPublicStatusBadge: (status: DataCard['is_public']) => ReactElement;
  parseQuestionnaireNativeAllowed: (rawData: string | null | undefined) => boolean;
  formatSizeBadge: (bytes: number | null | undefined) => string | null;
  handleSelectAll: (event: ChangeEvent<HTMLInputElement>) => void;
  handleSelectOne: (id: string) => void;
  handleViewDetails: (card: DataCard) => void;
  handleViewOriginalDetails: (card: DataCard) => void;
  handleToggleQuestionnaireNative: (card: DataCard, nextAllowed: boolean) => void;
  handlePageChange: (newPage: number) => void;
};

export function ContentManagementTable(props: ContentManagementTableProps) {
  const {
    dataCards,
    loading,
    selectedIds,
    nativeUpdatingId,
    total,
    totalPages,
    filters,
    getReviewStatusBadge,
    getPublicStatusBadge,
    parseQuestionnaireNativeAllowed,
    formatSizeBadge,
    handleSelectAll,
    handleSelectOne,
    handleViewDetails,
    handleViewOriginalDetails,
    handleToggleQuestionnaireNative,
    handlePageChange,
  } = props;

  return (
    <>
      <AdminTableScroll withCard={false} className="rounded-lg bg-white shadow-sm">
        <table className="min-w-full w-max text-left text-sm text-gray-500">
          <thead className="bg-gray-50 text-xs text-gray-700">
            <tr>
              <th scope="col" className="p-4">
                <input type="checkbox" onChange={handleSelectAll} checked={selectedIds.size === dataCards.length && dataCards.length > 0} />
              </th>
              <th scope="col" className="px-6 py-3">名称 / 作者</th>
              <th scope="col" className="px-6 py-3">类型</th>
              <th scope="col" className="px-6 py-3">公开状态</th>
              <th scope="col" className="px-6 py-3">审查状态</th>
              <th scope="col" className="whitespace-nowrap px-6 py-3">点赞 / 收藏 / 使用</th>
              <th scope="col" className="px-6 py-3">内容预览</th>
              <th scope="col" className="px-6 py-3">更新时间</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="p-8 text-center">加载中...</td>
              </tr>
            ) : dataCards.length === 0 ? (
              <tr>
                <td colSpan={8} className="p-8 text-center">未找到符合条件的数据</td>
              </tr>
            ) : (
              dataCards.map((card) => {
                const hasPendingUpdate = Boolean(card.pending_update_id);
                const displayName = hasPendingUpdate ? (card.pending_update_name ?? card.name) : card.name;
                const displayDescription = hasPendingUpdate ? (card.pending_update_description ?? card.description) : card.description;
                const displayData = hasPendingUpdate ? (card.pending_update_data ?? card.data) : card.data;
                const questionnaireNativeAllowed = card.type === 'questionnaire' ? parseQuestionnaireNativeAllowed(card.data) : false;
                const canToggleQuestionnaireNative = card.type === 'questionnaire' && !hasPendingUpdate;
                const metricsStale = card.metrics_stale === 1;
                const hasVisualAssets = card.has_visual_assets === 1;
                const sizeBadgeText = formatSizeBadge(card.size_bytes);

                return (
                  <tr key={card.id} className="border-b bg-white hover:bg-gray-50">
                    <td className="p-4">
                      <input type="checkbox" onChange={() => handleSelectOne(card.id)} checked={selectedIds.has(card.id)} />
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleViewDetails(card)} className="text-left font-medium text-purple-600 hover:underline">
                        {displayName}
                        {hasPendingUpdate ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">更新待审核</span>
                        ) : null}
                        {!hasPendingUpdate && card.review_status === 'pending' ? (
                          <span className="ml-2 inline-flex items-center rounded-full bg-blue-100 px-2 py-0.5 text-[11px] text-blue-800">新建待审</span>
                        ) : null}
                        {card.is_recommended === 1 ? (
                          <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-700">
                            <span>推荐</span>
                          </span>
                        ) : null}
                        {card.type === 'questionnaire' ? (
                          <button
                            type="button"
                            disabled={!canToggleQuestionnaireNative || nativeUpdatingId === card.id}
                            onClick={(event) => {
                              event.stopPropagation();
                              handleToggleQuestionnaireNative(card, !questionnaireNativeAllowed);
                            }}
                            className={`ml-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                              questionnaireNativeAllowed ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100' : 'border-gray-200 bg-gray-100 text-gray-600 hover:bg-gray-200'
                            } ${!canToggleQuestionnaireNative || nativeUpdatingId === card.id ? 'cursor-not-allowed opacity-60' : ''}`}
                            title={canToggleQuestionnaireNative ? '点击切换问卷原生许可' : '存在待审更新，暂不可切换'}
                          >
                            {questionnaireNativeAllowed ? '原生许可' : '非原生'}
                          </button>
                        ) : null}
                      </button>
                      <div className="text-xs text-gray-500">by {card.username}</div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {hasVisualAssets ? <span className="inline-flex items-center rounded-full bg-fuchsia-100 px-2 py-0.5 text-[11px] text-fuchsia-700">含视觉资产</span> : null}
                        {metricsStale ? <span className="inline-flex items-center rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] text-indigo-700">技术值待重算</span> : null}
                        {sizeBadgeText ? (
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] ${
                              (card.size_bytes ?? 0) >= MAX_DATA_CARD_BYTES ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
                            }`}
                          >
                            {sizeBadgeText}
                          </span>
                        ) : null}
                      </div>
                      {hasPendingUpdate ? (
                        <div className="mt-1 flex items-center gap-2">
                          <span className="text-[11px] text-gray-500">原：{card.name}</span>
                          <button onClick={() => handleViewOriginalDetails(card)} className="text-[11px] text-gray-500 underline hover:text-gray-800">
                            看原版
                          </button>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-6 py-4">
                      {card.type === 'character' ? '角色' : card.type === 'scenario' ? '情景' : card.type === 'history' ? '叙事历史' : '问卷'}
                    </td>
                    <td className="px-6 py-4">{getPublicStatusBadge(card.is_public)}</td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        {hasPendingUpdate ? <span className="inline-flex rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">更新待审核</span> : null}
                        {getReviewStatusBadge(card.review_status)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">❤️ {card.like_count} / ⭐ {card.favorite_count} / 📥 {card.usage_count}</td>
                    <td className="max-w-xs px-6 py-4 text-xs text-gray-500">
                      {(() => {
                        const defaultDescriptions = ['角色数据卡', '情景数据卡', '叙事历史数据卡', '问卷数据卡'];
                        const normalizedDescription = (displayDescription || '').trim();
                        const isMeaningfulDescription = normalizedDescription && !defaultDescriptions.includes(normalizedDescription);

                        const contentToShow = (() => {
                          if (isMeaningfulDescription) return normalizedDescription;
                          if (card.type === 'history') {
                            try {
                              const parsed = displayData ? JSON.parse(displayData) : null;
                              const count = Array.isArray(parsed?.entries) ? parsed.entries.length : 0;
                              return `叙事历史（${count} 条）`;
                            } catch {
                              return '叙事历史（解析失败）';
                            }
                          }
                          return displayData || '';
                        })();
                        let titleToShow = contentToShow;
                        try {
                          if (!isMeaningfulDescription && displayData) {
                            titleToShow = JSON.stringify(JSON.parse(displayData), null, 2);
                          }
                        } catch (error) {
                          console.error('❌ 发生解析错误:', error);
                        }

                        return (
                          <div className="space-y-1">
                            <p className="truncate" title={titleToShow}>
                              {contentToShow}
                            </p>
                            <div className="text-[11px] text-gray-400">
                              {typeof card.size_bytes === 'number' && Number.isFinite(card.size_bytes) ? `${formatKilobytes(card.size_bytes)} KB` : '大小未知'}
                            </div>
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-6 py-4">
                      {hasPendingUpdate ? (
                        <div className="space-y-0.5">
                          <div className="text-sm text-gray-700">{new Date(card.pending_update_created_at || card.updated_at).toLocaleString()}</div>
                          <div className="text-[11px] text-gray-500">更新提交</div>
                        </div>
                      ) : (
                        new Date(card.updated_at).toLocaleString()
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </AdminTableScroll>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm">
          <button onClick={() => handlePageChange(filters.page - 1)} disabled={loading || filters.page <= 1} className="admin-button-sm">
            上一页
          </button>
          <span>
            第 {filters.page} / {totalPages} 页 (共 {total} 项)
          </span>
          <button onClick={() => handlePageChange(filters.page + 1)} disabled={loading || filters.page >= totalPages} className="admin-button-sm">
            下一页
          </button>
        </div>
      ) : null}
    </>
  );
}
