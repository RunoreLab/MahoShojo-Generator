import React, { useMemo, useState } from 'react';
import type {
    ThinkingEffort,
    UserGenerationOverrides,
    UserThinkingOverride,
} from '@/lib/ai/generation-settings/types';
import { THINKING_EFFORT_LABELS } from '@/lib/ai/generation-settings/provider-adapters';
import { MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS } from '@/lib/ai/custom-provider';

type ThinkingSupport = 'supported' | 'unsupported' | 'unknown';

interface AdvancedGenerationSettingsProps {
    value?: UserGenerationOverrides;
    onChange: (value: UserGenerationOverrides | undefined) => void;
    /** 当前模型 temperature 支持状态。 */
    temperatureSupported?: boolean;
    /** 当前模型 temperature 上限（由 capability 决定，未提供则不限制）。 */
    temperatureMax?: number;
    /** 当前模型 maxOutputTokens 上限（由 capability 决定，未提供则用全局上限）。 */
    maxOutputTokensMax?: number;
    /** 当前模型 thinking 支持状态。 */
    thinkingSupport?: ThinkingSupport;
    /** 当前模型可用的 thinking 档位（未提供则展示全部档位）。 */
    thinkingEfforts?: ThinkingEffort[];
    /** 当前模型是否支持显式关闭 thinking。 */
    canDisableThinking?: boolean;
}

const AdvancedGenerationSettings: React.FC<AdvancedGenerationSettingsProps> = ({
    value,
    onChange,
    temperatureSupported = true,
    temperatureMax,
    maxOutputTokensMax,
    thinkingSupport = 'supported',
    thinkingEfforts,
    canDisableThinking = true,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [numericInputRevision, setNumericInputRevision] = useState(0);

    // <input type="number"> 对极端指数等 bad input 可能保留浏览器内部草稿；
    // 此时业务状态已经回到 undefined，再次 setState(undefined) 不一定触发重渲染，
    // 导致“恢复默认设置”看起来没有反应。递增 revision 可强制重建输入区域并清掉该草稿。
    const resetNumericInputDrafts = () => {
        setNumericInputRevision(revision => revision + 1);
    };

    const efforts = thinkingEfforts ?? [];
    const hasThinkingEffortControl = efforts.length > 0;
    const defaultThinkingEffort: ThinkingEffort = efforts.includes('medium')
        ? 'medium'
        : (efforts[0] ?? 'medium');

    const maxOutputTokens = value?.maxOutputTokens;
    const temperature = value?.temperature;
    const effectiveMaxOutputTokensMax = Math.min(
        maxOutputTokensMax ?? MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS,
        MAX_CUSTOM_PROVIDER_OUTPUT_TOKENS,
    );
    const thinking = value?.thinking;
    const rawThinkingMode = thinking?.mode ?? 'default';
    // 兼容旧 localStorage：若旧版本保存了 disabled，但能力表确认不可关闭，UI 回退为“默认”。
    const thinkingMode = rawThinkingMode === 'disabled' && !canDisableThinking
        ? 'default'
        : rawThinkingMode;
    const storedEffort = thinking?.mode === 'enabled' ? thinking.effort : undefined;
    const thinkingEffort = storedEffort && efforts.includes(storedEffort)
        ? storedEffort
        : defaultThinkingEffort;

    const modifiedCount = useMemo(() => {
        let count = 0;
        if (typeof maxOutputTokens === 'number') count++;
        if (typeof temperature === 'number') count++;
        if (
            thinking &&
            thinking.mode !== 'default' &&
            !(thinking.mode === 'disabled' && !canDisableThinking)
        ) count++;
        return count;
    }, [maxOutputTokens, temperature, thinking, canDisableThinking]);

    /** 直接构造最终对象并向外发送（不再合并旧 value，避免“删除字段又被合回”）。 */
    const emit = (next: UserGenerationOverrides) => {
        if (typeof next.maxOutputTokens !== 'number' && typeof next.temperature !== 'number' && !next.thinking) {
            onChange(undefined);
            return;
        }
        onChange(next);
    };

    const updateMaxOutputTokens = (next: number | undefined) => {
        emit({ ...(value ?? {}), maxOutputTokens: next });
    };

    const updateTemperature = (next: number | undefined) => {
        emit({ ...(value ?? {}), temperature: next });
    };

    const updateThinking = (next: UserThinkingOverride) => {
        const rest = { ...(value ?? {}) };
        if (next.mode === 'default') {
            delete rest.thinking;
        } else {
            rest.thinking = next;
        }
        emit(rest);
    };

    const handleReset = () => {
        resetNumericInputDrafts();
        onChange(undefined);
    };

    const thinkingUncontrollable = thinkingSupport === 'unsupported' || thinkingSupport === 'unknown';

    return (
        <div className="mt-3">
            <button
                type="button"
                onClick={() => setIsOpen(prev => !prev)}
                className="battle-lite-muted-text flex items-center gap-1 text-sm font-semibold hover:underline"
            >
                <span>{isOpen ? '▼' : '▶'}</span>
                <span>
                    高级生成设置
                    {modifiedCount > 0 ? ` (${modifiedCount}项已修改)` : ''}
                </span>
            </button>

            {isOpen && (
                <div
                    key={numericInputRevision}
                    className="mt-2 space-y-3 text-sm"
                >
                    {/* 最大输出 Tokens */}
                    <div>
                        <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
                            最大输出 Tokens
                        </label>
                        <input
                            className="input-field font-mono"
                            type="number"
                            min={1}
                            max={effectiveMaxOutputTokensMax}
                            step={1}
                            placeholder="自动"
                            value={typeof maxOutputTokens === 'number' ? String(maxOutputTokens) : ''}
                            inputMode="numeric"
                            onChange={(event) => {
                                const raw = event.target.value.trim();
                                if (!raw) {
                                    updateMaxOutputTokens(undefined);
                                    return;
                                }
                                const parsed = Number(raw);
                                if (!Number.isFinite(parsed) || parsed < 1) {
                                    resetNumericInputDrafts();
                                    updateMaxOutputTokens(undefined);
                                    return;
                                }
                                const bounded = Math.min(Math.floor(parsed), effectiveMaxOutputTokensMax);
                                updateMaxOutputTokens(bounded);
                            }}
                        />
                        <p className="battle-lite-subtle-text mt-1 text-xs">
                            留空则使用模型 / 供应商默认。
                            {typeof maxOutputTokensMax === 'number' && `当前模型上限 ${maxOutputTokensMax}。`}
                        </p>
                    </div>

                    {/* Temperature */}
                    <div>
                        <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
                            Temperature
                        </label>
                        <input
                            className="input-field font-mono"
                            type="number"
                            min={0}
                            max={temperatureMax}
                            step={0.1}
                            placeholder="自动"
                            value={typeof temperature === 'number' ? String(temperature) : ''}
                            inputMode="decimal"
                            onChange={(event) => {
                                const raw = event.target.value.trim();
                                if (!raw) {
                                    updateTemperature(undefined);
                                    return;
                                }
                                const parsed = Number(raw);
                                if (!Number.isFinite(parsed)) {
                                    resetNumericInputDrafts();
                                    updateTemperature(undefined);
                                    return;
                                }
                                let bounded = Math.max(0, parsed);
                                if (typeof temperatureMax === 'number') {
                                    bounded = Math.min(bounded, temperatureMax);
                                }
                                updateTemperature(bounded);
                            }}
                        />
                        <p className="battle-lite-subtle-text mt-1 text-xs">
                            留空则使用模型 / 供应商默认。
                            {!temperatureSupported && ' 当前模型可能不支持 temperature，超出的设置会被忽略。'}
                        </p>
                    </div>

                    {/* Thinking / 推理 */}
                    <div>
                        <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">
                            Thinking / 推理
                        </label>
                        {thinkingUncontrollable ? (
                            <p className="battle-lite-subtle-text text-xs">
                                {thinkingSupport === 'unsupported'
                                    ? '当前模型不支持自定义推理设置。'
                                    : '未知模型，无法确定推理参数格式，将跟随模型默认。'}
                            </p>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-3">
                                    {([
                                        { key: 'default', label: '跟随模型默认' },
                                        ...(canDisableThinking ? [{ key: 'disabled', label: '关闭' } as const] : []),
                                        { key: 'enabled', label: '开启' },
                                    ] as const).map(option => (
                                        <label key={option.key} className="flex items-center gap-1 text-sm cursor-pointer">
                                            <input
                                                type="radio"
                                                name="thinking-mode"
                                                checked={thinkingMode === option.key}
                                                onChange={() =>
                                                    updateThinking(
                                                        option.key === 'enabled'
                                                            ? (hasThinkingEffortControl
                                                                ? { mode: 'enabled', effort: thinkingEffort }
                                                                : { mode: 'enabled' })
                                                            : { mode: option.key },
                                                    )
                                                }
                                                className="h-4 w-4"
                                            />
                                            <span>{option.label}</span>
                                        </label>
                                    ))}
                                </div>
                                {!canDisableThinking && (
                                    <p className="battle-lite-subtle-text mt-1 text-xs">
                                        当前模型支持调整推理，但不支持完全关闭。
                                    </p>
                                )}
                                {thinkingMode === 'enabled' && hasThinkingEffortControl && (
                                    <div className="mt-2">
                                        <label className="battle-lite-muted-text mb-1 block text-xs font-semibold">强度</label>
                                        <select
                                            className="input-field"
                                            value={thinkingEffort}
                                            onChange={(event) =>
                                                updateThinking({ mode: 'enabled', effort: event.target.value as ThinkingEffort })
                                            }
                                        >
                                            {efforts.map(effort => (
                                                <option key={effort} value={effort}>
                                                    {THINKING_EFFORT_LABELS[effort]}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                )}
                                {thinkingMode === 'enabled' && !hasThinkingEffortControl && (
                                    <p className="battle-lite-subtle-text mt-1 text-xs">
                                        当前接入仅支持开启 / 关闭或跟随默认，不提供可靠的强度档位。
                                    </p>
                                )}
                            </>
                        )}
                    </div>

                    <hr className="border-t border-current/10" />

                    <button
                        type="button"
                        onClick={handleReset}
                        className="battle-lite-subtle-text w-full rounded-lg border border-current/20 px-3 py-2 text-xs font-semibold hover:bg-current/5"
                    >
                        恢复默认设置
                    </button>
                </div>
            )}
        </div>
    );
};

export default AdvancedGenerationSettings;