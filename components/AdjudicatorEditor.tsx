// components/AdjudicatorEditor.tsx

import React from 'react';
import { AdjudicatorEvent } from '@/types/arena';

/**
 * @fileoverview 这是一个全新的、可复用的组件，专门用于创建和编辑增强型随机判定器。
 * 它可以处理二元判定、自定义多结果判定以及复杂的事件链。
 */

interface AdjudicatorEditorProps {
    events: AdjudicatorEvent[];
    onEventsChange: (events: AdjudicatorEvent[]) => void;
    // 递归深度，用于UI缩进
    depth?: number;
}

const AdjudicatorEditor: React.FC<AdjudicatorEditorProps> = ({
    events,
    onEventsChange,
    depth = 0
}) => {
    // ---- 核心状态更新函数 ----

    /**
     * 通用事件更新处理器。
     * @param index - 要更新的事件在当前层级数组中的索引。
     * @param updatedEvent - 更新后的事件对象。
     */
    const handleEventChange = (index: number, updatedEvent: AdjudicatorEvent) => {
        const newEvents = [...events];
        newEvents[index] = updatedEvent;
        onEventsChange(newEvents);
    };

    /**
     * 添加一个新的根事件或子事件。
     */
    const addEvent = () => {
        const newEvent: AdjudicatorEvent = {
            id: `event-${Date.now()}-${Math.random()}`,
            description: '',
            type: 'binary',
            probability: 50,
            outcomes: []
        };
        onEventsChange([...events, newEvent]);
    };

    /**
     * 删除一个事件。
     * @param index - 要删除的事件的索引。
     */
    const deleteEvent = (index: number) => {
        onEventsChange(events.filter((_, i) => i !== index));
    };


    // ---- 渲染单个事件的函数 ----
    const renderEvent = (event: AdjudicatorEvent, index: number) => {
        
        /**
         * 处理自定义结果的概率变化，并自动重新分配以确保总和为100。
         */
        const handleOutcomeProbabilityChange = (outcomeIndex: number, newProb: number) => {
            const newOutcomes = [...(event.outcomes || [])];
            const changedOutcome = newOutcomes[outcomeIndex];
            if (!changedOutcome) return;

            const oldValue = changedOutcome.probability;
            const newValue = Math.max(0, Math.min(100, newProb));
            changedOutcome.probability = newValue;

            const otherOutcomes = newOutcomes.filter((_, i) => i !== outcomeIndex);
            const remainingProb = 100 - newValue;
            const oldRemainingProb = 100 - oldValue;

            // 如果其他结果的总概率不为零，则按比例分配剩余概率
            if (oldRemainingProb > 0) {
                otherOutcomes.forEach(o => {
                    o.probability = Math.round((o.probability / oldRemainingProb) * remainingProb);
                });
            } else if (otherOutcomes.length > 0) {
                // 如果其他结果总概率为零，则平均分配
                const avgProb = Math.floor(remainingProb / otherOutcomes.length);
                otherOutcomes.forEach(o => o.probability = avgProb);
            }

            // 确保总和精确为100
            const currentTotal = newOutcomes.reduce((sum, o) => sum + o.probability, 0);
            if (currentTotal !== 100 && newOutcomes.length > 0) {
                const diff = 100 - currentTotal;
                // 将差值加到第一个结果上（或最后一个）
                const adjustIndex = newOutcomes.length -1;
                newOutcomes[adjustIndex].probability += diff;
            }

            handleEventChange(index, { ...event, outcomes: newOutcomes });
        };

        const renderChainedEventEditor = (
            chainedEvent: { event: AdjudicatorEvent } | undefined,
            onChainedEventChange: (newEvent: { event: AdjudicatorEvent } | undefined) => void,
            label: string
        ) => (
            <div className="pl-4 mt-2 border-l-2 border-dashed border-gray-300">
                {chainedEvent ? (
                     <AdjudicatorEditor
                        events={[chainedEvent.event]}
                        onEventsChange={(newEvents) => onChainedEventChange(newEvents.length > 0 ? { event: newEvents[0] } : undefined)}
                        depth={depth + 1}
                    />
                ) : (
                    <button
                        onClick={() => onChainedEventChange({
                            event: {
                                id: `event-${Date.now()}-${Math.random()}`,
                                description: '',
                                type: 'binary',
                                probability: 50
                            }
                        })}
                        className="text-xs text-blue-600 hover:underline"
                    >
                        + 添加【{label}】后续事件
                    </button>
                )}
            </div>
        );

        return (
            <div key={event.id} className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
                {/* 事件描述和删除按钮 */}
                <div className="flex items-start gap-2">
                    <span className="text-sm font-semibold text-gray-500 pt-2">{depth > 0 ? ' L' : ''} {index + 1}.</span>
                    <textarea
                        value={event.description}
                        onChange={(e) => handleEventChange(index, { ...event, description: e.target.value })}
                        placeholder={`输入事件描述 (例如：${depth > 0 ? 'TA是否躲开了攻击？' : '天空突然降下惊雷'})`}
                        rows={2}
                        className="input-field flex-grow"
                    />
                    <button onClick={() => deleteEvent(index)} className="text-red-500 hover:text-red-700 font-bold p-1 text-xl leading-none rounded-full hover:bg-red-100 flex-shrink-0 mt-1">
                        &times;
                    </button>
                </div>

                {/* 判定类型切换 */}
                <div className="flex items-center gap-4 text-sm">
                    <label className="font-medium text-gray-700">判定类型:</label>
                    <div className="flex items-center gap-2">
                        <input type="radio" id={`type-binary-${event.id}`} name={`type-${event.id}`} value="binary" checked={event.type === 'binary'}
                            onChange={() => handleEventChange(index, { ...event, type: 'binary' })} />
                        <label htmlFor={`type-binary-${event.id}`}>成功/失败</label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="radio" id={`type-custom-${event.id}`} name={`type-${event.id}`} value="custom" checked={event.type === 'custom'}
                            onChange={() => handleEventChange(index, { ...event, type: 'custom', outcomes: event.outcomes?.length ? event.outcomes : [{ id: `outcome-${Date.now()}`, name: '结果1', probability: 100 }] })} />
                        <label htmlFor={`type-custom-${event.id}`}>自定义结果</label>
                    </div>
                </div>

                {/* 编辑器区域 */}
                {event.type === 'binary' ? (
                    // 二元判定编辑器
                    <div>
                        <div className="flex items-center gap-3">
                            <label className="text-sm font-medium text-gray-700">成功率:</label>
                            <input type="range" min="1" max="100" value={event.probability}
                                onChange={(e) => handleEventChange(index, { ...event, probability: parseInt(e.target.value, 10) })}
                                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer" />
                            <div className="relative w-24 flex-shrink-0">
                                <input type="number" min="1" max="100" value={event.probability}
                                    onChange={(e) => handleEventChange(index, { ...event, probability: parseInt(e.target.value, 10) || 50 })}
                                    className="input-field w-full text-center pr-6" />
                                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">%</span>
                            </div>
                        </div>
                        {/* 连锁事件编辑器 */}
                        {renderChainedEventEditor(event.onSuccess, (ce) => handleEventChange(index, {...event, onSuccess: ce}), '成功')}
                        {renderChainedEventEditor(event.onFailure, (ce) => handleEventChange(index, {...event, onFailure: ce}), '失败')}
                    </div>
                ) : (
                    // 自定义结果编辑器
                    <div className="space-y-2">
                        {(event.outcomes || []).map((outcome, oIndex) => (
                            <div key={outcome.id} className="p-3 bg-white rounded border">
                                <div className="flex items-center gap-2">
                                    <input type="text" value={outcome.name}
                                        onChange={(e) => {
                                            const newOutcomes = [...(event.outcomes || [])];
                                            newOutcomes[oIndex].name = e.target.value;
                                            handleEventChange(index, { ...event, outcomes: newOutcomes });
                                        }}
                                        placeholder="结果名称" className="input-field flex-grow" />
                                    <div className="relative w-28 flex-shrink-0">
                                        <input type="number" value={outcome.probability}
                                            onChange={(e) => handleOutcomeProbabilityChange(oIndex, parseInt(e.target.value, 10) || 0)}
                                            className="input-field w-full text-center pr-6" />
                                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 text-sm pointer-events-none">%</span>
                                    </div>
                                    <button onClick={() => {
                                        const newOutcomes = (event.outcomes || []).filter((_, i) => i !== oIndex);
                                        handleEventChange(index, { ...event, outcomes: newOutcomes });
                                    }} className="text-gray-400 hover:text-red-500">&times;</button>
                                </div>
                                 {/* 连锁事件编辑器 */}
                                {renderChainedEventEditor(outcome.chainedEvent, (ce) => {
                                    const newOutcomes = [...(event.outcomes || [])];
                                    newOutcomes[oIndex].chainedEvent = ce;
                                    handleEventChange(index, {...event, outcomes: newOutcomes});
                                }, outcome.name)}
                            </div>
                        ))}
                        <button onClick={() => {
                            const newOutcomes = [...(event.outcomes || []), { id: `outcome-${Date.now()}`, name: `结果${(event.outcomes?.length || 0) + 1}`, probability: 0 }];
                            // 重新分配概率
                            const avgProb = Math.floor(100 / newOutcomes.length);
                            newOutcomes.forEach(o => o.probability = avgProb);
                            const remainder = 100 - (avgProb * newOutcomes.length);
                            if (newOutcomes.length > 0) newOutcomes[0].probability += remainder;
                            handleEventChange(index, { ...event, outcomes: newOutcomes });
                        }} className="text-xs text-blue-600 hover:underline">
                            + 添加新结果
                        </button>
                    </div>
                )}
            </div>
        );
    };

    // ---- 组件主渲染 ----
    return (
        <div className="space-y-4" style={{ marginLeft: depth > 0 ? `${depth * 10}px` : '0' }}>
            {events.map((event, index) => renderEvent(event, index))}
            {/* 只有根编辑器 (depth=0) 才能添加新的根事件 */}
            {depth === 0 && (
                <button
                    onClick={addEvent}
                    className="w-full py-2 px-4 border border-dashed border-gray-300 rounded text-gray-600 hover:bg-gray-50 text-sm"
                >
                    + 添加根判定事件
                </button>
            )}
        </div>
    );
};

export default AdjudicatorEditor;