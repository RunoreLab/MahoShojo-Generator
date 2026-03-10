type ContentManagementActionBarProps = {
  selectedCount: number;
  currentPageCount: number;
  total: number;
  isExporting: boolean;
  onApprove: () => void;
  onReject: () => void;
  onSetPublic: (value: -1 | 0 | 1) => void;
  onSetRecommended: (value: 0 | 1) => void;
  onRecomputeMetrics: () => void;
  onResetArenaRatings: () => void;
  onExport: () => void;
  onOpenAiReview: () => void;
};

export function ContentManagementActionBar(props: ContentManagementActionBarProps) {
  const {
    selectedCount,
    currentPageCount,
    total,
    isExporting,
    onApprove,
    onReject,
    onSetPublic,
    onSetRecommended,
    onRecomputeMetrics,
    onResetArenaRatings,
    onExport,
    onOpenAiReview,
  } = props;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-white p-4 shadow-sm">
      <span className="mr-4 text-sm text-gray-600">选中 {selectedCount} / {currentPageCount} 项 (共 {total} 项)</span>
      <div className="flex flex-grow flex-wrap gap-2">
        <button onClick={onApprove} className="admin-button-sm bg-green-600 text-white hover:bg-green-700">
          通过审查
        </button>
        <button onClick={onReject} className="admin-button-sm bg-red-600 text-white hover:bg-red-700">
          拒绝审查
        </button>
        <button onClick={() => onSetPublic(1)} className="admin-button-sm bg-blue-600 text-white hover:bg-blue-700">
          设为公开
        </button>
        <button onClick={() => onSetPublic(0)} className="admin-button-sm bg-gray-600 text-white hover:bg-gray-700">
          设为私有
        </button>
        <button onClick={() => onSetPublic(-1)} className="admin-button-sm bg-zinc-700 text-white hover:bg-zinc-800">
          设为封禁
        </button>
        <button onClick={() => onSetRecommended(1)} className="admin-button-sm bg-amber-500 text-white hover:bg-amber-600">
          设为推荐
        </button>
        <button onClick={() => onSetRecommended(0)} className="admin-button-sm bg-amber-200 text-amber-800 hover:bg-amber-300">
          取消推荐
        </button>
        <button onClick={onRecomputeMetrics} className="admin-button-sm bg-indigo-700 text-white hover:bg-indigo-800">
          重算技术值
        </button>
        <button onClick={onResetArenaRatings} className="admin-button-sm bg-rose-700 text-white hover:bg-rose-800">
          重置排位（角色）
        </button>
        <button onClick={onExport} className="admin-button-sm bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50" disabled={isExporting || selectedCount === 0}>
          {isExporting ? '导出中...' : '导出选中项'}
        </button>
        <button onClick={onOpenAiReview} className="admin-button-sm bg-indigo-600 text-white hover:bg-indigo-700">
          AI 辅助审查
        </button>
      </div>
    </div>
  );
}
