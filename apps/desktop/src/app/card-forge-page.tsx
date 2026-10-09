import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useRouter } from '@tanstack/react-router';
import { GameCardFace, ImageCropEditor, CardForgeThemeEditor, DEFAULT_IMAGE_TRANSFORM } from '@mahoshojo/ui-web/card-forge';
import { buildSafeFileName, DENY_SNAPDOM_MEDIA } from '@mahoshojo/ui-web/client';
import { ProductFooter } from '@mahoshojo/ui-web/shell';
import { type GameCardForgeRuntimeState } from '@mahoshojo/domain/card-forge-document';
import { readLocalForgeDocument, exportLocalForgeDocument, type LocalForgeSource } from '../features/card-forge/document';
import { FORGE_IMAGE_MAX_BYTES, validateForgeImage } from '../features/card-forge/local-media';
import { captureLocalForgeImage, downloadForgeBlob } from '../features/card-forge/export';
import { useExternalLinks } from '../features/external-links/external-links-provider';
import { useLeaveGuard } from './useLeaveGuard';
import { navigateByProductHref, resolveInternalHrefForHashHistory } from './hash-history-fragment';

export function DesktopCardForge() {
  const router = useRouter();
  const { openFixed } = useExternalLinks();
  const [source, setSource] = useState<LocalForgeSource | null>(null);
  const [state, setState] = useState<GameCardForgeRuntimeState | null>(null);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const markDirty = (value: boolean) => { dirtyRef.current = value; setDirty(value); };
  const setWorking = useCallback((value: boolean) => { busyRef.current = value; if (alive.current) setBusy(value); }, []);
  const guard = useLeaveGuard(
    () => busyRef.current || dirtyRef.current,
    '工坊有未导出的编辑或操作仍在进行，请完成操作或确认放弃后再离开。',
    '窗口关闭保护初始化失败，卡牌工坊暂不可用，请重新打开页面。',
    () => !busyRef.current && window.confirm('工坊编辑尚未导出，确认放弃并离开？'),
  );
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current || !guard.ready) return;
    setWorking(true); setError(''); setNotice('');
    try { await operation(); }
    catch (cause) { if (alive.current) setError(cause instanceof Error ? cause.message : '本地工坊操作失败，请重试。'); }
    finally { setWorking(false); }
  };
  const read = (file: File | undefined) => {
    if (!file || busyRef.current || !guard.ready) return;
    if (dirtyRef.current && !window.confirm('当前工坊编辑尚未导出，确认放弃并载入新文件？')) return;
    void run(async () => {
      const next = await readLocalForgeDocument(file);
      if (!alive.current) return;
      setSource(next); setState(next.state); markDirty(false);
    });
  };
  const change = (patch: Partial<GameCardForgeRuntimeState>) => {
    if (busyRef.current || !guard.ready) return;
    setState((current) => current ? { ...current, ...patch } : null); markDirty(true); setNotice('');
  };
  const upload = (file: File | undefined) => {
    if (!file || !state) return;
    void run(async () => {
      if (file.size > FORGE_IMAGE_MAX_BYTES) throw new Error('插图超过 10 MiB，请先缩小本地图片。');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const imageUrl = await validateForgeImage(bytes);
      if (!alive.current) return;
      setState((current) => current ? { ...current, imageUrl, imageSource: 'uploaded', imageTransform: DEFAULT_IMAGE_TRANSFORM } : null);
      markDirty(true);
    });
  };
  const exportJson = () => void run(async () => {
    if (!state) return;
    const json = exportLocalForgeDocument(state);
    if (!alive.current) return;
    downloadForgeBlob(new Blob([json], { type: 'application/json' }), buildSafeFileName(state.faceData.cardName, 'json', '卡牌工坊'));
    setNotice('已发起工坊 JSON 下载，请确认系统保存完成；无法获知系统保存或取消结果，离开时仍会提醒未保存的编辑。');
  });
  return <div className="magic-background-white"><div className="container !max-w-[1200px] card-forge-shell">
    <h1 className="title card-forge-title text-center">卡牌工坊</h1>
    <p className="subtitle text-center">本地卡面预览、主题色与插图裁剪</p>
    <section className="card-forge-panel rounded-2xl p-5 space-y-3">
      <label className="block">导入工坊存档 / 卡面 / 旧版元数据 JSON（最大 32 MiB）
        <input aria-label="导入卡牌 JSON" type="file" accept=".json,application/json" disabled={busy || !guard.ready}
          onChange={(event) => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; read(file); }} />
      </label>
      <p className="text-sm text-gray-600">文件只在本机处理。远程图片不会加载；插图支持静态 PNG / JPEG / WebP，最大 10 MiB、16 MP、单边 8192 像素。</p>
      {source ? <p className="text-sm">当前来源：{source.name} · {dirty ? '有未导出的编辑' : '无未导出的编辑'}</p> : null}
      {source?.warning ? <p role="status" className="text-sm text-amber-700">{source.warning}</p> : null}
      {source ? <p className="text-sm text-amber-700">工坊 JSON 是规范化编辑存档，不是原件：旧版外层元数据（如 sourceCardData、sourceCardType）与效果条目中 type / description 以外的扩展字段不写入存档；导出原始 JSON 可完整保留原始字节和未知字段。未加载的图片不会写入新存档。</p> : null}
      {busy ? <p role="status">正在处理本地文件…</p> : null}
      {error ? <p role="alert" className="text-red-700">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {guard.message ? <p role="alert">{guard.message}</p> : null}
    </section>
    {state ? <div className="grid lg:grid-cols-2 gap-6 mt-6">
      <fieldset disabled={busy || !guard.ready} className="space-y-4 min-w-0">
        <section className="card-forge-panel rounded-2xl p-5 space-y-4">
          <h2 className="text-lg font-semibold">插图</h2>
          <label>选择本地插图<input aria-label="选择本地插图" type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; upload(file);
          }} /></label>
          {state.imageUrl ? <><button type="button" className="footer-link" onClick={() => change({ imageUrl: null, imageSource: null })}>移除插图</button>
            <ImageCropEditor imageUrl={state.imageUrl} imageAspectRatio={state.imageAspectRatio} imageTransform={state.imageTransform}
              onAspectRatioChange={(imageAspectRatio) => change({ imageAspectRatio })} onTransformChange={(imageTransform) => change({ imageTransform })}
              onReset={() => change({ imageTransform: DEFAULT_IMAGE_TRANSFORM })} /></> : null}
        </section>
        <CardForgeThemeEditor color={state.faceData.themeColor} onChange={(themeColor) => change({ faceData: { ...state.faceData, themeColor } })} />
        <section className="card-forge-panel rounded-2xl p-5 space-y-3">
          <button type="button" className="generate-button" onClick={exportJson}>导出工坊 JSON（含本地插图）</button>
          <button type="button" className="footer-link block" onClick={() => void run(async () => {
            if (source) downloadForgeBlob(new Blob([source.original.slice().buffer], { type: 'application/json' }), buildSafeFileName(source.name.replace(/\.json$/i, ''), 'json', '原始卡牌'));
          })}>导出原始 JSON（完整原件）</button>
        </section>
      </fieldset>
      <section className="card-forge-panel rounded-2xl p-5">
        <GameCardFace faceData={state.faceData} imageUrl={state.imageUrl} imageAspectRatio={state.imageAspectRatio} imageTransform={state.imageTransform}
          disabled={busy || !guard.ready} canStartExport={() => !busyRef.current && guard.ready} mediaAdapter={DENY_SNAPDOM_MEDIA} logoUrl="/logo-white.svg" imageSaveMode="download"
          captureImage={captureLocalForgeImage} onExportStateChange={setWorking} onExportError={(cause) => { if (alive.current) setError(cause instanceof Error ? cause.message : 'PNG 导出失败，请重试。'); }}
          downloadImage={(blob, name) => { if (alive.current) downloadForgeBlob(blob, buildSafeFileName(name.replace(/\.png$/i, ''), 'png', '卡牌')); }} />
      </section>
    </div> : null}
    <div className="mt-8 text-center"><Link to="/" className="footer-link">返回首页</Link></div>
    <ProductFooter className="footer" assetSource={{ baseUrl: '/' }} onNavigateInternal={(href) => navigateByProductHref(router, href)} resolveInternalHref={resolveInternalHrefForHashHistory} onNavigateExternal={openFixed} />
  </div></div>;
}
