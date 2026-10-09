'use client';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildEditableQuestionnaire, createEmptyQuestion, importEditableQuestionnaire, type EditableQuestionnaire } from '@mahoshojo/domain/questionnaire-editor';
import { readQuestionnaireJsonFile } from './file';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import { QuestionnaireMetadataEditor } from './metadata';
import { QuestionnaireQuestionsEditor } from './questions';

export interface LocalQuestionnairePanelProps {
  repository: CardRepository;
  saveCard: (data: Record<string, unknown>, title: string) => Promise<'saved' | 'already-present'>;
  downloadText: (text: string, name: string) => void | Promise<void>;
  confirmReplace: () => boolean;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDirtyChange?: (dirty: boolean) => void;
}
const createInitial = (): EditableQuestionnaire => ({ kind: 'magical-girl', questionnaireId: 'magical-girl-custom', title: '未命名问卷', description: '', loreMarkdown: '', logoUrl: '/questionnaire-logo.svg', version: '', extensions: {}, questions: [createEmptyQuestion(0, 'magical-girl', 'initial-1')] });

/** Local host controller. Cloud library, replacement and moderation stay in the Web host. */
export function LocalQuestionnairePanel({ repository, saveCard, downloadText, confirmReplace, disabled, onBusyChange, onDirtyChange }: LocalQuestionnairePanelProps) {
  const [editor, setEditor] = useState(createInitial);
  const [paste, setPaste] = useState('');
  const [source, setSource] = useState<{ text: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<LocalCardRecordV1[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [opened, setOpened] = useState(false);
  const [unreadable, setUnreadable] = useState(0);
  const snapshot = JSON.stringify(editor);
  const [savedSnapshot, setSavedSnapshot] = useState(snapshot);
  const dirty = snapshot !== savedSnapshot || !!paste.trim();
  const lock = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useLayoutEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);
  const { questionnaireData, jsonError } = useMemo(() => buildEditableQuestionnaire(editor), [editor]);
  const json = useMemo(() => JSON.stringify(questionnaireData, null, 2), [questionnaireData]);
  const blocked = disabled || busy;
  async function run(action: () => Promise<void>) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError(''); setStatus(''); onBusyChange?.(true);
    try { await action(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { lock.current = false; onBusyChange?.(false); if (alive.current) setBusy(false); }
  }
  function changed() { setStatus(''); setError(''); }
  function apply(text: string, name: string) {
    const next = importEditableQuestionnaire(text, editor.kind);
    if (!alive.current) return;
    setEditor(next); setSource({ text, name }); setPaste(''); setStatus('已载入。编辑导出会规范化字段；原始来源可单独下载。');
  }
  function canReplace(includePaste = true) { return !(snapshot !== savedSnapshot || (includePaste && paste.trim())) || confirmReplace(); }
  async function loadLibrary(more: boolean) {
    await run(async () => {
      const page = await repository.list({ cardTypes: ['questionnaire'], limit: 100, ...(more && cursor ? { cursor } : {}) });
      if (!alive.current) return;
      const count = 'unreadable' in page && Array.isArray(page.unreadable) ? page.unreadable.length : 0;
      setUnreadable((prev) => (more ? prev : 0) + count);
      const accepted = page.items.filter((item) => item.cardType === 'questionnaire' && item.deletedAt === undefined);
      setItems((prev) => more ? [...prev, ...accepted] : accepted); setCursor(page.nextCursor); setOpened(true);
    });
  }
  return <div className="mt-6">
    <p className="text-sm text-slate-600">编辑本地问卷，条件与跳题沿用 Web 编辑器。保存为新的未签名问卷，nativeAllowed 固定为 false；不会覆盖来源卡或上传云端。</p>
    <p className="mt-2 text-xs text-amber-800">当前编辑与粘贴仅保留在本页，尚未自动保存草稿。请先保存到本地卡库；下载仅发起文件下载，请自行确认文件已落盘。</p>
    <fieldset disabled={blocked} className="min-w-0 border-0 p-0 disabled:opacity-70">
      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <h2 className="text-lg font-semibold">导入现有问卷</h2>
        <p className="mt-1 text-xs text-slate-500">JSON 最多 1 MiB。载入新来源前会询问是否放弃未保存的编辑；失败保留当前内容。</p>
        <label className="mt-3 block"><span className="text-xs">上传问卷 JSON</span><input aria-label="上传问卷 JSON" type="file" accept="application/json,.json" className="input-field" onChange={(event) => {
          const file = event.currentTarget.files?.[0]; event.currentTarget.value = '';
          if (!file || !canReplace()) return;
          void run(async () => {
            const text = await readQuestionnaireJsonFile(file);
            if (!alive.current) return;
            setPaste(text); apply(text, file.name);
          });
        }} /></label>
        <label className="mt-3 block"><span className="text-xs">粘贴问卷 JSON</span><textarea aria-label="粘贴问卷 JSON" value={paste} onChange={(event) => { changed(); setPaste(event.target.value); }} className="input-field h-28 font-mono text-xs" /></label>
        <button type="button" className="generate-button mt-2 mb-0" disabled={!paste.trim()} onClick={() => { if (canReplace(false)) void run(async () => apply(paste, '粘贴问卷.json')); }}>应用粘贴内容</button>
        <div className="mt-4"><button type="button" className="footer-link" onClick={() => void loadLibrary(false)}>{opened ? '刷新本地问卷库' : '打开本地问卷库'}</button></div>
        {opened ? <div className="mt-2 grid gap-2">
          {items.map((item) => <button type="button" key={item.id} className="rounded border border-slate-200 bg-white p-2 text-left text-sm" onClick={() => {
            if (!canReplace()) return;
            void run(async () => {
              const current = await repository.get(item.id);
              if (!alive.current) return;
              if (!current || current.deletedAt !== undefined || current.cardType !== 'questionnaire') throw new Error('问卷已不可用，请刷新本地库。');
              apply(JSON.stringify(current.data), `${current.title}.json`);
            });
          }}>{item.title}</button>)}
          {!items.length ? <p className="text-xs">本页暂无问卷卡</p> : null}
          {cursor ? <button type="button" onClick={() => void loadLibrary(true)}>继续查找下一页</button> : null}
          {unreadable ? <p role="status">{unreadable} 条记录暂不可读，已显示可读子集，原件未修改</p> : null}
        </div> : null}
      </div>
      <QuestionnaireMetadataEditor value={editor} onChange={(patch) => { changed(); setEditor((prev) => ({ ...prev, ...patch })); }} />
      <QuestionnaireQuestionsEditor questions={editor.questions} setQuestions={(update) => { changed(); setEditor((prev) => ({ ...prev, questions: typeof update === 'function' ? update(prev.questions) : update })); }} kind={editor.kind} />
      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" className="generate-button mb-0 md:w-auto" disabled={!!jsonError} onClick={() => void run(async () => {
          const result = await saveCard(JSON.parse(json) as Record<string, unknown>, editor.title.trim() || '未命名问卷');
          if (alive.current) { setSavedSnapshot(snapshot); setStatus(result === 'saved' ? '已另存为本地未签名问卷。' : '相同内容已在本地库，未覆盖已有记录。'); }
        })}>另存到本地问卷库</button>
        <button type="button" className="footer-link" disabled={!!jsonError} onClick={() => void run(async () => { await downloadText(json, editor.title || '问卷'); if (alive.current) setStatus('已发起下载，请确认保存位置。'); })}>下载编辑 JSON</button>
        {source ? <button type="button" className="footer-link" onClick={() => void run(async () => { await downloadText(source.text, `原始来源-${source.name}`); if (alive.current) setStatus('已发起原始来源下载；其中的签名或原生声明未作验证。'); })}>下载原始来源</button> : null}
      </div>
    </fieldset>
    {(error || jsonError) ? <p role="alert" className="mt-3 text-sm text-rose-700">{error || jsonError}</p> : null}
    {status ? <p role="status" className="mt-3 text-sm text-emerald-800">{status}</p> : null}
    <details className="mt-4" open><summary>编辑 JSON 预览</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-xs">{json}</pre></details>
  </div>;
}
