'use client';

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import clsx from 'clsx';
import { twMerge } from 'tailwind-merge';

export type ModalTabItem<TValue extends string> = {
  readonly value: TValue;
  readonly label: ReactNode;
  /**
   * 结果集数量等附加信息。
   *
   * 独立成 `tabular-nums` 片段而不是拼进 label：CJK 标签里混进变长数字时，
   * 等宽数字不会把相邻页签整体顶宽，切换 Tab 也不会造成整条 rail 抖动。
   */
  readonly count?: ReactNode;
  /** 原生 title。窄屏没有 hover，桌面端靠它补全被 rail 截断的长标签语义。 */
  readonly title?: string;
};

export type ModalTabsProps<TValue extends string> = {
  /**
   * DOM id 前缀，同时决定 `role="tab"` 的 id 与 `aria-controls` 指向的 panel id。
   *
   * 显式传入而不是内部 `useId()`：消费方要在 tabpanel 上写同一个 id 才能让
   * `aria-controls` 解析得到，随机 id 没法跨组件传递。取值必须能安全进 CSS 选择器。
   */
  readonly idPrefix: string;
  readonly ariaLabel: string;
  readonly items: readonly ModalTabItem<TValue>[];
  readonly value: TValue;
  readonly onValueChange: (value: TValue) => void;
  readonly className?: string;
};

/** 消费方用它把 tab 与自己的 tabpanel 绑到同一组 id 上。 */
export function modalTabIds(idPrefix: string, value: string): { tabId: string; panelId: string } {
  return { tabId: `${idPrefix}-tab-${value}`, panelId: `${idPrefix}-panel-${value}` };
}

/**
 * 窄屏横向滚动容器。
 *
 * `overflow-x-auto` 常开而不是挂在某个断点下：内容放得下时它不产生任何可见差异，
 * 放不下时才有滚动条。断点方案要赌「标签总宽度」这个变量——而标签里带调用方传入的
 * `titleOverride`／类型名／数量，长度不可控，断点一定会被某些组合穿透。
 *
 * `pb-1.5`/`px-1.5` 是 focus ring（offset 2px + ring 2px = 4px）的溢出预算；
 * 左侧留白同时充当 Material 要求的「首项缩进＝可滚动」提示。
 * 滚动条隐藏但滚动能力保留，滚动手势与键盘/AT 导航不受影响。
 */
const MODAL_TAB_RAIL_CLASS_NAME =
  'flex snap-x snap-proximity gap-2 overflow-x-auto overscroll-x-contain px-1.5 pb-1.5 '
  + '[scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden';

/**
 * `shrink-0` + `whitespace-nowrap` 是这个组件存在的理由。
 *
 * flex 子项默认允许收缩，而中文可以在任意字符间断行：少了这两条，窄屏下
 * 「管理员推荐」会被压成竖排单字，「我的角色 (167)」会被挤成一列——页面看起来像坏了。
 * `min-h-11` 对齐 Apple HIG 的 44pt / WCAG 2.5.5；Material 明确要求不要为了紧凑
 * 把 tab 目标压到 48dp 以下。
 */
const MODAL_TAB_CLASS_NAME =
  'inline-flex shrink-0 snap-center items-center justify-center whitespace-nowrap '
  + 'min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition-colors motion-reduce:transition-none '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pink-500 focus-visible:ring-offset-2';

const MODAL_TAB_STATE_CLASS_NAME = (selected: boolean): string =>
  selected ? 'bg-pink-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200';

/**
 * 模态框内的标签栏：WAI-ARIA tabs 模式 + 窄屏横向滚动。
 *
 * 选型依据（不要在无理由的情况下改成换行或溢出菜单）：
 * - W3C ARIA APG 议题 #2438 讨论 tablist 窄屏 reflow 时，任务组把「横向滚动」列为
 *   当前 ARIA 1.2 下的**首选**方案，明确说它比换行更优雅，且避开了方向切换与
 *   「更多」菜单的复杂度；「更多」菜单被否掉的原因是 button 不是 tablist 的合法子元素。
 * - Material Design 3：「当一组 tab 放不下时使用可滚动 tabs，它们最适合触摸界面浏览」，
 *   并要求移动端给首项留偏移以提示可滚动。
 * - 换行堆叠会把选中项挤到第二行，破坏 tab 与 panel 的视觉关联，在高度受限的模态框里
 *   还会进一步挤压内容区。
 *
 * 交互契约：
 * - roving tabIndex，整条 rail 只占一个 Tab 停靠点，其余靠方向键。
 * - 横向 tablist 只消费 ArrowLeft/ArrowRight 与 Home/End；上下方向键留给页面滚动
 *   （APG 对 horizontal tablist 的要求）。到达首尾**硬停**：Material 明确不建议让
 *   无限循环的滚动 tab 集把线性导航的读屏用户困住。
 */
export function ModalTabs<TValue extends string>({
  idPrefix,
  ariaLabel,
  items,
  value,
  onValueChange,
  className,
}: ModalTabsProps<TValue>) {
  const railRef = useRef<HTMLDivElement>(null);

  /**
   * 只改 rail 自己的 `scrollLeft`。
   *
   * 不用 `scrollIntoView`：它会连带滚动所有祖先滚动容器。模态框是 portal 到 body 的
   * fixed 元素，一旦页面自身可滚，这条 API 会把整个文档拽动。
   */
  const centerTab = useCallback((tabValue: string) => {
    const rail = railRef.current;
    if (!rail) return;
    const tab = document.getElementById(modalTabIds(idPrefix, tabValue).tabId);
    if (!tab || !rail.contains(tab)) return;
    const railRect = rail.getBoundingClientRect();
    const tabRect = tab.getBoundingClientRect();
    // 布局尚未就绪（jsdom、SSR 水合首帧）时不猜，浏览器会把 scrollLeft 夹在合法区间内。
    if (railRect.width === 0 || tabRect.width === 0) return;
    rail.scrollLeft += tabRect.left - railRect.left - (railRect.width - tabRect.width) / 2;
  }, [idPrefix]);

  // 只依赖 value：items 每次渲染都是新数组，跟着它跑会和用户手势抢 scrollLeft。
  // 首帧也会跑一次，正好把 initialTab 之外的默认选中项带进视野。
  useEffect(() => { centerTab(value); }, [centerTab, value]);

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    let next: TValue | null = null;
    if (step !== 0) {
      const index = items.findIndex((item) => item.value === value);
      const target = index >= 0 ? items[index + step] : undefined;
      if (target) next = target.value;
    } else if (event.key === 'Home') {
      next = items[0]?.value ?? null;
    } else if (event.key === 'End') {
      next = items.at(-1)?.value ?? null;
    }
    if (next === null || next === value) return;
    event.preventDefault();
    onValueChange(next);
    // 焦点移动本身会滚动祖先，这里再显式居中，保证方向键切到被截断的那一项也看得全。
    document.getElementById(modalTabIds(idPrefix, next).tabId)?.focus();
    centerTab(next);
  };

  return (
    <div
      ref={railRef}
      role="tablist"
      aria-label={ariaLabel}
      aria-orientation="horizontal"
      onKeyDown={onKeyDown}
      className={twMerge(clsx(MODAL_TAB_RAIL_CLASS_NAME, className))}
    >
      {items.map((item) => {
        const { tabId, panelId } = modalTabIds(idPrefix, item.value);
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            id={tabId}
            aria-selected={selected}
            aria-controls={panelId}
            // roving tabIndex：整条 rail 只占一个 Tab 停靠点。
            tabIndex={selected ? 0 : -1}
            title={item.title}
            onClick={() => onValueChange(item.value)}
            className={twMerge(clsx(MODAL_TAB_CLASS_NAME, MODAL_TAB_STATE_CLASS_NAME(selected)))}
          >
            {item.label}
            {item.count === undefined || item.count === null ? null : (
              // 空格必须落在 span 内部并用 whitespace-pre 保住：按钮是 inline-flex，
              // 纯空白的匿名文本节点在 flex 布局里会被整体丢弃，写成相邻元素间的空白
              // 同样不会渲染，结果就是「本地库(1)」少一个空格。
              <span className="whitespace-pre tabular-nums"> ({item.count})</span>
            )}
          </button>
        );
      })}
    </div>
  );
}