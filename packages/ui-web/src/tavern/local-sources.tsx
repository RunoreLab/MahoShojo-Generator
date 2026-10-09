import { useEffect, useRef, useState } from 'react';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import type { LocalCardRecordV1 } from '@mahoshojo/local-library/record';
import type { TavernSourceSelection } from './source-selection';
import type { TavernInputFile } from './file';

const hasOriginal = (item: LocalCardRecordV1): boolean => {
  const data = item.data;
  return typeof data === 'object' && data !== null && !Array.isArray(data)
    && typeof data._tavern === 'object' && data._tavern !== null && !Array.isArray(data._tavern)
    && data._tavern.raw !== undefined;
};

/** Local-only, explicitly opened selector; it never queries a cloud library. */
export function TavernLocalSources({ repository, disabled, onSource, selection, mode = 'original' }: {
  mode?: 'original' | 'character'; repository: CardRepository; selection: TavernSourceSelection; disabled?: boolean; onSource: (file: TavernInputFile) => void;
}) {
  const accepts = (item: LocalCardRecordV1) => item.cardType === 'character' && (mode === 'character' || hasOriginal(item));
  const [items, setItems] = useState<LocalCardRecordV1[]>([]);
  const [cursor, setCursor] = useState<string>();
  const [opened, setOpened] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unreadableCount, setUnreadableCount] = useState(0);
  const lock = useRef(false);
  const alive = useRef(true);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function load(more: boolean) {
    if (lock.current || disabled) return;
    lock.current = true; setBusy(true); setError('');
    try {
      const page = await repository.list({ cardTypes: ['character'], limit: 100, ...(more && cursor ? { cursor } : {}) });
      if (!alive.current) return;
      const unreadable = 'unreadable' in page && Array.isArray(page.unreadable) ? page.unreadable.length : 0;
      setUnreadableCount((previous) => (more ? previous : 0) + unreadable);
      setItems((previous) => more ? [...previous, ...page.items.filter(accepts)] : page.items.filter(accepts));
      setCursor(page.nextCursor); setOpened(true);
    } catch { if (alive.current) setError('本地库读取失败，可重试。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  async function select(id: string) {
    if (lock.current || disabled) return;
    const token = selection.begin();
    lock.current = true; setBusy(true); setError('');
    try {
      const item = await repository.get(id);
      if (!selection.isCurrent(token) || !alive.current || disabledRef.current) return;
      if (!item || item.deletedAt !== undefined || !accepts(item)) throw new Error('unavailable');
      const bytes = new TextEncoder().encode(JSON.stringify(item.data));
      if (alive.current) onSource({ name: `${item.title}.json`, size: bytes.length, arrayBuffer: async () => bytes.buffer });
    } catch { if (alive.current && selection.isCurrent(token)) setError('该本地原件已不可用，请刷新列表。'); }
    finally { lock.current = false; if (alive.current) setBusy(false); }
  }
  return <div className="mt-4 rounded-xl border border-pink-200 bg-white/70 p-4">
    <button type="button" disabled={disabled || busy} className="text-sm font-semibold text-pink-700 disabled:opacity-50" onClick={() => void load(false)}>{mode === 'character' ? (opened ? '刷新本地角色卡' : '从本地卡库读取角色卡') : (opened ? '刷新本地酒馆原件' : '从本地卡库读取酒馆原件')}</button>
    {opened ? <div className="mt-2 grid gap-2">
      {items.map((item) => <button key={item.id} type="button" disabled={disabled || busy} className="rounded-lg border border-pink-100 p-2 text-left text-sm disabled:opacity-50" onClick={() => void select(item.id)}>{item.title}</button>)}
      {items.length === 0 ? <p className="text-xs text-gray-600">{mode === 'character' ? '本页暂无角色卡。' : '本页暂无保留 _tavern.raw 的角色卡。'}</p> : null}
      {cursor ? <button type="button" disabled={disabled || busy} className="text-sm text-pink-700" onClick={() => void load(true)}>继续查找下一页</button> : null}
    </div> : null}
    {unreadableCount > 0 ? <p role="status" className="mt-2 text-xs text-amber-800">{unreadableCount} 条本地记录暂不可读，已显示可读子集；原始数据未修改。</p> : null}
    {error ? <p role="alert" className="mt-2 text-sm text-red-700">{error}</p> : null}
  </div>;
}
