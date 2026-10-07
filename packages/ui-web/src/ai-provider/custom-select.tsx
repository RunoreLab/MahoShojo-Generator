import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { useEscapeLayer } from '../modal/escape-stack';

import type { AiChannelAvailabilityEntry, AiProviderSelectOption } from './contract';

export interface AiProviderCustomSelectProps {
  options: AiProviderSelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** 宿主注入的可用性徽章渲染；缺省则不显示徽章。 */
  renderAvailabilityBadge?: (entry: AiChannelAvailabilityEntry) => ReactNode;
}

export const AiProviderCustomSelect = ({
  options,
  value,
  onChange,
  placeholder,
  disabled = false,
  renderAvailabilityBadge,
}: AiProviderCustomSelectProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = options.find((option) => option.value === value) ?? null;

  const handleDocumentClick = useCallback((event: MouseEvent) => {
    if (!containerRef.current) return;
    if (!containerRef.current.contains(event.target as Node)) {
      setIsOpen(false);
    }
  }, []);

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
      setIsOpen(false);
      if (containerRef.current?.contains(document.activeElement)) {
        triggerRef.current?.focus();
      }
      return true;
    },
  });

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

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`input-field flex w-full items-center justify-between gap-2 text-left ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
        onClick={() => !disabled && setIsOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        disabled={disabled}
      >
        {renderSelected()}
        <span className="battle-lite-subtle-text">{isOpen ? '▲' : '▼'}</span>
      </button>
      {isOpen && (
        <div className="battle-lite-select-menu absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-lg">
          <div role="listbox">
            {options.map((option, index) => (
              <button
                key={`${option.value}-${index}`}
                type="button"
                role="option"
                aria-selected={option.value === value}
                className={`flex w-full items-start gap-2 px-4 py-3 text-left transition-colors ${
                  option.value === value ? 'battle-lite-select-option-active' : 'battle-lite-select-option'
                }`}
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
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
                </div>
                {option.availability && renderAvailabilityBadge && (
                  <span className="mt-0.5 shrink-0">
                    {renderAvailabilityBadge(option.availability)}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
