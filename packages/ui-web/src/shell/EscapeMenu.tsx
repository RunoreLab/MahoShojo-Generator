import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Undo2 } from 'lucide-react';

import {
  getBaseModalLayoutClassNames,
  useBaseModalAccessibility,
} from '../modal/BaseModal';
import { useEscapeFallback } from '../modal/escape-stack';

/**
 * Esc 快捷菜单（DESK-PARITY-007，D5.1-N1）。
 *
 * 组件本身是宿主无关的共享壳：「哪些入口、当前在哪、怎么导航」全部由 props
 * 注入；「何时打开」由共享 Escape 层级栈的最低层兜底决定。是否挂载由宿主决定——
 * Desktop 在壳上装配（`desktop.escapeMenu.enabled` 默认 true），Web 不挂载；
 * 撤掉宿主装配即可整体移除，栈与事件语义不受影响。
 *
 * 不变量（规格 DESK-PARITY-007）：
 * - 打开条件：一次干净的 Escape（非 repeat/非 IME 组词/未被上游 preventDefault）
 *   未被任何已注册层消费，且焦点不在原生文本输入（input/textarea/contenteditable）；
 * - 菜单本身是模态 dialog：初始焦点在「继续」，Tab 被圈在面板内，Escape 关闭
 *   并把焦点归还原焦点元素（useBaseModalAccessibility 语义）；
 * - 动作只发宿主导航回调——不取消生成、不弃草稿、不触发保存/上传/网络请求；
 *   导航是否被守卫拦截由宿主 Router 决定，菜单不提供绕过路径；
 * - 当前页标记为当前项而不是冗余跳转。
 */

/** 菜单条目；由宿主按能力快照过滤后注入（未交付入口不渲染）。 */
export interface ShellEscapeMenuEntry {
  readonly href: string;
  readonly label: string;
  /** 条目图标；缺省不渲染图标槽位。 */
  readonly icon?: ReactNode;
}

export interface ShellEscapeMenuProps {
  /** 宿主开关（Desktop 读 `desktop.escapeMenu.enabled`）；false 时不登记兜底。 */
  readonly enabled: boolean;
  readonly entries: readonly ShellEscapeMenuEntry[];
  /** 当前规范化路径——用于标记当前项；由宿主路由注入。 */
  readonly pathname: string;
  /** 站内导航接管：宿主接到产品路径后走自己的 Router（守卫语义不变）。 */
  readonly onNavigate: (href: string) => void;
}

/**
 * 焦点位于原生文本输入时不打开菜单：`<input>`（文本型）、`<textarea>`、
 * contenteditable 里的 Escape 属于编辑语义（候选取消、失焦），菜单不抢。
 */
const NON_TEXT_INPUT_TYPES = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);

const isTextEditingTarget = (element: Element | null): boolean => {
  if (!(element instanceof HTMLElement)) return false;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(element.type);
  return (
    element.isContentEditable
    || element.closest('[contenteditable=""], [contenteditable="true"]') !== null
  );
};

/** `pathname` 命中条目的当前页判定：`/` 精确匹配，其余按前缀（含 `/` 边界）。 */
const isCurrentEntry = (pathname: string, href: string): boolean =>
  href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);

const actionItemClass =
  'flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm text-gray-800 transition hover:bg-pink-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-200 dark:text-slate-100 dark:hover:bg-slate-800';

export function ShellEscapeMenu({
  enabled,
  entries,
  pathname,
  onNavigate,
}: ShellEscapeMenuProps) {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => setMounted(true), []);

  // 兜底在层栈最低处：没有任何层消费干净 Escape 且焦点不在文本输入时才开。
  // 它不关闭任何东西，只负责「把菜单开起来」——菜单一旦打开就成为普通模态层。
  useEscapeFallback(enabled, () => {
    if (isTextEditingTarget(document.activeElement)) return false;
    setOpen(true);
    return true;
  });

  // 宿主在菜单开着时把开关关掉：菜单退场而不是悬在原地（开关语义如实生效）。
  useEffect(() => {
    if (!enabled) setOpen(false);
  }, [enabled]);

  const { dialogRef, initialFocusRef, titleId } = useBaseModalAccessibility({
    isOpen: open,
    onClose: close,
  });

  const { rootClassName, panelClassName } = getBaseModalLayoutClassNames({
    maxWidthClassName: 'max-w-xs',
    zIndexClassName: 'z-[60]',
  });

  const moveActionFocus = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [])];
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else if (index < 0) next = event.key === 'ArrowDown' ? 0 : buttons.length - 1;
    else next = event.key === 'ArrowDown'
      ? (index + 1) % buttons.length
      : (index - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  if (!mounted || !open) return null;

  const continueAction = (
    <button
      ref={initialFocusRef}
      type="button"
      onClick={close}
      className={actionItemClass}
    >
      <Undo2 className="h-4 w-4 shrink-0 text-pink-600" aria-hidden="true" />
      继续
    </button>
  );

  return createPortal(
    <div className={rootClassName} data-testid="escape-menu-root">
      <button
        type="button"
        aria-label="关闭快捷菜单"
        className="absolute inset-0 bg-black/60"
        onClick={close}
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={panelClassName}
        onKeyDown={moveActionFocus}
      >
        <div className="border-b border-gray-200 px-5 py-4 dark:border-gray-800">
          <div id={titleId} className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            快捷菜单
          </div>
          <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            按 Esc 或点击空白处返回当前页面
          </div>
        </div>
        <div ref={listRef} className="grid gap-1 px-3 py-3">
          {continueAction}
          {entries.map((entry) => {
            const current = isCurrentEntry(pathname, entry.href);
            const icon = entry.icon ? (
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
                {entry.icon}
              </span>
            ) : null;
            if (current) {
              return (
                <button
                  key={entry.href}
                  type="button"
                  disabled
                  aria-current="page"
                  className={`${actionItemClass} cursor-default text-pink-700 opacity-100 dark:text-pink-300`}
                >
                  {icon}
                  {entry.label}
                  <span className="ml-auto text-xs text-pink-500 dark:text-pink-400">当前页</span>
                </button>
              );
            }
            return (
              <button
                key={entry.href}
                type="button"
                onClick={() => {
                  // 先关菜单再发导航：守卫拦截时菜单已消失，提示由宿主页面展示。
                  close();
                  onNavigate(entry.href);
                }}
                className={actionItemClass}
              >
                {icon}
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>,
    document.body,
  );
}
