import { useEffect, useRef, useState } from 'react';
import { NarrativeHistoryPicker, type NarrativeHistoryPickerProps } from '@mahoshojo/ui-web/narrative-history';
import type { CardRepository } from '@mahoshojo/local-library/repository';
import { importDesktopHistoryFile } from './history-import';

type Props = NarrativeHistoryPickerProps & {
  repository: CardRepository;
  scopeKey: string;
  onImported: () => void;
  onBusyChange: (busy: boolean) => void;
};

export function DesktopArenaHistoryPicker({ repository, scopeKey, onImported, onBusyChange, ...props }: Props) {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const scope = useRef({ key: scopeKey, open: props.isOpen });
  const ports = useRef({ onBusyChange, onImported }); ports.current = { onBusyChange, onImported };
  if (scope.current.key !== scopeKey || scope.current.open !== props.isOpen) {
    scope.current = { key: scopeKey, open: props.isOpen };
    pending.current?.abort();
  }
  useEffect(() => { setStatus(null); setError(null); }, [scopeKey, props.isOpen]);
  useEffect(() => () => { pending.current?.abort(); ports.current.onBusyChange(false); }, []);
  const importFile = async (file: File) => {
    if (pending.current || props.disabled || !props.isOpen) return;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); ports.current.onBusyChange(true); setError(null); setStatus(null);
    try {
      const result = await importDesktopHistoryFile(repository, file, controller.signal);
      if (controller.signal.aborted) return;
      setStatus(`${result.alreadyPresent ? '本机已保存相同历史' : '已保存到本机'}（${result.count} 条）。请在列表中选择要引用的条目。`);
      ports.current.onImported();
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '导入失败，请保留原文件后重试。');
    } finally {
      pending.current = null; setBusy(false); ports.current.onBusyChange(false);
    }
  };
  return <NarrativeHistoryPicker {...props} busy={busy} onImportFile={(file) => { void importFile(file); }}
    importLabel="导入 JSON 并保存到本机" importStatus={status} importError={error}
    importHint="支持网页端叙事历史编辑器导出的 JSON。导入会建立独立本地历史卡，不覆盖当前活动历史；关闭后仍可从本地库引用。" />;
}
