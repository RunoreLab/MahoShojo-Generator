import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';

import { useEscapeLayer } from '../modal/escape-stack';

import type {
  AiChannelAvailabilityEntry,
  AiProviderSelectAction,
  AiProviderSelectOption,
} from './contract';

export interface AiProviderCustomSelectProps {
  options: AiProviderSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** 宿主注入的可用性徽章渲染；缺省则不显示徽章。 */
  renderAvailabilityBadge?: (entry: AiChannelAvailabilityEntry) => ReactNode;
  /**
   * 弹层底部的独立操作区（DESK-AIP-002），如「＋ 新建自定义连接」「管理连接」。
   * 动作不是选项：经 `onAction` 派发，不进入 `onChange` 的取值空间。
   */
  actions?: readonly AiProviderSelectAction[];
  onAction?: (actionId: string) => void;
}

type NavItem =
  | { type: 'option'; option: AiProviderSelectOption; id: string }
  | { type: 'action'; action: AiProviderSelectAction; id: string };

const navItemEnabled = (item: NavItem): boolean =>
  item.type === 'option' ? item.option.disabled !== true : item.action.disabled !== true;

/** 分组边界：相同 `group` 的连续选项归入同一 `role="group"`，无 group 的选项直接挂在 listbox 下。 */
const groupOptions = (
  options: readonly AiProviderSelectOption[],
  itemId: (index: number) => string,
): Array<{ key: string; group?: string; items: Array<{ option: AiProviderSelectOption; index: number; id: string }> }> => {
  const groups: Array<{ key: string; group?: string; items: Array<{ option: AiProviderSelectOption; index: number; id: string }> }> = [];
  options.forEach((option, index) => {
    const last = groups[groups.length - 1];
    if (last && last.group === option.group) {
      last.items.push({ option, index, id: itemId(index) });
    } else {
      groups.push({
        key: option.group ?? `__ungrouped_${index}`,
        ...(option.group !== undefined ? { group: option.group } : {}),
        items: [{ option, index, id: itemId(index) }],
      });
    }
  });
  return groups;
};

export const AiProviderCustomSelect = ({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  renderAvailabilityBadge,
  actions = [],
  onAction,
}: AiProviderCustomSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [activeIndex, setActiveIndex] = useState(-1);
  // 视口下方空间不足时向上展开（DESK-AIP-002：窄窗/缩放不裁切弹层）。
  const [openUpward, setOpenUpward] = useState(false);

  const selectedOption = options.find((option) => option.value === value) ?? null;

  // 键盘导航的扁平序列：先全部选项、再操作区动作，与视觉顺序一致。
  const navItems = useMemo<readonly NavItem[]>(() => {
    const optionItems: NavItem[] = options.map((option, index) => ({
      type: 'option',
      option,
      id: `${listId}-option-${index}`,
    }));
    const actionItems: NavItem[] = actions.map((action, index) => ({
      type: 'action',
      action,
      id: `${listId}-action-${index}`,
    }));
    return [...optionItems, ...actionItems];
  }, [actions, listId, options]);

  const optionGroups = useMemo(
    () => groupOptions(options, (index) => `${listId}-option-${index}`),
    [listId, options],
  );

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setActiveIndex(-1);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  const openMenu = useCallback(
    (preferredIndex?: number) => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (rect && typeof window !== 'undefined') {
        const below = window.innerHeight - rect.bottom;
        // 菜单限高 256px（max-h-64）；下方放不下且上方更宽裕时翻转到上方。
        setOpenUpward(below < 264 && rect.top > below);
      }
      setIsOpen(true);
      setActiveIndex(() => {
        if (preferredIndex !== undefined) return preferredIndex;
        const selectedIndex = options.findIndex(
          (option) => option.value === value && option.disabled !== true,
        );
        if (selectedIndex >= 0) return selectedIndex;
        const firstEnabled = navItems.findIndex(navItemEnabled);
        return firstEnabled >= 0 ? firstEnabled : navItems.length > 0 ? 0 : -1;
      });
    },
    [navItems, options, value],
  );

  const activateItem = useCallback(
    (item: NavItem | undefined) => {
      if (!item) return;
      if (item.type === 'option') {
        if (item.option.disabled === true) return;
        onChange(item.option.value);
      } else {
        if (item.action.disabled === true) return;
        onAction?.(item.action.id);
      }
      closeMenu();
    },
    [closeMenu, onAction, onChange],
  );

  const moveActive = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        if (navItems.length === 0) return -1;
        const next = Math.min(Math.max(current + delta, 0), navItems.length - 1);
        return next;
      });
    },
    [navItems.length],
  );

  // 键盘激活项滚入视口；jsdom 等环境没有 scrollIntoView 时静默跳过。
  useEffect(() => {
    if (!isOpen || activeIndex < 0) return;
    const item = navItems[activeIndex];
    if (!item) return;
    const element = menuRef.current?.querySelector(`#${CSS.escape(item.id)}`);
    (element as HTMLElement | null | undefined)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, isOpen, navItems]);

  const handleDocumentClick = useCallback((event: MouseEvent) => {
    if (!containerRef.current) return;
    if (!containerRef.current.contains(event.target as Node)) {
      closeMenu();
    }
  }, [closeMenu]);

  useEffect(() => {
    if (!isOpen) return;
    document.addEventListener('mousedown', handleDocumentClick);
    return () => document.removeEventListener('mousedown', handleDocumentClick);
  }, [handleDocumentClick, isOpen]);

  // Escape 经共享层级栈消费（DESK-PARITY-007）：只关本层并把焦点还给触发器；
  // 上方另有打开层（抽屉/模态）时它们先接，本层不会被连带关闭。
  useEscapeLayer({
    active: isOpen,
    onEscape: () => {
      closeMenu(containerRef.current?.contains(document.activeElement) === true);
      return true;
    },
  });

  // 弹层打开期间选项/动作集合变化时，把 activeIndex 收敛回合法范围。
  useEffect(() => {
    if (!isOpen) return;
    setActiveIndex((current) =>
      navItems.length === 0 ? -1 : Math.min(current, navItems.length - 1),
    );
  }, [isOpen, navItems.length]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return;
    if (!isOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        openMenu();
      }
      // Enter/Space 走原生 button click 路径，不重复处理。
      return;
    }
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        moveActive(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        moveActive(-1);
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(navItems.length > 0 ? 0 : -1);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(navItems.length - 1);
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        activateItem(navItems[activeIndex]);
        break;
      case 'Tab':
        // 不拦截：关闭弹层后让焦点按自然顺序移动。
        closeMenu();
        break;
      default:
        break;
    }
  };

  const renderSelected = () => (
    <div className="flex flex-1 flex-col text-left leading-tight">
      <span className="battle-lite-strong-text text-sm font-semibold">
        {selectedOption?.label ?? placeholder}
      </span>
      <span className="battle-lite-subtle-text flex items-center gap-1 text-xs">
        <span>{selectedOption?.description ?? '请选择'}</span>
        {selectedOption?.availability && renderAvailabilityBadge?.(selectedOption.availability)}
      </span>
    </div>
  );

  const activeItem = isOpen && activeIndex >= 0 ? navItems[activeIndex] : undefined;
  const isActive = (id: string) => activeItem?.id === id;

  const optionClassName = (option: AiProviderSelectOption, id: string) =>
    `flex w-full items-start gap-2 px-4 py-3 text-left transition-colors ${
      option.value === value ? 'battle-lite-select-option-active' : 'battle-lite-select-option'
    } ${option.disabled === true ? 'cursor-not-allowed opacity-60' : ''} ${
      isActive(id) ? 'battle-lite-select-option-focus' : ''
    }`;

  const renderOptionButton = (
    option: AiProviderSelectOption,
    id: string,
    flatIndex: number,
  ) => (
    <button
      key={id}
      id={id}
      type="button"
      role="option"
      aria-selected={option.value === value}
      aria-disabled={option.disabled === true}
      className={optionClassName(option, id)}
      onMouseEnter={() => setActiveIndex(flatIndex)}
      onClick={() => {
        if (option.disabled === true) return;
        onChange(option.value);
        closeMenu();
      }}
    >
      <div className="flex flex-1 flex-col items-start gap-1">
        <span className="battle-lite-strong-text text-sm font-semibold">
          {option.label}
        </span>
        {option.description && (
          <span className="battle-lite-subtle-text text-xs">
            {option.description}
          </span>
        )}
        {option.disabled === true && option.disabledReason && (
          <span className="battle-lite-subtle-text text-xs">
            {option.disabledReason}
          </span>
        )}
      </div>
      {option.availability && renderAvailabilityBadge && (
        <span className="mt-0.5 shrink-0">
          {renderAvailabilityBadge(option.availability)}
        </span>
      )}
    </button>
  );

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`input-field flex w-full items-center justify-between gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        onClick={() => {
          if (disabled) return;
          if (isOpen) {
            closeMenu();
          } else {
            openMenu();
          }
        }}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? `${listId}-menu` : undefined}
        aria-activedescendant={activeItem?.id}
        disabled={disabled}
      >
        {renderSelected()}
        <span className="battle-lite-subtle-text">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div
          id={`${listId}-menu`}
          ref={menuRef}
          className={`battle-lite-select-menu absolute z-30 max-h-64 w-full overflow-y-auto rounded-lg ${
            openUpward ? 'bottom-full mb-2' : 'mt-2'
          }`}
        >
          <div role="listbox" aria-label={placeholder}>
            {optionGroups.map((group) => {
              const buttons = group.items.map(({ option, index, id }) =>
                renderOptionButton(option, id, index),
              );
              if (group.group === undefined) return buttons;
              return (
                <div key={group.key} role="group" aria-label={group.group}>
                  <div className="battle-lite-subtle-text px-4 pb-1 pt-2 text-xs font-semibold">
                    {group.group}
                  </div>
                  {buttons}
                </div>
              );
            })}
          </div>
          {actions.length > 0 && (
            <div
              role="group"
              aria-label="操作"
              className="border-t border-(--app-border-strong)"
            >
              {actions.map((action, index) => {
                const id = `${listId}-action-${index}`;
                const flatIndex = options.length + index;
                return (
                  <button
                    key={id}
                    id={id}
                    type="button"
                    aria-disabled={action.disabled === true}
                    className={`battle-lite-select-option flex w-full items-start gap-2 px-4 py-3 text-left transition-colors ${
                      action.disabled === true ? 'cursor-not-allowed opacity-60' : ''
                    } ${isActive(id) ? 'battle-lite-select-option-focus' : ''}`}
                    onMouseEnter={() => setActiveIndex(flatIndex)}
                    onClick={() => {
                      if (action.disabled === true) return;
                      onAction?.(action.id);
                      closeMenu();
                    }}
                  >
                    <div className="flex flex-1 flex-col items-start gap-1">
                      <span className="battle-lite-strong-text text-sm font-semibold">
                        {action.label}
                      </span>
                      {action.description && (
                        <span className="battle-lite-subtle-text text-xs">
                          {action.description}
                        </span>
                      )}
                      {action.disabled === true && action.disabledReason && (
                        <span className="battle-lite-subtle-text text-xs">
                          {action.disabledReason}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
