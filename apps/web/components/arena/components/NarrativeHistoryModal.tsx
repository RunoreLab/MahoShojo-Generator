'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { NarrativeHistoryEditor, type NarrativeHistoryActionResult } from '@mahoshojo/ui-web/narrative-history';
import {
  buildNarrativeHistoryCardPayload,
  extractNarrativeHistoryImportEntries,
  mergeNarrativeHistoryEntries,
  normalizeImportedNarrativeHistoryEntries,
  type NarrativeHistoryImportMode,
} from '@mahoshojo/domain/narrative-history-operations';
import type { NarrativeHistoryEntry } from '@mahoshojo/domain/arena-types';

import BattleDataModal from '@/components/BattleDataModal';
import SaveToCloudButton from '@/components/SaveToCloudButton';
import { JsonSizeIndicator } from '@/components/shared/JsonSizeIndicator';
import { formatDateTime } from '@/lib/constants';
import { downloadBlob } from '@/lib/client/blobUrl';
import { randomUUID } from '@/lib/crypto';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { useNarrativeHistoryStore } from '../stores/useNarrativeHistoryStore';

type Props = { isOpen: boolean; onClose: () => void };
const now = () => new Date().toISOString();

/** Web owns persistence, filtering, downloads and explicit cloud capabilities. */
export function NarrativeHistoryModal({ isOpen, onClose }: Props) {
  const store = useNarrativeHistoryStore();
  const { entries, lastUpdatedAt, sort } = store;
  const [showCloudImport, setShowCloudImport] = useState(false);
  const [importMode, setImportMode] = useState<NarrativeHistoryImportMode>('append');
  const [cloudBusy, setCloudBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cloudPending = useRef(false);
  const scope = useRef(0);
  const open = useRef(isOpen);
  if (open.current !== isOpen) { open.current = isOpen; scope.current += 1; }
  useEffect(() => () => { scope.current += 1; }, []);
  const historyCardData = useMemo(() => entries.length > 0
    ? buildNarrativeHistoryCardPayload(entries, lastUpdatedAt, { now }) : null, [entries, lastUpdatedAt]);

  const checkCurrent = (expected: number) => {
    if (!open.current || expected !== scope.current) throw new Error('编辑会话已切换，本次操作未写入。');
  };
  const sanitize = async ({ title, content }: { title: string; content: string }) => {
    const rawTitle = title.trim() || '未命名';
    const rawContent = content.trim();
    if (!rawContent) throw new Error('正文不能为空。');
    const [titleCheck, contentCheck] = await Promise.all([quickCheck(rawTitle), quickCheck(rawContent)]);
    return {
      title: (titleCheck.filteredText || rawTitle).trim(),
      content: (contentCheck.filteredText || rawContent).trim(),
      filtered: titleCheck.hasSensitiveWords || contentCheck.hasSensitiveWords,
    };
  };
  const create = async (input: { title: string; content: string }) => {
    const expected = scope.current;
    const next = await sanitize(input);
    checkCurrent(expected);
    const entry = useNarrativeHistoryStore.getState().appendEntry(next);
    if (!entry) throw new Error('正文不能为空。');
    setHint(next.filtered ? '已自动屏蔽敏感词后创建。' : '已创建。');
    return entry;
  };
  const update = async (id: string, input: { title: string; content: string }) => {
    const expected = scope.current;
    const original = useNarrativeHistoryStore.getState().entries.find((entry) => entry.id === id);
    const next = await sanitize(input);
    checkCurrent(expected);
    const current = useNarrativeHistoryStore.getState();
    if (!original || current.entries.find((entry) => entry.id === id) !== original) throw new Error('原条目已变更，请保留正文并重新选择。');
    current.updateEntry(id, next);
    const entry = useNarrativeHistoryStore.getState().entries.find((item) => item.id === id);
    if (!entry) throw new Error('原条目已不可用。');
    setHint(next.filtered ? '已自动屏蔽敏感词后保存。' : '已保存。');
    return entry;
  };
  const importRaw = async (raw: unknown, mode: NarrativeHistoryImportMode): Promise<NarrativeHistoryActionResult> => {
    setHint(null); setError(null);
    const expected = scope.current;
    const extracted = extractNarrativeHistoryImportEntries(raw);
    const parsed = normalizeImportedNarrativeHistoryEntries(extracted.entries, { createId: randomUUID });
    if (!parsed.length) throw new Error('未找到可用的 entries（需要包含 title/content 字段）。');
    const original = useNarrativeHistoryStore.getState().entries;
    if (mode === 'replace' && original.length && !window.confirm(`当前已有 ${original.length} 条叙事历史，导入将覆盖它们。是否继续？`)) return { cancelled: true };
    const sanitized: NarrativeHistoryEntry[] = [];
    for (let i = 0; i < parsed.length; i += 4) {
      const chunk = await Promise.all(parsed.slice(i, i + 4).map(async (entry) => {
        const next = await sanitize({ title: entry.title || '未命名战报', content: entry.content });
        return { ...entry, title: next.title.slice(0, 120), content: next.content };
      }));
      checkCurrent(expected);
      sanitized.push(...chunk.filter((entry) => entry.content.trim()));
    }
    if (!sanitized.length) throw new Error('导入内容为空，或已被过滤为空。');
    const current = useNarrativeHistoryStore.getState();
    if (mode === 'replace' && current.entries !== original) throw new Error('叙事历史已更新，请重新确认覆盖导入。');
    const nextEntries = mergeNarrativeHistoryEntries(current.entries, sanitized, mode);
    current.replaceAll(nextEntries);
    const groups = extracted.groupCount > 1 ? `（来自 ${extracted.groupCount} 组）` : '';
    return { hint: mode === 'append' ? `已追加导入 ${sanitized.length} 条${groups}，当前共 ${nextEntries.length} 条。` : `已覆盖导入 ${sanitized.length} 条${groups}。` };
  };
  const importText = (text: string, mode: NarrativeHistoryImportMode) => importRaw(JSON.parse(text), mode);
  const importCloudCard = async (payload: Record<string, unknown>) => {
    if (cloudPending.current) return;
    cloudPending.current = true; setCloudBusy(true); setError(null);
    const expected = scope.current;
    try {
      const data = payload.data && typeof payload.data === 'object' ? payload.data as Record<string, unknown> : null;
      const templateId = typeof payload.templateId === 'string' ? payload.templateId : payload.template_id;
      const versionRaw = payload.version ?? data?.version;
      const version = typeof versionRaw === 'string' ? Number.parseInt(versionRaw, 10) : versionRaw;
      const importedEntries = Array.isArray(payload.entries) ? payload.entries : data?.entries;
      if (templateId !== 'narrative-history' || version !== 1 || !Array.isArray(importedEntries)) throw new Error('这不是可识别的叙事历史数据卡（templateId/version/entries 不匹配）。');
      const result = await importRaw({ templateId, version, entries: importedEntries }, importMode);
      checkCurrent(expected);
      if (result?.cancelled) return;
      if (importMode === 'replace') setShowCloudImport(false);
      setHint(`${result?.hint ?? ''}${typeof payload._cardId === 'string' ? ` 来源数据卡 ID：${payload._cardId}。` : ''}`);
    } catch (cause) {
      if (scope.current === expected) setError(cause instanceof Error ? cause.message : '导入失败。');
    } finally { cloudPending.current = false; setCloudBusy(false); }
  };
  const exportHistory = () => {
    if (!historyCardData) return;
    downloadBlob(new Blob([JSON.stringify(historyCardData, null, 2)], { type: 'application/json' }), `叙事历史_${formatDateTime(new Date()).replace(/[:\s]/g, '-')}.json`);
  };
  return <>
    <NarrativeHistoryEditor
      isOpen={isOpen} onClose={() => { setHint(null); setError(null); onClose(); }}
      entries={entries} lastUpdatedAt={lastUpdatedAt} sort={sort} onSortChange={store.setSort}
      formatDateTime={formatDateTime} onCreate={create} onUpdate={update}
      onDelete={store.deleteEntry} onClear={store.clear} onMove={store.moveEntry} onReorder={store.reorderEntries}
      onImportText={importText} onImportFile={async (file, mode) => { const expected = scope.current; const text = await file.text(); checkCurrent(expected); return importText(text, mode); }}
      onExport={exportHistory} onBrowse={(mode) => { setImportMode(mode); setShowCloudImport(true); setError(null); }}
      busy={cloudBusy} closeBlocked={showCloudImport} externalHint={hint} externalError={error}
      confirmAction={(message) => window.confirm(message)} requestDiscard={(message) => window.confirm(message)}
      saveAction={<SaveToCloudButton data={historyCardData} cardType="history" buttonText="保存到云端"
        className="px-3 py-1.5 text-xs font-semibold text-white rounded-lg transition-colors"
        style={{ backgroundColor: '#22c55e', backgroundImage: 'linear-gradient(to right, #22c55e, #16a34a)' }} />}
      sizeIndicator={<JsonSizeIndicator data={historyCardData} warningText="⚠️ 接近云端 300KB 上限，保存/替换可能失败，请先精简数据。" />}
    />
    <BattleDataModal isOpen={isOpen && showCloudImport} onClose={() => { if (!cloudPending.current) setShowCloudImport(false); }}
      onSelectCard={(payload) => void importCloudCard(payload)} selectedType="history" selectionMode="single" titleOverride="导入叙事历史数据卡" externalError={error} />
  </>;
}
