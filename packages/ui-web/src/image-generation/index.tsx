import { useState } from 'react';
import { CheckCircle2, Download, RefreshCw, Square } from 'lucide-react';

import { ErrorMessageBox } from '../details-controls/ErrorMessageBox';
import { GenerationActionButton, generationActionClassNames } from '../generation-actions';

export interface ImageGenerationFeedbackProps {
  busy: boolean;
  /** null 表示供应商没有可展示的进度，不制造百分比。 */
  progress: number | null;
  statusText?: string;
  error?: string;
  taskId?: string;
  outcome?: 'completed' | 'failed' | 'stopped' | 'unresolved';
  onStop?: () => void;
  /** 宿主只能继续查询已知任务，不能在此回调中创建新任务。 */
  onResume?: () => void;
}

/** 受控任务反馈；不请求供应商、不读取配置，也不赋予任务恢复能力。 */
export function ImageGenerationFeedback({
  busy, progress, statusText, error, taskId, outcome, onStop, onResume,
}: ImageGenerationFeedbackProps) {
  const knownTaskId = taskId?.trim();
  const percentage = progress !== null && Number.isFinite(progress)
    ? Math.min(100, Math.max(0, progress)) : undefined;

  if (busy) {
    return (
      <div className="mt-4 space-y-3 rounded-xl border border-(--app-border) bg-(--app-surface) p-4 text-(--app-text)">
        <div role="status" className="space-y-2">
          <p className="text-sm font-semibold">{statusText || '正在等待图片生成结果…'}</p>
          <progress className="h-2 w-full accent-(--app-accent-strong)" aria-label="图片生成进度" max={100} value={percentage} />
          <p className="text-xs text-(--app-text-muted)">
            {percentage === undefined ? '等待图片返回，暂无进度百分比' : `${percentage}%`}
          </p>
        </div>
        {onStop && <GenerationActionButton onClick={onStop}>
          <Square aria-hidden="true" className="h-4 w-4" />停止等待（已提交的任务可能仍会计费）
        </GenerationActionButton>}
      </div>
    );
  }

  if (!error && !knownTaskId && outcome !== 'stopped' && outcome !== 'unresolved') return null;

  return (
    <div className="mt-4 space-y-3 text-sm text-(--app-text)">
      {error && <ErrorMessageBox message={error} />}
      {!error && outcome === 'stopped' && <p role="status">已停止等待，供应商任务可能仍在运行。</p>}
      {knownTaskId && <p className="break-all text-xs text-(--app-text-muted)">任务 ID：{knownTaskId}</p>}
      {outcome === 'unresolved' && !knownTaskId && <p role="status" className="text-(--app-text-muted)">
        提交结果未知，任务可能已创建或计费。请先核实供应商记录，勿立即重复生成。
      </p>}
      {knownTaskId && onResume && <GenerationActionButton onClick={onResume}>
        <RefreshCw aria-hidden="true" className="h-4 w-4" />继续查询原任务
      </GenerationActionButton>}
    </div>
  );
}

export interface ImageGenerationResultViewProps {
  /** 由宿主提供可展示的图片；本组件不获取远程字节或改变图片来源。 */
  imageUrl: string;
  seed?: number;
  /** 宿主只对确实支持直接下载的图片传入此项。 */
  download?: { filename: string };
}

/** 生成成功与图片载入失败分开呈现；失败图片不会改成空 src。 */
export function ImageGenerationResultView({ imageUrl, seed, download }: ImageGenerationResultViewProps) {
  const [failedImage, setFailedImage] = useState<string | null>(null);
  const source = imageUrl.trim();
  const failed = !source || failedImage === source;

  return (
    <div className="mt-4 space-y-3 text-(--app-text)">
      <div className="space-y-1 rounded-xl border border-(--app-border) bg-(--app-surface) p-3 text-center" role="status">
        <p className="flex items-center justify-center gap-2 text-sm font-semibold"><CheckCircle2 aria-hidden="true" className="h-4 w-4" />生成成功！</p>
        {seed !== undefined && <p className="text-xs text-(--app-text-muted)">种子值: {seed}</p>}
      </div>
      {failed ? <ErrorMessageBox message="图片加载失败，生成结果仍保留。" /> : <div className="overflow-hidden rounded-xl border border-(--app-border) shadow-sm">
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- onError 处理资源载入失败，不是鼠标或键盘交互。 */}
        <img key={source} src={source} alt="生成的立绘" className="block h-auto w-full" onError={() => setFailedImage(source)} />
      </div>}
      {source && download && <a href={source} download={download.filename} className={generationActionClassNames.secondary}>
        <Download aria-hidden="true" className="h-4 w-4" />下载 PNG
      </a>}
    </div>
  );
}

export { NovelAISettingsFields, type NovelAISettingsFieldsProps } from './NovelAISettingsFields';
