import type { ReactNode } from 'react';
import { TARGET_TEMPLATE_OPTIONS, TARGET_TEMPLATE_LABELS, PRESERVABLE_FIELDS_CONFIG, type SupportedTargetTemplate } from './product';

const SUBLIMATION_USER_GUIDANCE_MAX_CHARS = 200;

export function SublimationTargetField({ targetTemplate, sourceTemplateLabel, hasCrossTemplateSelection, disabled, onChange }: { targetTemplate: SupportedTargetTemplate; sourceTemplateLabel: string; hasCrossTemplateSelection: boolean; disabled: boolean; onChange: (value: SupportedTargetTemplate) => void }) {
  const targetTemplateLabel = TARGET_TEMPLATE_LABELS[targetTemplate];
  return (
    <div className="input-group">
        <label htmlFor="sublimation-target" className="input-label">升华目标模板</label>
        <select id="sublimation-target"
            value={targetTemplate}
            onChange={(event) => onChange(event.target.value as SupportedTargetTemplate)}
            className="input-field"
            disabled={disabled}
        >
            {TARGET_TEMPLATE_OPTIONS.map(option => (
                <option key={option} value={option}>
                    {TARGET_TEMPLATE_LABELS[option]}
                </option>
            ))}
        </select>
        <p className="text-xs text-gray-500 mt-1">
            当前素材识别为：<span className="font-semibold">{sourceTemplateLabel}</span>；默认根据该模板选择目标，可手动尝试跨模板升华。
        </p>
        {hasCrossTemplateSelection && (
            <p className="text-xs text-purple-600 mt-1">
                检测到从 {sourceTemplateLabel} 升华为 {targetTemplateLabel}，系统已自动取消所有“保留字段”，AI 将完全重塑设定。
            </p>
        )}
        {targetTemplate === 'general' && (
            <p className="text-xs text-blue-600 mt-1">
                通用角色的 <code>content</code> 字段将承载全部设定，AI 会输出结构化 Markdown 方便继续创作。
            </p>
        )}
    </div>

  );
}

export function SublimationGuidanceField({ value, onChange, disabled, children }: { value: string; onChange: (value: string) => void; disabled: boolean; children?: ReactNode }) {
  return (
    <div className="input-group">
        <label htmlFor="sublimation-story-guidance" className="input-label">成长方向引导 (可选)</label>
        <div className="flex flex-wrap items-center gap-2">
            <input
                id="sublimation-story-guidance"
                name="sublimation_story_guidance"
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="input-field flex-1 min-w-[12rem]"
                placeholder={`输入关键词或一句话 (最多${SUBLIMATION_USER_GUIDANCE_MAX_CHARS}字)`}
                maxLength={SUBLIMATION_USER_GUIDANCE_MAX_CHARS}
                autoComplete="new-password"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                data-form-type="other"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                disabled={disabled}
            />
            {value.trim() ? (
                <button
                    type="button"
                    className="px-3 py-2 text-xs font-semibold rounded bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                    onClick={() => onChange('')}
                    disabled={disabled}
                >
                    清空
                </button>
            ) : null}
        </div>
        {children}
    </div>

  );
}

export function SublimationPreserveFields({ expanded, hasSource, disabled, onToggle, targetTemplate, fieldsToPreserve, allowReshapeNames, onAllowReshapeNamesChange, onFieldChange, onPreset }: { expanded: boolean; hasSource: boolean; disabled: boolean; onToggle: () => void; targetTemplate: SupportedTargetTemplate; fieldsToPreserve: readonly string[]; allowReshapeNames: boolean; onAllowReshapeNamesChange: (value: boolean) => void; onFieldChange: (field: string) => void; onPreset: (preset: 'default' | 'full' | 'personality') => void }) {
  const currentFieldsConfig = PRESERVABLE_FIELDS_CONFIG[targetTemplate];
  return (
    <div className="input-group mt-6">
        <button onClick={onToggle} disabled={disabled} className="text-sm font-semibold text-purple-700 hover:underline focus:outline-none">
            {expanded ? '▼ ' : '▶ '}高级选项：自定义升华范围
        </button>
        {expanded && hasSource && (
            <fieldset disabled={disabled} className="mt-3 p-4 bg-purple-50 border border-purple-200 rounded-lg">
                <p className="text-xs text-gray-600 mb-3">勾选你希望<span className="font-bold">保留不变</span>的字段，未勾选的字段将由AI重塑。</p>
                {targetTemplate === 'magical-girl' && (
                    <div className="mb-4 rounded-lg border border-purple-200 bg-white/70 p-3">
                        <label className="flex items-center text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={allowReshapeNames}
                                onChange={(event) => onAllowReshapeNamesChange(event.target.checked)}
                                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="ml-2 text-gray-700">重塑名称（魔装 / 奇境 / 繁开）</span>
                        </label>
                        <p className="text-[11px] text-gray-500 mt-1">
                            默认会保留上述 <code>name</code> 字段；开启后允许 AI 也对其进行“改名/追加称号”。
                        </p>
                    </div>
                )}
                {targetTemplate === 'general' && (
                    <p className="text-xs text-blue-700 mb-3">
                        提醒：<code>content</code> 字段包含角色的全部设定（外观、能力、背景、经历等）。如需完整改写，请取消勾选。
                    </p>
                )}
                <div className="mb-4 flex flex-wrap gap-2">
                    <button onClick={() => onPreset('default')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">默认</button>
                    <button onClick={() => onPreset('full')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">完全重塑</button>
                    <button onClick={() => onPreset('personality')} className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold py-1 px-3 rounded-full">仅心灵成长</button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {currentFieldsConfig.map(field => (
                        <label key={field.id} className="flex items-center text-sm cursor-pointer">
                            <input
                                type="checkbox"
                                checked={fieldsToPreserve.includes(field.id)}
                                onChange={() => onFieldChange(field.id)}
                                className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                            />
                            <span className="ml-2 text-gray-700">{field.label}</span>
                        </label>
                    ))}
                </div>
            </fieldset>
        )}
    </div>

  );
}

export function SublimationCurrentStateFieldset({ readCurrentState, writeCurrentState, disabled, streamMode = false, onReadChange, onWriteChange }: { readCurrentState: boolean; writeCurrentState: boolean; disabled: boolean; streamMode?: boolean; onReadChange: (value: boolean) => void; onWriteChange: (value: boolean) => void }) {
  return (
            <fieldset className="border border-gray-200 rounded-lg p-3">
                <legend className="text-xs font-semibold text-gray-600 px-1">当前状态</legend>
                <label className="flex items-center text-sm text-gray-700 mt-2">
                    <input
                        type="checkbox"
                        className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                        checked={readCurrentState}
                        onChange={(e) => onReadChange(e.target.checked)}
                        disabled={disabled}
                    />
                    升华时读取
                </label>
                <label className="flex items-center text-sm text-gray-700 mt-2">
                    <input
                        type="checkbox"
                        className="h-4 w-4 mr-2 text-purple-600 border-gray-300 rounded"
                        checked={writeCurrentState && !streamMode}
                        onChange={(e) => onWriteChange(e.target.checked)}
                        disabled={disabled || streamMode}
                    />
                    升华后写入
                </label>
                <p className="text-[11px] text-gray-500 mt-1">{streamMode ? '流式升华只保留原卡当前状态，不根据 Markdown 更新结构化状态；非流式写入偏好会保留。' : '当前状态用于追踪角色即时状况。开启写入后，AI 只会更新摘要，保留你自定义的字段。'}</p>
            </fieldset>
  );
}

export function SublimationNarrativeField({ value, onChange, disabled, children }: { value: string; onChange: (value: string) => void; disabled: boolean; children?: ReactNode }) {
  return <div className="input-group">
    <label htmlFor="narrative-history" className="input-label">叙事历史（可选）</label>
    <textarea id="narrative-history" value={value} onChange={(event) => onChange(event.target.value)} placeholder="输入或粘贴叙事历史（可多段文字），也可上传文件或从叙事历史中选择" className="input-field resize-y h-28" disabled={disabled} />
    {children}
  </div>;
}
