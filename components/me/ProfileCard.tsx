'use client';

import { useMemo, useRef } from 'react';
import { snapdom } from '@zumer/snapdom';

import Badge from '@/components/badge/Badge';
import type { UserBadge } from '@/types/badge';

type CardLite = {
  id: string;
  type: 'character' | 'scenario';
  name: string;
  description: string | null;
  isPublic: boolean;
  reviewStatus: string | null;
  likeCount: number;
  favoriteCount: number;
  usageCount: number;
  engagementScore: number;
};

type PvpMatchLite = {
  id: string;
  roomId: string | null;
  status: string;
  startedAt: string;
  endedAt: string | null;
  winnerUserId: number | null;
  players: Array<{ userId: number; seat: number; username: string | null; prefix: string | null }>;
};

type BattleReportLite = {
  id: string;
  startedAt: string;
  status: string;
  mode: string;
  headline: string | null;
  winner: string | null;
  pvpMatchId: string | null;
  contentBlocked: boolean;
};

export type MeProfileCardPayload = {
  profile: {
    id: number;
    username: string;
    prefix: string | null;
    createdAt: string;
    signature: string;
    avatarDataUrl: string | null;
  };
  badges: {
    equipped: UserBadge[];
    recent: UserBadge[];
  };
  topCards: {
    characters: CardLite[];
    scenario: CardLite | null;
  };
  pvp: {
    summary: {
      completedMatches: number;
      wins: number;
      losses: number;
      draws: number;
      abortedMatches: number;
      lastPlayedAt: string | null;
    };
    recentMatches: PvpMatchLite[];
  };
  recentBattleReports: BattleReportLite[];
};

type ImageSaveMode = 'auto' | 'modal' | 'download';

const formatDateTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleString('zh-CN');
};

const formatDate = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  return new Date(ms).toLocaleDateString('zh-CN');
};

const modeLabel = (mode: string): string => {
  switch (mode) {
    case 'classic':
      return '经典';
    case 'kizuna':
      return '羁绊';
    case 'daily':
      return '日常';
    case 'scenario':
      return '情景';
    default:
      return mode;
  }
};

const statusLabel = (status: string): string => {
  switch (status) {
    case 'completed':
      return '完成';
    case 'aborted':
      return '中断';
    case 'failed':
      return '失败';
    default:
      return status;
  }
};

function getInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

function sanitizeFilename(value: string): string {
  const normalized = value.trim().slice(0, 64);
  return normalized.replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '_') || 'profile';
}

export function ProfileCard({
  data,
  imageSaveMode = 'auto',
  onSaveImage,
}: {
  data: MeProfileCardPayload;
  imageSaveMode?: ImageSaveMode;
  onSaveImage?: (imageUrl: string) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const initials = useMemo(() => getInitials(data.profile.username), [data.profile.username]);
  const generatedAtLabel = useMemo(() => new Date().toLocaleString('zh-CN'), []);

  const winRate = useMemo(() => {
    const completed = data.pvp.summary.completedMatches || 0;
    if (completed <= 0) return null;
    const wins = data.pvp.summary.wins || 0;
    const pct = (wins / completed) * 100;
    return `${pct.toFixed(1)}%`;
  }, [data.pvp.summary.completedMatches, data.pvp.summary.wins]);

  const handleSaveImage = async () => {
    if (!cardRef.current) return;

    try {
      const buttonsContainer = cardRef.current.querySelector('.buttons-container') as HTMLElement | null;
      const logoPlaceholder = cardRef.current.querySelector('.logo-placeholder') as HTMLElement | null;

      if (buttonsContainer) buttonsContainer.style.display = 'none';
      if (logoPlaceholder) logoPlaceholder.style.display = 'flex';

      const result = await snapdom(cardRef.current, { scale: 1 });

      if (buttonsContainer) buttonsContainer.style.display = 'flex';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';

      const imgElement = await result.toPng();
      const imageUrl = imgElement.src;

      const resolvedMode: 'modal' | 'download' =
        imageSaveMode === 'modal' || imageSaveMode === 'download'
          ? imageSaveMode
          : /Mobi/i.test(window.navigator.userAgent)
            ? 'modal'
            : 'download';

      if (resolvedMode === 'modal') {
        if (onSaveImage) {
          onSaveImage(imageUrl);
          return;
        }
        const previewWindow = window.open(imageUrl, '_blank');
        if (!previewWindow) {
          alert('图片已生成，请长按或右键保存。');
        }
        return;
      }

      const downloadLink = document.createElement('a');
      downloadLink.href = imageUrl;
      downloadLink.download = `个人资料卡_${sanitizeFilename(data.profile.username)}_${data.profile.id}.png`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error('ProfileCard image generation failed:', err);
      const buttonsContainer = cardRef.current?.querySelector('.buttons-container') as HTMLElement | null;
      const logoPlaceholder = cardRef.current?.querySelector('.logo-placeholder') as HTMLElement | null;
      if (buttonsContainer) buttonsContainer.style.display = 'flex';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  const equippedBadges = (data.badges.equipped ?? []).slice(0, 5);
  const recentBadges = (data.badges.recent ?? []).slice(0, 5);

  return (
    <div
      ref={cardRef}
      className={[
        'relative w-[980px] overflow-hidden rounded-3xl border border-white/20 bg-gradient-to-br from-pink-500 via-fuchsia-500 to-indigo-500 text-white shadow-xl',
        'print:w-[980px]',
      ].join(' ')}
    >
      <div className="px-7 py-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <div className="h-16 w-16 shrink-0 overflow-hidden rounded-2xl border border-white/25 bg-white/15">
              {data.profile.avatarDataUrl ? (
                <img src={data.profile.avatarDataUrl} alt="头像" className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xl font-bold">{initials}</div>
              )}
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <div className="text-xl font-bold tracking-wide truncate">{data.profile.username}</div>
                {data.profile.prefix ? (
                  <div className="rounded-full bg-white/15 px-2 py-0.5 text-xs font-semibold">{data.profile.prefix}</div>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-white/85">
                ID：{data.profile.id} · 注册：{formatDate(data.profile.createdAt)}
              </div>
              <div className="mt-3 max-w-[620px] rounded-2xl bg-black/15 px-4 py-3 text-sm leading-relaxed text-white/90">
                {data.profile.signature ? (
                  <div className="whitespace-pre-wrap break-words">{data.profile.signature}</div>
                ) : (
                  <div className="text-white/70">（还没有个性签名）</div>
                )}
              </div>
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
                className="rounded-xl bg-white/15 px-4 py-2 text-sm font-semibold text-white hover:bg-white/20"
              >
                保存图片
              </button>
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4">
          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-sm font-semibold">当前佩戴徽章</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {equippedBadges.length > 0 ? (
                equippedBadges.map((ub) => (
                  <div key={`equipped-${ub.id}`} className="max-w-full">
                    <Badge badge={ub.badge} size="sm" />
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/70">暂无佩戴徽章</div>
              )}
            </div>

            <div className="mt-4 text-sm font-semibold">最近获得（除佩戴外）</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {recentBadges.length > 0 ? (
                recentBadges.map((ub) => (
                  <div key={`recent-${ub.id}`} className="max-w-full">
                    <Badge badge={ub.badge} size="sm" />
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/70">暂无其他徽章</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-sm font-semibold">数据卡高光</div>
            <div className="mt-2 text-xs text-white/80">按 点赞 + 收藏 + 使用 统计排序</div>

            <div className="mt-3">
              <div className="text-xs font-semibold text-white/85">Top 角色卡（3）</div>
              <div className="mt-2 space-y-2">
                {(data.topCards.characters ?? []).length > 0 ? (
                  data.topCards.characters.slice(0, 3).map((c) => (
                    <div key={`top-char-${c.id}`} className="rounded-xl bg-white/10 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <div className="text-sm font-semibold break-words">{c.name}</div>
                        {!c.isPublic ? (
                          <div className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/85">🔒 私有</div>
                        ) : null}
                      </div>
                      <div className="mt-1 text-[11px] text-white/85">
                        ❤️ {c.likeCount} · ⭐ {c.favoriteCount} · 📥 {c.usageCount} · 合计 {c.engagementScore}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-xs text-white/70">暂无角色卡数据</div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-white/85">Top 情景卡（1）</div>
              <div className="mt-2">
                {data.topCards.scenario ? (
                  <div className="rounded-xl bg-white/10 px-3 py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="text-sm font-semibold break-words">{data.topCards.scenario.name}</div>
                      {!data.topCards.scenario.isPublic ? (
                        <div className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/85">🔒 私有</div>
                      ) : null}
                    </div>
                    <div className="mt-1 text-[11px] text-white/85">
                      ❤️ {data.topCards.scenario.likeCount} · ⭐ {data.topCards.scenario.favoriteCount} · 📥 {data.topCards.scenario.usageCount} · 合计{' '}
                      {data.topCards.scenario.engagementScore}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-white/70">暂无情景卡数据</div>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex items-end justify-between gap-2">
              <div className="text-sm font-semibold">卡牌对决战绩（PVP）</div>
              {winRate ? <div className="text-xs text-white/85">胜率 {winRate}</div> : null}
            </div>
            <div className="mt-2 text-sm text-white/90">
              {data.pvp.summary.completedMatches} 场 · 胜 {data.pvp.summary.wins} · 负 {data.pvp.summary.losses} · 平 {data.pvp.summary.draws} · 中止{' '}
              {data.pvp.summary.abortedMatches}
            </div>
            <div className="mt-1 text-xs text-white/75">
              最近对局：{data.pvp.summary.lastPlayedAt ? formatDateTime(data.pvp.summary.lastPlayedAt) : '—'}
            </div>

            <div className="mt-4 text-xs font-semibold text-white/85">最近 3 场对局</div>
            <div className="mt-2 space-y-2">
              {(data.pvp.recentMatches ?? []).length > 0 ? (
                data.pvp.recentMatches.slice(0, 3).map((m) => {
                  const myId = data.profile.id;
                  const outcome =
                    m.status !== 'completed'
                      ? '未结算'
                      : m.winnerUserId == null
                        ? '平'
                        : m.winnerUserId === myId
                          ? '胜'
                          : '负';
                  const opponents = m.players
                    .filter((p) => p.userId !== myId)
                    .map((p) => p.username || `用户${p.userId}`)
                    .slice(0, 3)
                    .join(' / ');
                  return (
                    <div key={`match-${m.id}`} className="rounded-xl bg-white/10 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">
                          {outcome} · {opponents || '对手未知'}
                        </div>
                        <div className="text-[11px] text-white/80">{formatDateTime(m.startedAt)}</div>
                      </div>
                      <div className="mt-1 text-[11px] text-white/75">matchId：{m.id}</div>
                    </div>
                  );
                })
              ) : (
                <div className="text-xs text-white/70">暂无对局记录</div>
              )}
            </div>
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="text-sm font-semibold">最近 3 条战报生成记录</div>
            <div className="mt-2 space-y-2">
              {(data.recentBattleReports ?? []).length > 0 ? (
                data.recentBattleReports.slice(0, 3).map((r) => (
                  <div key={`report-${r.id}`} className="rounded-xl bg-white/10 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="text-sm font-semibold">
                        {modeLabel(r.mode)} · {statusLabel(r.status)}
                      </div>
                      <div className="text-[11px] text-white/80">{formatDateTime(r.startedAt)}</div>
                    </div>
                    <div className="mt-1 text-xs text-white/90 break-words">
                      {r.contentBlocked ? '（内容已屏蔽）' : r.headline || '（无标题）'}
                    </div>
                    <div className="mt-1 text-[11px] text-white/75">generationId：{r.id}</div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/70">暂无战报记录</div>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2 text-xs text-white/75">
          <div>生成时间：{generatedAtLabel}</div>
          <div className="text-right">
            <div className="font-semibold text-white/85">MahoShojo Generator</div>
            <div className="text-[11px]">（建议分享前检查是否包含隐私信息）</div>
          </div>
        </div>
      </div>
    </div>
  );
}
