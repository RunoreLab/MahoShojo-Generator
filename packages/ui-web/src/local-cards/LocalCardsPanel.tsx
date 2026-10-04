import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';

import type { LocalCardMutation, LocalCardsActions, LocalCardsModel } from './controller';
import {
  LOCAL_CARD_TYPE_LABELS,
  describeLocalCardProvenance,
  filterLocalCards,
  previewLocalCardData,
  type LocalCardType,
} from './presentation';

export interface LocalCardsPanelProps {
  readonly model: LocalCardsModel;
  readonly actions: LocalCardsActions;
  /** 宿主的维护互斥或存储不可用时整体禁用写操作；读与浏览不受影响。 */
  readonly disabled?: boolean;
}

const PAGE_SIZE = 20;

const buttonClass =
  'min-h-11 rounded-lg border border-(--app-border-strong) px-3 py-2 text-sm hover:bg-(--app-surface-90) disabled:cursor-not-allowed disabled:opacity-50';
const dangerButtonClass =
  'min-h-11 rounded-lg bg-(--app-accent-strong) px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50';

const formatTime = (iso: string): string => new Date(iso).toLocaleString();

const CONFIRM_COPY: Record<Exclude<LocalCardMutation, 'restore'>, { title: string; body: string; confirm: string }> = {
  delete: {
    title: '移入回收站？',
    body: '移入后不再出现在列表与选卡中，可随时在回收站恢复。',
    confirm: '确认移入回收站',
  },
  purge: {
    title: '彻底删除？',
    body: '将从本机本地库移除这条记录，无法在应用内撤销。此前导出的归档文件中的副本不受影响。',
    confirm: '确认彻底删除',
  },
};

const PENDING_LABEL: Record<LocalCardMutation, string> = {
  delete: '正在移入回收站…',
  restore: '正在恢复…',
  purge: '正在彻底删除…',
};

const CardDetails = ({ record }: { record: LocalCardRecordV1 }) => {
  const preview = previewLocalCardData(record);
  return (
    <div className="mt-3 flex min-w-0 flex-col gap-2 text-sm" data-testid="local-card-details">
      <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
        <dt className="text-(--app-text-muted)">ID</dt>
        <dd className="break-all">{record.id}</dd>
        <dt className="text-(--app-text-muted)">内容摘要</dt>
        <dd className="break-all">{record.contentDigest}</dd>
        <dt className="text-(--app-text-muted)">创建</dt>
        <dd>{formatTime(record.createdAt)}</dd>
        <dt className="text-(--app-text-muted)">更新</dt>
        <dd>{formatTime(record.updatedAt)}</dd>
        {record.deletedAt !== undefined && (
          <>
            <dt className="text-(--app-text-muted)">移入回收站</dt>
            <dd>{formatTime(record.deletedAt)}</dd>
          </>
        )}
        {record.cloudRef !== undefined && (
          <>
            <dt className="text-(--app-text-muted)">线上对应</dt>
            <dd className="break-all">{record.cloudRef.cardId}（复制于 {formatTime(record.cloudRef.copiedAt)}）</dd>
          </>
        )}
      </dl>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all rounded border border-(--app-border) p-2 text-xs">
        {preview.text}
      </pre>
      {preview.truncated && <p className="text-xs text-(--app-text-subtle)">正文较长，仅显示前一部分。</p>}
    </div>
  );
};

/**
 * 共源本地数据卡列表与回收站。
 *
 * 两端 `/local-library` 挂载同一份实现；宿主只提供仓储与错误文案（`DESK-PROD-002/003`）。
 * 文案只描述真实能力：软删进入回收站且可恢复；彻底删除不可在应用内撤销。单卡导出、编辑与选卡不在
 * 这里，因此界面不提供这些入口。
 */
export const LocalCardsPanel = ({ model, actions, disabled = false }: LocalCardsPanelProps) => {
  const [query, setQuery] = useState('');
  const [cardType, setCardType] = useState<LocalCardType | ''>('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ id: string; action: 'delete' | 'purge' } | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const searchId = useId();
  const typeId = useId();

  const filtered = useMemo(() => filterLocalCards(model.records, { query, cardType }), [model.records, query, cardType]);
  const shown = filtered.slice(0, visible);
  const recycle = model.view === 'recycle';
  const writeDisabled = disabled || model.pending !== null;

  useEffect(() => { setVisible(PAGE_SIZE); }, [query, cardType, model.view]);
  useEffect(() => {
    setConfirming(null);
    setExpandedId(null);
  }, [model.view]);
  useEffect(() => {
    if (confirming !== null) cancelRef.current?.focus();
  }, [confirming]);

  const closeConfirm = (): void => {
    setConfirming(null);
    triggerRef.current?.focus();
  };

  return (
    <section
      data-testid="local-cards-panel"
      aria-labelledby="local-cards-heading"
      className="rounded-lg border border-(--app-border) bg-(--app-surface) p-4"
    >
      <header className="flex flex-col gap-1">
        <h2 id="local-cards-heading" className="text-sm font-medium">本地数据卡</h2>
        <p className="text-sm text-(--app-text-muted)">
          保存在这台设备上的数据卡。回收站中的记录仍会以“已删除”状态随整库导出保存；彻底删除后才不再包含。
        </p>
      </header>

      <div role="group" aria-label="本地数据卡视图" className="mt-3 flex gap-2">
        {(['active', 'recycle'] as const).map((view) => (
          <button
            key={view}
            type="button"
            aria-pressed={model.view === view}
            data-testid={`local-cards-view-${view}`}
            onClick={() => actions.setView(view)}
            className={`${buttonClass} ${model.view === view ? 'bg-(--app-surface-strong) font-medium' : ''}`}
          >
            {view === 'active' ? '数据卡' : '回收站'}
          </button>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label htmlFor={searchId} className="flex min-w-0 flex-col gap-1 text-sm">
          搜索
          <input
            id={searchId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="标题、类型或 ID"
            className="min-h-11 rounded-lg border border-(--app-border-strong) bg-transparent px-3"
          />
        </label>
        <label htmlFor={typeId} className="flex flex-col gap-1 text-sm">
          类型
          <select
            id={typeId}
            value={cardType}
            onChange={(event) => setCardType(event.target.value as LocalCardType | '')}
            className="min-h-11 rounded-lg border border-(--app-border-strong) bg-transparent px-3"
          >
            <option value="">全部</option>
            {(Object.keys(LOCAL_CARD_TYPE_LABELS) as LocalCardType[]).map((type) => (
              <option key={type} value={type}>{LOCAL_CARD_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </label>
        <button type="button" className={buttonClass} onClick={actions.reload} disabled={model.status === 'loading'}>
          刷新
        </button>
      </div>

      {model.pending !== null && (
        <p role="status" className="mt-3 text-sm">{PENDING_LABEL[model.pending.action]}</p>
      )}
      {model.notice !== null && <p role="status" className="mt-3 text-sm">{model.notice}</p>}
      {model.actionError !== null && (
        <p role="alert" data-testid="local-cards-action-error" className="mt-3 text-sm text-(--app-accent-strong)">
          {model.actionError}
        </p>
      )}
      {model.unreadableCount > 0 && (
        <p role="alert" data-testid="local-cards-unreadable" className="mt-3 text-sm text-(--app-accent-strong)">
          有 {model.unreadableCount} 条记录无法解析，未在此显示；它们仍保留在本地库中。
        </p>
      )}

      {model.status === 'error' ? (
        <div className="mt-3">
          <p role="alert" data-testid="local-cards-load-error" className="text-sm text-(--app-accent-strong)">
            本地库读取失败：{model.loadError}
          </p>
          <button type="button" className={`${buttonClass} mt-2`} onClick={actions.reload}>重试</button>
        </div>
      ) : model.status !== 'ready' ? (
        <p role="status" className="mt-3 text-sm text-(--app-text-muted)">正在读取本地库…</p>
      ) : filtered.length === 0 ? (
        <p data-testid="local-cards-empty" className="mt-3 text-sm text-(--app-text-muted)">
          {model.records.length > 0
            ? '没有符合条件的数据卡。'
            : recycle ? '回收站是空的。' : '本地库中还没有数据卡。'}
        </p>
      ) : (
        <>
          <p className="mt-3 text-xs text-(--app-text-subtle)">
            共 {filtered.length} 条{filtered.length > shown.length ? `，显示前 ${shown.length} 条` : ''}
          </p>
          <ul className="mt-2 flex flex-col gap-3" data-testid="local-cards-list">
            {shown.map((record) => {
              const expanded = expandedId === record.id;
              const pendingHere = model.pending?.id === record.id;
              const confirmHere = confirming?.id === record.id ? confirming : null;
              return (
                <li key={record.id} data-testid="local-card-item" className="min-w-0 rounded border border-(--app-border) p-3 text-sm">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-all font-medium">{record.title}</p>
                      <p className="text-xs text-(--app-text-muted)">
                        {LOCAL_CARD_TYPE_LABELS[record.cardType]} · {describeLocalCardProvenance(record)} ·{' '}
                        {recycle && record.deletedAt !== undefined
                          ? `移入回收站 ${formatTime(record.deletedAt)}`
                          : `更新 ${formatTime(record.updatedAt)}`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className={buttonClass}
                        aria-expanded={expanded}
                        onClick={() => setExpandedId(expanded ? null : record.id)}
                      >
                        {expanded ? '收起详情' : '详情'}
                      </button>
                      {recycle && (
                        <button
                          type="button"
                          className={buttonClass}
                          disabled={writeDisabled || confirming !== null}
                          onClick={() => actions.restore(record.id)}
                        >
                          {pendingHere && model.pending?.action === 'restore' ? '正在恢复…' : '恢复'}
                        </button>
                      )}
                      <button
                        type="button"
                        className={buttonClass}
                        disabled={writeDisabled || confirming !== null}
                        onClick={(event) => {
                          triggerRef.current = event.currentTarget;
                          setConfirming({ id: record.id, action: recycle ? 'purge' : 'delete' });
                        }}
                      >
                        {recycle ? '彻底删除…' : '移入回收站…'}
                      </button>
                    </div>
                  </div>
                  {confirmHere !== null && (
                    <div
                      role="group"
                      aria-labelledby={`local-card-confirm-${record.id}`}
                      data-testid="local-card-confirm"
                      className="mt-3 rounded-lg border border-(--app-accent-strong) p-3"
                    >
                      <p id={`local-card-confirm-${record.id}`} className="font-medium">
                        {CONFIRM_COPY[confirmHere.action].title}
                      </p>
                      <p className="mt-1 text-sm">{CONFIRM_COPY[confirmHere.action].body}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button ref={cancelRef} type="button" className={buttonClass} onClick={closeConfirm}>
                          取消
                        </button>
                        <button
                          type="button"
                          className={dangerButtonClass}
                          disabled={writeDisabled}
                          onClick={() => {
                            setConfirming(null);
                            if (confirmHere.action === 'delete') actions.remove(record.id);
                            else actions.purge(record.id);
                          }}
                        >
                          {CONFIRM_COPY[confirmHere.action].confirm}
                        </button>
                      </div>
                    </div>
                  )}
                  {expanded && <CardDetails record={record} />}
                </li>
              );
            })}
          </ul>
          {filtered.length > shown.length && (
            <button type="button" className={`${buttonClass} mt-3`} onClick={() => setVisible((value) => value + PAGE_SIZE)}>
              显示更多
            </button>
          )}
        </>
      )}
    </section>
  );
};
