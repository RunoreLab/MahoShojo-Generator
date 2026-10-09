import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BaseModal } from '@mahoshojo/ui-web/modal';

import {
  DesktopExternalLinkError,
  openExternalUrl,
  type InvokeFn,
} from '../../platform/external-links-bridge';

/**
 * Desktop 的站外打开策略（D5.1-P1，`DESK-PARITY-003`）。
 *
 * 两种打开形态，渲染层只有这两个入口：
 *
 * - `openFixed`：**固定产品链接**（页脚赞助/群号/仓库、顶栏站外入口）。它们是产品内容
 *   的一部分，直接经 native 校验打开，不弹确认；
 * - `openContent`：**内容链接**（公告/百科/卡片 Markdown 里的站外地址）。默认先展示
 *   完整目标域名请用户确认——`externalLinks.confirmContentLinks`（S2 起经
 *   `config.json` 由宿主注入）可改为直接打开；非法值按 `true`（更保守）降级。
 *
 * native `open_external_url` 的协议/凭据校验是最终边界，两种形态共用。
 */

export interface ExternalLinksApi {
  /** 固定产品链接：不弹确认，直接打开。 */
  readonly openFixed: (url: string) => void;
  /** 内容链接：默认先确认再打开。 */
  readonly openContent: (url: string) => void;
}

const ExternalLinksContext = createContext<ExternalLinksApi | null>(null);

const describeOpenError = (cause: unknown): string =>
  cause instanceof DesktopExternalLinkError
    ? cause.code === 'invalid-url'
      ? '该链接不是合法的网页地址，已拒绝打开。'
      : `系统浏览器打开失败：${cause.message}`
    : '系统浏览器打开失败。';

interface PendingConfirm {
  readonly url: string;
  readonly host: string;
}

export function ExternalLinksProvider({
  children,
  invoke: invokeFn = invoke,
  confirmContentLinks = true,
}: {
  readonly children: ReactNode;
  /** 测试注入的 invoke 替身；生产默认走 Tauri 通道。 */
  readonly invoke?: InvokeFn;
  /** `externalLinks.confirmContentLinks`（默认 `true`，S2 起由 config snapshot 注入）。 */
  readonly confirmContentLinks?: boolean;
}) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 确认弹窗只允许一个；内容链接的「打开」动作必须等用户决定。
  const pendingRef = useRef<PendingConfirm | null>(null);

  const tryOpen = useCallback(
    (url: string) => {
      openExternalUrl(invokeFn, url).catch((cause: unknown) => {
        setError(describeOpenError(cause));
      });
    },
    [invokeFn],
  );

  const openFixed = useCallback(
    (url: string) => {
      tryOpen(url);
    },
    [tryOpen],
  );

  const openContent = useCallback(
    (url: string) => {
      if (!confirmContentLinks) {
        tryOpen(url);
        return;
      }
      let host = url;
      try {
        host = new URL(url).host;
      } catch {
        // host 显示原文；native 仍会拒绝非法 URL，确认框只是告知而非校验。
      }
      const next = { url, host };
      pendingRef.current = next;
      setPending(next);
    },
    [confirmContentLinks, tryOpen],
  );

  const api = useMemo<ExternalLinksApi>(() => ({ openFixed, openContent }), [openFixed, openContent]);

  return (
    <ExternalLinksContext.Provider value={api}>
      {children}
      <BaseModal
        isOpen={pending !== null}
        title="打开外部链接？"
        zIndexClassName="z-[1100]"
        onClose={() => {
          pendingRef.current = null;
          setPending(null);
        }}
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
              onClick={() => {
                pendingRef.current = null;
                setPending(null);
              }}
            >
              取消
            </button>
            <button
              type="button"
              className="rounded-md bg-pink-500 px-4 py-2 text-sm font-medium text-white hover:bg-pink-600"
              onClick={() => {
                const target = pendingRef.current;
                pendingRef.current = null;
                setPending(null);
                if (target) tryOpen(target.url);
              }}
            >
              在系统浏览器打开
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p>
            即将离开应用并在系统浏览器中打开 <span className="font-semibold">{pending?.host}</span>：
          </p>
          <p className="break-all rounded-md bg-gray-100 px-3 py-2 font-mono text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-300">
            {pending?.url}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            外部内容由站点自身提供；本地创作内容与账号凭据不会随链接发送。
          </p>
        </div>
      </BaseModal>
      <BaseModal isOpen={error !== null} zIndexClassName="z-[1100]" title="无法打开链接" onClose={() => setError(null)}>
        <p>{error}</p>
      </BaseModal>
    </ExternalLinksContext.Provider>
  );
}

export const useExternalLinks = (): ExternalLinksApi => {
  const api = useContext(ExternalLinksContext);
  if (!api) {
    // 缺 provider 时给「安全不可用」而不是崩：调用方拿到一个说明原因的 no-op，
    // 链接仍可被共源组件渲染为不可点击说明（DESK-PROD-001）。
    return {
      openFixed: () => undefined,
      openContent: () => undefined,
    };
  }
  return api;
};
