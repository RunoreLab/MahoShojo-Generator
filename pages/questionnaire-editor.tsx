import React, { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import {
  DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND,
  QUESTIONNAIRE_LOGO_PRESETS,
  normalizeQuestionnaireDefinition,
  sanitizeQuestionnaireLogoUrl,
  type QuestionnaireConditionOperator,
  type QuestionnaireCondition,
  type QuestionnaireDefinition,
  type QuestionnaireJumpRule,
  type QuestionnaireQuestion,
  type QuestionnaireQuestionRef,
} from '@/lib/questionnaires';

type EditableQuestion = {
  id: string;
  question: string;
  type?: 'text' | 'select';
  placeholder?: string;
  suggestionsText: string;
  optionsText: string;
  optionsFromId: string;
  suggestionsFromId: string;
  allowCustom?: boolean;
  helperText?: string;
  maxLengthText: string;
  required?: boolean;
  displayIfEnabled: boolean;
  displayIfQuestionId: string;
  displayIfOperator: string;
  displayIfValue: string;
  jumpEnabled: boolean;
  jumpQuestionId: string;
  jumpOperator: string;
  jumpValue: string;
  jumpTargetId: string;
  jumpToEnd: boolean;
  extraJson: string;
};

const createEmptyQuestion = (index: number, kind: 'magical-girl' | 'canshou'): EditableQuestion => ({
  id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
  question: '',
  type: 'text',
  placeholder: '',
  suggestionsText: '',
  optionsText: '',
  optionsFromId: '',
  suggestionsFromId: '',
  allowCustom: true,
  helperText: '',
  maxLengthText: '',
  required: true,
  displayIfEnabled: false,
  displayIfQuestionId: '',
  displayIfOperator: 'equals',
  displayIfValue: '',
  jumpEnabled: false,
  jumpQuestionId: '',
  jumpOperator: 'equals',
  jumpValue: '',
  jumpTargetId: '',
  jumpToEnd: false,
  extraJson: '',
});

const parseOptionsText = (input: string): QuestionnaireQuestion['options'] => {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return undefined;
  return lines.map((line) => {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) {
      const [label, value, flag] = parts;
      const disabled = flag ? ['disabled', 'true', '1', 'yes'].includes(flag.toLowerCase()) : false;
      return {
        label: label || value,
        value: value || label,
        ...(disabled ? { disabled: true } : {}),
      };
    }
    return line;
  });
};

const parseSuggestionsText = (input: string): string[] | undefined => {
  const lines = input
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
};

const stringifyOptions = (options: QuestionnaireQuestion['options']): string => {
  if (!options || options.length === 0) return '';
  return options
    .map((option) => {
      if (typeof option === 'string') return option;
      const flag = option.disabled ? '|disabled' : '';
      return `${option.label}|${option.value}${flag}`;
    })
    .join('\n');
};

const stringifySuggestions = (suggestions: string[] | undefined): string => {
  if (!suggestions || suggestions.length === 0) return '';
  return suggestions.join('\n');
};

const CONDITION_OPERATORS = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'includes', label: '包含' },
  { value: 'notIncludes', label: '不包含' },
  { value: 'empty', label: '为空' },
  { value: 'notEmpty', label: '不为空' },
];

const operatorNeedsValue = (operator: string) => !['empty', 'notEmpty'].includes(operator);

const toQuestionRefId = (ref: QuestionnaireQuestionRef | undefined): string => {
  if (!ref) return '';
  if (typeof ref === 'string') return ref;
  if (typeof ref.questionId === 'string') return ref.questionId;
  if (typeof ref.key === 'string') return ref.key;
  return '';
};

const parseConditionValue = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join('|');
  }
  if (typeof value === 'string') return value;
  return '';
};

const parseSimpleCondition = (
  condition: QuestionnaireCondition | QuestionnaireCondition[] | undefined
): { questionId: string; operator: string; value: string } | null => {
  if (!condition) return null;
  const target = Array.isArray(condition) ? (condition.length === 1 ? condition[0] : null) : condition;
  if (!target || typeof target !== 'object') return null;
  if ('any' in target || 'all' in target || 'not' in target) return null;
  const questionId = typeof target.questionId === 'string'
    ? target.questionId
    : (typeof target.key === 'string' ? target.key : '');
  if (!questionId) return null;
  const operator = typeof target.operator === 'string' ? target.operator : 'equals';
  const value = parseConditionValue(target.value);
  return { questionId, operator, value };
};

const parseSimpleJump = (
  jump: QuestionnaireJumpRule | QuestionnaireJumpRule[] | undefined
): {
  questionId: string;
  operator: string;
  value: string;
  targetId: string;
  toEnd: boolean;
} | null => {
  if (!jump) return null;
  const rule = Array.isArray(jump) ? (jump.length === 1 ? jump[0] : null) : jump;
  if (!rule || typeof rule !== 'object' || !rule.when) return null;
  const condition = parseSimpleCondition(rule.when);
  if (!condition) return null;
  const targetId = toQuestionRefId(rule.to);
  const toEnd = Boolean(rule.toEnd);
  return {
    questionId: condition.questionId,
    operator: condition.operator,
    value: condition.value,
    targetId,
    toEnd,
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const parseFormNumber = (value: FormDataEntryValue | null): number | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
};

const QuestionnaireEditorPage: React.FC = () => {
  const [kind, setKind] = useState<'magical-girl' | 'canshou'>('magical-girl');
  const [questionnaireId, setQuestionnaireId] = useState('magical-girl-custom');
  const [title, setTitle] = useState('未命名问卷');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState(DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['magical-girl']);
  const [version, setVersion] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([createEmptyQuestion(0, 'magical-girl')]);
  const [importText, setImportText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  useEffect(() => {
    setLogoUrl((prev) => {
      const trimmed = prev.trim();
      const shouldAutoSwitch = trimmed === DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['magical-girl']
        || trimmed === DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['canshou'];
      if (!shouldAutoSwitch) return prev;
      return DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND[kind];
    });
  }, [kind]);

  const logoPresets = useMemo(
    () => QUESTIONNAIRE_LOGO_PRESETS.filter((item) => item.kind === kind || item.kind === 'common'),
    [kind]
  );

  const normalizedLogoUrl = useMemo(() => sanitizeQuestionnaireLogoUrl(logoUrl), [logoUrl]);
  const logoWarning = useMemo(() => {
    const trimmed = logoUrl.trim();
    if (!trimmed) return null;
    return normalizedLogoUrl ? null : '⚠️ 当前 Logo URL 不可信，已在导出时忽略。';
  }, [logoUrl, normalizedLogoUrl]);
  const trimmedLogoUrl = logoUrl.trim();

  const updateQuestion = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
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

  const { questionnaireData, jsonError } = useMemo(() => {
    const errors: string[] = [];
    const cleanedQuestions: QuestionnaireQuestion[] = questions.map((q, index) => {
      let extra: Record<string, unknown> = {};
      if (q.extraJson.trim()) {
        try {
          extra = JSON.parse(q.extraJson);
        } catch {
          errors.push(`第 ${index + 1} 题的“额外字段 JSON”无法解析`);
        }
      }

      const maxLength = q.maxLengthText.trim() ? Number(q.maxLengthText) : null;
      if (q.maxLengthText.trim() && !Number.isFinite(maxLength)) {
        errors.push(`第 ${index + 1} 题的最大字数不是有效数字`);
      }

      let displayIf: QuestionnaireCondition | undefined = undefined;
      if (q.displayIfEnabled) {
        const questionId = q.displayIfQuestionId.trim();
        if (!questionId) {
          errors.push(`第 ${index + 1} 题已启用条件显示，但未选择引用题目`);
        } else {
          const operator = (q.displayIfOperator || 'equals') as QuestionnaireConditionOperator;
          const rawValue = q.displayIfValue.trim();
          const value = operatorNeedsValue(operator)
            ? (rawValue.includes('|') ? rawValue.split('|').map((item) => item.trim()).filter(Boolean) : rawValue)
            : undefined;
          displayIf = {
            questionId,
            operator,
            ...(value === undefined || (Array.isArray(value) && value.length === 0) ? {} : { value }),
          };
        }
      }

      let jump: QuestionnaireJumpRule | undefined = undefined;
      if (q.jumpEnabled) {
        const jumpQuestionId = q.jumpQuestionId.trim() || q.id.trim();
        const jumpTargetId = q.jumpTargetId.trim();
        const toEnd = q.jumpToEnd;
        if (!jumpQuestionId) {
          errors.push(`第 ${index + 1} 题已启用跳题，但条件题目为空`);
        } else if (!toEnd && !jumpTargetId) {
          errors.push(`第 ${index + 1} 题已启用跳题，但未设置跳转目标`);
        } else {
          const operator = (q.jumpOperator || 'equals') as QuestionnaireConditionOperator;
          const rawValue = q.jumpValue.trim();
          const value = operatorNeedsValue(operator)
            ? (rawValue.includes('|') ? rawValue.split('|').map((item) => item.trim()).filter(Boolean) : rawValue)
            : undefined;
          jump = {
            when: {
              questionId: jumpQuestionId,
              operator,
              ...(value === undefined || (Array.isArray(value) && value.length === 0) ? {} : { value }),
            },
            ...(toEnd ? { toEnd: true } : { to: { questionId: jumpTargetId } }),
          };
        }
      }

      return {
        ...extra,
        id: q.id.trim() || (kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`),
        question: q.question.trim() || `问题 ${index + 1}`,
        type: q.type,
        placeholder: q.placeholder?.trim() || undefined,
        suggestions: parseSuggestionsText(q.suggestionsText),
        options: parseOptionsText(q.optionsText),
        ...(q.optionsFromId.trim() ? { optionsFrom: { questionId: q.optionsFromId.trim() } } : {}),
        ...(q.suggestionsFromId.trim() ? { suggestionsFrom: { questionId: q.suggestionsFromId.trim() } } : {}),
        allowCustom: typeof q.allowCustom === 'boolean' ? q.allowCustom : undefined,
        helperText: q.helperText?.trim() || undefined,
        maxLength: Number.isFinite(maxLength) ? maxLength : null,
        required: typeof q.required === 'boolean' ? q.required : undefined,
        ...(displayIf ? { displayIf } : {}),
        ...(jump ? { jump } : {}),
      } satisfies QuestionnaireQuestion;
    });

    const payload: QuestionnaireDefinition = {
      id: questionnaireId.trim() || `${kind}-custom`,
      kind,
      title: title.trim() || '未命名问卷',
      description: description.trim() || undefined,
      logoUrl: normalizedLogoUrl || undefined,
      version: version.trim() || undefined,
      nativeAllowed: false,
      questions: cleanedQuestions,
    };

    return {
      questionnaireData: payload,
      jsonError: errors.length > 0 ? errors[0] : null,
    };
  }, [questions, questionnaireId, kind, title, description, normalizedLogoUrl, version]);

  const jsonPreview = useMemo(() => JSON.stringify(questionnaireData, null, 2), [questionnaireData]);

  const handleImport = () => {
    try {
      const parsed = JSON.parse(importText);
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind: kind,
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${kind}-custom`,
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        applyMagicalMeta: false,
        nativeAllowed: typeof parsed?.nativeAllowed === 'boolean' ? parsed.nativeAllowed : false,
      });
      if (!normalized) {
        setEditorError('问卷 JSON 无法识别，请检查格式');
        return;
      }
      setEditorError(null);
      setKind(normalized.kind);
      setQuestionnaireId(normalized.id);
      setTitle(normalized.title);
      setDescription(normalized.description || '');
      setLogoUrl(normalized.logoUrl || '');
      setVersion(normalized.version || '');
      setQuestions(normalized.questions.map((q) => {
        const displayIfParsed = parseSimpleCondition(q.displayIf);
        const jumpParsed = parseSimpleJump(q.jump);
        const extraPayload: Record<string, unknown> = {};
        if (!displayIfParsed && q.displayIf) extraPayload.displayIf = q.displayIf;
        if (!jumpParsed && q.jump) extraPayload.jump = q.jump;

        return {
          id: q.id,
          question: q.question,
          type: q.type || 'text',
          placeholder: q.placeholder || '',
          suggestionsText: stringifySuggestions(q.suggestions),
          optionsText: stringifyOptions(q.options),
          optionsFromId: toQuestionRefId(q.optionsFrom),
          suggestionsFromId: toQuestionRefId(q.suggestionsFrom),
          allowCustom: q.allowCustom ?? true,
          helperText: q.helperText || '',
          maxLengthText: q.maxLength == null ? '' : String(q.maxLength),
          required: q.required !== false,
          displayIfEnabled: Boolean(displayIfParsed),
          displayIfQuestionId: displayIfParsed?.questionId || '',
          displayIfOperator: displayIfParsed?.operator || 'equals',
          displayIfValue: displayIfParsed?.value || '',
          jumpEnabled: Boolean(jumpParsed),
          jumpQuestionId: jumpParsed?.questionId || '',
          jumpOperator: jumpParsed?.operator || 'equals',
          jumpValue: jumpParsed?.value || '',
          jumpTargetId: jumpParsed?.targetId || '',
          jumpToEnd: jumpParsed?.toEnd || false,
          extraJson: Object.keys(extraPayload).length > 0 ? JSON.stringify(extraPayload, null, 2) : '',
        };
      }));
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '读取文件失败');
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview);
      alert('✅ 问卷 JSON 已复制到剪贴板');
    } catch {
      setEditorError('复制失败，请手动选择文本');
    }
  };

  const handleDownloadJson = () => {
    const blob = new Blob([jsonPreview], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (title || 'questionnaire').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    link.href = url;
    link.download = `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Head>
        <title>问卷编辑器</title>
      </Head>
      <div className="magic-background">
        <div className="container">
          <div className="card">
            <h1 className="text-2xl font-bold text-slate-800 mb-4">问卷编辑器</h1>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800 mb-2">创建指引</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>问卷由「题目列表」组成，每道题可设置提示、选项与字数限制。</li>
                <li><code className="bg-slate-200 px-1 rounded">placeholder</code> 用于输入框提示，<code className="bg-slate-200 px-1 rounded">helperText</code> 用于补充说明。</li>
                <li><code className="bg-slate-200 px-1 rounded">suggestions</code> 会显示为灵感按钮；<code className="bg-slate-200 px-1 rounded">options</code> 用于推荐选项。</li>
                <li><code className="bg-slate-200 px-1 rounded">displayIf</code> 支持条件显示；<code className="bg-slate-200 px-1 rounded">jump</code> 可设置跳题规则。</li>
                <li><code className="bg-slate-200 px-1 rounded">optionsFrom</code> / <code className="bg-slate-200 px-1 rounded">suggestionsFrom</code> 可引用其他题目的选项或灵感。</li>
                <li>最大字数为建议上限，超出仍可提交但会影响原生性；留空表示不设题目上限（仍受统一原生上限影响）。</li>
                <li>Logo 仅支持站内路径或可信 HTTPS 外链，推荐使用下方快捷 Logo。</li>
                <li>更多高级字段可写入「额外字段 JSON」，会并入该题的最终结构。</li>
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs text-slate-500">问卷类型</label>
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as 'magical-girl' | 'canshou')}
                  className="input-field mt-1"
                >
                  <option value="magical-girl">魔法少女</option>
                  <option value="canshou">残兽</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500">问卷 ID（用于匹配）</label>
                <input
                  value={questionnaireId}
                  onChange={(e) => setQuestionnaireId(e.target.value)}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">问卷标题</label>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="input-field mt-1"
                />
              </div>
              <div>
                <label className="text-xs text-slate-500">版本号（可选）</label>
                <input
                  value={version}
                  onChange={(e) => setVersion(e.target.value)}
                  className="input-field mt-1"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-slate-500">描述（可选）</label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="input-field mt-1 h-20"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-xs text-slate-500">Logo URL（可选）</label>
                <input
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  className="input-field mt-1"
                />
                <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                    <span>快捷选择（点击即可填入）</span>
                    <button
                      type="button"
                      onClick={() => setLogoUrl('')}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      清空
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {logoPresets.map((preset) => {
                      const isActive = trimmedLogoUrl === preset.url;
                      return (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => setLogoUrl(preset.url)}
                          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition ${
                            isActive
                              ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                              : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-700'
                          }`}
                        >
                          <span>{preset.label}</span>
                          <span className="flex items-center justify-center rounded bg-white/70 px-1">
                            <img src={preset.url} alt={preset.label} className="h-4 w-auto" />
                          </span>
                        </button>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">仅允许站内路径（/ 开头）或可信 HTTPS 外链，其他地址会被忽略。</p>
                  {logoWarning && <p className="mt-1 text-xs text-rose-500">{logoWarning}</p>}
                </div>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Link href="/details" className="text-sm text-indigo-600 hover:underline">前往魔法少女问卷</Link>
              <Link href="/canshou" className="text-sm text-indigo-600 hover:underline">前往残兽问卷</Link>
            </div>

            <div className="mt-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">题目列表</h2>
                  <p className="mt-1 text-xs text-slate-500">拖拽左侧把手可快速排序，也可在右侧输入题号移动。</p>
                </div>
                <span className="text-xs text-slate-500">共 {questions.length} 题</span>
              </div>
            </div>

            <div className="mt-4 space-y-4">
              <datalist id="question-id-options">
                {questions.map((item, idx) => {
                  const label = item.question ? `${item.id} · ${item.question}` : item.id;
                  return (
                    <option key={`question-id-${idx}`} value={item.id} label={label} />
                  );
                })}
              </datalist>
              {questions.map((question, index) => (
                <div
                  key={`question-${index}`}
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
                      <label className="text-xs text-slate-500">灵感提示（每行一个）</label>
                      <textarea
                        value={question.suggestionsText}
                        onChange={(e) => updateQuestion(index, { suggestionsText: e.target.value })}
                        className="input-field mt-1 h-20"
                        placeholder="例如：温柔的誓言"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-500">推荐选项（每行一个，支持 label|value|disabled）</label>
                      <textarea
                        value={question.optionsText}
                        onChange={(e) => updateQuestion(index, { optionsText: e.target.value })}
                        className="input-field mt-1 h-20"
                        placeholder="例如：守护|守护|disabled"
                      />
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
                          checked={question.required ?? true}
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
                      <textarea
                        value={question.extraJson}
                        onChange={(e) => updateQuestion(index, { extraJson: e.target.value })}
                        className="input-field mt-1 h-20"
                        placeholder='例如：{ "displayIf": { "questionId": "MG-1", "operator": "equals", "value": "是" } }'
                      />
                    </div>
                  </div>
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
                  <button onClick={addQuestion} className="generate-button">新增题目</button>
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

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-700">导入 / 导出</h3>
                <div className="flex gap-2 text-xs">
                  <button onClick={handleCopyJson} className="text-indigo-600 hover:underline">复制 JSON</button>
                  <button onClick={handleDownloadJson} className="text-indigo-600 hover:underline">下载 JSON</button>
                </div>
              </div>
              <textarea
                value={importText}
                onChange={(e) => setImportText(e.target.value)}
                placeholder="在此粘贴问卷 JSON，点击“导入”应用"
                className="input-field mt-2 h-28"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                <button onClick={handleImport} className="rounded-lg border border-indigo-200 px-3 py-1 text-indigo-600">导入 JSON</button>
                <label className="text-xs text-slate-500">
                  <span className="mr-2">上传 JSON 文件</span>
                  <input type="file" accept="application/json" onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)} />
                </label>
              </div>
              <div className="mt-3 rounded-lg bg-white p-3 text-xs text-slate-600 whitespace-pre-wrap">
                {jsonPreview}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <SaveToCloudButton
                data={questionnaireData}
                cardType="questionnaire"
                buttonText="保存为云端问卷"
                className="generate-button"
              />
              <Link href="/" className="text-sm text-slate-500 hover:underline">返回首页</Link>
            </div>

            {(editorError || jsonError) && <ErrorMessage message={editorError || jsonError || '问卷格式错误'} />}
            <p className="mt-4 text-xs text-slate-400">提示：原生许可由管理员评估标记；自建问卷默认非原生。</p>
          </div>
          <Footer textWhite={true} />
        </div>
      </div>
    </>
  );
};

export default QuestionnaireEditorPage;
