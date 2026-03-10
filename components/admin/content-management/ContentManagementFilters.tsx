import type { ChangeEvent, Dispatch, MutableRefObject, SetStateAction } from 'react';

import type { ContentManagementFilters as ContentManagementFiltersState } from '@/components/admin/content-management/shared';

type ContentManagementFiltersProps = {
  filters: ContentManagementFiltersState;
  setFilters: Dispatch<SetStateAction<ContentManagementFiltersState>>;
  routerSearchValue: string;
  isComposingSearchRef: MutableRefObject<boolean>;
  handleFilterChange: (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => void;
  updateUrl: (nextFilters: ContentManagementFiltersState) => void;
  debouncedUpdateUrl: {
    (nextFilters: ContentManagementFiltersState): void;
    cancel: () => void;
  };
};

export function ContentManagementFilters(props: ContentManagementFiltersProps) {
  const { filters, setFilters, routerSearchValue, isComposingSearchRef, handleFilterChange, updateUrl, debouncedUpdateUrl } = props;

  return (
    <div className="mb-4 rounded-lg bg-white p-4 shadow-sm">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
        <input
          type="text"
          name="search"
          defaultValue={routerSearchValue}
          onChange={handleFilterChange}
          onCompositionStart={() => {
            isComposingSearchRef.current = true;
          }}
          onCompositionEnd={(event) => {
            isComposingSearchRef.current = false;
            const nextFilters = { ...filters, search: event.currentTarget.value, page: 1 };
            setFilters(nextFilters);
            debouncedUpdateUrl(nextFilters);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            if ((event.nativeEvent as unknown as { isComposing?: boolean }).isComposing || isComposingSearchRef.current) {
              event.preventDefault();
              return;
            }
            event.preventDefault();
            const nextFilters = { ...filters, search: event.currentTarget.value, page: 1 };
            setFilters(nextFilters);
            debouncedUpdateUrl.cancel();
            updateUrl(nextFilters);
          }}
          onBlur={(event) => {
            if (isComposingSearchRef.current) return;
            const nextFilters = { ...filters, search: event.currentTarget.value, page: 1 };
            setFilters(nextFilters);
            debouncedUpdateUrl.cancel();
            updateUrl(nextFilters);
          }}
          placeholder="搜索名称、描述、作者..."
          className="input-field"
        />
        <select name="reviewStatus" value={filters.reviewStatus} onChange={handleFilterChange} className="input-field">
          <option value="">所有审查状态</option>
          <option value="pending">待审查</option>
          <option value="approved">已通过</option>
          <option value="rejected">未通过</option>
        </select>
        <select name="isPublic" value={filters.isPublic} onChange={handleFilterChange} className="input-field">
          <option value="">所有公开状态</option>
          <option value="1">公开</option>
          <option value="0">私有</option>
          <option value="-1">封禁</option>
        </select>
        <select name="type" value={filters.type} onChange={handleFilterChange} className="input-field">
          <option value="">所有类型</option>
          <option value="character">角色</option>
          <option value="scenario">情景</option>
          <option value="history">叙事历史</option>
          <option value="questionnaire">问卷</option>
        </select>
        <select name="isRecommended" value={filters.isRecommended} onChange={handleFilterChange} className="input-field">
          <option value="">推荐状态</option>
          <option value="1">仅推荐</option>
          <option value="0">未推荐</option>
        </select>
        <select name="hasPendingUpdate" value={filters.hasPendingUpdate} onChange={handleFilterChange} className="input-field">
          <option value="">更新状态</option>
          <option value="1">仅更新待审核</option>
          <option value="0">排除更新待审核</option>
        </select>
        <select name="metricsState" value={filters.metricsState} onChange={handleFilterChange} className="input-field">
          <option value="">技术值状态</option>
          <option value="stale">待重算 / 已过期</option>
          <option value="fresh">已同步</option>
          <option value="missing">缺失</option>
        </select>
        <select name="hasVisualAssets" value={filters.hasVisualAssets} onChange={handleFilterChange} className="input-field">
          <option value="">视觉资产</option>
          <option value="1">包含视觉资产</option>
          <option value="0">不含视觉资产</option>
        </select>
        <select name="sizeBucket" value={filters.sizeBucket} onChange={handleFilterChange} className="input-field">
          <option value="">JSON 体积</option>
          <option value="warning">接近上限（≥80%）</option>
          <option value="overLimit">超预算</option>
        </select>
      </div>
    </div>
  );
}
