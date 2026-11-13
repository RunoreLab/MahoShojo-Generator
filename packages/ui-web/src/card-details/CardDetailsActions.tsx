import type { ReactNode } from 'react';
import { Download, HardDrive } from 'lucide-react';
import { GenerationActionButton } from '../generation-actions';

export interface CardDetailsActionsProps {
  onDownload: () => void;
  downloadDisabled?: boolean;
  downloadLabel?: string;
  downloadTitle?: string;
  onSave?: () => void;
  saveBusy?: boolean;
  saveBusyLabel?: string;
  feedback?: ReactNode;
}

/** 双端详情共用操作层级；宿主继续拥有权限、派发和保存回执。 */
export function CardDetailsActions({ onDownload, downloadDisabled, downloadLabel = '下载 JSON', downloadTitle, onSave, saveBusy, saveBusyLabel = '保存中…', feedback }: CardDetailsActionsProps) {
  return <div className="flex min-w-0 flex-col gap-2 break-words">
    {feedback}
    <div className="flex flex-wrap justify-end gap-2">
      <GenerationActionButton variant={onSave ? 'secondary' : 'primary'} onClick={onDownload} disabled={downloadDisabled}
        title={downloadTitle} className="min-h-11 flex-auto justify-center whitespace-nowrap sm:flex-none">
        <Download className="h-4 w-4 shrink-0" aria-hidden="true" />{downloadLabel}
      </GenerationActionButton>
      {onSave && <GenerationActionButton variant="primary" onClick={onSave} disabled={saveBusy} aria-busy={saveBusy || undefined}
        title="把这张数据卡的正文复制一份存入本机本地库，不会影响线上记录"
        className="min-h-11 flex-auto justify-center whitespace-nowrap sm:flex-none">
        <HardDrive className="h-4 w-4 shrink-0" aria-hidden="true" />{saveBusy ? saveBusyLabel : '存到本地库'}
      </GenerationActionButton>}
    </div>
  </div>;
}
