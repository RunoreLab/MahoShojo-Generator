import { useEffect, useMemo, useRef } from 'react';

/**
 * 统一 Escape 层级（DESK-PARITY-007）。
 *
 * 页面上的可关闭层（模态框、抽屉、下拉、原生 <dialog> 的协调登记）都注册进同一个
 * 模块级栈，由这里唯一的 document 级 keydown 分发器按下述不变量派发 Escape：
 *
 * - 自上而下逐层询问，第一层返回 `true`（已关闭或明确阻断）即停——一次 Escape
 *   至多消费一层，嵌套弹窗不会连锁关闭；
 * - 只有消费/阻断才 `preventDefault`；没有层接住时落到宿主兜底（Desktop 的
 *   Esc 快捷菜单），兜底也接不住则事件原样放行；
 * - 只分发干净的一次按键：`event.repeat`（长按）、`event.isComposing`（IME
 *   组词）、`event.defaultPrevented`（上游已处理）一律不进入层级判定。
 *
 * 层只做一件事：按自己语义回答「这一次 Escape 归不归我」。返回 `false` 表示
 * 让给下一层；返回 `true` 表示本层收口——可以是关闭自己，也可以是「子层正在
 * 前台、本层不动」的显式阻断（栈外宿主层没有注册进栈时用它挡住穿透）。
 *
 * `trapsFocus` 标记拥有焦点约束的模态层：它不是 Escape 语义的判定项，只服务于
 * `isTopmostFocusTrapLayer`——各层的 Tab 循环实现据此判断「现在该由谁圈住焦点」，
 * 避免两个 focus trap 互拽。普通弹出层（下拉/选择器）保持默认 `false`。
 *
 * 元素级局部键盘行为（输入框、listbox 内导航）不经过这里；`stopPropagation`
 * 的捕获监听（如 Web 竞技场沉浸态）会在事件冒泡到 document 前先行收口，
 * 与本栈天然隔离。
 */

/** 层的 Escape 应答：`true` = 已消费或明确阻断（立即停发）；`false` = 让给下一层。 */
export type EscapeLayerHandler = () => boolean;

interface RegisteredEscapeLayer {
  readonly id: symbol;
  readonly onEscape: EscapeLayerHandler;
  readonly trapsFocus: boolean;
}

const layers: RegisteredEscapeLayer[] = [];
let escapeFallback: (() => boolean) | null = null;
let dispatchInstalled = false;

const dispatchKeydown = (event: KeyboardEvent): void => {
  if (event.key !== 'Escape' || event.repeat || event.isComposing || event.defaultPrevented) {
    return;
  }
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index]!.onEscape()) {
      event.preventDefault();
      return;
    }
  }
  if (escapeFallback?.() === true) {
    event.preventDefault();
  }
};

const ensureDispatchInstalled = (): void => {
  if (dispatchInstalled || typeof document === 'undefined') return;
  document.addEventListener('keydown', dispatchKeydown);
  dispatchInstalled = true;
};

export interface EscapeLayerRegistration {
  readonly id: symbol;
  /** 该层拥有焦点约束（模态框/抽屉）；默认 false。 */
  readonly trapsFocus?: boolean;
  readonly onEscape: EscapeLayerHandler;
}

/** 把一层压入栈顶（后注册者更高）；卸载时必须 `popEscapeLayer` 同一 id。 */
export const pushEscapeLayer = (registration: EscapeLayerRegistration): void => {
  layers.push({
    id: registration.id,
    trapsFocus: registration.trapsFocus === true,
    onEscape: registration.onEscape,
  });
  ensureDispatchInstalled();
};

export const popEscapeLayer = (id: symbol): void => {
  const index = layers.findIndex((layer) => layer.id === id);
  if (index >= 0) layers.splice(index, 1);
};

/**
 * `id` 是否是最高的焦点约束层。模态层的 Tab 循环只应在它返回 true 时工作：
 * 上方存在另一个模态层（或登记为约束层的原生 <dialog>）时让位。
 */
export const isTopmostFocusTrapLayer = (id: symbol): boolean => {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index]!.trapsFocus) return layers[index]!.id === id;
  }
  return false;
};

/**
 * 最低层兜底：栈内没有任何层消费时才被询问（宿主 Esc 菜单用它）。
 * 同时只有一个兜底生效，重新注册即替换；返回值是注销函数。
 */
export const setEscapeFallback = (handler: () => boolean): (() => void) => {
  escapeFallback = handler;
  ensureDispatchInstalled();
  return () => {
    if (escapeFallback === handler) escapeFallback = null;
  };
};

export interface UseEscapeLayerOptions {
  /** 层当前是否打开；关闭状态不占栈位。 */
  readonly active: boolean;
  readonly onEscape: EscapeLayerHandler;
  readonly trapsFocus?: boolean;
}

/**
 * 组件侧登记一层。`onEscape` 经 ref 直达最新闭包，层本身不随回调身份重建；
 * 返回的 id 供 `isTopmostFocusTrapLayer` 配合自有 Tab 循环使用。
 */
export const useEscapeLayer = ({ active, onEscape, trapsFocus = false }: UseEscapeLayerOptions): symbol => {
  const id = useMemo(() => Symbol('escape-layer'), []);
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;
  useEffect(() => {
    if (!active) return;
    pushEscapeLayer({ id, trapsFocus, onEscape: () => onEscapeRef.current() });
    return () => popEscapeLayer(id);
  }, [active, id, trapsFocus]);
  return id;
};

/** 组件侧登记/注销兜底（`active` 为 false 时兜底不生效）。 */
export const useEscapeFallback = (active: boolean, handler: () => boolean): void => {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (!active) return;
    const wrapped = () => handlerRef.current();
    return setEscapeFallback(wrapped);
  }, [active]);
};
