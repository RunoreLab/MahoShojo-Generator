import type { ReactNode } from 'react';

import { DATA_CARD_TEMPLATE_LABELS, type DataCardTemplate, type InferableDataCardTemplate } from '@mahoshojo/domain/data-cards';

export const CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE = '__unknown__';
export const CHARACTER_MANAGER_TEMPLATE_ORDER: readonly DataCardTemplate[] = [
  'magical-girl',
  'canshou',
  'general',
  'scenario',
  'general-scenario',
];

export interface CharacterManagerTemplateSelectProps {
  /** 当前推断出的模板；`'unknown'` 时显示占位项。 */
  readonly value: InferableDataCardTemplate;
  /** 是否已有载入内容：决定占位文案与提示语义。 */
  readonly hasContent: boolean;
  /** 宿主执行创建空白/模板转换；本组件不自己改写数据。 */
  readonly onSelect: (template: DataCardTemplate) => void;
  readonly options?: readonly DataCardTemplate[];
  readonly id?: string;
  /** 选择器下方的说明文案（Web 默认解释原生性语义；Desktop 按本机保存语义覆盖）。 */
  readonly hintText?: ReactNode;
}

/**
 * 「内容模板」选择器。选择行为本身（空白创建、模板转换、schema 校验）是宿主业务——
 * 共享组件只渲染选项集合与提示文案。
 */
export function CharacterManagerTemplateSelect({
  value,
  hasContent,
  onSelect,
  options = CHARACTER_MANAGER_TEMPLATE_ORDER,
  id,
  hintText,
}: CharacterManagerTemplateSelectProps) {
  return (
    <div className="mb-6">
      <label className="block text-sm font-semibold text-gray-700 mb-1" htmlFor={id}>内容模板</label>
      <select
        id={id}
        value={value === 'unknown' ? CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE : value}
        onChange={(event) => {
          const next = event.target.value;
          if (next === CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE) return;
          onSelect(next as DataCardTemplate);
        }}
        className="input-field"
      >
        <option value={CHARACTER_MANAGER_TEMPLATE_PLACEHOLDER_VALUE} disabled>
          {hasContent ? '未知类型（请选择转换目标）' : '选择模板以创建空白内容'}
        </option>
        {options.map((template) => (
          <option key={template} value={template}>
            {DATA_CARD_TEMPLATE_LABELS[template]}
          </option>
        ))}
      </select>
      <p className="text-xs text-gray-500 mt-1">
        {hintText ?? (hasContent
          ? '切换模板会尝试根据规则转换当前内容，原生性状态不会因此改变。'
          : '未加载内容时，选择模板将创建对应的空白数据卡，初始即为非原生。')}
      </p>
    </div>
  );
}
