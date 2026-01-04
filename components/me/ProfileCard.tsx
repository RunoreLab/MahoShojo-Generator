'use client';

import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';

import Badge from '@/components/badge/Badge';
import BadgeIcon from '@/components/badge/BadgeIcon';
import { TierBadge } from '@/components/ranking/TierBadge';
import { createBlobUrl, downloadBlob } from '@/lib/client/blobUrl';
import { capturePngBlob } from '@/lib/client/snapdomCapture';
import type { SeasonsConfig } from '@/lib/seasons';
import { formatSeasonTitle, getCurrentSeason } from '@/lib/seasons';
import type { UserBadge } from '@/types/badge';
import { parseUserPrefix } from '@/lib/user-prefix';

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

type CardMetricsLite = {
  techScore: number;
  techLevel: string;
} | null;

type CardRatingLite = {
  rating: number;
  games: number;
  tier: string;
  publicRank: number | null;
  publicTotal: number | null;
} | null;

type CardRatingsLite = {
  strict: CardRatingLite;
};

type CharacterHighlight = CardLite & {
  metrics: CardMetricsLite;
  ratings: CardRatingsLite;
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
  promptTokens: number | null;
  reasoningTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedTokens: number | null;
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
    all: UserBadge[];
  };
  topCards: {
    characters: CharacterHighlight[];
    topRatedCharacter: CharacterHighlight | null;
    scenario: CardLite | null;
  };
  stats: {
    dataCards: {
      total: number;
      characters: number;
      scenarios: number;
      history: number;
      publicCards: number;
      magicalGirl: number;
      canshou: number;
      general: number;
      unknownCharacter: number;
      likeTotal: number;
      favoriteTotal: number;
      usageTotal: number;
    };
    battleReports7d: {
      total: number;
      completed: number;
      aborted: number;
      failed: number;
    };
    battleReportsAll: {
      total: number;
    };
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
    recentMatches: Array<
      PvpMatchLite & {
        roundSummary: { total: number; wins: number; losses: number; draws: number } | null;
      }
    >;
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

const fetchJson = async <T,>(url: string): Promise<T> => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
};

const formatCount = (value: unknown): string => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '-';
  return value.toLocaleString('zh-CN');
};

const formatRankFraction = (rank: number | null | undefined, total: number | null | undefined): string | null => {
  const safeRank = typeof rank === 'number' && Number.isFinite(rank) && rank > 0 ? Math.floor(rank) : null;
  if (safeRank == null) return null;
  const safeTotal = typeof total === 'number' && Number.isFinite(total) && total > 0 ? Math.floor(total) : null;
  return safeTotal == null ? `#${safeRank}` : `#${safeRank}/${safeTotal}`;
};

const buildTokenBreakdownLabel = (report: BattleReportLite): string => {
  const total =
    typeof report.totalTokens === 'number' && Number.isFinite(report.totalTokens)
      ? report.totalTokens
      : null;
  const prompt =
    typeof report.promptTokens === 'number' && Number.isFinite(report.promptTokens)
      ? report.promptTokens
      : null;
  const reasoning =
    typeof report.reasoningTokens === 'number' && Number.isFinite(report.reasoningTokens)
      ? report.reasoningTokens
      : null;
  const completion =
    typeof report.completionTokens === 'number' && Number.isFinite(report.completionTokens)
      ? report.completionTokens
      : null;

  const fallbackTotal = [prompt, reasoning, completion].reduce<number>((sum, n) => sum + (typeof n === 'number' ? n : 0), 0);
  const resolvedTotal = total ?? (fallbackTotal > 0 ? fallbackTotal : null);

  const pieces: string[] = [];
  pieces.push(`总 ${resolvedTotal == null ? '-' : formatCount(resolvedTotal)}`);
  if (prompt != null) pieces.push(`输入 ${formatCount(prompt)}`);
  if (reasoning != null) pieces.push(`推理 ${formatCount(reasoning)}`);
  if (completion != null) pieces.push(`输出 ${formatCount(completion)}`);
  return pieces.join(' / ');
};

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
  const parsedPrefix = useMemo(() => parseUserPrefix(data.profile.prefix), [data.profile.prefix]);

  const seasonsQuery = useQuery({
    queryKey: ['seasonsConfig'],
    queryFn: () => fetchJson<SeasonsConfig>('/config/seasons.json'),
    staleTime: 60_000,
  });
  const currentSeason = useMemo(() => getCurrentSeason(seasonsQuery.data), [seasonsQuery.data]);

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

      const blob = await capturePngBlob(cardRef.current, { scale: 1, dprMax: 2, fast: false });

      const resolvedMode: 'modal' | 'download' =
        imageSaveMode === 'modal' || imageSaveMode === 'download'
          ? imageSaveMode
          : /Mobi/i.test(window.navigator.userAgent)
            ? 'modal'
            : 'download';

      if (resolvedMode === 'modal') {
        const imageUrl = createBlobUrl(blob);
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

      downloadBlob(blob, `个人资料卡_${sanitizeFilename(data.profile.username)}_${data.profile.id}.png`);
    } catch (err) {
      alert('生成图片失败，请重试');
      console.error('ProfileCard image generation failed:', err);
    } finally {
      const buttonsContainer = cardRef.current?.querySelector('.buttons-container') as HTMLElement | null;
      const logoPlaceholder = cardRef.current?.querySelector('.logo-placeholder') as HTMLElement | null;
      if (buttonsContainer) buttonsContainer.style.display = 'flex';
      if (logoPlaceholder) logoPlaceholder.style.display = 'none';
    }
  };

  const allBadges = data.badges.all ?? [];
  const equippedBadges = (data.badges.equipped ?? []).slice(0, 5);
  const stats = data.stats;

  const renderCharacterHighlight = (c: CharacterHighlight, keyPrefix: string) => {
    const techLevel = c.metrics?.techLevel ?? null;
    const techScore = c.metrics?.techScore ?? null;
    const strict = c.ratings.strict;
    const isPublicLeaderboardEligible = c.isPublic && c.reviewStatus === 'approved';

    const strictLabel = (() => {
      if (!strict) return '无严格排位';
      const ratingLabel = `${formatCount(strict.rating)}分`;
      const rankLabel = isPublicLeaderboardEligible ? formatRankFraction(strict.publicRank, strict.publicTotal) : null;
      return rankLabel ? `${ratingLabel} ${rankLabel}` : ratingLabel;
    })();

    return (
      <div key={`${keyPrefix}-${c.id}`} className="rounded-xl bg-white/10 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm font-semibold break-words">{c.name}</div>
          {techLevel ? (
            <div className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/90 whitespace-nowrap">
              {techLevel}
            </div>
          ) : null}
          {strict ? <TierBadge tier={strict.tier} /> : null}
          <div className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/90 whitespace-nowrap">{strictLabel}</div>
          {!c.isPublic ? (
            <div className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] text-white/85 whitespace-nowrap">🔒 私有</div>
          ) : null}
        </div>
        <div className="mt-1 text-[11px] text-white/85">
          ❤️ {c.likeCount} · ⭐ {c.favoriteCount} · 📥 {c.usageCount}
          {' · '}
          技术值 {techScore == null ? '—' : techScore}
        </div>
      </div>
    );
  };

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
              <div className="flex flex-wrap items-center gap-2 min-w-0">
                <div className="text-xl font-bold tracking-wide truncate">{data.profile.username}</div>
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
                {data.profile.signature ? (
                  <span className="min-w-0 max-w-[520px] truncate text-sm text-white/85">
                    {data.profile.signature}
                  </span>
                ) : null}
              </div>
              <div className="mt-1 text-xs text-white/85">
                ID：{data.profile.id} · 注册：{formatDate(data.profile.createdAt)}
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
            <div className="flex min-w-0 items-center justify-between gap-2">
              <div className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold">徽章与统计</div>
              <div className="shrink-0 whitespace-nowrap text-xs text-white/75">徽章 {allBadges.length}</div>
            </div>

            <div className="mt-2 text-xs font-semibold text-white/85">佩戴中</div>
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

            <div className="mt-4 text-xs font-semibold text-white/85">全部徽章</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {allBadges.length > 0 ? (
                allBadges.map((ub) => (
                  <div key={`badge-${ub.id}`} className="max-w-full">
                    <Badge badge={ub.badge} size="sm" className={ub.isEquipped ? 'ring-1 ring-white/60' : ''} />
                  </div>
                ))
              ) : (
                <div className="text-xs text-white/70">暂无徽章</div>
              )}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[11px] text-white/75">角色卡（魔法少女/残兽/通用/未知）</div>
                <div className="mt-1 text-sm font-semibold text-white/95">
                  {stats.dataCards.magicalGirl}/{stats.dataCards.canshou}/{stats.dataCards.general}/{stats.dataCards.unknownCharacter}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[11px] text-white/75">情景卡</div>
                <div className="mt-1 text-sm font-semibold text-white/95">{stats.dataCards.scenarios}</div>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[11px] text-white/75">公开卡</div>
                <div className="mt-1 text-sm font-semibold text-white/95">{stats.dataCards.publicCards}</div>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2">
                <div className="text-[11px] text-white/75">获赞 / 收藏 / 使用</div>
                <div className="mt-1 text-sm font-semibold text-white/95">
                  {formatCount(stats.dataCards.likeTotal)} / {formatCount(stats.dataCards.favoriteTotal)} / {formatCount(stats.dataCards.usageTotal)}
                </div>
              </div>
              <div className="rounded-xl bg-white/10 px-3 py-2 col-span-2">
                <div className="text-[11px] text-white/75">近 7 天战报（完成/中断/失败） · 累计 {stats.battleReportsAll.total}</div>
                <div className="mt-1 text-sm font-semibold text-white/95">
                  {stats.battleReports7d.total}（{stats.battleReports7d.completed}/{stats.battleReports7d.aborted}/{stats.battleReports7d.failed}）
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-2xl bg-black/15 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="text-sm font-semibold">数据卡高光</div>
              {currentSeason ? (
                <div className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/85 ring-1 ring-white/15">
                  当前赛季：{formatSeasonTitle(currentSeason)}
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              <div className="text-xs font-semibold text-white/85">Top 角色卡（2）</div>
              <div className="mt-2 space-y-2">
                {(data.topCards.characters ?? []).length > 0 ? (
                  data.topCards.characters.slice(0, 2).map((c) => renderCharacterHighlight(c, 'top-char'))
                ) : (
                  <div className="text-xs text-white/70">暂无角色卡数据</div>
                )}
              </div>
            </div>

            <div className="mt-4">
              <div className="text-xs font-semibold text-white/85">排位最高角色卡（1）</div>
              <div className="mt-2 space-y-2">
                {data.topCards.topRatedCharacter ? (
                  renderCharacterHighlight(data.topCards.topRatedCharacter, 'top-rated')
                ) : (
                  <div className="text-xs text-white/70">暂无排位记录</div>
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
            <div className="flex min-w-0 items-end justify-between gap-2">
              <div className="min-w-0 flex-1 truncate whitespace-nowrap text-sm font-semibold">卡牌对决战绩（PVP）</div>
              {winRate ? <div className="shrink-0 whitespace-nowrap text-xs text-white/85">胜率 {winRate}</div> : null}
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
                  const roundSummaryText = m.roundSummary
                    ? `回合：胜 ${m.roundSummary.wins} / 负 ${m.roundSummary.losses} / 平 ${m.roundSummary.draws}（共 ${m.roundSummary.total}）`
                    : '回合：—';
                  return (
                    <div key={`match-${m.id}`} className="rounded-xl bg-white/10 px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-sm font-semibold">
                          {outcome} · {opponents || '对手未知'}
                        </div>
                        <div className="text-[11px] text-white/80">{formatDateTime(m.startedAt)}</div>
                      </div>
                      <div className="mt-1 text-[11px] text-white/80">{roundSummaryText}</div>
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
                    <div className="mt-1 text-[11px] text-white/85">
                      胜利者：{r.winner || '—'}
                      <span className="mx-2 text-white/60">·</span>
                      Tokens：{buildTokenBreakdownLabel(r)}
                      {typeof r.cachedTokens === 'number' && Number.isFinite(r.cachedTokens) && r.cachedTokens > 0
                        ? `（缓存 ${formatCount(r.cachedTokens)}）`
                        : ''}
                    </div>
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
