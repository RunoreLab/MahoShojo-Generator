import { useId } from 'react';
import { DEFAULT_MODELSCOPE_MODEL, MODELSCOPE_SIZE_OPTIONS, isModelScopePresetSize, type ModelScopePresetSize } from '@mahoshojo/ai-core/modelscope';

export interface ModelScopeSettingsFieldsProps {
  size: ModelScopePresetSize;
  onSizeChange: (value: ModelScopePresetSize) => void;
  /** 仅在宿主原本允许编辑模型时提供，不替宿主补默认值或 trim。 */
  model?: { value: string; onChange: (value: string) => void };
  disabled?: boolean;
  compact?: boolean;
}

/** 仅呈现非秘密参数；凭据、存储、请求和任务快照由宿主持有。 */
export function ModelScopeSettingsFields({ size, onSizeChange, model, disabled = false, compact = false }: ModelScopeSettingsFieldsProps) {
  const id = useId();
  const groupClass = compact ? 'space-y-2' : 'input-group';
  const labelClass = compact ? 'input-label text-xs' : 'input-label';
  const inputClass = compact ? 'input-field w-full text-sm' : 'input-field';
  return (
    <div className={compact ? 'grid grid-cols-1 sm:grid-cols-2 gap-3' : undefined}>
      <div className={groupClass}>
        <label htmlFor={`${id}-size`} className={labelClass}>图片尺寸</label>
        <select id={`${id}-size`} value={size} disabled={disabled} className={inputClass}
          onChange={(event) => {
            if (isModelScopePresetSize(event.target.value)) onSizeChange(event.target.value);
          }}>
          {MODELSCOPE_SIZE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
      </div>
      {model && <div className={groupClass}>
        <label htmlFor={`${id}-model`} className={labelClass}>模型（可选）</label>
        <input id={`${id}-model`} aria-label="模型（可选）" type="text" value={model.value} disabled={disabled}
          onChange={(event) => model.onChange(event.target.value)} placeholder={DEFAULT_MODELSCOPE_MODEL}
          className={`${inputClass} font-mono`} />
      </div>}
    </div>
  );
}
