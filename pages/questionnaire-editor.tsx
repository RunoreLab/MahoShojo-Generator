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
  type QuestionnaireOption,
  type QuestionnaireQuestion,
  type QuestionnaireQuestionRef,
} from '@/lib/questionnaires';

type EditableSuggestionItem = {
  uid: string;
  text: string;
};

type EditableOptionItem = {
  uid: string;
  label: string;
  value: string;
  disabled: boolean;
};

type EditableQuestion = {
  uid: string;
  id: string;
  question: string;
  type?: 'text' | 'select';
  placeholder?: string;
  suggestions: EditableSuggestionItem[];
  options: EditableOptionItem[];
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

let questionUidCounter = 0;
let suggestionUidCounter = 0;
let optionUidCounter = 0;

const createQuestionUid = (seed?: string) => {
  if (seed) return `question-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `question-${crypto.randomUUID()}`;
  }
  questionUidCounter += 1;
  return `question-${Date.now()}-${questionUidCounter}`;
};

const createSuggestionUid = (seed?: string) => {
  if (seed) return `suggestion-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `suggestion-${crypto.randomUUID()}`;
  }
  suggestionUidCounter += 1;
  return `suggestion-${Date.now()}-${suggestionUidCounter}`;
};

const createOptionUid = (seed?: string) => {
  if (seed) return `option-${seed}`;
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `option-${crypto.randomUUID()}`;
  }
  optionUidCounter += 1;
  return `option-${Date.now()}-${optionUidCounter}`;
};

const createEmptyQuestion = (
  index: number,
  kind: 'magical-girl' | 'canshou',
  uidSeed?: string
): EditableQuestion => ({
  uid: createQuestionUid(uidSeed),
  id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
  question: '',
  type: 'text',
  placeholder: '',
  suggestions: [],
  options: [],
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

const buildSuggestionsPayload = (items: EditableSuggestionItem[]): string[] | undefined => {
  const normalized = items
    .map((item) => item.text.trim())
    .filter(Boolean);
  return normalized.length > 0 ? normalized : undefined;
};

const buildOptionsPayload = (items: EditableOptionItem[]): QuestionnaireOption[] | undefined => {
  const normalized = items
    .map((item) => {
      const label = item.label.trim();
      const value = item.value.trim();
      const resolvedLabel = label || value;
      const resolvedValue = value || label;
      if (!resolvedLabel || !resolvedValue) return null;
      if (!item.disabled && resolvedLabel === resolvedValue) return resolvedValue;
      return {
        label: resolvedLabel,
        value: resolvedValue,
        ...(item.disabled ? { disabled: true } : {}),
      };
    })
    .filter((item): item is QuestionnaireOption => item !== null);
  return normalized.length > 0 ? normalized : undefined;
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

const getQuestionLabel = (question: EditableQuestion, index: number) => {
  const idLabel = question.id.trim() || `Q${index + 1}`;
  const textLabel = question.question.trim() || `问题 ${index + 1}`;
  return `${idLabel} · ${textLabel}`;
};

const QuestionnaireEditorPage: React.FC = () => {
  const [kind, setKind] = useState<'magical-girl' | 'canshou'>('magical-girl');
  const [questionnaireId, setQuestionnaireId] = useState('magical-girl-custom');
  const [title, setTitle] = useState('未命名问卷');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState(DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['magical-girl']);
  const [version, setVersion] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([createEmptyQuestion(0, 'magical-girl', 'initial-1')]);
  const [importText, setImportText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});

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

  const flashMessage = (message: string) => {
    setActionMessage(message);
    setTimeout(() => setActionMessage(null), 2400);
  };

  const updateQuestion = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
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
        suggestions: buildSuggestionsPayload(q.suggestions),
        options: buildOptionsPayload(q.options),
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

  const handleImport = (rawText?: string) => {
    const sourceText = typeof rawText === 'string' ? rawText : importText;
    if (!sourceText.trim()) {
      setEditorError('请先粘贴或上传问卷 JSON');
      return;
    }
    try {
      const parsed = JSON.parse(sourceText);
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
      setImportText(sourceText);
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
          uid: createQuestionUid(),
          id: q.id,
          question: q.question,
          type: q.type || 'text',
          placeholder: q.placeholder || '',
          suggestions: (q.suggestions || []).map((text) => ({ uid: createSuggestionUid(), text })),
          options: (q.options || []).map((option) => {
            if (typeof option === 'string') {
              return { uid: createOptionUid(), label: option, value: option, disabled: false };
            }
            return {
              uid: createOptionUid(),
              label: option.label,
              value: option.value,
              disabled: Boolean(option.disabled),
            };
          }),
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
      setCollapsedMap({});
      flashMessage('✅ 已导入问卷并应用');
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '问卷 JSON 解析失败');
    }
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      setImportText(text);
      handleImport(text);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '读取文件失败');
    }
  };

  const handleImportInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    void handleImportFile(file);
    event.target.value = '';
  };

  const handlePasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) {
        setEditorError('剪贴板内容为空');
        return;
      }
      setImportText(text);
      handleImport(text);
    } catch (error) {
      setEditorError(error instanceof Error ? error.message : '读取剪贴板失败');
    }
  };

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(jsonPreview);
      flashMessage('✅ 已复制到剪贴板');
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
    flashMessage('✅ 已生成下载文件');
  };

  return (
    <>
      <Head>
        <title>问卷编辑器</title>
      </Head>
      <div className="magic-background-white">
        <div className="container !max-w-[1100px]">
          <div className="card !max-w-none">
            <h1 className="sr-only">问卷编辑器</h1>
            <div className="text-center mb-6">
              <div className="flex justify-center">
                <div className="rounded-2xl bg-gradient-to-r from-pink-500 via-rose-500 to-fuchsia-500 px-6 py-3 shadow-lg">
                  <img src="/questionnaire-title.svg" alt="问卷编辑器" className="h-8 w-auto" />
                </div>
              </div>
              <p className="subtitle mt-3">把问卷当作可维护的创作工具箱</p>
              <div className="mt-3 flex flex-wrap justify-center gap-2 text-xs">
                <span className="rounded-full bg-pink-100 px-3 py-1 text-pink-700">条件显示 / 跳题</span>
                <span className="rounded-full bg-amber-100 px-3 py-1 text-amber-700">云端问卷库</span>
                <span className="rounded-full bg-indigo-100 px-3 py-1 text-indigo-700">JSON 导入 / 导出</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 text-xs">
              <Link
                href="/details"
                className="rounded-full border border-pink-200 bg-pink-50 px-3 py-1 text-pink-700 hover:border-pink-300 hover:bg-pink-100"
              >
                前往魔法少女问卷
              </Link>
              <Link
                href="/canshou"
                className="rounded-full border border-rose-200 bg-rose-50 px-3 py-1 text-rose-700 hover:border-rose-300 hover:bg-rose-100"
              >
                前往残兽问卷
              </Link>
            </div>
            {actionMessage && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                {actionMessage}
              </div>
            )}
            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
              <p className="font-semibold text-slate-800 mb-2">创建指引</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>问卷由「题目列表」组成，每道题可设置提示、选项与字数限制。</li>
                <li><code className="bg-slate-200 px-1 rounded">placeholder</code> 用于输入框提示，<code className="bg-slate-200 px-1 rounded">helperText</code> 用于补充说明。</li>
                <li><code className="bg-slate-200 px-1 rounded">suggestions</code> 会显示为灵感按钮（可逐条新增/删除）；<code className="bg-slate-200 px-1 rounded">options</code> 是推荐选项列表，支持设置「标签 / 内容 / 禁用」。</li>
                <li><code className="bg-slate-200 px-1 rounded">displayIf</code> 支持条件显示；<code className="bg-slate-200 px-1 rounded">jump</code> 可设置跳题规则。</li>
                <li><code className="bg-slate-200 px-1 rounded">optionsFrom</code> / <code className="bg-slate-200 px-1 rounded">suggestionsFrom</code> 可引用其他题目的选项或灵感。</li>
                <li>最大字数为建议上限，超出仍可提交但会影响原生性；留空表示不设题目上限（仍受统一原生上限影响）。</li>
                <li>Logo 仅支持站内路径或可信 HTTPS 外链，推荐使用下方快捷 Logo。</li>
                <li>更多高级字段可写入「额外字段 JSON」，会并入该题的最终结构。</li>
              </ul>
            </div>

            <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">导入现有问卷</h3>
                    <p className="mt-1 text-xs text-slate-500">支持粘贴或上传 JSON，导入后会覆盖当前编辑内容。</p>
                  </div>
                  <button
                    type="button"
                    onClick={handlePasteFromClipboard}
                    className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100"
                  >
                    从剪贴板导入
                  </button>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-xs text-slate-500">上传问卷 JSON 文件</label>
                    <input
                      type="file"
                      accept="application/json"
                      onChange={handleImportInputChange}
                      className="input-field mt-1 file:mr-4 file:rounded-full file:border-0 file:bg-white file:px-4 file:py-2 file:text-xs file:text-slate-600"
                    />
                    <p className="mt-1 text-xs text-slate-400">上传后会自动导入并应用。</p>
                  </div>
                  <div>
                    <label className="text-xs text-slate-500">粘贴问卷 JSON</label>
                    <textarea
                      value={importText}
                      onChange={(e) => setImportText(e.target.value)}
                      placeholder="在此粘贴问卷 JSON"
                      className="input-field mt-1 h-28"
                    />
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <button
                        type="button"
                        onClick={() => handleImport()}
                        className="rounded-lg border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700"
                      >
                        应用粘贴内容
                      </button>
                      <button
                        type="button"
                        onClick={() => setImportText('')}
                        className="rounded-lg border border-slate-200 px-3 py-1 text-slate-500 hover:text-slate-700"
                      >
                        清空
                      </button>
                    </div>
                  </div>
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">导出问卷</h3>
                    <p className="mt-1 text-xs text-slate-500">复制或下载当前问卷 JSON，方便保存与分享。</p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <button onClick={handleCopyJson} className="rounded-full border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">复制 JSON</button>
                    <button onClick={handleDownloadJson} className="rounded-full border border-indigo-200 px-3 py-1 text-indigo-600 hover:text-indigo-700">下载 JSON</button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                  <span>预览（{jsonPreview.length} 字符）</span>
                  <button
                    type="button"
                    onClick={() => setShowPreview((prev) => !prev)}
                    className="text-indigo-600 hover:underline"
                  >
                    {showPreview ? '收起预览' : '展开预览'}
                  </button>
                </div>
                {showPreview && (
                  <div className="mt-2 max-h-64 overflow-auto rounded-lg bg-white p-3 text-xs text-slate-600 whitespace-pre-wrap">
                    {jsonPreview}
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">问卷信息</h2>
                  <p className="mt-1 text-xs text-slate-500">编辑问卷基础字段与 Logo 展示。</p>
                </div>
                <div className="text-xs text-slate-500">当前题目：{questions.length} 题</div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
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
            </div>

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
                        <span>必答：{question.required === false ? '否' : '是'}</span>
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

            <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
              <SaveToCloudButton
                data={questionnaireData}
                cardType="questionnaire"
                buttonText="保存为云端问卷"
                className="generate-button mb-0 w-full text-sm md:w-auto md:px-6 md:py-2"
              />
              <Link href="/" className="footer-link text-sm">返回首页</Link>
            </div>

            {(editorError || jsonError) && <ErrorMessage message={editorError || jsonError || '问卷格式错误'} />}
            <p className="mt-4 text-xs text-slate-400">提示：原生许可由管理员评估标记；自建问卷默认非原生。</p>
          </div>
          <Footer />
        </div>
      </div>
    </>
  );
};

export default QuestionnaireEditorPage;
