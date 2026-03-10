import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { dataCardApi } from '@/lib/auth';
import { normalizeQuestionnaireDefinition } from '@/lib/questionnaires';

export type QuestionnaireCompatTargetCard = {
  id: string;
  name: string;
  description: string;
  isPublic: number;
};

interface QuestionnaireCompatModalProps {
  isOpen: boolean;
  onClose: () => void;
  rawJson: string;
  targetCard: QuestionnaireCompatTargetCard | null;
  onReplaceSuccess?: (result: { pendingReview: boolean; message?: string }) => void;
}

const tryPrettyJson = (raw: string): string => {
  const source = typeof raw === 'string' ? raw : '';
  if (!source.trim()) return '';
  try {
    return JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return source;
  }
};

export default function QuestionnaireCompatModal({
  isOpen,
  onClose,
  rawJson,
  targetCard,
  onReplaceSuccess,
}: QuestionnaireCompatModalProps) {
  const router = useRouter();
  const [draftJson, setDraftJson] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const titleText = useMemo(() => {
    if (!targetCard) return '问卷数据卡兼容模式';
    return `问卷数据卡兼容编辑：${targetCard.name || '未命名问卷'}`;
  }, [targetCard]);

  const flashToast = (message: string) => {
    setToast(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2400);
  };

  useEffect(() => {
    if (!isOpen) return;
    setDraftJson(tryPrettyJson(rawJson));
    setError(null);
    setSaving(false);
    setToast(null);
  }, [isOpen, rawJson]);

  useEffect(() => () => {
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(draftJson);
      flashToast('✅ 已复制 JSON 到剪贴板');
    } catch {
      setError('复制失败：请手动选择文本并复制');
    }
  };

  const handleDownload = () => {
    const blob = new Blob([draftJson], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (targetCard?.name || 'questionnaire').replace(/[^a-z0-9\u4e00-\u9fa5]/gi, '_');
    link.href = url;
    link.download = `${safeName}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    flashToast('✅ 已生成下载文件');
  };

  const handleCopyAndOpenEditor = async () => {
    try {
      await navigator.clipboard.writeText(draftJson);
      flashToast('✅ 已复制，正在打开问卷编辑器…');
    } catch {
      flashToast('⚠️ 未能自动复制，请手动复制后再打开问卷编辑器');
    }
    router.push('/questionnaire-editor');
  };

  const handleReplace = async () => {
    if (!targetCard) return;
    setSaving(true);
    setError(null);

    try {
      let parsed: any;
      try {
        parsed = JSON.parse(draftJson);
      } catch {
        throw new Error('JSON 无法解析：请检查逗号、引号与括号是否完整');
      }

      const fallbackKind = parsed?.kind === 'canshou' ? 'canshou' : 'magical-girl';
      const normalized = normalizeQuestionnaireDefinition(parsed, {
        fallbackKind,
        fallbackId: typeof parsed?.id === 'string' ? parsed.id : `${fallbackKind}-custom`,
        fallbackTitle: typeof parsed?.title === 'string' ? parsed.title : '未命名问卷',
        nativeAllowed: typeof parsed?.nativeAllowed === 'boolean' ? parsed.nativeAllowed : false,
      });

      if (!normalized) {
        throw new Error('问卷 JSON 无法识别：请确认包含 kind、title，以及 questions 或 loreMarkdown 等字段');
      }

      const payload = {
        ...parsed,
        ...normalized,
        questions: normalized.questions,
      };

      const textToCheck = `${targetCard.name} ${targetCard.description} ${JSON.stringify(payload)}`;
      const sensitiveWordResult = await quickCheck(textToCheck);
      if (sensitiveWordResult.hasSensitiveWords) {
        router.push('/arrested');
        return;
      }

      const result = await dataCardApi.replaceCard(targetCard.id, {
        name: targetCard.name,
        description: targetCard.description,
        isPublic: targetCard.isPublic,
        data: payload,
      });

      if (!result.success) {
        throw new Error(result.error || '替换失败');
      }

      onReplaceSuccess?.({
        pendingReview: Boolean(result.pendingReview),
        message: result.message,
      });
      flashToast(result.message || (result.pendingReview ? '✅ 更新已提交审核，审核通过后生效' : '✅ 已替换问卷数据卡'));
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : '替换失败');
    } finally {
      setSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg p-6 max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 text-2xl leading-none z-10"
          aria-label="关闭"
          disabled={saving}
        >
          ×
        </button>

        <div className="pr-8">
          <h2 className="text-xl font-bold text-gray-900">{titleText}</h2>
          <div className="mt-1 text-xs text-gray-500">
            {targetCard
              ? `目标数据卡：${targetCard.name || '未命名问卷'}（${targetCard.id}）`
              : '未绑定云端数据卡：本弹窗仅用于兼容查看/导出。'}
          </div>
        </div>

        <div className="mt-4 p-3 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm">
          <div className="font-semibold">提示：建议改用专用问卷编辑器</div>
          <div className="mt-1 leading-relaxed">
            角色管理器仅提供基础 JSON 兼容编辑/替换能力（用于老入口兜底）。复杂编辑（跳题、引用、Logo 预设等）请前往{' '}
            <Link href="/questionnaire-editor" className="text-purple-700 hover:underline font-semibold">
              /questionnaire-editor
            </Link>
            。
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
              onClick={handleCopy}
              disabled={!draftJson || saving}
            >
              复制 JSON
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 disabled:opacity-60"
              onClick={handleDownload}
              disabled={!draftJson || saving}
            >
              下载 JSON
            </button>
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-60"
              onClick={handleCopyAndOpenEditor}
              disabled={!draftJson || saving}
            >
              复制并打开问卷编辑器
            </button>
          </div>
          {targetCard && (
            <button
              type="button"
              className="px-3 py-1.5 text-xs bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-60"
              onClick={handleReplace}
              disabled={!draftJson || saving}
            >
              {saving ? '替换中…' : '保存并替换此数据卡'}
            </button>
          )}
        </div>

        {toast && <div className="mt-3 text-xs text-green-700 bg-green-50 border border-green-200 rounded px-3 py-2">{toast}</div>}
        {error && <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

        <div className="mt-4 flex-1 overflow-hidden">
          <label className="block text-xs text-gray-500 mb-1">问卷 JSON（兼容编辑）</label>
          <textarea
            className="input-field font-mono text-xs h-full min-h-[320px] resize-none"
            value={draftJson}
            onChange={(e) => setDraftJson(e.target.value)}
            disabled={saving}
            spellCheck={false}
          />
        </div>
      </div>
    </div>
  );
}
