import type { ReactNode } from 'react';

import { BaseModal } from '../modal';

export type WebReportConsentDialogViewProps = {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onAccept: () => void;
  readonly title?: string;
  readonly executionDescription?: ReactNode;
  /** 是否展示、当前选择和记忆范围均由宿主决定；视图不保存许可。 */
  readonly remember?: {
    readonly checked: boolean;
    readonly onChange: (checked: boolean) => void;
  };
};

/** 普通 Web 执行风险确认；不授予同源信任或 Native 能力。 */
export function WebReportConsentDialogView({
  open,
  onCancel,
  onAccept,
  title = '启用 Web 战报',
  executionDescription,
  remember,
}: WebReportConsentDialogViewProps) {
  return (
    <BaseModal isOpen={open} title={title} onClose={() => onCancel()} maxWidthClassName="max-w-lg">
      {executionDescription ? <p className="mb-3 break-words text-sm leading-6">{executionDescription}</p> : null}
      <p className="text-sm leading-6">
        Web 战报会运行生成的网页或 Web 包中的 HTML、CSS 和 JavaScript，并可能加载第三方脚本、样式、图片或其他网络资源。
        生成页面可能出现显示异常、页面卡顿或外部资源失效，第三方资源也可能接收到相关网络请求或页面发送的信息。
        请仅在了解这些风险后启用。
      </p>
      {remember ? <label className="mt-4 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={remember.checked} onChange={(event) => remember.onChange(event.target.checked)} />
        此浏览器不再提示（多人房间分别确认）
      </label> : null}
      <div className="mt-5 flex justify-end gap-3">
        <button type="button" onClick={() => onCancel()} className="rounded-lg border px-4 py-2 text-sm">取消</button>
        <button type="button" onClick={() => onAccept()} className="rounded-lg bg-purple-600 px-4 py-2 text-sm text-white">继续使用 Web</button>
      </div>
    </BaseModal>
  );
}
