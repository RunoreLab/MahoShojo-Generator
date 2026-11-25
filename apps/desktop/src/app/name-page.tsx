import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useRouter } from '@tanstack/react-router';
import { serializeNameGenerationResult, type NameGenerationResult } from '@mahoshojo/domain/name-generation';
import { NamePageView } from '@mahoshojo/ui-web/name-generation';
import { useCooldown } from '@mahoshojo/ui-web/cooldown';
import { capturePngBlob, DENY_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';
import { useResultAutoScroll } from '@mahoshojo/ui-web/details-controls';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { NameSession } from '../features/name/session';
import { normalizeNameGenerationInput } from '../features/name/generation';
import { DesktopAiProviderPanel } from '../features/ai-config/desktop-ai-provider-panel';
import { useDesktopAiConfig } from '../features/ai-config/use-desktop-ai-config';
import { resolveDesktopAiTargetForState } from '../features/ai-config/desktop-ai-config';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { IpcLocalCardRepository } from '../platform/local-card-bridge';
import { downloadBlobFile, downloadTextFile } from '../platform/download-text-file';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';
import { QuestionnaireDraftPanel } from './questionnaire-draft-panel';
import { useLeaveGuard } from './useLeaveGuard';

const captureLocalImage: typeof capturePngBlob = (element, options) => capturePngBlob(element, { ...options, mediaAdapter: DENY_SNAPDOM_MEDIA });

function NameForm({ session }: { session: NameSession }) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const { state: aiState, store: aiStore } = useDesktopAiConfig();
  const target = resolveDesktopAiTargetForState(aiState, undefined, 'fixed-default');
  const [languages, setLanguages] = useState<{ code: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const { isCooldown, startCooldown, remainingTime } = useCooldown('generateMagicalGirlCooldown', 60000);
  const serverCooldown = target.location === 'server' && isCooldown;
  const exporting = useRef(false);
  const onExportingChange = useCallback((value: boolean) => { exporting.current = value; }, []);
  const resultRef = useRef<HTMLDivElement>(null);
  useResultAutoScroll(resultRef, state.card !== null, { restored: state.resultRestored });
  const guard = useLeaveGuard(
    () => exporting.current || aiStore.isPreparingGeneration() || session.isBusy() || session.hasUnsavedDraft(),
    '生成或导出尚未完成，或草稿未能保存。请等待、取消生成，或保存原文后再离开。',
    '窗口关闭保护初始化失败，生成与导出暂不可用。请重新打开页面后重试。',
    () => {
      if (exporting.current || aiStore.isPreparingGeneration() || state.saving) return false;
      if (!window.confirm(state.phase === 'generating' ? '生成尚未完成。确认终止生成并离开？未保存到草稿的内容将丢失。' : '当前内容尚未保存到本机草稿。确认放弃未保存内容并离开？')) return false;
      session.cancel();
      return true;
    },
  );
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/languages.json', { signal: controller.signal, credentials: 'omit', redirect: 'error' })
      .then(response => response.ok ? response.json() : [])
      .then(data => { if (!controller.signal.aborted && Array.isArray(data)) setLanguages(data); }).catch(() => undefined);
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const stop = () => { aiStore.cancelPreparingGeneration(); session.cancel(); };
    window.addEventListener('pagehide', stop);
    return () => { window.removeEventListener('pagehide', stop); stop(); };
  }, [aiStore, session]);
  const busy = state.phase === 'generating' || state.saving || aiState.generationActive;
  const profilesBlocked = target.profile !== null && aiState.profilesState !== 'ready';
  const generateDisabled = !guard.ready || busy || state.pendingRestore || serverCooldown || (target.location === 'client' && !target.mode) || !target.providerTarget || !!target.unavailableReason || profilesBlocked;
  const generate = () => {
    if (generateDisabled || exporting.current || session.isBusy()) return;
    try {
      const draft = session.getSnapshot().draft;
      normalizeNameGenerationInput({ realName: draft.inputName, language: draft.selectedLanguage });
      const confirmUncertain = session.getSnapshot().phase === 'uncertain';
      if (confirmUncertain && !window.confirm('上次生成是否已在服务器执行仍无法确认。再次生成会发起新请求，可能产生重复调用与费用。确认继续？')) return;
      setError(null);
      void aiStore.withPreparedGeneration(async (prepared) => {
        if (!prepared.providerTarget || (prepared.location === 'client' && !prepared.mode)) throw new Error('请选择可用的生成通道。');
        const hosted = prepared.location === 'server';
        await session.generate(
          { invoke, profileId: prepared.profile?.id ?? '', providerTarget: prepared.providerTarget,
            ...(hosted ? { onHostedDispatchSettled: (retryAfterSeconds?: number) => startCooldown(retryAfterSeconds === undefined ? 60000 : retryAfterSeconds * 1000) } : {}) },
          { realName: draft.inputName, language: draft.selectedLanguage },
          { mode: hosted ? 'hosted-json' : prepared.mode!, generationMode: 'non-stream', modelId: prepared.modelId ?? undefined, overrides: prepared.generationOverrides },
          confirmUncertain,
        );
      }, { serverPolicy: 'fixed-default' }).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'AI 配置准备失败'));
    } catch (cause) { setError(cause instanceof Error ? cause.message : '生成失败'); }
  };
  const result = (state.card as unknown as NameGenerationResult | null) ?? state.draft.lastSuccessfulResult ?? null;
  const showingPreviousResult = state.card === null && result !== null;
  const link = (href: string, label: string) => <a href={resolveInternalHrefForHashHistory(href)} className="footer-link" onClick={event => { event.preventDefault(); navigateByProductHref(router, href); }}>{label}</a>;
  return <NamePageView
    inputName={state.draft.inputName} selectedLanguage={state.draft.selectedLanguage}
    languages={languages.length ? languages : [{ code: state.draft.selectedLanguage, name: state.draft.selectedLanguage }]}
    onNameChange={inputName => session.updateDraft({ ...session.getSnapshot().draft, inputName })}
    onLanguageChange={selectedLanguage => session.updateDraft({ ...session.getSnapshot().draft, selectedLanguage })}
    onGenerate={generate} isGenerating={state.phase === 'generating'} disabled={busy || state.pendingRestore || !guard.ready} generateDisabled={generateDisabled}
    generateLabel={serverCooldown ? `冷却中 (${remainingTime}s)` : undefined}
    magicalGirl={result} resultRef={resultRef}
    captureImage={captureLocalImage} onExportingChange={onExportingChange}
    onSaveImage={(blob, result) => downloadBlobFile(`${result.name || 'magical-girl'}.png`, blob)}
    onSaveJson={result => downloadTextFile(`魔法少女_${result.name}.json`, serializeNameGenerationResult(result))}
    navigation={<><p className="subtitle text-center">或者要不要来试试 {link('/details', '奇妙妖精大调查')}？</p><div className="text-center">{link('/encyclopedia/character-generator', '百科：角色生成（/name、/details、/canshou）')}</div></>}
    configuration={<fieldset disabled={busy || state.pendingRestore} className="mb-4 min-w-0 space-y-3">
      <p className="text-sm">名字生成支持客户端直连或服务器系统默认 JSON 通道。服务器仅接收名字和语言；结果卡截图不需要立绘生成。</p>
      <DesktopAiProviderPanel generationMode="non-stream" serverPolicy="fixed-default" showConnectionTest={false} copy={{ serverOutput: { stream: '', nonStream: '系统默认 JSON' }, emptyProfilesHint: '请先配置客户端连接。', serverFootnote: '', payloadNoun: '名字' }} />
    </fieldset>}
    actions={<>
      {state.phase === 'generating' && <button className="footer-link" onClick={() => session.cancel()}>取消生成</button>}
      {aiStore.isPreparingGeneration() && <button className="footer-link" onClick={() => aiStore.cancelPreparingGeneration()}>取消准备</button>}
      <div className="mt-4 text-center">{link('/creator', '进入创作工房')}</div>
      <div className="text-center" style={{ marginTop: '2rem' }}>{link('/', '返回首页')}</div>
    </>}
    feedback={<>
      <QuestionnaireDraftPanel draftError={state.draftError} draftBlocked={session.isDraftBlocked()} busy={busy} actionClass="footer-link" onRetrySave={() => session.retryDraftSave()} />
      {session.isDraftBlocked() && <button className="footer-link" disabled={busy} onClick={() => {
        if (!busy && !exporting.current && window.confirm('清除损坏草稿并重置本页？这会删除原始损坏草稿及当前输入和结果。请先下载需要保留的结果或复制原始输出。')) session.discardDraft();
      }}>清除损坏草稿并重置本页</button>}
      {!guard.ready && !guard.message && <p role="status">正在初始化窗口关闭保护…</p>}
      {guard.message && <p role="alert">{guard.message}</p>}
      {error && <p role="alert">{error}</p>}
      {showingPreviousResult && <p role="status">下方保留的是上次成功结果，图片与 JSON 导出均使用该结果；本次生成的原始输出单独列出。</p>}
      {state.message && <p role={state.phase === 'failed' ? 'alert' : 'status'}>{state.phase === 'completed' ? '生成完成，可下载图片或 JSON。' : state.message}</p>}
      {target.location === 'client' && aiState.profilesState === 'failed' && <p role="alert">{aiState.profilesError}</p>}
    </>}
    afterResult={state.rawText && <details open={state.phase !== 'completed'}><summary>{session.executionMode() === 'hosted-json' ? '服务器原始响应（签名仅属于原数据，展示卡为未签名转换结果）' : '原始输出正文'}</summary><pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded border p-3">{state.rawText}</pre></details>}
    footer={<ProductFooter assetSource={{ baseUrl: '/' }} onNavigateInternal={href => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />}
  />;
}

export function DesktopName() {
  const [session, setSession] = useState<NameSession | null>(null);
  useEffect(() => {
    const owner = new NameSession({ storage: window.localStorage, repository: new IpcLocalCardRepository(invoke) });
    owner.restoreDraft(false);
    setSession(owner);
    const onPageHide = () => owner.cancel();
    window.addEventListener('pagehide', onPageHide);
    return () => { window.removeEventListener('pagehide', onPageHide); owner.dispose(); };
  }, []);
  return session ? <NameForm session={session} /> : <p role="status">正在准备草稿…</p>;
}
