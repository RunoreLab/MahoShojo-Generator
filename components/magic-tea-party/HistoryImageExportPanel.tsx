'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import { MarkdownBlock } from '@/components/MarkdownBlock';
import { GeneratedByUserBadge } from '@/components/shared/GeneratedByUserBadge';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { createBlobUrl, downloadBlob, revokeBlobUrl } from '@/lib/client/blobUrl';
import { buildSafeFileName } from '@/lib/client/fileName';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import type { MagicTeaPartyMessage, MagicTeaPartyPreferences, MagicTeaPartySession } from '@/lib/magic-tea-party/types';

type SaveMode = 'download' | 'modal';
type LayoutPreset = 'mobile' | 'desktop';
type RangeMode = 'recent' | 'all' | 'manual';

type Props = {
  activeSession: MagicTeaPartySession | null;
  preferences: MagicTeaPartyPreferences;
  messages: MagicTeaPartyMessage[];
  outputView: 'raw' | 'rendered';
  isGenerating: boolean;
};

const EXPORT_WIDTH: Record<LayoutPreset, number> = {
  mobile: 720,
  desktop: 960,
};

function detectDefaultSaveMode(): SaveMode {
  if (typeof window === 'undefined') return 'download';
  return /Mobi/i.test(window.navigator.userAgent) ? 'modal' : 'download';
}

function detectDefaultLayoutPreset(): LayoutPreset {
  if (typeof window === 'undefined') return 'desktop';
  return /Mobi/i.test(window.navigator.userAgent) ? 'mobile' : 'desktop';
}

function resolveDefaultRecentCount(preset: LayoutPreset): number {
  return preset === 'mobile' ? 12 : 24;
}

const getSpeakerNameFromRole = (session: MagicTeaPartySession | null, roleId: string): string => {
  const roles = session?.roles ?? [];
  const match = roles.find((role) => role.id === roleId);
  return match?.name || roleId;
};

const getAssistantPrefix = (session: MagicTeaPartySession | null): string => {
  const presetId = session?.settings?.presetId || '';
  const prefix = presetId.startsWith('arena-') ? 'A.R.E.N.A. 魔法茶会' : '魔法茶会';
  return `${prefix} · 叙述者`;
};

const resolveSpeakerLabel = (
  message: MagicTeaPartyMessage,
  session: MagicTeaPartySession | null,
  preferences: MagicTeaPartyPreferences
): string => {
  const metaSpeakerName =
    message.meta && typeof message.meta === 'object' && typeof (message.meta as any).speakerName === 'string'
      ? String((message.meta as any).speakerName).trim()
      : '';
  if (metaSpeakerName) return metaSpeakerName;

  if (message.role === 'system') return 'system';
  if (message.role === 'assistant') return getAssistantPrefix(session);

  const userDisplayName = (session?.settings.userDisplayName || preferences.userDisplayName || '旅人').trim() || '旅人';
  if (message.speakerId) return getSpeakerNameFromRole(session, message.speakerId);
  return userDisplayName;
};

const formatDateTime = (ms: number): string => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '';
  try {
    return new Date(ms).toLocaleString('zh-CN');
  } catch {
    return '';
  }
};

const buildPlainTextPreview = (message: MagicTeaPartyMessage, session: MagicTeaPartySession | null): string => {
  const segments = Array.isArray(message.segments) ? message.segments : null;
  if (segments && segments.length > 0) {
    const lines: string[] = [];
    for (const seg of segments) {
      if (!seg) continue;
      if (seg.type === 'narration') {
        const text = typeof seg.text === 'string' ? seg.text.trim() : '';
        if (text) lines.push(text);
        continue;
      }
      if (seg.type === 'dialogue') {
        const name = (seg.speakerName || getSpeakerNameFromRole(session, seg.speakerId)).trim();
        const text = typeof seg.text === 'string' ? seg.text.trim() : '';
        if (text) lines.push(name ? `${name}: ${text}` : text);
        continue;
      }
      if (seg.type === 'choices') {
        const items = Array.isArray(seg.items) ? seg.items : [];
        const first = items[0]?.text?.trim() ?? '';
        if (first) lines.push(`选项：${first}`);
        continue;
      }
    }
    return lines.join('\n').trim();
  }
  return (message.content ?? '').trim();
};

const buildExportFileName = (sessionTitle: string): string => {
  const date = new Date();
  const stamp = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
    '_',
    String(date.getHours()).padStart(2, '0'),
    String(date.getMinutes()).padStart(2, '0'),
  ].join('');
  const base = `魔法茶会_${sessionTitle || '对话'}_${stamp}`;
  return buildSafeFileName(base, 'png', 'magic-tea-party');
};

export function MagicTeaPartyHistoryImageExportPanel(props: Props) {
  const { activeSession, preferences, messages, outputView, isGenerating } = props;
  const [collapsed, setCollapsed] = useState(true);
  const [rangeMode, setRangeMode] = useState<RangeMode>('recent');
  const [recentCount, setRecentCount] = useState(24);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('desktop');
  const [saveMode, setSaveMode] = useState<SaveMode>('download');
  const [includeSystem, setIncludeSystem] = useState(false);
  const [showTimestamps, setShowTimestamps] = useState(false);
  const [manualSelected, setManualSelected] = useState<string[]>([]);
  const [captureBusy, setCaptureBusy] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [exportedAt, setExportedAt] = useState<string>('');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);

  const exportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setLayoutPreset(detectDefaultLayoutPreset());
    setSaveMode(detectDefaultSaveMode());
  }, []);

  useEffect(() => {
    const preset = detectDefaultLayoutPreset();
    setLayoutPreset(preset);
    setRecentCount(resolveDefaultRecentCount(preset));
    setRangeMode('recent');
    setManualSelected([]);
    setCaptureError(null);
    setExportedAt('');
  }, [activeSession?.id]);

  const visibleMessages = useMemo(() => {
    return messages.filter((message) => {
      if (!includeSystem && message.role === 'system') return false;
      const meta = message.meta && typeof message.meta === 'object' ? (message.meta as Record<string, unknown>) : null;
      return !meta || meta.noticeSuppressed !== true;
    });
  }, [includeSystem, messages]);

  const manualCandidate = useMemo(() => {
    const max = 200;
    if (visibleMessages.length <= max) return { list: visibleMessages, truncated: false, hiddenCount: 0 };
    return { list: visibleMessages.slice(-max), truncated: true, hiddenCount: visibleMessages.length - max };
  }, [visibleMessages]);

  const selectedMessages = useMemo(() => {
    if (rangeMode === 'all') return visibleMessages;
    if (rangeMode === 'recent') {
      const cap = Math.max(1, Math.min(visibleMessages.length, Math.floor(recentCount || 1)));
      return visibleMessages.slice(-cap);
    }
    const set = new Set(manualSelected);
    return visibleMessages.filter((message) => set.has(message.id));
  }, [manualSelected, rangeMode, recentCount, visibleMessages]);

  const exportTitle = activeSession?.title?.trim() || '未命名会话';
  const exportWidth = EXPORT_WIDTH[layoutPreset];

  const handleQuickSelectRecent = (count: number) => {
    const cap = Math.max(1, Math.min(visibleMessages.length, Math.floor(count || 1)));
    const ids = visibleMessages.slice(-cap).map((m) => m.id);
    setManualSelected(ids);
  };

  const handleToggleManualId = (id: string) => {
    setManualSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return Array.from(next);
    });
  };

  const handleStartExport = async () => {
    if (!activeSession) {
      setCaptureError('请先选择一个会话。');
      return;
    }
    if (!exportRef.current) return;
    if (selectedMessages.length === 0) {
      setCaptureError('没有可保存的对话条目，请调整范围或勾选条目。');
      return;
    }
    if (isGenerating) {
      setCaptureError('正在生成中，建议停止生成后再保存图片。');
      return;
    }

    setCaptureBusy(true);
    setCaptureError(null);

    try {
      setExportedAt(new Date().toLocaleString('zh-CN'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      const blob = await capturePngBlob(exportRef.current, { scale: 1, dprMax: 2, fast: false });
      const filename = buildExportFileName(exportTitle);

      if (saveMode === 'modal') {
        const url = createBlobUrl(blob);
        setImageUrl((prev) => {
          revokeBlobUrl(prev);
          return url;
        });
        setShowImageModal(true);
        return;
      }

      downloadBlob(blob, filename);
    } catch (err) {
      const raw = err instanceof Error ? err.message : '';
      const hint = raw.includes('canvas') || raw.includes('dimensions') ? '图片太长或内容过多，建议减少保存条目后重试。' : '';
      setCaptureError(hint || raw || '生成图片失败，请重试。');
      console.error('MagicTeaParty export image failed:', err);
    } finally {
      setCaptureBusy(false);
    }
  };

  const summaryLine = activeSession
    ? `当前会话：${exportTitle} · 可见消息 ${visibleMessages.length} 条`
    : '尚未选择会话。';
  const quickRangeLabel =
    rangeMode === 'all'
      ? `全部 ${selectedMessages.length} 条`
      : rangeMode === 'manual'
        ? `已选 ${selectedMessages.length} 条`
        : `最近 ${selectedMessages.length} 条`;

  return (
    <>
      <div className="rounded-xl border border-pink-100 bg-white p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold text-gray-800">保存对话为图片</div>
          <button
            type="button"
            className="text-xs text-pink-700 hover:underline"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            {collapsed ? '展开' : '收起'}
          </button>
        </div>

        {collapsed ? (
          <div className="space-y-2 text-xs text-gray-500">
            <div>可将魔法茶会对话保存为长图分享：电脑端建议直接下载；手机端建议生成后长按保存。</div>
            <div>{summaryLine}</div>
            {activeSession && visibleMessages.length > 0 ? (
              <button
                type="button"
                className="w-full rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700 hover:bg-pink-50 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleStartExport()}
                disabled={captureBusy || isGenerating}
              >
                {saveMode === 'modal'
                  ? `快速生成图片（${quickRangeLabel} · 预览后长按保存）`
                  : `快速生成图片（${quickRangeLabel} · 直接下载）`}
              </button>
            ) : null}
            {captureBusy ? <div className="text-xs text-gray-500">正在生成图片…</div> : null}
            {captureError ? <div className="text-xs text-red-600">{captureError}</div> : null}
          </div>
        ) : (
          <>
            <div className="text-xs text-gray-500">支持保存全部对话、最近 N 条或手动勾选对话条目。</div>
            <div className="rounded-lg border border-pink-100 bg-pink-50/60 px-3 py-2 text-xs text-gray-600">
              {summaryLine}
              <div className="mt-1 text-[11px] text-gray-500">将会按照当前对话视图保存：{outputView === 'raw' ? '原始' : '渲染'}内容。</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-600">保存方式</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className={[
                      'rounded-lg border px-3 py-1.5',
                      saveMode === 'download' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                    ].join(' ')}
                    onClick={() => setSaveMode('download')}
                  >
                    直接下载（电脑推荐）
                  </button>
                  <button
                    type="button"
                    className={[
                      'rounded-lg border px-3 py-1.5',
                      saveMode === 'modal' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                    ].join(' ')}
                    onClick={() => setSaveMode('modal')}
                  >
                    长按保存（手机推荐）
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <div className="text-xs font-semibold text-gray-600">保存版式</div>
                <div className="flex flex-wrap gap-2 text-xs">
                  <button
                    type="button"
                    className={[
                      'rounded-lg border px-3 py-1.5',
                      layoutPreset === 'mobile' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                    ].join(' ')}
                    onClick={() => setLayoutPreset('mobile')}
                  >
                    竖版（手机）
                  </button>
                  <button
                    type="button"
                    className={[
                      'rounded-lg border px-3 py-1.5',
                      layoutPreset === 'desktop' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                    ].join(' ')}
                    onClick={() => setLayoutPreset('desktop')}
                  >
                    宽版（电脑）
                  </button>
                </div>
                <div className="text-[11px] text-gray-500">导出宽度：{exportWidth}px（长图高度随条目数量增长）。</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-xs font-semibold text-gray-600">保存范围</div>
              <div className="flex flex-wrap gap-2 text-xs">
                <button
                  type="button"
                  className={[
                    'rounded-lg border px-3 py-1.5',
                    rangeMode === 'all' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  onClick={() => setRangeMode('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={[
                    'rounded-lg border px-3 py-1.5',
                    rangeMode === 'recent' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  onClick={() => setRangeMode('recent')}
                >
                  最近 N 条
                </button>
                <button
                  type="button"
                  className={[
                    'rounded-lg border px-3 py-1.5',
                    rangeMode === 'manual' ? 'border-gray-900 bg-gray-900 text-white' : 'bg-white hover:bg-gray-50',
                  ].join(' ')}
                  onClick={() => {
                    if (rangeMode !== 'manual') {
                      setManualSelected(selectedMessages.map((m) => m.id));
                    }
                    setRangeMode('manual');
                  }}
                >
                  手动勾选
                </button>
              </div>

              {rangeMode === 'recent' ? (
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-xs text-gray-600">
                    N：
                    <input
                      type="number"
                      min={1}
                      max={Math.max(1, visibleMessages.length)}
                      className="ml-2 w-20 rounded-lg border border-pink-200 bg-white px-2 py-1 text-xs text-gray-800"
                      value={String(recentCount)}
                      onChange={(event) => {
                        const next = Number(event.target.value);
                        const safe = Number.isFinite(next) ? Math.max(1, Math.min(9999, Math.floor(next))) : 1;
                        setRecentCount(safe);
                      }}
                    />
                  </label>
                  <div className="text-[11px] text-gray-500">已选 {selectedMessages.length} 条。</div>
                </div>
              ) : null}

              {rangeMode === 'manual' ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <button
                      type="button"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                      onClick={() => setManualSelected(visibleMessages.map((m) => m.id))}
                    >
                      全选
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                      onClick={() => handleQuickSelectRecent(recentCount)}
                    >
                      最近 {recentCount} 条
                    </button>
                    <button
                      type="button"
                      className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-gray-700 hover:bg-gray-50"
                      onClick={() => setManualSelected([])}
                    >
                      清空
                    </button>
                    <div className="text-[11px] text-gray-500">已选 {selectedMessages.length} 条。</div>
                  </div>

                  {manualCandidate.truncated ? (
                    <div className="text-[11px] text-amber-700">
                      条目较多，仅展示最近 {manualCandidate.list.length} 条供勾选（更早 {manualCandidate.hiddenCount} 条未展示）。
                    </div>
                  ) : null}

                  <div className="max-h-56 overflow-y-auto rounded-lg border border-pink-100 bg-white p-2">
                    <div className="space-y-1">
                      {manualCandidate.list.map((message, idx) => {
                        const label = resolveSpeakerLabel(message, activeSession, preferences);
                        const preview = buildPlainTextPreview(message, activeSession).slice(0, 80);
                        const isChecked = manualSelected.includes(message.id);
                        const indexLabel = manualCandidate.truncated ? visibleMessages.length - manualCandidate.list.length + idx + 1 : idx + 1;
                        return (
                          <label
                            key={message.id}
                            className="flex items-start gap-2 rounded-md px-2 py-1 text-xs text-gray-700 hover:bg-pink-50"
                          >
                            <input
                              type="checkbox"
                              className="mt-0.5"
                              checked={isChecked}
                              onChange={() => handleToggleManualId(message.id)}
                            />
                            <span className="min-w-0">
                              <span className="font-semibold text-gray-800">#{indexLabel}</span>{' '}
                              <span className="text-gray-600">{label}</span>
                              {preview ? <span className="text-gray-500">：{preview}</span> : null}
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={includeSystem}
                  onChange={(event) => setIncludeSystem(Boolean(event.target.checked))}
                />
                包含 system 消息
              </label>
              <label className="flex items-center gap-2 text-xs text-gray-700">
                <input
                  type="checkbox"
                  checked={showTimestamps}
                  onChange={(event) => setShowTimestamps(Boolean(event.target.checked))}
                />
                显示时间戳
              </label>
              <button
                type="button"
                className="rounded-xl bg-pink-600 px-4 py-2 text-sm font-semibold text-white hover:bg-pink-700 disabled:cursor-not-allowed disabled:opacity-50"
                onClick={() => void handleStartExport()}
                disabled={!activeSession || selectedMessages.length === 0 || captureBusy || isGenerating}
              >
                {captureBusy ? '生成中…' : saveMode === 'modal' ? '生成图片（预览保存）' : '生成图片（直接下载）'}
              </button>
            </div>

            {captureError ? <div className="text-xs text-red-600">{captureError}</div> : null}
          </>
        )}
      </div>

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={imageUrl}
        onClose={() => {
          setShowImageModal(false);
          setImageUrl((prev) => {
            revokeBlobUrl(prev);
            return null;
          });
        }}
      />

      {/* 导出专用画布：放在视口外，但保持可渲染，供 snapdom 截图 */}
      <div className="fixed left-[-10000px] top-0 z-[-1]">
        <div
          ref={exportRef}
          className="result-card"
          style={{
            width: exportWidth,
            marginTop: 0,
            background: 'linear-gradient(135deg, #ec4899 0%, #fb7185 45%, #d946ef 100%)',
          }}
        >
          <div className="result-content">
            <div className="flex justify-center">
              <img src="/magic-tea-party-white.svg" alt="魔法茶会" className="w-64 mb-3" />
            </div>

            <div className="text-center text-white/90">
              <div className="text-lg font-bold tracking-wide">{exportTitle}</div>
              <div className="mt-1 text-xs text-white/70">
                {exportedAt ? `导出时间：${exportedAt}` : null}
                {exportedAt ? ' · ' : null}
                {`条目：${selectedMessages.length}`}
              </div>
            </div>

            <div className="mt-4 space-y-3">
              {selectedMessages.map((message) => {
                const speaker = resolveSpeakerLabel(message, activeSession, preferences);
                const isUser = message.role === 'user';
                const bubbleClass = isUser ? 'bg-pink-600 text-white' : 'bg-white border border-pink-100 text-gray-800';
                const speakerClass = `px-1 text-xs font-semibold ${isUser ? 'text-right text-pink-100' : 'text-white/80'}`;
                const metaOutputFormat =
                  message.meta && typeof message.meta === 'object' && typeof (message.meta as any).outputFormat === 'string'
                    ? (message.meta as any).outputFormat
                    : null;
                const preferMarkdown =
                  message.role === 'assistant' &&
                  (metaOutputFormat === 'markdown' || (!metaOutputFormat && activeSession?.settings.outputFormat === 'markdown'));
                const timestamp = showTimestamps ? formatDateTime(message.createdAt) : '';
                const headerText = timestamp ? `${speaker} · ${timestamp}` : speaker;
                const shouldRenderSegments =
                  outputView === 'rendered' && message.role === 'assistant' && Array.isArray(message.segments) && message.segments.length > 0;

                return (
                  <div key={message.id} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                    <div className="w-full max-w-[720px]">
                      <div className="space-y-1">
                        <div className={speakerClass}>{headerText}</div>
                        <div className={`rounded-xl px-4 py-3 ${bubbleClass} ${shouldRenderSegments ? 'space-y-2' : ''}`}>
                          {outputView === 'raw' && message.role === 'assistant' ? (
                            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                          ) : shouldRenderSegments ? (
                            <>
                              {message.segments!.map((seg, idx) => {
                                if (seg.type === 'narration') {
                                  return (
                                    <p key={`${message.id}-n-${idx}`} className="whitespace-pre-wrap leading-relaxed">
                                      {seg.text}
                                    </p>
                                  );
                                }
                                if (seg.type === 'dialogue') {
                                  const segSpeakerName = seg.speakerName || getSpeakerNameFromRole(activeSession, seg.speakerId);
                                  return (
                                    <div key={`${message.id}-d-${idx}`} className="rounded-lg bg-pink-50 px-3 py-2">
                                      <div className="text-xs font-semibold text-pink-700">{segSpeakerName}</div>
                                      <div className="whitespace-pre-wrap leading-relaxed text-gray-800">{seg.text}</div>
                                    </div>
                                  );
                                }
                                if (seg.type === 'choices') {
                                  return (
                                    <div key={`${message.id}-c-${idx}`} className="grid gap-2 sm:grid-cols-2">
                                      {seg.items.map((item) => (
                                        <div
                                          key={item.id}
                                          className="rounded-xl border border-pink-200 bg-white px-4 py-2 text-left text-sm font-semibold text-pink-700"
                                        >
                                          {item.text}
                                        </div>
                                      ))}
                                    </div>
                                  );
                                }
                                return null;
                              })}
                            </>
                          ) : preferMarkdown ? (
                            <MarkdownBlock content={message.content || ''} variant="light" mode="article" />
                          ) : (
                            <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="mt-6 flex flex-col items-center justify-center">
              <img
                src="/logo-white-qrcode.svg"
                width={220}
                height={220}
                alt="项目 Logo"
                style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
              />
              <GeneratedByUserBadge variant="dark" label="保存者：" fallbackUsername="游客" className="mt-3" />
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
