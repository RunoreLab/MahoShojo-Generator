import type { ReactNode, RefObject } from 'react';
import { ScenarioMarkdownPreview } from '../scenario/ScenarioMarkdownPreview';
import { Download, Heart, Info, Star, X } from 'lucide-react';
import type { CardLibraryDetailsCard } from '../card-library/host';
import Badge from '../card-library/Badge';
import { buildTitleDisplay } from '../card-library/text';
import { getFieldDisplayName } from '../creator/field-translations';
import { BASE_MODAL_BODY_LAYOUT_CLASS_NAME, BASE_MODAL_ROOT_LAYOUT_CLASS_NAME, useBaseModalAccessibility } from '../modal';

/** 来源只陈述这次正文的取得方式，不代表当前服务器权限或签名验证。 */
export type CardDetailsSource =
  | { kind: 'local'; provenance?: string; label?: string }
  | { kind: 'cache'; lastSuccessAt: string | null }
  | { kind: 'public' }
  | { kind: 'owned' }
  | { kind: 'preset' };

const formatDate = (value?: string | null) => {
  if (!value) return '未知';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
export const describeCardDetailsSource = (source: CardDetailsSource): string => {
  switch (source.kind) {
    case 'local': return `${source.label ?? '本地正文'} · ${source.provenance ?? '本机未验证签名'}`;
    case 'cache': return `公开库缓存快照 · 最近成功读取：${formatDate(source.lastSuccessAt)} · 不代表当前公开状态`;
    case 'public': return '公开数据卡正文 · 不代表历史赛季正文快照';
    case 'owned': return '我的云端数据卡正文';
    case 'preset': return '此客户端内置预设版本 · 不保证与历史赛季或当前服务器版本一致';
  }
};

/** 仅限制展示复杂度，不改变下载或保存的完整原件。 */
export function CardDetailsBody({ data, renderMarkdown }: { data: string; renderMarkdown: (content: string) => ReactNode }) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return <p role="alert" className="text-sm text-red-700">正文解析失败：数据卡不是有效的 JSON</p>;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return <p role="alert" className="text-sm text-red-700">正文格式无效：需要 JSON 对象或数组</p>;
  }
  let remaining = 2000;
  const render = (value: unknown, level = 0): ReactNode => {
    if (level > 16 || remaining-- <= 0) return <span className="text-amber-700">内容过深或过多，部分设定未展开；原始 JSON 保持完整</span>;
    if (typeof value === 'string') return value.trim() ? renderMarkdown(value) : <span className="text-gray-500">（空）</span>;
    if (typeof value === 'number' || typeof value === 'boolean') return <span>{String(value)}</span>;
    if (value === null) return <span className="text-gray-500">无数据</span>;
    if (Array.isArray(value)) {
      const limit = Math.max(0, remaining);
      return <div className="space-y-1">{value.slice(0, limit).map((entry, index) => <div key={index} className="flex items-start gap-2"><span>•</span><div className="min-w-0 flex-1">{render(entry, level + 1)}</div></div>)}{value.length > limit && <span className="text-amber-700">较长列表已截断展示，原始 JSON 保持完整</span>}</div>;
    }
    if (typeof value === 'object' && value) {
      const entries = Object.entries(value).filter(([key]) => !key.startsWith('_') && !['metadata', 'userAnswers', 'constructor', 'prototype', 'toString', 'valueOf'].includes(key));
      const limit = Math.max(0, remaining);
      return <div className="space-y-2">{entries.slice(0, limit).map(([key, entry]) => <div key={key} className="border-l-2 border-gray-200 pl-3"><div className="mb-1 text-sm font-medium text-gray-600">{String(getFieldDisplayName(key))}:</div><div className="ml-2">{render(entry, level + 1)}</div></div>)}{entries.length > limit && <span className="text-amber-700">较多字段已截断展示，原始 JSON 保持完整</span>}</div>;
    }
    return null;
  };
  return Object.keys(parsed).length ? render(parsed) : <p className="py-8 text-center text-gray-500">暂无详细设定数据</p>;
}

export interface BasicCardDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  card: CardLibraryDetailsCard;
  source: CardDetailsSource;
  renderMarkdown: (content: string) => ReactNode;
  fallbackFocusRef?: RefObject<HTMLElement | null>;
  /** 宿主子弹窗打开时暂时隐藏底层语义，层级由同一个 modal 栈管理。 */
  obscured?: boolean;
  headerActions?: ReactNode;
  beforeOverview?: ReactNode;
  metadata?: ReactNode;
  footer?: ReactNode;
}

export function BasicCardDetailsModal({ isOpen, onClose, card, source, renderMarkdown, fallbackFocusRef, obscured, headerActions, beforeOverview, metadata, footer }: BasicCardDetailsModalProps) {
  const { titleId, dialogRef, initialFocusRef } = useBaseModalAccessibility({ isOpen, onClose, fallbackFocusRef });
  if (!isOpen) return null;
  const { display, full } = buildTitleDisplay(card.name || '未命名');
  const typeLabel = { character: '角色', scenario: '剧本', history: '历史', questionnaire: '问卷' }[card.type] ?? '数据卡';
  return <div className={`${BASE_MODAL_ROOT_LAYOUT_CLASS_NAME} z-50 bg-black/50`}>
    <div ref={dialogRef} role="dialog" aria-modal={obscured ? undefined : 'true'} aria-hidden={obscured ? 'true' : undefined} aria-labelledby={titleId} tabIndex={-1} className="flex max-h-[min(90dvh,calc(100dvh-2rem))] w-full max-w-4xl flex-col overflow-hidden rounded-lg bg-white text-gray-800">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b p-6">
        <div className="flex min-w-0 items-center gap-3"><Info className="h-5 w-5 shrink-0 text-purple-600" /><div className="min-w-0"><h2 id={titleId} className="truncate text-xl font-bold" title={full}>{display}</h2><p className="mt-1 text-xs text-gray-500">类型：{typeLabel}</p></div></div>
        <div className="relative flex shrink-0 items-center gap-2">{headerActions}<button type="button" ref={initialFocusRef} onClick={onClose} aria-label={`关闭${typeLabel}详情`} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"><X className="h-5 w-5" /></button></div>
      </div>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- 可滚动正文必须能独立获得键盘焦点，与 BaseModal 一致。 */}
      <div className={`${BASE_MODAL_BODY_LAYOUT_CLASS_NAME} space-y-6 p-6`} role="region" aria-labelledby={titleId} tabIndex={0}>
        {beforeOverview}
        <section className="space-y-2">
          <h3 className="font-medium text-gray-700">概览</h3>
          <p className="whitespace-pre-wrap text-sm text-gray-600">{card.description?.trim() ? card.description : '暂无简介'}</p>
          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500"><span className="flex items-center gap-1"><Heart className="h-3 w-3" />{card.likeCount ?? 0}</span><span className="flex items-center gap-1"><Star className="h-3 w-3" />{card.favoriteCount ?? 0}</span><span className="flex items-center gap-1"><Download className="h-3 w-3" />{card.usageCount ?? 0}</span></div>
          <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500"><span className="inline-flex items-center gap-1">作者：{card.author ?? '未知'}{card.authorBadges?.map((badge) => <Badge key={badge.id} badge={badge} size="sm" />)}</span><span title={card.createdAt}>创建：{formatDate(card.createdAt)}</span><span title={card.updatedAt}>更新：{formatDate(card.updatedAt)}</span></div>
          <p className="text-xs text-gray-500">来源：{describeCardDetailsSource(source)}</p>
        </section>
        {metadata}
        <section className="space-y-2"><h3 className="font-medium text-gray-700">{card.type === 'history' ? '内容' : '详细设定'}</h3><div className="rounded-lg bg-gray-50 p-4"><CardDetailsBody key={card.type === 'scenario' ? JSON.stringify([card.id, card.data]) : undefined} data={card.data} renderMarkdown={card.type === 'scenario' ? (content) => <ScenarioMarkdownPreview content={content} renderMarkdown={renderMarkdown} /> : renderMarkdown} /></div></section>
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t bg-gray-50 p-6">{footer}<button type="button" onClick={onClose} className="rounded-lg bg-gray-200 px-4 py-2 text-gray-700 hover:bg-gray-300">关闭</button></div>
    </div>
  </div>;
}
