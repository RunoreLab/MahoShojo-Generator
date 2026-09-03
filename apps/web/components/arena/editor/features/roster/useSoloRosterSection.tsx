'use client';

import { useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';

import { TierBadge } from '@/components/ranking/TierBadge';
import { TechBadge } from '@/components/ranking/TechBadge';
import { computeEloExpectedScore } from '@/lib/arena/elo';
import { authStorage } from '@/lib/auth';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import {
  parseGenerationRankingResponse,
  requireGenerationRankingResponse,
  type GenerationRankingParticipant,
  type GenerationRankingQueueResult,
} from '@/lib/arena/generation-ranking';

import { useBattleActions } from '../../../hooks/useBattleActions';
import { useBattleStore } from '../../../stores/useBattleStore';
import { formatCombatantCount, isCombatantLimitReached } from '../../../types';
import type { Combatant, CombatantData } from '../../../types';
import { getCombatantDisplayName } from '../../../utils/characterValidator';
import {
  GENERATION_RANKING_MAX_ATTEMPTS,
  GENERATION_RANKING_MAX_DURATION_MS,
  getGenerationRankingRefetchInterval,
  shouldEnableGenerationRankingRecovery,
} from '../../../utils/generation-ranking-polling';
import type {
  ArenaRosterRowExtras,
  ArenaRosterRowView,
  ArenaRosterSectionModel,
  ArenaRosterTeamView,
} from './roster-contract';

const COMBATANT_TYPE_LABELS: Record<CombatantData['type'], string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  'general-character': '通用角色',
};

const getCombatantKey = (combatant: Combatant) => ('id' in combatant ? combatant.id : combatant.filename);

type Queue = 'strict' | 'free';

type ApiRating = {
  queue: Queue;
  rating: number;
  games: number;
  wins: number;
  losses: number;
  draws: number;
  tier: string;
};

type EloWinRatePrediction = {
  queue: Queue;
  expectedScore: number;
  expectedPct: number;
  selfRating: number;
  opponentRating: number;
};

type DataCardMetaResponse = {
  success: boolean;
  metrics: { techScore: number; techLevel: string } | null;
  ratings: { strict: ApiRating | null; free: ApiRating | null };
};

type PresetMetaResponse = {
  success: boolean;
  ratings: { strict: ApiRating | null; free: ApiRating | null };
};

const fetchJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const res = await fetch(url, init);
  const json = (await res.json()) as T;
  if (!res.ok) {
    const errorMessage =
      typeof (json as any)?.error === 'string' ? (json as any).error : `HTTP ${res.status}: ${JSON.stringify(json)}`;
    throw new Error(errorMessage);
  }
  return json;
};

const toFiniteNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

const buildEntityKeyForCombatant = (combatant: CombatantData): string | null => {
  if (combatant.isPreset) {
    const id = (combatant.filename ?? '').toString().trim();
    return id ? `preset:${id}` : null;
  }
  const id = (combatant.sourceDataCardId ?? '').toString().trim();
  return id ? `data_card:${id}` : null;
};

const pickTierBadge = (ratings?: { strict: ApiRating | null; free: ApiRating | null } | null): { tier: string; label: string } | null => {
  if (ratings?.strict?.tier) return { tier: ratings.strict.tier, label: '严格' };
  if (ratings?.free?.tier) return { tier: ratings.free.tier, label: '自由' };
  return null;
};

const formatIneligibleReasons = (reasons: string[]): string => {
  const map: Record<string, string> = {
    'free-disabled': '未开启自由排位',
    'status-not-completed': '战报未完成',
    'combatant-count-not-2': '需 2 人对战',
    'ip-missing': '无法获取 IP',
    'mode-not-classic': '需经典模式',
    'mode-not-season': '模式不符合赛季规则',
    'need-login': '需登录',
    'need-ranked-match': '需先进行排位匹配',
    'ranked-match-missing': '未进行排位匹配',
    'ranked-match-invalid': '排位匹配票据无效',
    'ranked-match-expired': '排位匹配已过期',
    'ranked-match-settings-changed': '匹配后修改了设置',
    'ranked-match-roster-changed': '匹配后修改了参战列表',
    'ranked-match-unrankable': '参战者未登记为数据卡/预设',
    'ranked-match-user-mismatch': '排位匹配票据与账号不匹配',
    'language-not-zh-cn': '需简体中文',
    'has-user-guidance': '存在故事引导',
    'season-user-guidance-missing': '缺少赛季故事引导',
    'season-user-guidance-mismatch': '故事引导不符合赛季规则',
    'season-questionnaire-lore-not-allowed': '存在问卷/设定卡 Lore（赛季规则不允许）',
    'season-questionnaire-lore-mismatch': '问卷/设定卡 Lore 不符合赛季规则',
    'season-scenario-missing': '缺少主情景（赛季规则）',
    'season-scenario-preset-mismatch': '主情景不是赛季指定预设',
    'season-aux-scenarios-not-allowed': '存在辅助情景（赛季规则不允许）',
    'has-adjudication-events': '存在随机判定器事件',
    'read-arena-history': '开启读取历战',
    'read-current-state': '开启读取当前状态',
    'read-narrative-history': '开启读取叙事历史',
    'has-character-guidance': '存在角色行动引导',
    'ai-model-blacklisted': '选择了不支持严格排位计分的模型',
  };
  return reasons.map((r) => map[r] ?? r).join('、');
};

const formatSkipReason = (reason: string | null): string => {
  if (!reason) return '未知原因';
  const map: Record<string, string> = {
    'winner-empty': '战报未给出胜者',
    'multi-winner': '胜者包含多人',
    'winner-ambiguous': '胜者无法匹配参战者',
    'daily-limit': '今日严格排位次数已达上限（按 UTC 00:00/北京时间 08:00 刷新）',
    'dedup-user-pair': '同一对手组合仍处于计分冷却期（严格去重）',
    'pair-daily-limit': '同一对手组合今日计分已达上限（严格去重）',
    'strict-card-missing': '数据卡不存在/已删除（严格排位不计分）',
    'strict-not-character': '仅“角色”数据卡可参与严格排位计分',
    'strict-not-public': '严格排位仅允许公开角色卡',
    'strict-not-approved': '严格排位仅允许已审核通过的公开角色卡',
    'strict-out-of-range': '对手分差过大（不计严格排位）',
    'dedup-ip-pair': '短时间同 IP 重复对局（自由去重）',
    'ratings-missing': '排位记录缺失',
    'rating-conflict': '排位并发冲突',
  };
  return map[reason] ?? reason;
};

const shortenReason = (text: string, maxChars = 18): string => {
  const chars = Array.from(text);
  if (chars.length <= maxChars) return text;
  return `${chars.slice(0, Math.max(0, maxChars)).join('')}…`;
};

const renderDeltaBadge = (delta: number) => {
  const text = delta >= 0 ? `+${delta}` : String(delta);
  const className =
    delta > 0
      ? 'text-emerald-700'
      : delta < 0
        ? 'text-red-700'
        : 'text-gray-600';
  return <span className={['font-mono font-semibold', className].join(' ')} title={`本局变化：${text}`}>Δ{text}</span>;
};

const queueStatusSuffix = (queue: GenerationRankingQueueResult) => {
  if (queue.eligible && queue.eventStatus === 'applied' && typeof queue.delta === 'number') {
    return <span className="ml-1">{renderDeltaBadge(queue.delta)}</span>;
  }
  if (queue.eligible && (queue.eventStatus === 'missing' || queue.eventStatus === 'pending')) {
    return <span className="ml-1 text-gray-500">（结算中）</span>;
  }
  if (queue.eligible && (queue.eventStatus === 'skipped' || queue.eventStatus === 'failed')) {
    const reasonText = formatSkipReason(queue.skipReason);
    const shortText = shortenReason(reasonText);
    return <span className="ml-1 text-gray-500" title={reasonText}>（未计分：{shortText}）</span>;
  }
  if (!queue.eligible) {
    const reasonText = formatIneligibleReasons(queue.ineligibleReasons);
    const shortText = shortenReason(reasonText);
    return <span className="ml-1 text-gray-500" title={reasonText}>（不计分：{shortText}）</span>;
  }
  return null;
};

const TEAM_KEY_PREFIX = 'team:';

const teamIdFromKey = (key: string): number => Number(key.slice(TEAM_KEY_PREFIX.length));

/**
 * 单人 roster/分队 adapter：把 battle store 与排位/技术值增强逻辑
 * 映射为共享 ArenaRosterSection 消费的 ArenaRosterSectionModel。
 */
export const useSoloRosterSectionModel = (input: {
  onShowDetails: (combatant: CombatantData) => void;
}): ArenaRosterSectionModel => {
  const { onShowDetails } = input;
  const queryClient = useQueryClient();
  const combatants = useBattleStore((state) => state.combatants);
  const teams = useBattleStore((state) => state.teams);
  const isGenerating = useBattleStore((state) => state.isGenerating);
  const lastGenerationId = useBattleStore((state) => state.lastGenerationId);
  const removeCombatant = useBattleStore((state) => state.removeCombatant);
  const moveCombatant = useBattleStore((state) => state.moveCombatant);
  const addTeam = useBattleStore((state) => state.addTeam);
  const removeTeam = useBattleStore((state) => state.removeTeam);
  const renameTeam = useBattleStore((state) => state.renameTeam);
  const toggleTeamCollapsed = useBattleStore((state) => state.toggleTeamCollapsed);
  const updateCombatantTeam = useBattleStore((state) => state.updateCombatantTeam);
  const updateCombatantCharacterGuidance = useBattleStore((state) => state.updateCombatantCharacterGuidance);
  const { handleAddRandomPlaceholder, handleClearRoster } = useBattleActions();

  const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});
  const generationRankingPollingRef = useRef({ generationId: '', startedAt: 0, attemptCount: 0 });

  const downloadJson = (combatant: CombatantData) => {
    const jsonData = JSON.stringify(combatant.data, null, 2);
    const blob = new Blob([jsonData], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const baseName = getCombatantDisplayName(combatant.data);
    link.download = `${baseName}_修正版.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const copyJson = async (combatant: CombatantData) => {
    const jsonData = JSON.stringify(combatant.data, null, 2);
    await navigator.clipboard.writeText(jsonData);
    setCopiedStatus((prev) => ({ ...prev, [combatant.filename]: true }));
    setTimeout(() => {
      setCopiedStatus((prev) => ({ ...prev, [combatant.filename]: false }));
    }, 2000);
  };

  const readableCombatants = useMemo(
    () => combatants.filter((c): c is CombatantData => 'data' in c),
    [combatants],
  );

  const techByCombatantKey = useMemo(() => {
    const map = new Map<string, { techScore: number; techLevel: string }>();
    for (const combatant of readableCombatants) {
      const key = getCombatantKey(combatant);
      try {
        const result = computeTechIndex(combatant.data);
        map.set(key, { techScore: result.techScore, techLevel: result.techLevel });
      } catch {
        // 技术值用于增强显示，失败不影响主流程
      }
    }
    return map;
  }, [readableCombatants]);

  const metaTargets = useMemo(() => {
    return readableCombatants
      .map((combatant) => {
        const entityKey = buildEntityKeyForCombatant(combatant);
        if (!entityKey) return null;
        if (combatant.isPreset) {
          return {
            entityKey,
            kind: 'preset' as const,
            id: combatant.filename,
          };
        }
        const dataCardId = combatant.sourceDataCardId;
        if (!dataCardId) return null;
        return {
          entityKey,
          kind: 'data_card' as const,
          id: dataCardId,
        };
      })
      .filter(Boolean) as Array<{ entityKey: string; kind: 'data_card' | 'preset'; id: string }>;
  }, [readableCombatants]);

  const metaQueries = useQueries({
    queries: metaTargets.map((target) => {
      if (target.kind === 'preset') {
        return {
          queryKey: ['arenaPresetMeta', target.id],
          queryFn: () => fetchJson<PresetMetaResponse>(`/api/arena/preset-meta?entityId=${encodeURIComponent(target.id)}`),
          staleTime: 60_000,
        };
      }
      return {
        queryKey: ['arenaDataCardMeta', target.id],
        queryFn: async () => {
          const authHeader = await authStorage.getAuthHeader();
          const headers: Record<string, string> = {};
          if (authHeader) headers.Authorization = authHeader;
          return fetchJson<DataCardMetaResponse>(
            `/api/data-card-meta?dataCardId=${encodeURIComponent(target.id)}`,
            Object.keys(headers).length > 0 ? { headers } : undefined,
          );
        },
        staleTime: 60_000,
      };
    }),
  });

  const metaByEntityKey = useMemo(() => {
    const map = new Map<string, { ratings: { strict: ApiRating | null; free: ApiRating | null }; tech?: { techScore: number; techLevel: string } | null }>();
    metaTargets.forEach((target, index) => {
      const data = metaQueries[index]?.data as any;
      const ratings = (data?.ratings ?? { strict: null, free: null }) as { strict: ApiRating | null; free: ApiRating | null };
      const tech = (data?.metrics ?? null) as { techScore: number; techLevel: string } | null;
      map.set(target.entityKey, { ratings, tech });
    });
    return map;
  }, [metaQueries, metaTargets]);

  const generationRankingQueryKey = ['arenaGenerationRanking', lastGenerationId] as const;
  const cachedGenerationRanking = parseGenerationRankingResponse(
    queryClient.getQueryData<unknown>(generationRankingQueryKey),
  );
  const hasTerminalRanking = Boolean(
    cachedGenerationRanking?.success
      && cachedGenerationRanking.state === 'ready'
      && Array.isArray(cachedGenerationRanking.participants)
      && !cachedGenerationRanking.participants.some((participant) =>
        (participant.queues.strict.eligible && ['missing', 'pending'].includes(participant.queues.strict.eventStatus))
        || (participant.queues.free.eligible && ['missing', 'pending'].includes(participant.queues.free.eventStatus)),
      ),
  );
  const generationRankingRecoveryEnabled = shouldEnableGenerationRankingRecovery({
    generationId: lastGenerationId,
    isGenerating,
    hasTerminalRanking,
  });

  const generationRankingQuery = useQuery({
    queryKey: generationRankingQueryKey,
    queryFn: async ({ signal }) => {
      const generationId = lastGenerationId as string;
      if (generationRankingPollingRef.current.generationId !== generationId) {
        generationRankingPollingRef.current = { generationId, startedAt: Date.now(), attemptCount: 0 };
      }
      generationRankingPollingRef.current.attemptCount += 1;
      const payload = await fetchJson<unknown>(
        `/api/arena/generation-ranking?generationId=${encodeURIComponent(lastGenerationId as string)}`,
        { signal },
      );
      return requireGenerationRankingResponse(payload);
    },
    enabled: generationRankingRecoveryEnabled,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = parseGenerationRankingResponse(query.state.data);
      let pending = Boolean(data?.success && data.state === 'pending');
      if (data?.success && data.state === 'ready') {
        pending = data.participants.some((p) =>
          (p.queues.strict.eligible && (p.queues.strict.eventStatus === 'missing' || p.queues.strict.eventStatus === 'pending')) ||
          (p.queues.free.eligible && (p.queues.free.eventStatus === 'missing' || p.queues.free.eventStatus === 'pending')),
        );
      }
      const polling = generationRankingPollingRef.current;
      return getGenerationRankingRefetchInterval({
        enabled: generationRankingRecoveryEnabled,
        pending,
        attemptCount: polling.attemptCount,
        elapsedMs: polling.startedAt > 0 ? Date.now() - polling.startedAt : 0,
      });
    },
  });
  const generationRankingData = parseGenerationRankingResponse(generationRankingQuery.data);

  const generationParticipantByEntityKey = useMemo(() => {
    const map = new Map<string, GenerationRankingParticipant>();
    const data = generationRankingData;
    if (!data || !data.success || data.state !== 'ready') return map;
    data.participants.forEach((p) => {
      if (typeof p.entityKey === 'string' && p.entityKey.trim()) {
        map.set(p.entityKey.trim(), p);
      }
    });
    return map;
  }, [generationRankingData]);

  const generationRankingPollingStopped = (() => {
    const data = generationRankingData;
    if (!data?.success) return false;
    const pending = data.state === 'pending' || (data.state === 'ready' && data.participants.some((participant) =>
      (participant.queues.strict.eligible && ['missing', 'pending'].includes(participant.queues.strict.eventStatus))
      || (participant.queues.free.eligible && ['missing', 'pending'].includes(participant.queues.free.eventStatus)),
    ));
    if (!pending) return false;
    const polling = generationRankingPollingRef.current;
    return polling.attemptCount >= GENERATION_RANKING_MAX_ATTEMPTS
      || (polling.startedAt > 0 && Date.now() - polling.startedAt >= GENERATION_RANKING_MAX_DURATION_MS);
  })();

  const eloPredictionByCombatantKey = useMemo(() => {
    const map = new Map<string, EloWinRatePrediction>();

    if (combatants.length !== 2 || readableCombatants.length !== 2) return map;

    const [player, opponent] = readableCombatants;
    const playerKey = getCombatantKey(player);
    const opponentKey = getCombatantKey(opponent);

    const playerEntityKey = buildEntityKeyForCombatant(player);
    const opponentEntityKey = buildEntityKeyForCombatant(opponent);
    if (!playerEntityKey || !opponentEntityKey) return map;

    const playerMeta = metaByEntityKey.get(playerEntityKey);
    const opponentMeta = metaByEntityKey.get(opponentEntityKey);

    const playerParticipant = generationParticipantByEntityKey.get(playerEntityKey);
    const opponentParticipant = generationParticipantByEntityKey.get(opponentEntityKey);

    const playerStrict = toFiniteNumber(playerParticipant?.queues.strict.rating ?? playerMeta?.ratings.strict?.rating);
    const opponentStrict = toFiniteNumber(opponentParticipant?.queues.strict.rating ?? opponentMeta?.ratings.strict?.rating);
    const playerFree = toFiniteNumber(playerParticipant?.queues.free.rating ?? playerMeta?.ratings.free?.rating);
    const opponentFree = toFiniteNumber(opponentParticipant?.queues.free.rating ?? opponentMeta?.ratings.free?.rating);

    const queueToUse: Queue | null = playerStrict != null && opponentStrict != null ? 'strict' : playerFree != null && opponentFree != null ? 'free' : null;
    if (!queueToUse) return map;

    const playerRating = queueToUse === 'strict' ? playerStrict : playerFree;
    const opponentRating = queueToUse === 'strict' ? opponentStrict : opponentFree;
    if (playerRating == null || opponentRating == null) return map;

    const playerExpectedScore = computeEloExpectedScore(playerRating, opponentRating);
    const opponentExpectedScore = computeEloExpectedScore(opponentRating, playerRating);

    map.set(playerKey, {
      queue: queueToUse,
      expectedScore: playerExpectedScore,
      expectedPct: Math.round(playerExpectedScore * 100),
      selfRating: playerRating,
      opponentRating,
    });

    map.set(opponentKey, {
      queue: queueToUse,
      expectedScore: opponentExpectedScore,
      expectedPct: Math.round(opponentExpectedScore * 100),
      selfRating: opponentRating,
      opponentRating: playerRating,
    });

    return map;
  }, [combatants.length, generationParticipantByEntityKey, metaByEntityKey, readableCombatants]);

  const rows = useMemo<ArenaRosterRowView[]>(() => combatants.map((combatant, index) => {
    const isPlaceholder = 'id' in combatant;
    const key = getCombatantKey(combatant);
    return Object.freeze({
      key,
      displayName: isPlaceholder ? combatant.filename : getCombatantDisplayName(combatant.data),
      typeLabel: isPlaceholder
        ? (combatant.type === 'random-magical-girl' ? '随机魔法少女' : '随机残兽')
        : COMBATANT_TYPE_LABELS[combatant.type],
      guidance: isPlaceholder ? '' : (combatant.characterGuidance ?? ''),
      index,
      teamKey: combatant.teamId ? `${TEAM_KEY_PREFIX}${combatant.teamId}` : null,
      isPlaceholder,
    });
  }), [combatants]);

  const teamViews = useMemo<ArenaRosterTeamView[]>(() => teams.map((team) => Object.freeze({
    key: `${TEAM_KEY_PREFIX}${team.id}`,
    name: team.name,
    memberKeys: Object.freeze(rows
      .filter((row) => row.teamKey === `${TEAM_KEY_PREFIX}${team.id}`)
      .map((row) => row.key)),
    collapsed: team.isCollapsed,
  })), [rows, teams]);

  const rowExtras = (row: ArenaRosterRowView): ArenaRosterRowExtras | undefined => {
    const combatant = combatants.find((item) => getCombatantKey(item) === row.key);
    if (!combatant || 'id' in combatant) return undefined;
    const data = combatant;
    const entityKey = buildEntityKeyForCombatant(data);
    const meta = entityKey ? metaByEntityKey.get(entityKey) : null;
    const tierBadge = meta ? pickTierBadge(meta.ratings) : null;
    const localTech = techByCombatantKey.get(row.key) ?? null;
    const techLevel = meta?.tech?.techLevel ?? localTech?.techLevel ?? null;
    const techScore = meta?.tech?.techScore ?? localTech?.techScore ?? null;
    const generationParticipant = entityKey ? generationParticipantByEntityKey.get(entityKey) : null;
    const generationTier = generationParticipant?.queues.strict.tier ?? generationParticipant?.queues.free.tier ?? null;
    const generationTierLabel =
      generationParticipant?.queues.strict.tier ? '严格' : (generationParticipant?.queues.free.tier ? '自由' : '');
    const tierToShow = generationTier ?? tierBadge?.tier ?? (entityKey ? '无牌' : '未登记');
    const tierLabelToShow = generationTier ? generationTierLabel : (tierBadge?.label ?? '');
    const prediction = eloPredictionByCombatantKey.get(row.key);

    return {
      tags: (
        <>
          {data.isValid ? <span className="text-green-600 whitespace-nowrap">(原生)</span> : null}
          {data.isPreset ? <span className="text-purple-600 whitespace-nowrap">(预设)</span> : null}
          {data.isNonStandard ? (
            <span className="text-orange-500 font-semibold whitespace-nowrap">(非规范格式)</span>
          ) : null}
          {data.wasCorrected ? <span className="text-yellow-600 whitespace-nowrap">(格式已修正)</span> : null}
        </>
      ),
      copied: Boolean(copiedStatus[data.filename]),
      onShowDetails: () => onShowDetails(data),
      onDownload: data.wasCorrected ? () => downloadJson(data) : undefined,
      onCopy: data.wasCorrected ? () => { void copyJson(data); } : undefined,
      rankingBadge: tierToShow ? (
        <span className="flex flex-wrap items-center gap-1 min-w-0">
          <TierBadge tier={tierToShow} />
          {typeof techLevel === 'string' && techLevel.trim() ? (
            <TechBadge mode="level" techScore={techScore} techLevel={techLevel} />
          ) : null}
          {tierLabelToShow ? <span className="text-[10px] text-gray-500">({tierLabelToShow})</span> : null}
        </span>
      ) : undefined,
      ranking: (
        <>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
            <span className="whitespace-normal break-words sm:whitespace-nowrap">
              技术值：{typeof techScore === 'number' ? techScore : '-'}
            </span>
            <span className="whitespace-normal break-words sm:whitespace-nowrap">
              严格：{generationParticipant?.queues.strict.rating ?? meta?.ratings.strict?.rating ?? '-'}
              {generationParticipant ? queueStatusSuffix(generationParticipant.queues.strict) : null}
            </span>
            <span className="whitespace-normal break-words sm:whitespace-nowrap">
              自由：{generationParticipant?.queues.free.rating ?? meta?.ratings.free?.rating ?? '-'}
              {generationParticipant ? queueStatusSuffix(generationParticipant.queues.free) : null}
            </span>
            {(() => {
              if (!prediction) return null;
              const queueLabel = prediction.queue === 'strict' ? '严格' : '自由';
              const title = `预计胜率（Elo · ${queueLabel}）：${prediction.expectedPct}%（${prediction.selfRating} vs ${prediction.opponentRating}）`;
              return (
                <span className="whitespace-nowrap" title={title}>
                  预计胜率：<span className="font-mono font-semibold text-sky-700">{prediction.expectedPct}%</span>
                  <span className="ml-1 text-gray-500">（{queueLabel}）</span>
                </span>
              );
            })()}
          </div>
          {!entityKey ? (
            <div className="mt-0.5 text-[11px] text-gray-500">提示：未登记为数据卡/预设时，无法参与排位计分。</div>
          ) : entityKey && lastGenerationId && !generationParticipant && generationRankingData?.success && generationRankingData.state === 'pending' ? (
            <div className="mt-0.5 text-[11px] text-gray-500">
              {generationRankingPollingStopped ? '排位结果暂未就绪，已停止自动查询。' : '排位结算中…（可能需要几秒钟）'}
              {generationRankingPollingStopped ? (
                <button
                  type="button"
                  className="ml-1 text-sky-700 hover:underline"
                  onClick={() => {
                    generationRankingPollingRef.current = {
                      generationId: lastGenerationId,
                      startedAt: Date.now(),
                      attemptCount: 0,
                    };
                    void generationRankingQuery.refetch();
                  }}
                >
                  手动刷新
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      ),
    };
  };

  return {
    rows,
    teams: teamViews,
    capabilities: {
      reorderRows: true,
      removeRows: true,
      editGuidance: true,
      ranking: true,
      addPlaceholders: true,
      clearRoster: true,
      createTeams: true,
      renameTeams: true,
      removeTeams: true,
      reorderTeams: false,
      assignTeamMembers: true,
      reorderTeamMembers: false,
      collapseTeams: true,
    },
    disabled: isGenerating,
    combatantCountLabel: formatCombatantCount(combatants.length),
    combatantCapReached: isCombatantLimitReached(combatants.length),
    rowExtras,
    actions: {
      moveRow: moveCombatant,
      removeRow: (key) => removeCombatant(key),
      setGuidance: (key, value) => updateCombatantCharacterGuidance(key, value),
      addPlaceholder: handleAddRandomPlaceholder,
      clearRoster: handleClearRoster,
      createTeam: () => `${TEAM_KEY_PREFIX}${addTeam()}`,
      renameTeam: (key, name) => renameTeam(teamIdFromKey(key), name),
      removeTeam: (key) => removeTeam(teamIdFromKey(key)),
      moveTeam: () => undefined,
      assignCombatant: (combatantKey, teamKey) => updateCombatantTeam(combatantKey, teamKey ? teamIdFromKey(teamKey) : null),
      moveTeamMember: () => undefined,
      toggleTeamCollapsed: (key) => toggleTeamCollapsed(teamIdFromKey(key)),
    },
  };
};
