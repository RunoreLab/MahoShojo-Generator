import { useEffect, useReducer, useState } from 'react';
import type { ReactNode } from 'react';

import type {
  PagePreferenceField,
  PagePreferencesAdapter,
} from './page-preferences';
import { resolvePagePreferenceFieldDefault } from './page-preferences';
import { formatPagePreferenceValue } from './page-fields';
import {
  SettingsCard,
  SettingsFieldRow,
  SettingsOptionButtons,
  SettingsToggle,
} from './primitives';

/**
 * 单页记忆偏好的查看/修改/重置卡片（DESK-SET-007）。
 *
 * 读写都经 `PagePreferencesAdapter`——设置页与页面共用同一个 owner 与同一
 * 份存储，不存在「设置页默认值」这种第二权威。重置只清登记的偏好字段：
 * `fields` 形态保留草稿/结果/未知字段；`blob` 形态整个键都是偏好。
 *
 * 空态与损坏态如实区分：从未写过 ≠ 损坏。空存储不是「没有设置项」——
 * 控件照常渲染，显示的是字段登记的页面生效默认（D5.1-S1-r1）；在此
 * 修改即首写：blob 直接建偏好对象，fields 经 owner 领域工厂建合法
 * 文档。损坏的 fields 形态拒绝手术（保护草稿），由用户在对应页面处理。
 */

/** 订阅 adapter 的写入/重置/跨标签页变更——触发重渲染后 `read()` 自然取到新值。 */
const useAdapterSubscription = (adapter: PagePreferencesAdapter) => {
  const [, bump] = useReducer((v: number) => v + 1, 0);
  useEffect(() => adapter.subscribe(bump), [adapter]);
};

const TextPreferenceControl = ({
  field,
  value,
  onCommit,
}: {
  field: PagePreferenceField;
  value: unknown;
  onCommit: (value: string) => boolean;
}) => {
  const [draft, setDraft] = useState(typeof value === 'string' ? value : '');
  const [error, setError] = useState<string | null>(null);
  const current = typeof value === 'string' ? value : '';

  const commit = () => {
    if (draft === current) return;
    try {
      if (!onCommit(draft.trim())) {
        setError('写入失败，存储不可用');
        return;
      }
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '值不合法');
    }
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        type="text"
        className="w-36 rounded-md border border-(--app-input-border) bg-(--app-input-bg) px-2 py-1.5 text-xs text-(--app-text)"
        value={draft}
        aria-label={field.label}
        onChange={(event) => {
          setDraft(event.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit();
        }}
      />
      {error ? <span className="text-xs text-(--app-accent-strong)">{error}</span> : null}
    </div>
  );
};

const FieldControl = ({
  field,
  value,
  adapter,
}: {
  field: PagePreferenceField;
  value: unknown;
  adapter: PagePreferencesAdapter;
}) => {
  switch (field.kind) {
    case 'boolean':
      return (
        <SettingsToggle
          ariaLabel={field.label}
          checked={value === true}
          onChange={(next) => adapter.writeField(field.key, next)}
        />
      );
    case 'select':
      return (
        <SettingsOptionButtons
          ariaLabel={field.label}
          value={typeof value === 'string' ? value : ''}
          options={field.options ?? []}
          onChange={(next) => adapter.writeField(field.key, next)}
        />
      );
    case 'text':
      return (
        <TextPreferenceControl
          field={field}
          value={value}
          onCommit={(next) => adapter.writeField(field.key, next)}
        />
      );
    case 'count':
    case 'readonly':
      return (
        <span className="text-xs text-(--app-text-muted)">
          {formatPagePreferenceValue(field, value)}
        </span>
      );
  }
};

export const PagePreferencesCard = ({
  adapter,
  pageLink,
}: {
  adapter: PagePreferencesAdapter;
  /** 宿主提供的「前往页面」链接（路由语义归宿主）。 */
  pageLink?: ReactNode;
}) => {
  useAdapterSubscription(adapter);
  // SSR 与首次客户端渲染都只显示「读取中」：localStorage 只在挂载后读，
  // 避免服务端渲染出「损坏/空」再闪成真实值的水合不一致。
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const result = mounted ? adapter.read() : ({ status: 'empty' } as const);
  const [confirming, setConfirming] = useState(false);
  const [notice, setNotice] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const handleReset = () => {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setConfirming(false);
    if (adapter.reset()) {
      setNotice({ type: 'ok', text: '已重置该页偏好。草稿与已保存结果不受影响。' });
    } else {
      setNotice({ type: 'error', text: '重置失败：无法安全解析或写入存储。' });
    }
  };

  return (
    <SettingsCard
      title={adapter.source.title}
      description={
        <>
          存储于本机 <code className="text-[11px]">{adapter.source.storageKey}</code>
          {adapter.source.scope === 'fields' ? '（草稿文档内的偏好字段）' : null}
        </>
      }
      actions={pageLink}
    >
      {!mounted ? (
        <p className="text-xs text-(--app-text-subtle)">读取中…</p>
      ) : null}
      {result.status === 'corrupted' ? (
        <p className="text-xs text-(--app-accent-strong)">
          {adapter.source.scope === 'fields'
            ? '草稿数据无法解析，为保护内容暂不可在此修改；请前往页面处理草稿。'
            : '存储内容无法解析。'}
        </p>
      ) : null}
      {mounted && result.status !== 'corrupted' ? (
        <>
          {result.status === 'empty' ? (
            <p className="text-xs text-(--app-text-subtle)">
              该页尚未写入任何偏好，以下为页面生效默认；在此修改会立即写入。
            </p>
          ) : null}
          <div className="divide-y divide-(--app-border)">
            {adapter.source.fields.map((field) => (
              <SettingsFieldRow
                key={field.key}
                label={field.label}
                description={field.description}
                control={
                  <FieldControl
                    field={field}
                    value={
                      result.status === 'ready' && field.key in result.values
                        ? result.values[field.key]
                        : resolvePagePreferenceFieldDefault(field)
                    }
                    adapter={adapter}
                  />
                }
              />
            ))}
          </div>
        </>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-3 border-t border-(--app-border) pt-3">
        <p className="text-xs text-(--app-text-subtle)">
          重置只清除该页记住的偏好，不影响回答草稿与生成结果。
        </p>
        <div className="flex items-center gap-2">
          {confirming ? (
            <button
              type="button"
              className="rounded-md px-2 py-1.5 text-xs text-(--app-text-muted) hover:text-(--app-text)"
              onClick={() => setConfirming(false)}
            >
              取消
            </button>
          ) : null}
          <button
            type="button"
            className="rounded-md border border-(--app-border) px-3 py-1.5 text-xs font-medium text-(--app-text-muted) transition hover:border-(--app-accent-strong) hover:text-(--app-accent-strong) disabled:opacity-50"
            disabled={result.status === 'empty' || result.status === 'corrupted'}
            onClick={handleReset}
          >
            {confirming ? '确认重置' : '重置该页偏好'}
          </button>
        </div>
      </div>
      {notice ? (
        <p
          className={`mt-2 text-xs ${
            notice.type === 'ok' ? 'text-(--app-text-muted)' : 'text-(--app-accent-strong)'
          }`}
          role={notice.type === 'error' ? 'alert' : 'status'}
        >
          {notice.text}
        </p>
      ) : null}
    </SettingsCard>
  );
};
