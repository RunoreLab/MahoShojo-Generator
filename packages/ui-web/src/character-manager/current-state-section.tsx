import { useId } from 'react';
import type { CharacterCurrentState, CurrentStateField } from '@mahoshojo/domain/arena-types';

export interface CharacterManagerCurrentStateSectionProps {
  /** `data.current_state`；缺省时按空快照渲染（与 Web 一致）。 */
  readonly state?: CharacterCurrentState | null;
  /** 写回整个 `current_state`；组件内部负责 `updated_at` 刷新与 `fields` 数组化。 */
  readonly onChange: (next: CharacterCurrentState) => void;
  /** 新增字段 id；默认 `crypto.randomUUID()`（带降级）。 */
  readonly createId?: () => string;
  /** 摘要框下方说明（Web：原生签名提示）。 */
  readonly summaryHint?: string;
}

const defaultCreateId = (): string => {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  return typeof cryptoObj?.randomUUID === 'function'
    ? cryptoObj.randomUUID()
    : `field-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

// 只检查控件读取所需的结构；空 label 是重命名中的合法编辑暂态。
const hasEditableStateShape = (value: unknown): boolean => {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const state = value as Record<string, unknown>;
  if (state.summary != null && typeof state.summary !== 'string') return false;
  if (state.fields == null) return true;
  return Array.isArray(state.fields) && state.fields.every((entry: unknown) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    const field = entry as Record<string, unknown>;
    return typeof field.id === 'string' && typeof field.label === 'string'
      && typeof field.type === 'string'
      && (field.value == null || ['string', 'number', 'boolean'].includes(typeof field.value));
  });
};

/**
 * 「当前状态」fieldset（自 Web `CharacterManagerPage` 抽取）：状态摘要 + 自定义字段
 * （label/type/value 三元组）。`updated_at` 在每次提交时刷新——这是数据契约的一部分，
 * 不是宿主差异。
 */
export function CharacterManagerCurrentStateSection({
  state,
  onChange,
  createId = defaultCreateId,
  summaryHint = '修改当前状态将使原生签名失效。请尽量统一使用状态摘要，避免随意增加自定义字段。',
}: CharacterManagerCurrentStateSectionProps) {
  const controlId = useId();

  // 仅保护安全读取，沿用原字段对象；不按最终 schema 拦截输入中间态。
  if (!hasEditableStateShape(state)) {
    return <fieldset className="border border-gray-300 p-4 rounded-lg mt-4">
      <legend className="text-sm font-semibold px-2 text-gray-600">当前状态</legend>
      <p role="alert" className="text-xs text-gray-600">当前状态格式暂不支持结构化编辑，原始数据仍保留；可导出 JSON 修正后重新导入。</p>
      <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(state, null, 2)}</pre>
    </fieldset>;
  }

  const snapshot: CharacterCurrentState = {
    ...state,
    summary: state?.summary ?? '',
    fields: Array.isArray(state?.fields) ? state.fields : [],
    updated_at: state?.updated_at ?? null,
  };

  const commit = (next: CharacterCurrentState) => {
    onChange({
      ...next,
      fields: Array.isArray(next.fields) ? next.fields : [],
      updated_at: new Date().toISOString(),
    });
  };

  const fields = snapshot.fields ?? [];

  const updateField = (fieldId: string, updater: (field: CurrentStateField) => CurrentStateField) => {
    commit({ ...snapshot, fields: fields.map((field) => (field.id === fieldId ? updater(field) : field)) });
  };

  return (
    <fieldset className="border border-gray-300 p-4 rounded-lg mt-4">
      <legend className="text-sm font-semibold px-2 text-gray-600">当前状态</legend>
      <div className="space-y-4">
        <div>
          <label htmlFor={`${controlId}-summary`} className="block text-xs font-semibold text-gray-600 mb-1">状态摘要</label>
          <textarea
            id={`${controlId}-summary`}
            value={snapshot.summary ?? ''}
            onChange={(event) => commit({ ...snapshot, summary: event.target.value })}
            className="input-field"
            rows={3}
            placeholder="记录角色身体状况、情绪、物品等即时状态..."
          />
          {summaryHint ? <p className="text-[11px] text-gray-500 mt-1">{summaryHint}</p> : null}
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-600">自定义字段</span>
            <button
              type="button"
              onClick={() =>
                commit({
                  ...snapshot,
                  fields: [...fields, { id: createId(), label: `字段 ${fields.length + 1}`, type: 'string', value: '' }],
                })
              }
              className="text-xs text-purple-700 font-semibold hover:underline"
            >
              + 新增字段
            </button>
          </div>
          {fields.length > 0 ? (
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="border border-gray-200 rounded-md p-3 space-y-2">
                  <div className="flex flex-col gap-2 md:flex-row">
                    <label className="sr-only" htmlFor={`${controlId}-field-${index}-label`}>字段名称</label>
                    <input
                      id={`${controlId}-field-${index}-label`}
                      type="text"
                      className="input-field flex-1"
                      value={field.label}
                      onChange={(event) => updateField(field.id, (current) => ({ ...current, label: event.target.value }))}
                      placeholder="字段名称"
                    />
                    <label className="sr-only" htmlFor={`${controlId}-field-${index}-type`}>字段类型</label>
                    <select
                      id={`${controlId}-field-${index}-type`}
                      className="input-field md:w-32"
                      value={field.type}
                      onChange={(event) => {
                        const type = event.target.value as CurrentStateField['type'];
                        updateField(field.id, (current) => {
                          let nextValue: string | number | boolean;
                          if (type === 'boolean') {
                            nextValue = Boolean(current.value);
                          } else if (type === 'number') {
                            const numeric = Number(current.value);
                            nextValue = Number.isFinite(numeric) ? numeric : 0;
                          } else {
                            nextValue = current.value?.toString() ?? '';
                          }
                          return { ...current, type, value: nextValue };
                        });
                      }}
                    >
                      <option value="string">字符串</option>
                      <option value="number">数值</option>
                      <option value="boolean">布尔</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="sr-only" htmlFor={`${controlId}-field-${index}-value`}>字段值</label>
                    {field.type === 'boolean' ? (
                      <select
                        id={`${controlId}-field-${index}-value`}
                        className="input-field"
                        value={String(field.value)}
                        onChange={(event) => updateField(field.id, (current) => ({ ...current, value: event.target.value === 'true' }))}
                      >
                        <option value="true">是</option>
                        <option value="false">否</option>
                      </select>
                    ) : (
                      <input
                        id={`${controlId}-field-${index}-value`}
                        type={field.type === 'number' ? 'number' : 'text'}
                        className="input-field"
                        value={field.value?.toString() ?? ''}
                        onChange={(event) => {
                          const rawValue = event.target.value;
                          updateField(field.id, (current) => {
                            if (current.type === 'number') {
                              const numeric = Number(rawValue);
                              return { ...current, value: Number.isFinite(numeric) ? numeric : 0 };
                            }
                            return { ...current, value: rawValue };
                          });
                        }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => commit({ ...snapshot, fields: fields.filter((item) => item.id !== field.id) })}
                      className="text-xs text-red-500 font-semibold hover:underline"
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">暂无自定义字段，点击“新增字段”以记录独特的资源或计数。</p>
          )}
        </div>
      </div>
    </fieldset>
  );
}
