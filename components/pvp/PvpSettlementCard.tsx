'use client';

import { useMemo, useRef, useState } from 'react';

import Badge from '@/components/badge/Badge';
import BadgeIcon from '@/components/badge/BadgeIcon';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import { getMainColorGradient, type MainColorKey } from '@/lib/main-color';
import type { PvpRoomRules } from '@/lib/pvp/types';
import type { UserBadge } from '@/types/badge';
import { parseUserPrefix } from '@/lib/user-prefix';

type ImageSaveMode = 'auto' | 'modal' | 'download';

export type PvpSettlementCardPayload = {
  generatedAt: string;
  room: {
    id: string;
    hostUserId: number;
    status: string;
    phase: string;
    currentMatchId: string;
    rules: PvpRoomRules;
    scenario: { kind: 'data_card'; id: string | null; name: string | null } | null;
  };
  me: {
    userId: number;
    username: string;
    prefix: string | null;
    seat: number | null;
    avatarDataUrl: string | null;
    signature?: string | null;
    badges: UserBadge[];
    pvp: {
      completedMatches: number;
      wins: number;
      losses: number;
      draws: number;
      winRate: number;
      lastPlayedAt: string | null;
    };
  };
  participants: Array<{
    userId: number;
    seat: number | null;
    username: string;
    rawUsername: string | null;
    prefix: string | null;
    isBot: boolean;
    badges: UserBadge[];
  }>;
  match: {
    id: string;
    maxRounds: number;
    roundCount: number;
    score: { winsByUserId: Array<{ userId: number; wins: number }>; maxRounds: number } | null;
  };
  myDeck: Array<{ name: string; type: string | null; ref: any; source: any }>;
  myInitialHand: Array<{ snapshotId: string; name: string; type: string | null; ref: any }>;
  rounds: Array<{
    roundId: string;
    roundIndex: number;
    status: string;
    headline: string | null;
    winner: {
      seat: number | null;
      userId: number | null;
      username: string;
      characterName: string | null;
      isBot: boolean | null;
      status: 'final' | 'draw' | 'pending' | 'unknown';
    };
    myPlay: { seat: number | null; snapshotId: string | null; name: string | null; type: string | null } | null;
  }>;
};

function sanitizeFilename(value: string): string {
  const normalized = value.trim().slice(0, 64);
  return normalized.replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_') || 'pvp';
}

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

const modeLabel = (mode: string): string => {
  if (mode === 'classic') return '经典';
  if (mode === 'kizuna') return '羁绊';
  if (mode === 'daily') return '日常';
  if (mode === 'scenario') return '情景';
  return mode;
};

const generationLabel = (value: string): string => {
  if (value === 'stream') return '流式';
  if (value === 'non-stream') return '非流式';
  return value;
};

export function PvpSettlementCard({
  data,
  themeKey = 'Pink',
  imageSaveMode = 'auto',
  onSaveImage,
}: {
  data: PvpSettlementCardPayload;
  themeKey?: MainColorKey;
  imageSaveMode?: ImageSaveMode;
  onSaveImage?: (imageUrl: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isSavingImage, setIsSavingImage] = useState(false);
  const initials = useMemo(() => getInitials(data.me.username), [data.me.username]);
  const parsedPrefix = useMemo(() => parseUserPrefix(data.me.prefix), [data.me.prefix]);
  const signature = (data.me.signature ?? '').trim();

  const gradient = useMemo(() => getMainColorGradient(themeKey), [themeKey]);
  const background = useMemo(
    () => `linear-gradient(135deg, ${gradient.first} 0%, ${gradient.second} 100%)`,
    [gradient.first, gradient.second],
  );

  const rules = data.room.rules;
  const displayBadges = (data.me.badges ?? []).slice(0, 5);

  const scoreByUserId = useMemo(() => {
    const map = new Map<number, number>();
    // 服务端 bestOf=off 时 score 可能为 null；这里用 rounds 兜底统计胜场。
    if (data.match.score?.winsByUserId?.length) {
      for (const s of data.match.score.winsByUserId) {
        if (!s || typeof s.userId !== 'number') continue;
        map.set(s.userId, typeof s.wins === 'number' ? s.wins : 0);
      }
      return map;
    }
    for (const p of data.participants) {
      if (typeof p.userId === 'number') map.set(p.userId, 0);
    }
    for (const r of data.rounds) {
      if (r.status !== 'completed') continue;
      if (r.winner.status !== 'final') continue;
      const id = r.winner.userId;
      if (typeof id !== 'number') continue;
      map.set(id, (map.get(id) ?? 0) + 1);
    }
    return map;
  }, [data.match.score?.winsByUserId, data.participants, data.rounds]);

  const scoreboard = useMemo(() => {
    const entries = data.participants
      .map((p) => ({
        userId: p.userId,
        seat: p.seat,
        username: p.username,
        prefix: p.prefix,
        badges: Array.isArray(p.badges) ? p.badges : [],
        isBot: p.isBot,
        wins: scoreByUserId.get(p.userId) ?? 0,
      }))
      .sort((a, b) => (b.wins ?? 0) - (a.wins ?? 0));
    return entries;
  }, [data.participants, scoreByUserId]);

  const handleSaveImage = async () => {
    if (!cardRef.current) return;
    if (isSavingImage) return;

    const buttonsContainer = cardRef.current.querySelector('.buttons-container') as HTMLElement | null;
    const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement | null;

    try {
      setIsSavingImage(true);
      if (buttonsContainer) buttonsContainer.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const blob = await capturePngBlob(cardRef.current, { scale: 1, dprMax: 2, fast: false });

      const resolvedMode: 'modal' | 'download' =
        imageSaveMode === 'modal' || imageSaveMode === 'download'
          ? imageSaveMode
          : /Mobi/i.test(window.navigator.userAgent)
            ? 'modal'
            : 'download';

      const filename = `PVP_战局结算卡_${sanitizeFilename(data.room.id)}_${sanitizeFilename(data.match.id)}.png`;

      if (resolvedMode === 'modal') {
        const imageUrl = createBlobUrl(blob);
        if (onSaveImage) {
          onSaveImage(imageUrl);
          return;
        }
        const previewWindow = window.open(imageUrl, '_blank');
        if (!previewWindow) alert('图片已生成，请长按或右键保存。');
        return;
      }

      downloadBlob(blob, filename);
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error('PvpSettlementCard image generation failed:', err);
    } finally {
      if (buttonsContainer) buttonsContainer.style.display = 'flex';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
      setIsSavingImage(false);
    }
  };

  return (
    <div
      ref={cardRef}
      className={[
        'relative w-[980px] overflow-hidden rounded-3xl border border-white/20 text-white shadow-xl',
        'print:w-[980px]',
      ].join(' ')}
      style={{ backgroundImage: background }}
    >
      <div className="px-7 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/25 bg-white/15">
              {data.me.avatarDataUrl ? (
                <img src={data.me.avatarDataUrl} alt="头像" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold">{initials}</div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <div className="text-xl font-bold tracking-wide truncate">{data.me.username}</div>
                {parsedPrefix ? (
                  <span
                    className={[
                      'inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold',
                      parsedPrefix.borderColor ? 'border' : '',
                    ].join(' ')}
                    style={{
                      color: parsedPrefix.textColor,
                      background: parsedPrefix.backgroundColor,
                      ...(parsedPrefix.borderColor
                        ? { borderColor: parsedPrefix.borderColor, borderWidth: '1px', borderStyle: 'solid' }
                        : null),
                    }}
                    title={`头衔：${parsedPrefix.title}`}
                  >
                    {parsedPrefix.icon && parsedPrefix.icon.type !== 'null' ? (
                      <BadgeIcon icon={parsedPrefix.icon} size={12} />
                    ) : null}
                    <span className="whitespace-nowrap">{parsedPrefix.title}</span>
                  </span>
                ) : null}
                {signature ? <span className="text-xs text-white/85">{signature}</span> : null}
              </div>

              <div className="mt-1 text-xs text-white/85">
                生成 {new Date(data.generatedAt).toLocaleString('zh-CN')}
              </div>

              {displayBadges.length > 0 ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <div className="text-xs font-semibold text-white/90">徽章</div>
                  {displayBadges.map((ub) => (
                    <div key={`badge-${ub.id}`} className="max-w-full">
                      <Badge badge={ub.badge} size="sm" className={ub.isEquipped ? 'ring-1 ring-white/70' : 'opacity-95'} />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-2 text-xs text-white/80">暂无徽章</div>
              )}
            </div>
          </div>

          <div className="shrink-0 text-right">
            <div className="logo-placeholder hidden items-center justify-end">
              <img src="/questionnaire-title.svg" width={240} height={56} alt="Logo" />
            </div>
            <div className="buttons-container flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleSaveImage}
                disabled={isSavingImage}
                className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20 disabled:opacity-60"
              >
                {isSavingImage ? '生成中…' : '保存图片'}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex items-end justify-between gap-2">
              <div className="text-sm font-semibold">近期战绩（PVP）</div>
              <div className="text-xs text-white/85">胜率 {data.me.pvp.winRate}%</div>
            </div>
            <div className="mt-2 text-sm text-white/90">
              {data.me.pvp.completedMatches} 场 · 胜 {data.me.pvp.wins} · 负 {data.me.pvp.losses} · 平 {data.me.pvp.draws}
            </div>
            <div className="mt-1 text-xs text-white/75">
              最近对局：{data.me.pvp.lastPlayedAt ? new Date(data.me.pvp.lastPlayedAt).toLocaleString('zh-CN') : '—'}
            </div>
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">本局设置</div>
              <div className="text-xs text-white/85">模式 {modeLabel(rules.mode)}</div>
            </div>
            <div className="mt-2 text-xs text-white/90 leading-relaxed">
              人数：{rules.participants}；提交：{rules.submissionMode === 'hostOnly' ? '房主牌堆' : `${rules.cardsPerPlayer} / 人`}；初始手牌：{rules.dealPerPlayer}；空手补发：{rules.dealWhenEmpty}；抽取：{rules.drawSource}；复用弃牌：{String(rules.recycleUsedCards)}；去重：{String(rules.dedupe)}；洗混：{String(rules.shuffleDecks)}；展示提交：{String(rules.showAllSubmissions)}
            </div>
            <div className="mt-1 text-xs text-white/85 leading-relaxed">
              生成：{generationLabel(rules.generationMode)}；语言：{rules.language?.trim() || '默认'}；字数：{rules.storyLength || 'default'}
            </div>
            {rules.mode === 'scenario' ? (
              <div className="mt-1 text-xs text-white/85">
                情景：{data.room.scenario?.name || data.room.scenario?.id || '—'}
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-black/15 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">本局计分板</div>
            <div className="text-xs text-white/85">最多 {data.match.maxRounds} 轮</div>
          </div>
          <div className="mt-3 space-y-2">
            {scoreboard.map((row) => {
              const isMe = row.userId === data.me.userId;
              return (
                <div
                  key={`score-${row.userId}`}
                  className={[
                    'rounded-xl border px-3 py-2 flex items-center justify-between gap-3',
                    isMe ? 'bg-white/20 border-white/35' : 'bg-white/10 border-white/20',
                  ].join(' ')}
                >
                  <div className="min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-full bg-white/15 border border-white/25 text-xs">
                      座位 {row.seat ?? '?'}
                    </span>
                    <span className={['font-semibold truncate', isMe ? 'text-white' : 'text-white/95'].join(' ')}>
                      {row.username}
                    </span>
                    {isMe ? <span className="px-2 py-0.5 rounded-full bg-black/20 text-xs">我</span> : null}
                  </div>
                  <div className="shrink-0 px-3 py-1 rounded-full text-xs font-semibold border border-white/25 bg-white/15">
                    胜场 {row.wins}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">我的提交卡组</div>
              <div className="text-xs text-white/85">{data.myDeck.length} 张</div>
            </div>
            {data.myDeck.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.myDeck.slice(0, 60).map((c, idx) => (
                  <span
                    key={`deck-${idx}-${c.name}`}
                    className="max-w-full rounded-full bg-white/15 border border-white/25 px-3 py-1 text-xs text-white/90"
                    title={c.type ? `类型：${c.type}` : undefined}
                  >
                    {c.name}
                  </span>
                ))}
                {data.myDeck.length > 60 ? (
                  <span className="rounded-full bg-black/15 border border-white/15 px-3 py-1 text-xs text-white/85">
                    以及另外 {data.myDeck.length - 60} 张…
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-xs text-white/80">
                {rules.submissionMode === 'hostOnly' ? '本房间为“房主牌堆”模式，非房主无需提交。' : '暂无提交记录。'}
              </div>
            )}
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">我的初始手牌</div>
              <div className="text-xs text-white/85">{data.myInitialHand.length || '—'}</div>
            </div>
            {data.myInitialHand.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {data.myInitialHand.slice(0, 60).map((c) => (
                  <span
                    key={`hand-${c.snapshotId}`}
                    className="max-w-full rounded-full bg-white/15 border border-white/25 px-3 py-1 text-xs text-white/90"
                    title={c.type ? `类型：${c.type}` : undefined}
                  >
                    {c.name}
                  </span>
                ))}
                {data.myInitialHand.length > 60 ? (
                  <span className="rounded-full bg-black/15 border border-white/15 px-3 py-1 text-xs text-white/85">
                    以及另外 {data.myInitialHand.length - 60} 张…
                  </span>
                ) : null}
              </div>
            ) : (
              <div className="mt-3 text-xs text-white/80">
                该对局未记录“开局手牌快照”（可能是旧对局或异常开始）。建议在新对局开局后再生成结算卡。
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 rounded-2xl bg-black/15 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">回合战报摘要</div>
            <div className="text-xs text-white/85">{data.rounds.length} 条</div>
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-white/20 bg-white/10">
            <div className="grid grid-cols-[96px_1fr_280px_240px] gap-0 border-b border-white/15 bg-black/10 px-3 py-2 text-[11px] font-semibold text-white/85">
              <div>回合</div>
              <div>标题</div>
              <div>胜者</div>
              <div>我的出牌</div>
            </div>
            <div className="divide-y divide-white/10">
              {data.rounds.length > 0 ? (
                data.rounds.slice(0, 30).map((r) => (
                  <div
                    key={`round-${r.roundId}`}
                    className="grid grid-cols-[96px_1fr_280px_240px] gap-0 px-3 py-2 text-xs"
                  >
                    <div className="text-white/85">第 {r.roundIndex} 回合</div>
                    <div className="min-w-0 pr-3">
                      <div className="text-white/95 break-words">{r.headline || '—'}</div>
                      <div className="text-[11px] text-white/70">状态：{r.status}</div>
                    </div>
                    <div className="pr-3">
                      <div className="text-white/95 break-words">{r.winner.username}</div>
                      <div className="text-[11px] text-white/75 break-words">
                        角色：{r.winner.characterName || (r.winner.status === 'draw' ? '平局' : '—')}
                      </div>
                    </div>
                    <div>
                      {r.myPlay?.name ? (
                        <>
                          <div className="text-white/95 break-words">{r.myPlay.name}</div>
                          <div className="text-[11px] text-white/75">座位：{r.myPlay.seat ?? '—'}</div>
                        </>
                      ) : (
                        <div className="text-white/75">—</div>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="px-3 py-3 text-xs text-white/80">暂无回合记录。</div>
              )}
            </div>
          </div>

          {data.rounds.length > 30 ? (
            <div className="mt-2 text-xs text-white/80">仅展示前 30 条回合摘要。</div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
