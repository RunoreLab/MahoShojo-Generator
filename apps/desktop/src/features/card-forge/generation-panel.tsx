import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { CardForgeSourceFields } from '@mahoshojo/ui-web/card-forge';
import { StreamStopButton } from '@mahoshojo/ui-web/details-controls';
import { CardLibraryModal } from '@mahoshojo/ui-web/card-library';
import { GameCardFaceDataSchema, type GameCardFaceData } from '@mahoshojo/contracts/game-card';
import { MAX_DATA_CARD_BYTES } from '@mahoshojo/domain/data-card-size';
import { stripLocalCardTransportMeta } from '@mahoshojo/local-library/digest';
import { IpcLocalCardRepository } from '../../platform/local-card-bridge';
import { useDesktopCardLibraryHost } from '../../platform/card-library-host';
import { DesktopAiProviderPanel } from '../ai-config/desktop-ai-provider-panel';
import { useDesktopAiConfig } from '../ai-config/use-desktop-ai-config';
import { resolveDesktopAiTargetForState } from '../ai-config/desktop-ai-config';
import { ForgeGenerationSession } from './session';
import { normalizeForgeGenerationInput } from './generation';

export interface ForgeGenerationPanelProps {
  disabled: boolean;
  onBusyChange: (value: boolean) => void;
  onInputDirty: () => void;
  onProviderDirtyChange: (value: boolean) => void;
  onBeforeGenerate: () => boolean;
  onGenerated: (face: GameCardFaceData, source: string) => void;
}

function ForgeGenerationForm({ session, disabled, onBusyChange, onInputDirty, onGenerated, onBeforeGenerate, onProviderDirtyChange }: ForgeGenerationPanelProps & { session: ForgeGenerationSession }) {
  const output = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const { state: ai, store } = useDesktopAiConfig();
  const host = useDesktopCardLibraryHost();
  const target = resolveDesktopAiTargetForState(ai);
  const [sourceCardJson, setSource] = useState('');
  const [customInstructions, setInstructions] = useState('');
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState('');
  const [working, setWorking] = useState(false);
  const active = useRef(false);
  const epoch = useRef(0);
  const alive = useRef(true);
  const callbacks = useRef({ onBusyChange, onGenerated, onInputDirty });
  callbacks.current = { onBusyChange, onGenerated, onInputDirty };
  useEffect(() => {
    alive.current = true;
    const stop = () => { epoch.current++; store.cancelPreparingGeneration(); session.cancel(); };
    window.addEventListener('pagehide', stop);
    return () => { alive.current = false; stop(); window.removeEventListener('pagehide', stop); };
  }, [store, session]);
  const lock = (value: boolean) => { active.current = value; callbacks.current.onBusyChange(value); if (alive.current) setWorking(value); };
  const changeSource = (value: string) => { if (active.current || disabled) return; epoch.current++; setSource(value); callbacks.current.onInputDirty(); };
  const read = async (file: File | undefined) => {
    if (!file || active.current || disabled) return;
    lock(true); const ticket = ++epoch.current; setError('');
    try {
      if (file.size > MAX_DATA_CARD_BYTES) throw new Error('源数据卡文件超过 1 MiB。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_DATA_CARD_BYTES) throw new Error('源数据卡文件超过 1 MiB。');
      const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      normalizeForgeGenerationInput({ sourceCardJson: text });
      if (!alive.current || ticket !== epoch.current) return;
      setSource(text); callbacks.current.onInputDirty();
    } catch (cause) { if (alive.current && ticket === epoch.current) setError(cause instanceof Error ? cause.message : '源卡读取失败。'); }
    finally { lock(false); }
  };
  const blocked = disabled || working || ai.generationActive;
  const unavailable = target.location !== 'client' ? '卡面生成目前仅支持客户端 Direct，请选择客户端执行及可用连接。' : target.unavailableReason;
  const generate = async () => {
    if (blocked || active.current || unavailable || !target.providerTarget || !target.mode || (target.profile && ai.profilesState !== 'ready')) return;
    const original = sourceCardJson;
    let input;
    try { input = normalizeForgeGenerationInput({ sourceCardJson, customInstructions }); } catch (cause) { setError(cause instanceof Error ? cause.message : '源卡无效。'); return; }
    if (!onBeforeGenerate()) return;
    lock(true); setError(''); const ticket = ++epoch.current;
    try {
      await store.withPreparedGeneration(async prepared => {
        if (!alive.current || ticket !== epoch.current) return;
        if (prepared.location !== 'client' || !prepared.mode || !prepared.providerTarget) throw new Error('请选择可用的客户端 Direct 连接。');
        await session.generate({ invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget }, input,
          { mode: prepared.mode, modelId: prepared.modelId ?? undefined, generationMode: 'non-stream', overrides: prepared.generationOverrides }, true);
        const result = session.getSnapshot();
        if (alive.current && ticket === epoch.current && result.phase === 'completed' && result.card) callbacks.current.onGenerated(GameCardFaceDataSchema.parse(result.card), original);
      });
    } catch (cause) { if (alive.current && ticket === epoch.current) setError(cause instanceof Error ? cause.message : 'AI 配置准备失败。'); }
    finally { lock(false); }
  };
  const cancel = () => { epoch.current++; store.cancelPreparingGeneration(); session.cancel(); };
  return <section className="card-forge-panel rounded-2xl p-5 space-y-3">
    <h2 className="text-lg font-semibold">从源数据卡生成卡面</h2>
    <p className="text-sm text-(--app-text-muted)">仅点击生成时向所选连接发送源卡与附加要求，不修改原卡；成功生成新作品不会沿用旧插图。</p>
    <fieldset disabled={blocked} className="space-y-3 min-w-0">
      <label className="block input-label">导入源数据卡（最大 1 MiB）<input aria-label="导入源数据卡" type="file" accept=".json,application/json" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; void read(file); }} /></label>
      <button type="button" className="card-forge-chip card-forge-chip-blue" onClick={() => setPicker(true)}>选择本地源卡</button>
      <CardForgeSourceFields sourceCardJson={sourceCardJson} customInstructions={customInstructions} onSourceCardJsonChange={changeSource} onCustomInstructionsChange={value => { if (!active.current && !disabled) { setInstructions(value); onInputDirty(); } }} sourcePlaceholder="粘贴角色卡 / 情景卡 JSON，不是工坊存档或已生成卡面" />
      <DesktopAiProviderPanel onDirtyChange={onProviderDirtyChange} generationMode="non-stream" showConnectionTest={false} serverUnavailableReason="工坊卡面生成尚未接入服务器。请选择客户端执行。" copy={{ serverOutput: { stream: '', nonStream: '' }, emptyProfilesHint: '请配置客户端连接。', serverFootnote: '', payloadNoun: '源数据卡' }} />
    </fieldset>
    {working ? <><StreamStopButton onClick={cancel} label="停止生成" className="w-full" /><p role="status">正在准备或生成卡面，旧作品保持不变…</p></> :
      <button type="button" className="generate-button w-full" disabled={blocked || !!unavailable || !target.providerTarget || !target.mode || !sourceCardJson.trim() || (target.profile !== null && ai.profilesState !== 'ready')} onClick={() => void generate()}>生成卡牌卡面</button>}
    {unavailable && <p role="status">{unavailable}</p>}
    {error && <p role="alert">{error}</p>}
    {!working && output.message && <p role={output.phase === 'failed' ? 'alert' : 'status'}>{output.phase === 'completed' ? '卡面已生成，请使用工坊 JSON 或 PNG 导出；源卡没有改写。' : output.message}</p>}
    {output.rawText && <details><summary>本次原始输出</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words">{output.rawText}</pre></details>}
    <CardLibraryModal host={host} isOpen={picker && !blocked} onClose={() => setPicker(false)} visibleTabs={['local']} initialTab="local" selectedType="all" allowedTypes={['character', 'scenario']} titleOverride="选择本地源数据卡" allowDeckImport={false} onSelectCard={(payload, context) => {
      if (active.current || disabled) return false;
      try { const text = JSON.stringify(stripLocalCardTransportMeta(context.rawSourceData ?? payload), null, 2); normalizeForgeGenerationInput({ sourceCardJson: text }); changeSource(text); setPicker(false); setError(''); }
      catch (cause) { setError(cause instanceof Error ? cause.message : '源卡无法读取。'); return false; }
    }} />
  </section>;
}
export function ForgeGenerationPanel(props: ForgeGenerationPanelProps) {
  const [session, setSession] = useState<ForgeGenerationSession | null>(null);
  useEffect(() => { const owner = new ForgeGenerationSession(new IpcLocalCardRepository(invoke)); setSession(owner); return () => owner.dispose(); }, []);
  return session ? <ForgeGenerationForm {...props} session={session} /> : null;
}
