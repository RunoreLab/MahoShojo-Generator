'use client';

import type { ReactNode } from 'react';

/** A display projection only: a directory row never claims to contain a complete record. */
export type BattleStoryDirectoryRow = {
  id: string;
  title: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
};

export type BattleStoryDirectoryProps = {
  rows: readonly BattleStoryDirectoryRow[];
  selectedId: string | null;
  onSelect(id: string): void;
  title?: ReactNode;
  loading?: boolean;
  loadingContent?: ReactNode;
  error?: ReactNode;
  emptyContent?: ReactNode;
  /** Hosts own pagination and its progress/error controls. */
  footer?: ReactNode;
  className?: string;
};

export type BattleStoryChapterDirectoryProps = BattleStoryDirectoryProps & {
  /** Total known count, not the number of currently loaded rows. */
  count?: number;
};

function DirectoryRows(props: BattleStoryDirectoryProps & { kind: 'session' | 'chapter' }) {
  const { rows, selectedId, onSelect, loading, loadingContent, error, emptyContent, footer, kind } = props;
  return (
    <>
      {loading ? <div role="status" className="text-sm text-gray-500">{loadingContent ?? '正在读取...'}</div> : null}
      {error ? <div role="alert" className="text-sm text-red-700">{error}</div> : null}
      {rows.length === 0 ? (
        !loading && !error ? <div className="text-sm text-gray-500">{emptyContent}</div> : null
      ) : (
        <div className={`${kind === 'session' ? 'max-h-[320px]' : 'max-h-[420px]'} space-y-2 overflow-y-auto pr-1`}>
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => onSelect(row.id)}
              disabled={row.disabled}
              aria-pressed={selectedId === row.id}
              className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                selectedId === row.id
                  ? kind === 'session' ? 'border-emerald-300 bg-emerald-50' : 'border-blue-300 bg-blue-50'
                  : 'border-gray-200 bg-white hover:bg-gray-50'
              }`}
            >
              <div className="text-sm font-medium text-gray-800">{row.title}</div>
              {row.description != null ? <div className="mt-1 text-xs text-gray-500">{row.description}</div> : null}
            </button>
          ))}
        </div>
      )}
      {footer}
    </>
  );
}

/** Controlled directory: new pages and rerenders never change the host's selection. */
export function BattleStorySessionDirectory(props: BattleStoryDirectoryProps) {
  return (
    <section className={props.className ?? 'rounded-2xl border border-gray-200 bg-white p-4'} aria-busy={props.loading || undefined}>
      <div className="mb-3 text-sm font-semibold text-gray-800">{props.title ?? '本地会话'}</div>
      <DirectoryRows {...props} kind="session" emptyContent={props.emptyContent ?? '本地还没有连续战报会话。'} />
    </section>
  );
}

export function BattleStoryChapterDirectory(props: BattleStoryChapterDirectoryProps) {
  const count = props.count ?? props.rows.length;
  return (
    <section className={props.className ?? 'rounded-2xl border border-gray-200 bg-white p-4'} aria-busy={props.loading || undefined}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-gray-800">{props.title ?? '章节列表'}</div>
        {count > 0 ? <div className="text-xs text-gray-500">共 {count} 章</div> : null}
      </div>
      <DirectoryRows {...props} kind="chapter" emptyContent={props.emptyContent ?? '创建首章后，这里会显示连续章节链。'} />
    </section>
  );
}

export type BattleStoryChapterIdentity = { sessionId: string; chapterId: string };

/** Only loaded state has content. Hosts must pair title/content from that exact identity. */
export type BattleStoryChapterReadViewState =
  | { status: 'unloaded' }
  | { status: 'loading'; identity: BattleStoryChapterIdentity }
  | { status: 'error'; identity: BattleStoryChapterIdentity; message: ReactNode }
  | {
    status: 'loaded';
    identity: BattleStoryChapterIdentity;
    title: ReactNode;
    content: ReactNode;
    actions?: ReactNode;
    footer?: ReactNode;
  };

export type BattleStoryChapterReaderProps = {
  state: BattleStoryChapterReadViewState;
  title?: ReactNode;
  description?: ReactNode;
  emptyContent?: ReactNode;
  loadingContent?: ReactNode;
  /** A retry control belongs to the current failed identity, supplied by the host. */
  errorActions?: ReactNode;
  className?: string;
};

/** The host supplies its real report renderer; this layer never fabricates a full chapter. */
export function BattleStoryChapterReader(props: BattleStoryChapterReaderProps) {
  const { state, title = '章节预览', description, emptyContent, loadingContent, errorActions, className } = props;
  return (
    <div
      className={className ?? 'space-y-4'}
      aria-busy={state.status === 'loading' || undefined}
      data-story-session-id={state.status === 'unloaded' ? undefined : state.identity.sessionId}
      data-story-chapter-id={state.status === 'unloaded' ? undefined : state.identity.chapterId}
      data-story-read-status={state.status}
    >
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="text-sm font-semibold text-gray-800">{state.status === 'loaded' ? state.title : title}</div>
        {description != null ? <div className="mt-1 text-xs text-gray-500">{description}</div> : null}
      </div>
      {state.status === 'unloaded' ? emptyContent : null}
      {state.status === 'loading' ? <div role="status" className="text-sm text-gray-500">{loadingContent ?? '正在读取章节...'}</div> : null}
      {state.status === 'error' ? <div role="alert" className="text-sm text-red-700">{state.message}{errorActions}</div> : null}
      {state.status === 'loaded' ? <>{state.actions}{state.content}{state.footer}</> : null}
    </div>
  );
}

export type BattleStoryActionsProps = { children: ReactNode; className?: string };

/** Actions, authorization, cooldowns and disabled reasons remain controlled by the host. */
export function BattleStoryActions({ children, className = 'flex flex-wrap gap-2' }: BattleStoryActionsProps) {
  return <div className={className}>{children}</div>;
}
