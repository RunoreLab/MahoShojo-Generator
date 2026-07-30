'use client';

import { useMemo, useRef, useState } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';

import { TierBadge } from '@/components/ranking/TierBadge';
import { TechBadge } from '@/components/ranking/TechBadge';
import { computeEloExpectedScore } from '@/lib/arena/elo';
import { authStorage } from '@/lib/auth';
import { computeTechIndex } from '@/lib/metrics/techIndex';
import type { GenerationRankingResponse } from '@/lib/arena/generation-ranking';

import { useBattleActions } from '../hooks/useBattleActions';
import { useBattleStore } from '../stores/useBattleStore';
import { formatCombatantCount, isCombatantLimitReached } from '../types';
import type { BattleStoreState, Combatant, CombatantData } from '../types';
import { getCombatantDisplayName } from '../utils/characterValidator';
import {
  GENERATION_RANKING_MAX_ATTEMPTS,
  GENERATION_RANKING_MAX_DURATION_MS,
  getGenerationRankingRefetchInterval,
  shouldEnableGenerationRankingRecovery,
} from '../utils/generation-ranking-polling';

interface CombatantListProps {
  onShowDetails: (combatant: CombatantData) => void;
}

const COMBATANT_TYPE_LABELS: Record<CombatantData['type'], string> = {
  'magical-girl': '魔法少女',
  canshou: '残兽',
  'general-character': '通用角色',
};

type IndexedCombatant = {
  combatant: Combatant;
  index: number;
};

const getCombatantKey = (combatant: Combatant) => ('id' in combatant ? combatant.id : combatant.filename);

const getCombatantIdentifier = getCombatantKey;

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

export function CombatantList({ onShowDetails }: CombatantListProps) {
  const queryClient = useQueryClient();
  const useBattleSelector = <T,>(selector: (state: BattleStoreState) => T) => useBattleStore(selector);
  const combatants = useBattleSelector((state) => state.combatants);
  const teams = useBattleSelector((state) => state.teams);
  const isGenerating = useBattleSelector((state) => state.isGenerating);
  const lastGenerationId = useBattleSelector((state) => state.lastGenerationId);
  const removeCombatant = useBattleSelector((state) => state.removeCombatant);
  const moveCombatant = useBattleSelector((state) => state.moveCombatant);
  const addTeam = useBattleSelector((state) => state.addTeam);
  const removeTeam = useBattleSelector((state) => state.removeTeam);
  const renameTeam = useBattleSelector((state) => state.renameTeam);
  const toggleTeamCollapsed = useBattleSelector((state) => state.toggleTeamCollapsed);
  const updateCombatantTeam = useBattleSelector((state) => state.updateCombatantTeam);
  const updateCombatantCharacterGuidance = useBattleSelector((state) => state.updateCombatantCharacterGuidance);
  const { handleAddRandomPlaceholder, handleClearRoster } = useBattleActions();

  const [copiedStatus, setCopiedStatus] = useState<Record<string, boolean>>({});
  const [guidanceOpenFor, setGuidanceOpenFor] = useState<string | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [editingTeamName, setEditingTeamName] = useState<string>('');
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false);
  const generationRankingPollingRef = useRef({ generationId: '', startedAt: 0, attemptCount: 0 });
  const isCombatantCapReached = isCombatantLimitReached(combatants.length);

  const teamNameMap = useMemo(() => {
    const map = new Map<number, string>();
    teams.forEach((team) => map.set(team.id, team.name));
    return map;
  }, [teams]);

  const getTeamLabel = (teamId: number | undefined) => {
    if (!teamId) return '未分队';
    const name = teamNameMap.get(teamId);
    return name && name.trim() ? name.trim() : `队伍 ${teamId}`;
  };

  const indexedCombatants = useMemo<IndexedCombatant[]>(
    () =>
      combatants.map((combatant, index) => ({
        combatant,
        index,
      })),
    [combatants]
  );

  const hasAnyTeam = useMemo(() => {
    if (teams.length > 0) return true;
    return combatants.some((c) => typeof c.teamId === 'number' && c.teamId > 0);
  }, [combatants, teams.length]);

  const combatantsByTeam = useMemo(() => {
    const byTeamId = new Map<number, IndexedCombatant[]>();
    const unassigned: IndexedCombatant[] = [];

    indexedCombatants.forEach((item) => {
      const teamId = item.combatant.teamId;
      if (!teamId) {
        unassigned.push(item);
        return;
      }
      const bucket = byTeamId.get(teamId) ?? [];
      bucket.push(item);
      byTeamId.set(teamId, bucket);
    });

    return { byTeamId, unassigned };
  }, [indexedCombatants]);

  const beginEditTeam = (teamId: number) => {
    const current = teams.find((t) => t.id === teamId);
    setEditingTeamId(teamId);
    setEditingTeamName(current?.name ?? `分队 ${teamId}`);
  };

  const commitEditTeam = () => {
    if (editingTeamId === null) return;
    renameTeam(editingTeamId, editingTeamName);
    setEditingTeamId(null);
    setEditingTeamName('');
  };

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
  const cachedGenerationRanking = queryClient.getQueryData<GenerationRankingResponse>(generationRankingQueryKey);
  const hasTerminalRanking = Boolean(
    cachedGenerationRanking?.success
      && cachedGenerationRanking.state === 'ready'
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
    queryFn: ({ signal }) => {
      const generationId = lastGenerationId as string;
      if (generationRankingPollingRef.current.generationId !== generationId) {
        generationRankingPollingRef.current = { generationId, startedAt: Date.now(), attemptCount: 0 };
      }
      generationRankingPollingRef.current.attemptCount += 1;
      return fetchJson<GenerationRankingResponse>(
        `/api/arena/generation-ranking?generationId=${encodeURIComponent(lastGenerationId as string)}`,
        { signal },
      );
    },
    enabled: generationRankingRecoveryEnabled,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchIntervalInBackground: false,
    refetchInterval: (query) => {
      const data = query.state.data;
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

  const generationParticipantByEntityKey = useMemo(() => {
    const map = new Map<string, NonNullable<Extract<GenerationRankingResponse, { success: true; state: 'ready' }>>['participants'][number]>();
    const data = generationRankingQuery.data;
    if (!data || !data.success || data.state !== 'ready') return map;
    data.participants.forEach((p) => {
      if (typeof p.entityKey === 'string' && p.entityKey.trim()) {
        map.set(p.entityKey.trim(), p);
      }
    });
    return map;
  }, [generationRankingQuery.data]);

  const generationRankingPollingStopped = (() => {
    const data = generationRankingQuery.data;
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

  if (combatants.length === 0) {
    return null;
  }

  const renderCombatantRow = (combatant: Combatant, index: number) => {
    const isPlaceholder = 'id' in combatant;
    const key = getCombatantKey(combatant);
    const data = isPlaceholder ? null : (combatant as CombatantData);
    const guidanceValue = data?.characterGuidance ?? '';
    const displayName = isPlaceholder ? combatant.filename : getCombatantDisplayName(data?.data);
    const entityKey = !isPlaceholder && data ? buildEntityKeyForCombatant(data) : null;
    const meta = entityKey ? metaByEntityKey.get(entityKey) : null;
    const tierBadge = meta ? pickTierBadge(meta.ratings) : null;
    const localTech = techByCombatantKey.get(key) ?? null;
    const techLevel = meta?.tech?.techLevel ?? localTech?.techLevel ?? null;
    const techScore = meta?.tech?.techScore ?? localTech?.techScore ?? null;
    const generationParticipant = entityKey ? generationParticipantByEntityKey.get(entityKey) : null;
    const generationTier = generationParticipant?.queues.strict.tier ?? generationParticipant?.queues.free.tier ?? null;
    const generationTierLabel =
      generationParticipant?.queues.strict.tier ? '严格' : (generationParticipant?.queues.free.tier ? '自由' : '');
    const tierToShow = generationTier ?? tierBadge?.tier ?? (isPlaceholder ? null : (entityKey ? '无牌' : '未登记'));
    const tierLabelToShow = generationTier ? generationTierLabel : (tierBadge?.label ?? '');
    const typeDisplay = isPlaceholder
      ? combatant.type === 'random-magical-girl'
        ? '(随机魔法少女)'
        : '(随机残兽)'
      : `(${COMBATANT_TYPE_LABELS[data!.type]})`;
    const canMoveUp = index > 0;
    const canMoveDown = index < combatants.length - 1;

    return (
      <div key={key} className="group rounded-lg bg-white/70 border border-gray-300 px-2 py-2">
        <div className="flex items-start gap-2">
          <div className="flex flex-col gap-1 pt-0.5">
            <button
              type="button"
              onClick={() => moveCombatant(index, index - 1)}
              disabled={isGenerating || !canMoveUp}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="上移"
              title="上移"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => moveCombatant(index, index + 1)}
              disabled={isGenerating || !canMoveDown}
              className="w-6 h-6 text-xs rounded border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="下移"
              title="下移"
            >
              ↓
            </button>
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex flex-col sm:flex-row sm:items-start sm:gap-2">
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-gray-800 leading-snug break-words line-clamp-3" title={displayName}>
                  {displayName}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-500">
                  <span className="whitespace-nowrap">{typeDisplay}</span>
                  {!isPlaceholder && data?.isValid && <span className="text-green-600 whitespace-nowrap">(原生)</span>}
                  {!isPlaceholder && data?.isPreset && <span className="text-purple-600 whitespace-nowrap">(预设)</span>}
                  {!isPlaceholder && data?.isNonStandard && (
                    <span className="text-orange-500 font-semibold whitespace-nowrap">(非规范格式)</span>
                  )}
                  {!isPlaceholder && data?.wasCorrected && <span className="text-yellow-600 whitespace-nowrap">(格式已修正)</span>}
                  {!isPlaceholder && tierToShow && (
                    <span className="flex flex-wrap items-center gap-1 min-w-0">
                      <TierBadge tier={tierToShow} />
                      {typeof techLevel === 'string' && techLevel.trim() ? (
                        <TechBadge mode="level" techScore={techScore} techLevel={techLevel} />
                      ) : null}
                      {tierLabelToShow ? <span className="text-[10px] text-gray-500">({tierLabelToShow})</span> : null}
                    </span>
                  )}
                  </div>
              </div>

              <div className="mt-2 sm:mt-0 flex flex-wrap items-center justify-end gap-2 w-full sm:w-auto">
                {!isPlaceholder && (
                  <>
                    <button
                      onClick={() => setGuidanceOpenFor((prev) => (prev === key ? null : key))}
                      className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                      disabled={isGenerating}
                      title="为该角色输入行动/想法引导（最多100字）"
                    >
                      行动
                    </button>
                    <button
                      onClick={() => onShowDetails(combatant as CombatantData)}
                      className="text-xs bg-gray-200 text-gray-700 px-2 py-1 rounded hover:bg-gray-300"
                      disabled={isGenerating}
                    >
                      详情
                    </button>
                    {(combatant as CombatantData).wasCorrected && (
                      <>
                        <button
                          onClick={() => downloadJson(combatant as CombatantData)}
                          disabled={isGenerating}
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded hover:bg-blue-200"
                        >
                          下载
                        </button>
                        <button
                          onClick={() => copyJson(combatant as CombatantData)}
                          disabled={isGenerating}
                          className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded hover:bg-green-200 w-16"
                        >
                          {copiedStatus[(combatant as CombatantData).filename] ? '已复制!' : '复制'}
                        </button>
                      </>
                    )}
                  </>
                )}
                <button
                  onClick={() => !isGenerating && removeCombatant(getCombatantIdentifier(combatant))}
                  className={`w-5 h-5 bg-red-200 text-red-700 rounded-full flex items-center justify-center text-xs font-bold transition-colors flex-shrink-0 ${
                    isGenerating ? 'opacity-50 cursor-not-allowed' : 'hover:bg-red-300'
                  }`}
                  aria-label={`移除 ${displayName}`}
                  disabled={isGenerating}
                >
                  X
                </button>
              </div>
            </div>

            {!isPlaceholder && guidanceOpenFor !== key && data?.characterGuidance?.trim() && (
              <div className="mt-1 text-xs text-gray-500 italic break-words">
                行动引导：{data.characterGuidance.trim()}
              </div>
            )}

            {!isPlaceholder && (
              <div className="mt-1 text-xs text-gray-600">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 min-w-0">
                  <span className="whitespace-normal break-words sm:whitespace-nowrap">
                    技术值：{typeof techScore === 'number' ? techScore : '-'}
                  </span>
                  <span className="whitespace-normal break-words sm:whitespace-nowrap">
                    严格：{generationParticipant?.queues.strict.rating ?? meta?.ratings.strict?.rating ?? '-'}
                    {(() => {
                      const q = generationParticipant?.queues.strict;
                      if (!q) return null;
                      if (q.eligible && q.eventStatus === 'applied' && typeof q.delta === 'number') {
                        return <span className="ml-1">{renderDeltaBadge(q.delta)}</span>;
                      }
                      if (q.eligible && (q.eventStatus === 'missing' || q.eventStatus === 'pending')) {
                        return <span className="ml-1 text-gray-500">（结算中）</span>;
                      }
                      if (q.eligible && (q.eventStatus === 'skipped' || q.eventStatus === 'failed')) {
                        const reasonText = formatSkipReason(q.skipReason);
                        const shortText = shortenReason(reasonText);
                        return <span className="ml-1 text-gray-500" title={reasonText}>（未计分：{shortText}）</span>;
                      }
                      if (!q.eligible) {
                        const reasonText = formatIneligibleReasons(q.ineligibleReasons);
                        const shortText = shortenReason(reasonText);
                        return <span className="ml-1 text-gray-500" title={reasonText}>（不计分：{shortText}）</span>;
                      }
                      return null;
                    })()}
                  </span>
                  <span className="whitespace-normal break-words sm:whitespace-nowrap">
                    自由：{generationParticipant?.queues.free.rating ?? meta?.ratings.free?.rating ?? '-'}
                    {(() => {
                      const q = generationParticipant?.queues.free;
                      if (!q) return null;
                      if (q.eligible && q.eventStatus === 'applied' && typeof q.delta === 'number') {
                        return <span className="ml-1">{renderDeltaBadge(q.delta)}</span>;
                      }
                      if (q.eligible && (q.eventStatus === 'missing' || q.eventStatus === 'pending')) {
                        return <span className="ml-1 text-gray-500">（结算中）</span>;
                      }
                      if (q.eligible && (q.eventStatus === 'skipped' || q.eventStatus === 'failed')) {
                        const reasonText = formatSkipReason(q.skipReason);
                        const shortText = shortenReason(reasonText);
                        return <span className="ml-1 text-gray-500" title={reasonText}>（未计分：{shortText}）</span>;
                      }
                      if (!q.eligible) {
                        const reasonText = formatIneligibleReasons(q.ineligibleReasons);
                        const shortText = shortenReason(reasonText);
                        return <span className="ml-1 text-gray-500" title={reasonText}>（不计分：{shortText}）</span>;
                      }
                      return null;
                    })()}
                  </span>
                  {(() => {
                    const prediction = eloPredictionByCombatantKey.get(key);
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
                ) : entityKey && lastGenerationId && !generationParticipant && generationRankingQuery.data?.success && generationRankingQuery.data.state === 'pending' ? (
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
              </div>
            )}
          </div>
        </div>

        {!isPlaceholder && guidanceOpenFor === key && (
          <div className="mt-2 ml-8 p-2 rounded bg-white/70 border border-gray-300">
            <div className="text-xs text-gray-700 mb-1">角色行动引导（可选，最多100字）</div>
            <textarea
              className="w-full text-xs border border-gray-300 rounded px-2 py-1 bg-white disabled:opacity-50"
              rows={3}
              maxLength={100}
              disabled={isGenerating}
              placeholder="例如：谨慎试探、优先保护同伴、尽量不杀、被恐惧支配、隐藏身份等"
              value={guidanceValue}
              onChange={(e) => updateCombatantCharacterGuidance((combatant as CombatantData).filename, e.target.value)}
            />
            <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
              <span>{Array.from(guidanceValue).length}/100</span>
              <div className="flex items-center gap-2">
                {guidanceValue.trim() ? (
                  <button
                    type="button"
                    className="px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 disabled:opacity-50"
                    onClick={() => updateCombatantCharacterGuidance((combatant as CombatantData).filename, '')}
                    disabled={isGenerating}
                  >
                    清空
                  </button>
                ) : null}
                <button
                  type="button"
                  className="px-2 py-1 rounded bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
                  onClick={() => setGuidanceOpenFor(null)}
                  disabled={isGenerating}
                >
                  收起
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="mb-4 p-3 bg-gray-200 rounded-lg">
      <div className="flex justify-between items-center m-0 top-0 right-0">
        <p className="font-semibold text-sm text-gray-700">已选角色 ({formatCombatantCount(combatants.length)}):</p>
        <button
          onClick={handleClearRoster}
          disabled={isGenerating}
          className="text-sm text-red-500 hover:underline cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          清空列表
        </button>
      </div>

      <div className="flex gap-2 mt-3">
        <button
          onClick={() => handleAddRandomPlaceholder('random-magical-girl')}
          disabled={isGenerating || isCombatantCapReached}
          className="text-xs flex-1 bg-pink-100 text-pink-700 px-3 py-1.5 rounded-lg hover:bg-pink-200 disabled:opacity-50"
        >
          + 添加随机魔法少女
        </button>
        <button
          onClick={() => handleAddRandomPlaceholder('random-canshou')}
          disabled={isGenerating || isCombatantCapReached}
          className="text-xs flex-1 bg-red-100 text-red-700 px-3 py-1.5 rounded-lg hover:bg-red-200 disabled:opacity-50"
        >
          + 添加随机残兽
        </button>
      </div>

      <div className="flex justify-between items-center mt-3">
        <button
          type="button"
          onClick={() => {
            const id = addTeam();
            setUnassignedCollapsed(false);
            beginEditTeam(id);
          }}
          disabled={isGenerating}
          className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
        >
          + 新建分队
        </button>
      </div>

      {!hasAnyTeam && <div className="mt-2 space-y-2">{combatants.map((c, idx) => renderCombatantRow(c, idx))}</div>}

      {hasAnyTeam && (
        <div className="mt-2 space-y-2">
          {(combatantsByTeam.unassigned.length > 0 || teams.length > 0) && (
            <div className="rounded-lg border border-gray-300 bg-white/50">
              <button
                type="button"
                className="w-full flex flex-wrap items-center gap-2 px-2 py-2"
                onClick={() => setUnassignedCollapsed((v) => !v)}
                aria-expanded={!unassignedCollapsed}
                aria-controls="arena-team-unassigned-content"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <ChevronDown
                    className={`h-4 w-4 text-gray-700 transition-transform ${unassignedCollapsed ? '-rotate-90' : ''}`}
                    aria-hidden
                  />
                  <span className="font-semibold text-sm text-gray-700">未分队</span>
                  <span className="text-xs text-gray-500">({combatantsByTeam.unassigned.length})</span>
                </div>

                {teams.length > 0 && (
                  <select
                    defaultValue=""
                    className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50 w-full sm:w-44 min-w-0 max-w-full truncate sm:ml-auto"
                    disabled={isGenerating || indexedCombatants.every((item) => !item.combatant.teamId)}
                    onChange={(e) => {
                      const value = e.currentTarget.value;
                      if (!value) return;
                      updateCombatantTeam(value, null);
                      e.currentTarget.value = '';
                    }}
                    title="把某个已分队的角色移回未分队"
                  >
                    <option value="">移回未分队…</option>
                    {indexedCombatants
                      .filter((item) => item.combatant.teamId)
                      .map((item) => {
                        const identifier = getCombatantIdentifier(item.combatant);
                        const isPlaceholder = 'id' in item.combatant;
                        const data = isPlaceholder ? null : (item.combatant as CombatantData);
                        const name = isPlaceholder ? item.combatant.filename : getCombatantDisplayName(data?.data);
                        const label = `${name}（${getTeamLabel(item.combatant.teamId)}）`;
                        return (
                          <option key={identifier} value={identifier}>
                            {label}
                          </option>
                        );
                      })}
                  </select>
                )}
              </button>

              {!unassignedCollapsed && (
                <div id="arena-team-unassigned-content" className="p-2 pt-0 space-y-2">
                  {combatantsByTeam.unassigned.map((item) => renderCombatantRow(item.combatant, item.index))}
                </div>
              )}
            </div>
          )}

          {teams.map((team) => {
            const members = combatantsByTeam.byTeamId.get(team.id) ?? [];
            const isCollapsed = team.isCollapsed;

            return (
              <div key={team.id} className="rounded-lg border border-gray-300 bg-white/50">
              <div className="flex flex-wrap items-center gap-2 px-2 py-2">
                <button
                  type="button"
                  className="flex items-center gap-2 min-w-0 flex-1"
                  onClick={() => toggleTeamCollapsed(team.id)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`arena-team-${team.id}-content`}
                >
                    <ChevronDown
                      className={`h-4 w-4 text-gray-700 transition-transform ${isCollapsed ? '-rotate-90' : ''}`}
                      aria-hidden
                    />
                    {editingTeamId === team.id ? (
                      <input
                        className="text-sm font-semibold text-gray-700 border border-gray-300 rounded px-2 py-1 bg-white w-44"
                        value={editingTeamName}
                        disabled={isGenerating}
                        autoFocus
                        maxLength={50}
                        onChange={(e) => setEditingTeamName(e.target.value)}
                        onBlur={commitEditTeam}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitEditTeam();
                          if (e.key === 'Escape') {
                            setEditingTeamId(null);
                            setEditingTeamName('');
                          }
                        }}
                        aria-label="分队名称"
                      />
                    ) : (
                      <span className="font-semibold text-sm text-gray-700 truncate" title={team.name}>
                        {team.name}
                      </span>
                    )}
                    <span className="text-xs text-gray-500">({members.length})</span>
                  </button>

                  <div className="flex w-full sm:w-auto flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:ml-auto min-w-0">
                    <select
                      defaultValue=""
                      className="text-xs border border-gray-300 rounded px-1 py-1 bg-white disabled:opacity-50 w-full sm:w-44 min-w-0 max-w-full truncate"
                      disabled={isGenerating || indexedCombatants.length === 0}
                      onChange={(e) => {
                        const value = e.currentTarget.value;
                        if (!value) return;
                        updateCombatantTeam(value, team.id);
                        e.currentTarget.value = '';
                      }}
                      title="把角色加入/转移到该分队"
                    >
                      <option value="">添加/转移成员…</option>
                      {indexedCombatants
                        .filter((item) => item.combatant.teamId !== team.id)
                        .map((item) => {
                          const identifier = getCombatantIdentifier(item.combatant);
                          const isPlaceholder = 'id' in item.combatant;
                          const data = isPlaceholder ? null : (item.combatant as CombatantData);
                          const name = isPlaceholder ? item.combatant.filename : getCombatantDisplayName(data?.data);
                          return (
                            <option key={identifier} value={identifier}>
                              {name}（{getTeamLabel(item.combatant.teamId)}）
                            </option>
                          );
                        })}
                    </select>

                    <button
                      type="button"
                      onClick={() => beginEditTeam(team.id)}
                      disabled={isGenerating}
                      className="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded hover:bg-gray-200 disabled:opacity-50"
                    >
                      改名
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (isGenerating) return;
                        if (!confirm(`确定删除分队「${team.name}」吗？成员会回到未分队。`)) return;
                        removeTeam(team.id);
                      }}
                      disabled={isGenerating}
                      className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded hover:bg-red-200 disabled:opacity-50"
                    >
                      删除
                    </button>
                  </div>
                </div>

                {!isCollapsed && (
                  <div id={`arena-team-${team.id}-content`} className="p-2 pt-0 space-y-2">
                    {members.length === 0 ? (
                      <div className="text-xs text-gray-500 px-1 py-2">暂无成员（可用右侧下拉框添加/转移）</div>
                    ) : (
                      members.map((item) => renderCombatantRow(item.combatant, item.index))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
