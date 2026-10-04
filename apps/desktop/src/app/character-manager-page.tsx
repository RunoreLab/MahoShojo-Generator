import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter, useSearch } from '@tanstack/react-router';
import { DataCardFieldEditor, setDataCardFieldValue } from '@mahoshojo/ui-web/card-editor';
import { MagicalGirlResultBody } from '@mahoshojo/ui-web/character-result';
import { LOCAL_CARD_TYPE_LABELS, LocalCardsPanel, useLocalCardsController, type LocalCardsHost } from '@mahoshojo/ui-web/local-cards';

import { useLeaveGuard } from './useLeaveGuard';
import {
  EDITABLE_CARD_TYPES,
  MAX_IMPORT_FILE_BYTES,
  asMagicalGirlPreview,
  draftFromRecord,
  isEditableLocalCard,
  parseImportedCard,
  saveCardDraft,
  type CardDraft,
  type LocalCardType,
  type SaveOutcome,
} from '../features/character-manager/editor';
import { IpcLocalCardRepository, describeLocalCardError } from '../platform/local-card-bridge';

const actionClass =
  'min-h-11 rounded-lg border border-(--app-border-strong) px-4 py-2 text-sm hover:bg-(--app-surface-90) disabled:cursor-not-allowed disabled:opacity-50';
const inputClass = 'min-h-11 w-full rounded-lg border border-(--app-border-strong) bg-transparent px-3 py-2 text-sm';

const snapshotOf = (draft: CardDraft): string => JSON.stringify([draft.cardType, draft.title, draft.data]);

type Notice = { readonly tone: 'status' | 'alert'; readonly text: string };

/**
 * Desktop 本地角色管理（D3.2b-2）。
 *
 * 只操作本地库：从列表“编辑”打开一条记录（`?card=<id>`），或导入/粘贴单个 JSON 数据卡。字段编辑器与
 * 本地卡列表是共源实现；保存规则见 `features/character-manager/editor`。编辑草稿只在页面内存中——有未保存
 * 修改时导航、刷新与关窗需确认放弃，不承诺重启恢复（`DESK-PROD-007/008`）。云端保存、原生性校验与敏感词
 * 检测仍只在网页版提供，本页不显示这些入口。
 */
export function DesktopCharacterManager() {
  const router = useRouter();
  const search = useSearch({ strict: false });
  const cardParam = typeof search.card === 'string' ? search.card : undefined;
  const repository = useMemo(() => new IpcLocalCardRepository((command, args) => invoke(command, args as never)), []);
  const cardsHost = useMemo<LocalCardsHost>(() => ({ store: repository, describeError: describeLocalCardError }), [repository]);
  const cards = useLocalCardsController(cardsHost);
  const [draft, setDraft] = useState<CardDraft | null>(null);
  const [baseline, setBaseline] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [replacedOriginalId, setReplacedOriginalId] = useState<string | null>(null);
  const [pasted, setPasted] = useState('');
  const titleId = useId();
  const typeId = useId();
  const pasteId = useId();

  const dirty = draft !== null && baseline !== snapshotOf(draft);
  const dirtyRef = useRef(false);
  dirtyRef.current = dirty;
  const savingRef = useRef(false);
  const loadedIdRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const guard = useLeaveGuard(
    () => savingRef.current || dirtyRef.current,
    '有尚未保存的修改，或保存仍在进行。请保存、等待完成，或确认放弃修改后再离开。',
    '窗口关闭保护初始化失败，保存暂不可用。请重新打开页面后重试。',
    () => !savingRef.current && window.confirm('有尚未保存的修改。确认放弃修改并离开？'),
  );

  const open = useCallback((next: CardDraft) => {
    setDraft(next);
    setBaseline(snapshotOf(next));
    setOutcome(null);
    setReplacedOriginalId(null);
  }, []);

  const closeEditor = useCallback(() => {
    loadedIdRef.current = null;
    setDraft(null);
    setBaseline(null);
    setOutcome(null);
    setReplacedOriginalId(null);
    cards.controller.actions.reload();
  }, [cards.controller.actions]);

  // `?card=` 是打开记录的唯一入口；切换记录时由离开保护先确认是否放弃当前修改。
  useEffect(() => {
    if (cardParam === undefined) {
      if (loadedIdRef.current !== null) closeEditor();
      return;
    }
    if (loadedIdRef.current === cardParam) return;
    loadedIdRef.current = cardParam;
    const request = ++requestRef.current;
    setLoading(true);
    setNotice(null);
    void repository.get(cardParam).then((record) => {
      if (request !== requestRef.current) return;
      if (record === null) setNotice({ tone: 'alert', text: '本地库中没有这张数据卡，它可能已被彻底删除。' });
      else if (record.deletedAt !== undefined) setNotice({ tone: 'alert', text: '这张数据卡在回收站中，恢复后才能编辑。' });
      else if (!isEditableLocalCard(record)) setNotice({ tone: 'alert', text: '本页只编辑角色与情景卡；问卷与叙事历史卡暂不支持。' });
      else {
        open(draftFromRecord(record));
        return;
      }
      loadedIdRef.current = null;
      setDraft(null);
    }).catch((cause: unknown) => {
      if (request !== requestRef.current) return;
      loadedIdRef.current = null;
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
  }, [cardParam, closeEditor, open, repository]);

  const openRecord = (id: string) => {
    void router.navigate({ to: '/character-manager', search: { card: id } });
  };
  const leaveEditor = () => {
    if (cardParam !== undefined) {
      void router.navigate({ to: '/character-manager', search: {} });
      return;
    }
    if (dirty && !window.confirm('有尚未保存的修改。确认放弃修改？')) return;
    closeEditor();
  };

  const importText = (text: string) => {
    const parsed = parseImportedCard(text);
    if (!parsed.ok) {
      setNotice({ tone: 'alert', text: parsed.error });
      return;
    }
    setNotice({ tone: 'status', text: '已载入数据卡，尚未保存到本地库。' });
    open(parsed.draft);
  };

  const save = async () => {
    if (draft === null || savingRef.current || !guard.ready) return;
    savingRef.current = true;
    setSaving(true);
    setNotice(null);
    let savedId: string | null = null;
    try {
      const result = await saveCardDraft(repository, draft);
      setOutcome(result);
      if (result.kind === 'updated' || result.kind === 'created') {
        const saved = { ...draft, original: result.record, title: result.record.title };
        if (result.kind === 'created' && draft.original !== null) setReplacedOriginalId(draft.original.id);
        loadedIdRef.current = result.record.id;
        // 同步清掉未保存标记：随后的 URL 替换不该被离开保护当成“放弃修改”。
        dirtyRef.current = false;
        setDraft(saved);
        setBaseline(snapshotOf(saved));
        cards.controller.actions.reload();
        savedId = result.record.id;
      }
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    // 保存结束后才替换 URL：保存在途时离开保护会（正确地）拦下任何导航。
    if (savedId !== null && cardParam !== savedId) {
      void router.navigate({ to: '/character-manager', search: { card: savedId }, replace: true });
    }
  };

  const restoreFromRecycleBin = async (id: string) => {
    try {
      await repository.restore(id);
      cards.controller.actions.reload();
      // 恢复的就是当前正文（同一摘要），直接打开恢复后的记录，不再把草稿当成待放弃的修改。
      dirtyRef.current = false;
      openRecord(id);
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    }
  };

  const moveOriginalToRecycleBin = async (id: string) => {
    try {
      await repository.delete(id);
      setReplacedOriginalId(null);
      setNotice({ tone: 'status', text: '原记录已移入回收站，可在本地库恢复。' });
      cards.controller.actions.reload();
    } catch (cause) {
      setNotice({ tone: 'alert', text: describeLocalCardError(cause) });
    }
  };

  const preview = draft === null ? null : asMagicalGirlPreview(draft);

  return (
    <section data-testid="page-character-manager" className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold">角色管理</h1>
        <p className="text-sm text-(--app-text-muted)">
          编辑本地库中的角色与情景卡，或导入单个 JSON 数据卡。不需要账号，也不会访问项目服务器；云端保存、原生性校验与敏感词检测目前只在网页版提供。
        </p>
      </header>
      {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
      {guard.message && <p role="alert">{guard.message}</p>}
      {notice && <p role={notice.tone} className="text-sm">{notice.text}</p>}
      {loading && <p role="status" className="text-sm">正在读取本地数据卡…</p>}

      {draft === null ? (
        <>
          <section className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4" aria-labelledby="character-import-heading">
            <h2 id="character-import-heading" className="text-sm font-medium">导入单个数据卡</h2>
            <p className="mt-1 text-sm text-(--app-text-muted)">
              选择 .json 文件或粘贴内容。载入后可先编辑，确认保存后才写入本地库；同内容的卡不会重复保存。
            </p>
            <input
              type="file"
              accept=".json,application/json"
              aria-label="选择数据卡 JSON 文件"
              className="mt-3 block text-sm"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > MAX_IMPORT_FILE_BYTES) {
                  setNotice({ tone: 'alert', text: '文件超过单张数据卡的大小上限（4 MiB）。' });
                  return;
                }
                void file.text().then(importText, () => setNotice({ tone: 'alert', text: '读取文件失败，请重试。' }));
              }}
            />
            <label htmlFor={pasteId} className="mt-3 block text-sm">或粘贴 JSON</label>
            <textarea id={pasteId} value={pasted} onChange={(event) => setPasted(event.target.value)} rows={5} className={inputClass} />
            <button type="button" className={`${actionClass} mt-2`} disabled={pasted.trim() === ''} onClick={() => importText(pasted)}>
              从文本载入
            </button>
          </section>
          <LocalCardsPanel
            model={cards.model}
            actions={cards.controller.actions}
            onEdit={(record) => openRecord(record.id)}
            canEdit={isEditableLocalCard}
          />
        </>
      ) : (
        <section className="flex flex-col gap-4 rounded-lg border border-(--app-border) bg-(--app-surface) p-4" aria-labelledby="character-editor-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="character-editor-heading" className="text-base font-semibold">
              {draft.original === null ? '编辑导入的数据卡' : `编辑：${draft.original.title}`}
            </h2>
            <span className="text-xs text-(--app-text-muted)">
              {draft.original === null ? '尚未保存到本地库' : '本地库记录'}{dirty ? ' · 有未保存的修改' : ''}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr,auto]">
            <label htmlFor={titleId} className="flex flex-col gap-1 text-sm">
              记录标题
              <input id={titleId} value={draft.title} maxLength={512} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className={inputClass} />
            </label>
            <label htmlFor={typeId} className="flex flex-col gap-1 text-sm">
              类型
              <select
                id={typeId}
                value={draft.cardType}
                onChange={(event) => setDraft({ ...draft, cardType: event.target.value as LocalCardType })}
                className={inputClass}
              >
                {EDITABLE_CARD_TYPES.map((type) => <option key={type} value={type}>{LOCAL_CARD_TYPE_LABELS[type]}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-(--app-text-muted)">
            标题不影响内容身份。修改正文会另存为一条新记录，原记录保留；正文中已有的签名字段原样保存，本机不校验签名，新记录标记为无签名。
          </p>
          <DataCardFieldEditor
            data={draft.data}
            onFieldChange={(path, value) => setDraft((current) => (current === null ? current : { ...current, data: setDataCardFieldValue(current.data, path, value) }))}
          />
          {preview !== null && (
            <details>
              <summary className="cursor-pointer text-sm font-medium">角色正文预览</summary>
              <div className="mt-2"><MagicalGirlResultBody magicalGirl={preview} /></div>
            </details>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={actionClass}
              disabled={!guard.ready || saving || (draft.original !== null && !dirty)}
              onClick={() => void save()}
            >
              {saving ? '正在保存…' : '保存到本地库'}
            </button>
            <button type="button" className={actionClass} disabled={saving} onClick={leaveEditor}>
              {dirty ? '放弃修改并关闭' : '关闭'}
            </button>
          </div>
          {outcome?.kind === 'unchanged' && <p role="status" className="text-sm">没有需要保存的修改。</p>}
          {outcome?.kind === 'updated' && <p role="status" className="text-sm">已更新本地库中的记录。</p>}
          {outcome?.kind === 'created' && (
            <div role="status" className="text-sm">
              <p>{replacedOriginalId === null ? '已保存到本地库。' : '正文已改变，已另存为一条新记录；原记录仍在本地库。'}</p>
              {replacedOriginalId !== null && (
                <button type="button" className={`${actionClass} mt-2`} onClick={() => void moveOriginalToRecycleBin(replacedOriginalId)}>
                  将原记录移入回收站
                </button>
              )}
            </div>
          )}
          {outcome?.kind === 'exists' && (
            <div role="status" className="text-sm">
              <p>本地库已有内容相同的记录，未重复保存。</p>
              <button type="button" className={`${actionClass} mt-2`} onClick={() => openRecord(outcome.id)}>打开已有记录</button>
            </div>
          )}
          {outcome?.kind === 'in-recycle-bin' && (
            <div role="status" className="text-sm">
              <p>内容相同的记录在回收站中。保存不会自动恢复它。</p>
              <button type="button" className={`${actionClass} mt-2`} onClick={() => void restoreFromRecycleBin(outcome.id)}>
                从回收站恢复并打开
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
