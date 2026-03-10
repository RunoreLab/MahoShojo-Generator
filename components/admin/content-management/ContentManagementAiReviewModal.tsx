import type { Dispatch, SetStateAction } from 'react';

import type { AiReviewResult, AiTargetSnapshotItem } from '@/components/admin/content-management/shared';

type ContentManagementAiReviewModalProps = {
  isOpen: boolean;
  onClose: () => void;
  aiBatchSize: number;
  setAiBatchSize: Dispatch<SetStateAction<number>>;
  aiModel: string;
  setAiModel: Dispatch<SetStateAction<string>>;
  resolvedAiModels: string[];
  aiModelLabelMap: Map<string, string>;
  availableAiModelsError: string | null;
  availableAiModels: string[];
  isAiReviewing: boolean;
  aiReviewResults: AiReviewResult[];
  markedActions: Record<string, 'approve' | 'reject'>;
  aiTargetSnapshotById: Record<string, AiTargetSnapshotItem>;
  externalReviewContent: string;
  setExternalReviewContent: Dispatch<SetStateAction<string>>;
  copyStatus: string;
  onStartAiReview: () => void;
  onCopyToClipboard: () => void;
  onParseAndApply: () => void;
  onExecuteMarkedActions: () => void;
  onMarkAction: (id: string, action: 'approve' | 'reject') => void;
  onViewDetailsFromAiTarget: (targetId: string, variant: 'review' | 'original') => void;
};

export function ContentManagementAiReviewModal(props: ContentManagementAiReviewModalProps) {
  const {
    isOpen,
    onClose,
    aiBatchSize,
    setAiBatchSize,
    aiModel,
    setAiModel,
    resolvedAiModels,
    aiModelLabelMap,
    availableAiModelsError,
    availableAiModels,
    isAiReviewing,
    aiReviewResults,
    markedActions,
    aiTargetSnapshotById,
    externalReviewContent,
    setExternalReviewContent,
    copyStatus,
    onStartAiReview,
    onCopyToClipboard,
    onParseAndApply,
    onExecuteMarkedActions,
    onMarkAction,
    onViewDetailsFromAiTarget,
  } = props;

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-bold">AI 辅助审查</h2>
          <button onClick={onClose} className="text-2xl text-gray-500 hover:text-gray-800">
            &times;
          </button>
        </div>
        <div className="flex flex-grow flex-col overflow-hidden md:flex-row">
          <div className="flex w-full flex-col border-r md:w-1/2">
            <div className="space-y-4 p-4">
              <div className="flex items-center gap-4">
                <div>
                  <label className="text-sm font-medium">单次处理数量</label>
                  <input type="number" value={aiBatchSize} onChange={(event) => setAiBatchSize(parseInt(event.target.value))} className="input-field mt-1 w-24" min="1" max="50" />
                </div>
                <div>
                  <label className="text-sm font-medium">使用模型</label>
                  <select value={aiModel} onChange={(event) => setAiModel(event.target.value)} className="input-field mt-1">
                    <option value="default">使用系统默认配置（推荐）</option>
                    {resolvedAiModels.map((modelId) => (
                      <option key={modelId} value={modelId}>
                        {aiModelLabelMap.get(modelId) ?? modelId}
                      </option>
                    ))}
                  </select>
                  {availableAiModelsError && availableAiModels.length === 0 ? <p className="mt-1 text-[11px] text-amber-700">模型列表获取失败，已回退到内置目录：{availableAiModelsError}</p> : null}
                </div>
                <button onClick={onStartAiReview} disabled={isAiReviewing} className="admin-button-sm self-end bg-indigo-600 text-white hover:bg-indigo-700">
                  {isAiReviewing ? '审查中...' : '开始审查'}
                </button>
              </div>
              <p className="text-xs text-gray-500">若已在下方大列表中勾选内容，则优先审查勾选项；否则从当前列表中选取“新建待审 / 更新待审”最多 {aiBatchSize} 项。AI 给出“拒绝”不会自动勾选，需管理员确认。</p>
            </div>
            <div className="flex-grow overflow-y-auto border-t p-4">
              {isAiReviewing ? <div className="text-center">AI 正在努力分析中...</div> : null}
              {aiReviewResults.length === 0 && !isAiReviewing ? <div className="text-center text-gray-500">暂无审查结果</div> : null}
              {aiReviewResults.length > 0 ? (
                <div className="space-y-2">
                  {aiReviewResults.map((result) => (
                    <div key={result.id} className="rounded-lg border bg-gray-50 p-3">
                      <p className="font-semibold">{result.name}</p>
                      <p className={`text-sm font-bold ${result.suggestion === 'approved' ? 'text-green-600' : 'text-red-600'}`}>AI建议: {result.suggestion === 'approved' ? '通过' : '拒绝'}</p>
                      <p className="text-xs italic text-gray-600">理由: {result.reason}</p>
                      {aiTargetSnapshotById[result.id] ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button onClick={() => onViewDetailsFromAiTarget(result.id, 'review')} className="admin-button-sm bg-gray-100 text-gray-700 hover:bg-gray-200">
                            {aiTargetSnapshotById[result.id].kind === 'update' ? '查看更新' : '查看详情'}
                          </button>
                          {aiTargetSnapshotById[result.id].kind === 'update' ? (
                            <button onClick={() => onViewDetailsFromAiTarget(result.id, 'original')} className="admin-button-sm bg-gray-100 text-gray-700 hover:bg-gray-200">
                              看原版
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      <div className="mt-2 flex gap-2">
                        <label className="flex cursor-pointer items-center text-xs">
                          <input type="radio" name={`action-${result.id}`} onChange={() => onMarkAction(result.id, 'approve')} checked={markedActions[result.id] === 'approve'} />
                          <span className="ml-1">通过</span>
                        </label>
                        <label className="flex cursor-pointer items-center text-xs">
                          <input type="radio" name={`action-${result.id}`} onChange={() => onMarkAction(result.id, 'reject')} checked={markedActions[result.id] === 'reject'} />
                          <span className="ml-1">拒绝</span>
                        </label>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex w-full flex-col md:w-1/2">
            <div className="p-4">
              <h3 className="mb-2 font-semibold">外部 AI 审查工作流</h3>
              <button onClick={onCopyToClipboard} className="admin-button-sm mb-2 w-full bg-gray-700 text-white hover:bg-gray-800">
                1. 复制内容以供外部审查
              </button>
              {copyStatus ? <p className="mb-2 text-center text-xs text-green-600">{copyStatus}</p> : null}
              <textarea
                value={externalReviewContent}
                onChange={(event) => setExternalReviewContent(event.target.value)}
                placeholder="2. 在此处粘贴外部 AI 返回的 JSON 数组结果（留空则尝试读取剪贴板）..."
                className="input-field h-32 w-full resize-y"
              />
              <button onClick={onParseAndApply} className="admin-button-sm mt-2 w-full bg-blue-700 text-white hover:bg-blue-800">
                3. 解析并应用建议
              </button>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t p-4">
          <button onClick={onExecuteMarkedActions} disabled={Object.keys(markedActions).length === 0} className="admin-button-sm bg-green-700 text-white hover:bg-green-800">
            执行所有已标记操作 ({Object.keys(markedActions).length})
          </button>
        </div>
      </div>
    </div>
  );
}
