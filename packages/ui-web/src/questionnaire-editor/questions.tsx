'use client';
import React, { useState } from 'react';
import { createEmptyQuestion, createOptionUid, createSuggestionUid, CONDITION_OPERATORS, operatorNeedsValue, type EditableQuestion, type EditableOptionItem } from '@mahoshojo/domain/questionnaire-editor';

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseFormNumber = (value: FormDataEntryValue | null): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const getQuestionLabel = (question: EditableQuestion, index: number) => {
  const idLabel = question.id.trim() || `Q${index + 1}`;
  const textLabel = question.question.trim() || `问题 ${index + 1}`;
  return `${idLabel} · ${textLabel}`;
};

export function QuestionnaireQuestionsEditor({ questions, setQuestions, kind }: {
  questions: EditableQuestion[];
  setQuestions: React.Dispatch<React.SetStateAction<EditableQuestion[]>>;
  kind: 'magical-girl' | 'canshou';
}) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const updateQuestion = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== index) return q;
      let extraJson = q.extraJson;
      // Explicitly taking over in simple controls removes the dormant advanced rule.
      const takeover = [patch.displayIfEnabled ? 'displayIf' : '', patch.jumpEnabled ? 'jump' : '', patch.optionsFromId?.trim() ? 'optionsFrom' : '', patch.suggestionsFromId?.trim() ? 'suggestionsFrom' : ''].filter(Boolean);
      if (takeover.length) {
        try {
          const extra = JSON.parse(extraJson || '{}');
          if (extra && typeof extra === 'object' && !Array.isArray(extra)) {
            for (const key of takeover) delete extra[key];
            extraJson = Object.keys(extra).length ? JSON.stringify(extra, null, 2) : '';
          }
        } catch { /* Keep invalid advanced input visible for correction. */ }
      }
      return { ...q, extraJson, ...patch };
    }));
  };

  const addSuggestionItem = (questionIndex: number) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return { ...q, suggestions: [...q.suggestions, { uid: createSuggestionUid(), text: '' }] };
    }));
  };

  const updateSuggestionItem = (questionIndex: number, itemUid: string, text: string) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return {
        ...q,
        suggestions: q.suggestions.map((item) => (item.uid === itemUid ? { ...item, text } : item)),
      };
    }));
  };

  const removeSuggestionItem = (questionIndex: number, itemUid: string) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return { ...q, suggestions: q.suggestions.filter((item) => item.uid !== itemUid) };
    }));
  };

  const moveSuggestionItem = (questionIndex: number, fromIndex: number, direction: -1 | 1) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      const nextIndex = clampNumber(fromIndex + direction, 0, Math.max(q.suggestions.length - 1, 0));
      if (nextIndex === fromIndex) return q;
      const next = [...q.suggestions];
      const [target] = next.splice(fromIndex, 1);
      next.splice(nextIndex, 0, target);
      return { ...q, suggestions: next };
    }));
  };

  const addOptionItem = (questionIndex: number) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return {
        ...q,
        options: [...q.options, { uid: createOptionUid(), label: '', value: '', disabled: false }],
      };
    }));
  };

  const updateOptionItem = (questionIndex: number, itemUid: string, patch: Partial<EditableOptionItem>) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return {
        ...q,
        options: q.options.map((item) => {
          if (item.uid !== itemUid) return item;
          if (typeof patch.label === 'string') {
            const shouldSyncValue = item.value === item.label;
            const nextLabel = patch.label;
            const nextValue = typeof patch.value === 'string'
              ? patch.value
              : (shouldSyncValue ? nextLabel : item.value);
            return { ...item, ...patch, value: nextValue };
          }
          return { ...item, ...patch };
        }),
      };
    }));
  };

  const removeOptionItem = (questionIndex: number, itemUid: string) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      return { ...q, options: q.options.filter((item) => item.uid !== itemUid) };
    }));
  };

  const moveOptionItem = (questionIndex: number, fromIndex: number, direction: -1 | 1) => {
    setQuestions((prev) => prev.map((q, i) => {
      if (i !== questionIndex) return q;
      const nextIndex = clampNumber(fromIndex + direction, 0, Math.max(q.options.length - 1, 0));
      if (nextIndex === fromIndex) return q;
      const next = [...q.options];
      const [target] = next.splice(fromIndex, 1);
      next.splice(nextIndex, 0, target);
      return { ...q, options: next };
    }));
  };

  const addQuestion = () => {
    setQuestions((prev) => [...prev, createEmptyQuestion(prev.length, kind)]);
  };

  const insertQuestionAt = (position: number) => {
    setQuestions((prev) => {
      const next = [...prev];
      const targetIndex = clampNumber(position - 1, 0, next.length);
      next.splice(targetIndex, 0, createEmptyQuestion(next.length, kind));
      return next;
    });
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveQuestionTo = (fromIndex: number, toIndex: number) => {
    setQuestions((prev) => {
      if (fromIndex < 0 || fromIndex >= prev.length) return prev;
      const targetIndex = clampNumber(toIndex, 0, prev.length - 1);
      if (targetIndex === fromIndex) return prev;
      const next = [...prev];
      const [target] = next.splice(fromIndex, 1);
      next.splice(targetIndex, 0, target);
      return next;
    });
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    moveQuestionTo(index, index + direction);
  };

  const applyAutoIds = () => {
    setQuestions((prev) => prev.map((q, index) => ({
      ...q,
      id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
    })));
  };

  const handleInsertSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rawPosition = parseFormNumber(data.get('insertPosition'));
    if (rawPosition === null) return;
    const max = questions.length + 1;
    const position = clampNumber(rawPosition, 1, max);
    insertQuestionAt(position);
    event.currentTarget.reset();
  };

  const handleMoveToSubmit = (index: number) => (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const rawPosition = parseFormNumber(data.get('moveTo'));
    if (rawPosition === null) return;
    const max = Math.max(questions.length, 1);
    const targetPosition = clampNumber(rawPosition, 1, max);
    moveQuestionTo(index, targetPosition - 1);
    event.currentTarget.reset();
  };

  const handleToggleCollapse = (uid: string) => {
    setCollapsedMap((prev) => ({ ...prev, [uid]: !prev[uid] }));
  };

  const handleCollapseAll = (nextCollapsed: boolean) => {
    setCollapsedMap((prev) => {
      const next = { ...prev };
      questions.forEach((question) => {
        next[question.uid] = nextCollapsed;
      });
      return next;
    });
  };

  const handleJumpToQuestion = (uid: string) => () => {
    setCollapsedMap((prev) => ({ ...prev, [uid]: false }));
    if (typeof document === 'undefined') return;
    const target = document.getElementById(`question-${uid}`);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const handleDragStart = (index: number) => (event: React.DragEvent<HTMLButtonElement>) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
    setDragIndex(index);
  };

  const handleDragOver = (index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (dragOverIndex !== index) setDragOverIndex(index);
  };

  const handleDrop = (index: number) => (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const rawIndex = event.dataTransfer.getData('text/plain');
    const parsedIndex = Number.parseInt(rawIndex, 10);
    const sourceIndex = Number.isFinite(parsedIndex) ? parsedIndex : dragIndex;
    if (sourceIndex === null || Number.isNaN(sourceIndex)) return;
    moveQuestionTo(sourceIndex, index);
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  return <>
            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">题目列表</h2>
                  <p className="mt-1 text-xs text-slate-500">拖拽左侧把手可快速排序，也可在右侧输入题号移动。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-slate-500">共 {questions.length} 题</span>
                  <button
                    type="button"
                    onClick={() => handleCollapseAll(true)}
                    className="rounded-full border border-slate-200 px-3 py-1 text-slate-500 hover:text-slate-700"
                  >
                    全部收起
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCollapseAll(false)}
                    className="rounded-full border border-slate-200 px-3 py-1 text-slate-500 hover:text-slate-700"
                  >
                    全部展开
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-slate-600">目录跳转</h3>
                  <span className="text-xs text-slate-400">点击题号快速定位</span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  {questions.map((question, index) => (
                    <button
                      key={`toc-${question.uid}`}
                      type="button"
                      onClick={handleJumpToQuestion(question.uid)}
                      className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-700"
                      title={getQuestionLabel(question, index)}
                    >
                      {index + 1}.{question.id.trim() || `Q${index + 1}`}
                    </button>
                  ))}
                </div>
              </div>
              <datalist id="question-id-options">
                {questions.map((item) => {
                  const label = item.question ? `${item.id} · ${item.question}` : item.id;
                  return (
                    <option key={`question-id-${item.uid}`} value={item.id} label={label} />
                  );
                })}
              </datalist>
              {questions.map((question, index) => (
                <div
                  key={question.uid}
                  id={`question-${question.uid}`}
                  className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition ${
                    dragOverIndex === index ? 'ring-2 ring-indigo-200' : ''
                  } ${dragIndex === index ? 'opacity-80' : ''}`}
                  onDragOver={handleDragOver(index)}
                  onDrop={handleDrop(index)}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        draggable
                        onDragStart={handleDragStart(index)}
                        onDragEnd={handleDragEnd}
                        className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:text-slate-700 cursor-grab active:cursor-grabbing"
                        aria-label="拖拽调整顺序"
                        title="拖拽调整顺序"
                      >
                        ≡
                      </button>
                      <div className="font-semibold text-slate-800">题目 {index + 1}</div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleToggleCollapse(question.uid)}
                        className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:text-slate-700"
                        aria-expanded={!(collapsedMap[question.uid] ?? false)}
                      >
                        {collapsedMap[question.uid] ? '展开' : '收起'}
                      </button>
                      <form onSubmit={handleMoveToSubmit(index)} className="flex items-center gap-1">
                        <span className="text-slate-500">移动到</span>
                        <input
                          name="moveTo"
                          type="number"
                          min={1}
                          max={questions.length}
                          className="input-field h-8 w-16 px-2 text-xs"
                          placeholder={`${index + 1}`}
                        />
                        <span className="text-slate-500">题</span>
                        <button type="submit" className="rounded-md border border-slate-200 px-2 py-1 text-slate-500 hover:text-slate-700">移动</button>
                      </form>
                      <button onClick={() => moveQuestion(index, -1)} className="text-slate-500 hover:text-slate-700">上移</button>
                      <button onClick={() => moveQuestion(index, 1)} className="text-slate-500 hover:text-slate-700">下移</button>
                      <button onClick={() => removeQuestion(index)} className="text-rose-500 hover:text-rose-600">删除</button>
                    </div>
                  </div>
                  {collapsedMap[question.uid] ? (
                    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
                      <div className="font-semibold text-slate-700">{getQuestionLabel(question, index)}</div>
                      <div className="mt-1 flex flex-wrap gap-2 text-slate-500">
                        <span>类型：{question.type === 'select' ? '选项优先' : '文本输入'}</span>
                        <span>必答：{question.required === true ? '是' : '否'}</span>
                        <span>最大字数：{question.maxLengthText.trim() || '未设置'}</span>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      <div>
                        <label className="text-xs text-slate-500">题目 ID</label>
                        <input
                          value={question.id}
                          onChange={(e) => updateQuestion(index, { id: e.target.value })}
                          className="input-field mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">题目内容</label>
                        <input
                          value={question.question}
                          onChange={(e) => updateQuestion(index, { question: e.target.value })}
                          className="input-field mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">题目类型</label>
                        <select
                          value={question.type || 'text'}
                          onChange={(e) => updateQuestion(index, { type: e.target.value as 'text' | 'select' })}
                          className="input-field mt-1"
                        >
                          <option value="text">文本输入</option>
                          <option value="select">选项优先</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">最大字数（建议上限，留空=不设题目上限）</label>
                        <input
                          value={question.maxLengthText}
                          onChange={(e) => updateQuestion(index, { maxLengthText: e.target.value })}
                          className="input-field mt-1"
                          placeholder="例如 200"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs text-slate-500">输入框提示（placeholder）</label>
                        <input
                          value={question.placeholder || ''}
                          onChange={(e) => updateQuestion(index, { placeholder: e.target.value })}
                          className="input-field mt-1"
                        />
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs text-slate-500">补充说明（helperText）</label>
                        <input
                          value={question.helperText || ''}
                          onChange={(e) => updateQuestion(index, { helperText: e.target.value })}
                          className="input-field mt-1"
                        />
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs text-slate-500">灵感提示</label>
                          <button
                            type="button"
                            onClick={() => addSuggestionItem(index)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:text-slate-700"
                          >
                            + 新增
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">会显示为“灵感按钮”，点击即可快速填入答案。</p>
                        {question.suggestions.length === 0 ? (
                          <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                            暂无灵感提示，点击“新增”添加。
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {question.suggestions.map((item, suggestionIndex) => (
                              <div key={item.uid} className="flex items-center gap-2">
                                <input
                                  value={item.text}
                                  onChange={(e) => updateSuggestionItem(index, item.uid, e.target.value)}
                                  className="input-field h-9 flex-1 text-xs"
                                  placeholder="例如：温柔的誓言"
                                />
                                <button
                                  type="button"
                                  onClick={() => moveSuggestionItem(index, suggestionIndex, -1)}
                                  disabled={suggestionIndex === 0}
                                  className="h-9 w-9 rounded-md border border-slate-200 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                                  aria-label="上移灵感提示"
                                  title="上移"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveSuggestionItem(index, suggestionIndex, 1)}
                                  disabled={suggestionIndex === question.suggestions.length - 1}
                                  className="h-9 w-9 rounded-md border border-slate-200 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                                  aria-label="下移灵感提示"
                                  title="下移"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeSuggestionItem(index, item.uid)}
                                  className="h-9 rounded-md border border-rose-200 px-3 text-xs text-rose-500 hover:text-rose-600"
                                >
                                  删除
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <label className="text-xs text-slate-500">推荐选项</label>
                          <button
                            type="button"
                            onClick={() => addOptionItem(index)}
                            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:text-slate-700"
                          >
                            + 新增
                          </button>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          标签：展示给用户；内容：写入答案（留空将自动等于标签）；禁用：显示但不可选。
                        </p>
                        {question.options.length === 0 ? (
                          <div className="mt-2 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-400">
                            暂无推荐选项，点击“新增”添加。
                          </div>
                        ) : (
                          <div className="mt-2 space-y-2">
                            {question.options.map((item, optionIndex) => (
                              <div key={item.uid} className="flex flex-wrap items-center gap-2">
                                <input
                                  value={item.label}
                                  onChange={(e) => updateOptionItem(index, item.uid, { label: e.target.value })}
                                  className="input-field h-9 flex-1 text-xs min-w-[140px]"
                                  placeholder="标签（展示给用户）"
                                />
                                <input
                                  value={item.value}
                                  onChange={(e) => updateOptionItem(index, item.uid, { value: e.target.value })}
                                  className="input-field h-9 flex-1 text-xs min-w-[140px]"
                                  placeholder="内容（写入答案）"
                                />
                                <label className="flex items-center gap-2 text-xs text-slate-600">
                                  <input
                                    type="checkbox"
                                    checked={item.disabled}
                                    onChange={(e) => updateOptionItem(index, item.uid, { disabled: e.target.checked })}
                                  />
                                  禁用
                                </label>
                                <button
                                  type="button"
                                  onClick={() => moveOptionItem(index, optionIndex, -1)}
                                  disabled={optionIndex === 0}
                                  className="h-9 w-9 rounded-md border border-slate-200 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                                  aria-label="上移推荐选项"
                                  title="上移"
                                >
                                  ↑
                                </button>
                                <button
                                  type="button"
                                  onClick={() => moveOptionItem(index, optionIndex, 1)}
                                  disabled={optionIndex === question.options.length - 1}
                                  className="h-9 w-9 rounded-md border border-slate-200 text-xs text-slate-500 hover:text-slate-700 disabled:opacity-40"
                                  aria-label="下移推荐选项"
                                  title="下移"
                                >
                                  ↓
                                </button>
                                <button
                                  type="button"
                                  onClick={() => removeOptionItem(index, item.uid)}
                                  className="h-9 rounded-md border border-rose-200 px-3 text-xs text-rose-500 hover:text-rose-600"
                                >
                                  删除
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">引用其他题目的选项（可选）</label>
                        <input
                          list="question-id-options"
                          value={question.optionsFromId}
                          onChange={(e) => updateQuestion(index, { optionsFromId: e.target.value })}
                          className="input-field mt-1"
                          placeholder="选择题目 ID（留空表示使用本题选项）"
                        />
                        <p className="mt-1 text-xs text-slate-400">仅当本题“推荐选项”为空时才会使用引用。</p>
                        {question.optionsFromId.trim() && question.options.some((item) => item.label.trim() || item.value.trim()) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-amber-600">本题已有推荐选项，将覆盖引用。</span>
                            <button
                              type="button"
                              onClick={() => updateQuestion(index, { options: [] })}
                              className="rounded-md border border-amber-200 px-2 py-1 text-amber-700 hover:border-amber-300"
                            >
                              清空本题选项
                            </button>
                          </div>
                        )}
                      </div>
                      <div>
                        <label className="text-xs text-slate-500">引用其他题目的灵感（可选）</label>
                        <input
                          list="question-id-options"
                          value={question.suggestionsFromId}
                          onChange={(e) => updateQuestion(index, { suggestionsFromId: e.target.value })}
                          className="input-field mt-1"
                          placeholder="选择题目 ID（留空表示使用本题灵感）"
                        />
                        <p className="mt-1 text-xs text-slate-400">仅当本题“灵感提示”为空时才会使用引用。</p>
                        {question.suggestionsFromId.trim() && question.suggestions.some((item) => item.text.trim()) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                            <span className="text-amber-600">本题已有灵感提示，将覆盖引用。</span>
                            <button
                              type="button"
                              onClick={() => updateQuestion(index, { suggestions: [] })}
                              className="rounded-md border border-amber-200 px-2 py-1 text-amber-700 hover:border-amber-300"
                            >
                              清空本题灵感
                            </button>
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={question.allowCustom ?? true}
                            onChange={(e) => updateQuestion(index, { allowCustom: e.target.checked })}
                          />
                          允许自定义回答
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={question.required ?? false}
                            onChange={(e) => updateQuestion(index, { required: e.target.checked })}
                          />
                          必答题
                        </label>
                      </div>
                      <div className="md:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                        <div className="flex flex-wrap items-center gap-3 text-xs text-slate-700">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={question.displayIfEnabled}
                              onChange={(e) => updateQuestion(index, { displayIfEnabled: e.target.checked })}
                            />
                            启用条件显示
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={question.jumpEnabled}
                              onChange={(e) => updateQuestion(index, { jumpEnabled: e.target.checked })}
                            />
                            启用跳题
                          </label>
                        </div>
                        {question.displayIfEnabled && (
                          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                            <div>
                              <label className="text-xs text-slate-500">引用题目 ID</label>
                              <input
                                list="question-id-options"
                                value={question.displayIfQuestionId}
                                onChange={(e) => updateQuestion(index, { displayIfQuestionId: e.target.value })}
                                className="input-field mt-1"
                                placeholder="选择用于判断的题目"
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">条件</label>
                              <select
                                value={question.displayIfOperator}
                                onChange={(e) => updateQuestion(index, { displayIfOperator: e.target.value })}
                                className="input-field mt-1"
                              >
                                {CONDITION_OPERATORS.map((item) => (
                                  <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">条件值（多个用 | 分隔）</label>
                              <input
                                value={question.displayIfValue}
                                onChange={(e) => updateQuestion(index, { displayIfValue: e.target.value })}
                                className="input-field mt-1"
                                disabled={!operatorNeedsValue(question.displayIfOperator)}
                                placeholder="例如：是|确定"
                              />
                            </div>
                          </div>
                        )}
                        {question.jumpEnabled && (
                          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3 text-xs">
                            <div>
                              <label className="text-xs text-slate-500">条件题目 ID</label>
                              <input
                                list="question-id-options"
                                value={question.jumpQuestionId}
                                onChange={(e) => updateQuestion(index, { jumpQuestionId: e.target.value })}
                                className="input-field mt-1"
                                placeholder={`默认本题：${question.id}`}
                              />
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">条件</label>
                              <select
                                value={question.jumpOperator}
                                onChange={(e) => updateQuestion(index, { jumpOperator: e.target.value })}
                                className="input-field mt-1"
                              >
                                {CONDITION_OPERATORS.map((item) => (
                                  <option key={item.value} value={item.value}>{item.label}</option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="text-xs text-slate-500">条件值（多个用 | 分隔）</label>
                              <input
                                value={question.jumpValue}
                                onChange={(e) => updateQuestion(index, { jumpValue: e.target.value })}
                                className="input-field mt-1"
                                disabled={!operatorNeedsValue(question.jumpOperator)}
                                placeholder="例如：否"
                              />
                            </div>
                            <div className="md:col-span-3 flex flex-wrap items-center gap-3">
                              <label className="flex items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={question.jumpToEnd}
                                  onChange={(e) => updateQuestion(index, { jumpToEnd: e.target.checked })}
                                />
                                满足条件后直接结束问卷
                              </label>
                              <div className="flex-1 min-w-[200px]">
                                <label className="text-xs text-slate-500">跳转到题目 ID</label>
                                <input
                                  list="question-id-options"
                                  value={question.jumpTargetId}
                                  onChange={(e) => updateQuestion(index, { jumpTargetId: e.target.value })}
                                  className="input-field mt-1"
                                  disabled={question.jumpToEnd}
                                  placeholder="选择后续题目（仅支持向后跳）"
                                />
                              </div>
                            </div>
                          </div>
                        )}
                        <p className="mt-3 text-xs text-slate-400">提示：条件/跳题仅支持简单规则；复杂条件可继续使用“额外字段 JSON”。</p>
                      </div>
                      <div className="md:col-span-2">
                        <label className="text-xs text-slate-500">额外字段 JSON（可选）</label>
                        {question.extraJson.trim() ? <p className="mt-1 text-xs text-amber-800">高级 JSON 中的条件、跳转或引用仍然生效；简易控件留空或未勾选不会删除这些规则。删除请编辑高级 JSON；启用简易规则或填写简易引用会接管对应字段。</p> : null}
                        <textarea
                          value={question.extraJson}
                          onChange={(e) => updateQuestion(index, { extraJson: e.target.value })}
                          className="input-field mt-1 h-20"
                          placeholder='例如：{ "displayIf": { "questionId": "MG-1", "operator": "equals", "value": "是" } }'
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-700">题目操作</h3>
                  <p className="mt-1 text-xs text-slate-500">新增默认追加在末尾，也可按题号插入。</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button onClick={addQuestion} className="generate-button mb-0 w-full text-sm md:w-auto md:px-6 md:py-2">新增题目</button>
                  <button onClick={applyAutoIds} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400">自动编号</button>
                </div>
              </div>
              <form onSubmit={handleInsertSubmit} className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-slate-500">插入到第</span>
                <input
                  name="insertPosition"
                  type="number"
                  min={1}
                  max={questions.length + 1}
                  className="input-field h-8 w-20 px-2 text-xs"
                  placeholder={`${questions.length + 1}`}
                />
                <span className="text-slate-500">题</span>
                <button type="submit" className="rounded-md border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">插入空题</button>
              </form>
              <p className="mt-2 text-xs text-slate-400">提示：拖拽卡片左侧把手即可快速调整顺序。</p>
            </div>

  </>;
}
