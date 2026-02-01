import React, { useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import { normalizeQuestionnaireDefinition, type QuestionnaireDefinition, type QuestionnaireQuestion } from '@/lib/questionnaires';

type EditableQuestion = {
  id: string;
  question: string;
  type?: 'text' | 'select';
  placeholder?: string;
  suggestionsText: string;
  optionsText: string;
  allowCustom?: boolean;
  helperText?: string;
  maxLengthText: string;
  required?: boolean;
  extraJson: string;
};

const createEmptyQuestion = (index: number, kind: 'magical-girl' | 'canshou'): EditableQuestion => ({
  id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
  question: '',
  type: 'text',
  placeholder: '',
  suggestionsText: '',
  optionsText: '',
  allowCustom: true,
  helperText: '',
  maxLengthText: '',
  required: true,
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

const QuestionnaireEditorPage: React.FC = () => {
  const [kind, setKind] = useState<'magical-girl' | 'canshou'>('magical-girl');
  const [questionnaireId, setQuestionnaireId] = useState('magical-girl-custom');
  const [title, setTitle] = useState('未命名问卷');
  const [description, setDescription] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [version, setVersion] = useState('');
  const [questions, setQuestions] = useState<EditableQuestion[]>([createEmptyQuestion(0, 'magical-girl')]);
  const [importText, setImportText] = useState('');
  const [editorError, setEditorError] = useState<string | null>(null);

  const updateQuestion = (index: number, patch: Partial<EditableQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  };

  const addQuestion = () => {
    setQuestions((prev) => [...prev, createEmptyQuestion(prev.length, kind)]);
  };

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const moveQuestion = (index: number, direction: -1 | 1) => {
    setQuestions((prev) => {
      const next = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      const temp = next[index];
      next[index] = next[targetIndex];
      next[targetIndex] = temp;
      return next;
    });
  };

  const applyAutoIds = () => {
    setQuestions((prev) => prev.map((q, index) => ({
      ...q,
      id: kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`,
    })));
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

      return {
        id: q.id.trim() || (kind === 'magical-girl' ? `MG-${index + 1}` : `CS-${index + 1}`),
        question: q.question.trim() || `问题 ${index + 1}`,
        type: q.type,
        placeholder: q.placeholder?.trim() || undefined,
        suggestions: parseSuggestionsText(q.suggestionsText),
        options: parseOptionsText(q.optionsText),
        allowCustom: typeof q.allowCustom === 'boolean' ? q.allowCustom : undefined,
        helperText: q.helperText?.trim() || undefined,
        maxLength: Number.isFinite(maxLength) ? maxLength : null,
        required: typeof q.required === 'boolean' ? q.required : undefined,
        ...extra,
      } satisfies QuestionnaireQuestion;
    });

    const payload: QuestionnaireDefinition = {
      id: questionnaireId.trim() || `${kind}-custom`,
      kind,
      title: title.trim() || '未命名问卷',
      description: description.trim() || undefined,
      logoUrl: logoUrl.trim() || undefined,
      version: version.trim() || undefined,
      nativeAllowed: false,
      questions: cleanedQuestions,
    };

    return {
      questionnaireData: payload,
      jsonError: errors.length > 0 ? errors[0] : null,
    };
  }, [questions, questionnaireId, kind, title, description, logoUrl, version]);

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
      setQuestions(normalized.questions.map((q) => ({
        id: q.id,
        question: q.question,
        type: q.type || 'text',
        placeholder: q.placeholder || '',
        suggestionsText: stringifySuggestions(q.suggestions),
        optionsText: stringifyOptions(q.options),
        allowCustom: q.allowCustom ?? true,
        helperText: q.helperText || '',
        maxLengthText: q.maxLength == null ? '' : String(q.maxLength),
        required: q.required !== false,
        extraJson: '',
      })));
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
                <li>最大字数留空表示无限制；关闭「允许自定义」即可只使用选项作答。</li>
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
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button onClick={addQuestion} className="generate-button">新增题目</button>
              <button onClick={applyAutoIds} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400">自动编号</button>
              <Link href="/details" className="text-sm text-indigo-600 hover:underline">前往魔法少女问卷</Link>
              <Link href="/canshou" className="text-sm text-indigo-600 hover:underline">前往残兽问卷</Link>
            </div>

            <div className="mt-6 space-y-4">
              {questions.map((question, index) => (
                <div key={`question-${index}`} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-slate-800">题目 {index + 1}</div>
                    <div className="flex gap-2 text-xs">
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
                      <label className="text-xs text-slate-500">最大字数（留空=无限制）</label>
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
                    <div className="md:col-span-2">
                      <label className="text-xs text-slate-500">额外字段 JSON（可选）</label>
                      <textarea
                        value={question.extraJson}
                        onChange={(e) => updateQuestion(index, { extraJson: e.target.value })}
                        className="input-field mt-1 h-20"
                        placeholder='例如：{ "metadata": { "tag": "情绪" } }'
                      />
                    </div>
                  </div>
                </div>
              ))}
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
