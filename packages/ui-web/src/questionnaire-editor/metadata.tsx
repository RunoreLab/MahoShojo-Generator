'use client';
import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import type { EditableQuestionnaire } from '@mahoshojo/domain/questionnaire-editor';
import { DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND, QUESTIONNAIRE_LOGO_PRESETS } from '@mahoshojo/domain/questionnaire-logo';
import { sanitizeQuestionnaireLogoUrl } from '@mahoshojo/domain/questionnaire-definition';
export function QuestionnaireMetadataEditor({ value, onChange, renderLoreStats }: {
 value: EditableQuestionnaire; onChange: (patch: Partial<EditableQuestionnaire>) => void;
 renderLoreStats?: (text: string) => ReactNode;
}) {
 const { kind, questionnaireId, title, description, loreMarkdown, logoUrl, version, questions } = value;
  const setKind = (value: EditableQuestionnaire['kind']) => onChange({ kind: value });
  const setQuestionnaireId = (value: EditableQuestionnaire['questionnaireId']) => onChange({ questionnaireId: value });
  const setTitle = (value: EditableQuestionnaire['title']) => onChange({ title: value });
  const setDescription = (value: EditableQuestionnaire['description']) => onChange({ description: value });
  const setLoreMarkdown = (value: EditableQuestionnaire['loreMarkdown']) => onChange({ loreMarkdown: value });
  const setLogoUrl = (value: EditableQuestionnaire['logoUrl']) => onChange({ logoUrl: value });
  const setVersion = (value: EditableQuestionnaire['version']) => onChange({ version: value });
  const previousKind = useRef(kind);
  useEffect(() => {
    if (previousKind.current === kind) return;
    previousKind.current = kind;
    const prev = logoUrl;
    const next = (() => {
      const trimmed = prev.trim();
      const shouldAutoSwitch = trimmed === DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['magical-girl']
        || trimmed === DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND['canshou'];
      if (!shouldAutoSwitch) return prev;
      return DEFAULT_QUESTIONNAIRE_LOGO_BY_KIND[kind];
    })();
    if (next !== logoUrl) onChange({ logoUrl: next });
  }, [kind, logoUrl, onChange]);

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

  return (
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
                <label className="text-xs text-slate-500">问卷设定（Lore，可选，多行 Markdown/文本）</label>
                <textarea
                  value={loreMarkdown}
                  onChange={(e) => setLoreMarkdown(e.target.value)}
                  className="input-field mt-1 h-40 whitespace-pre-wrap"
                  placeholder="在此填写给 AI 的参考设定（例如：世界观术语、能力阶段边界、创作提示等）。"
                />
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-slate-400">
                    提示：设定会作为“参考资料”注入提示词，不会覆盖系统输出规则；内容越长越耗 Token。
                  </p>
                  {renderLoreStats?.(loreMarkdown)}
                </div>
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

  );
}
