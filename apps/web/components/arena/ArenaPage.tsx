'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import { useAuth } from '@/lib/useAuth';
import { ONLINE_DATA_CARD_TYPES } from '@mahoshojo/contracts/data-cards';

import { BattleHeader } from './components/BattleHeader';
import { PresetSelector } from './components/PresetSelector';
import { DatabaseSelector } from './components/DatabaseSelector';
import { RosterUploader } from './components/RosterUploader';
import { CombatantList } from './components/CombatantList';
import { ScenarioPanel } from './components/ScenarioPanel';
import { MaterialPanel } from './components/MaterialPanel';
import { BattleSettings } from './components/BattleSettings';
import { AdjudicatorPanel } from './components/AdjudicatorPanel';
import { StoryOptions } from './components/StoryOptions';
import { QuestionnaireLorePanel } from './components/QuestionnaireLorePanel';
import { BattleActions } from './components/BattleActions';
import { BattleResult } from './components/BattleResult';
import { BattleStorySessionPanel } from './components/BattleStorySessionPanel';
import { BattleModeSwitcher } from './components/BattleModeSwitcher';
import { GenerationModeSwitcher } from './components/GenerationModeSwitcher';
import { RankingQuickActions } from './components/RankingQuickActions';
import { useBattleStore } from './stores/useBattleStore';
import {
  BattleStoreState,
  CombatantData,
  formatCombatantCount,
  hasCombatantLimit,
  MAX_COMBATANTS,
} from './types';
import { useBattleActions } from './hooks/useBattleActions';
import { useLanguagesQuery } from './hooks/useArenaData';
import { ArenaRankingModal } from './components/ArenaRankingModal';
import { ArenaCommunitySection } from './shared/ArenaCommunitySection';
import { ArenaPageLinks } from './shared/ArenaPageLinks';
import { ArenaRankingLinks } from './shared/ArenaRankingLinks';
import { ArenaRoomProvider } from './multiplayer/useArenaRoom';
import { ArenaEditorWorkspaceBoundary } from './multiplayer/ArenaRoomProposalWorkspace';
import { ArenaRoomDialog } from './multiplayer/ArenaRoomDialog';
import { ArenaEditorWorkspaceLayout } from './editor/ArenaEditorWorkspaceLayout';
import {
  countArenaSelectedReferenceItems,
  getArenaReferenceRemainingCapacity,
  MAX_ARENA_REFERENCE_ITEMS,
} from '@/lib/arena/resource-budget';

const ArenaMultiplayerPanel = dynamic(
  () => import('./multiplayer/ArenaMultiplayerPanel').then((module) => (
    module.ArenaMultiplayerContextPanel
  )),
  { ssr: false },
);

const ArenaMultiplayerResult = dynamic(
  () => import('./multiplayer/ArenaMultiplayerPanel').then((module) => (
    module.ArenaMultiplayerContextResult
  )),
  { ssr: false },
);

type ArenaPageProps = {
  readonly multiplayer?: {
    readonly enabled: boolean;
    readonly origin: string;
  };
};

export function ArenaPage({ multiplayer }: ArenaPageProps = {}) {
  const { isAuthenticated, loading: authLoading, user } = useAuth();
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [dataModalType, setDataModalType] = useState<'character' | 'scenario' | 'auxScenario' | 'material'>('character');
  const [selectedCombatant, setSelectedCombatant] = useState<CombatantData | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showRankingModal, setShowRankingModal] = useState(false);

  const combatants = useBattleStore((state: BattleStoreState) => state.combatants);
  const scenario = useBattleStore((state: BattleStoreState) => state.scenario);
  const auxScenarios = useBattleStore((state: BattleStoreState) => state.auxScenarios);
  const materials = useBattleStore((state: BattleStoreState) => state.materials);
  const selectedQuestionnaires = useBattleStore((state: BattleStoreState) => state.selectedQuestionnaires);
  const battleMode = useBattleStore((state: BattleStoreState) => state.battleMode);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const error = useBattleStore((state: BattleStoreState) => state.error);

  const {
    handleSelectDataCard,
    handleRandomMatch,
    handleToggleAuxScenarioDataCard,
    handleToggleCombatantDataCard,
    handleToggleMaterialDataCard,
  } = useBattleActions();

  const { data: languages } = useLanguagesQuery();

  const presetCombatantCount = useMemo(
    () => combatants.filter((item) => 'data' in item && (item as CombatantData).isPreset).length,
    [combatants],
  );
  const characterMaxSelected = hasCombatantLimit(MAX_COMBATANTS) ? MAX_COMBATANTS : undefined;
  const referenceItemCount = countArenaSelectedReferenceItems({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });
  const referenceRemainingCapacity = getArenaReferenceRemainingCapacity({
    auxScenarios,
    materials,
    selectedQuestionnaires,
  });

  const scenarioSummary = useMemo(() => {
    if (battleMode !== 'scenario') return '当前未启用情景模式';
    const titleRaw = (scenario.content as any)?.title ?? (scenario.content as any)?.name;
    const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
    const main = title || scenario.fileName || '未选择主情景';
    const auxCount = auxScenarios.length;
    return auxCount > 0 ? `主情景：${main}｜辅助：${auxCount}` : `主情景：${main}`;
  }, [auxScenarios.length, battleMode, scenario.content, scenario.fileName]);

  const selectedCharacterDataCardIds = useMemo(() => {
    const out: string[] = [];
    combatants.forEach((c) => {
      if ('sourceDataCardId' in c && typeof c.sourceDataCardId === 'string' && c.sourceDataCardId) {
        out.push(c.sourceDataCardId);
      }
    });
    return out;
  }, [combatants]);

  const selectedScenarioDataCardIds = useMemo(() => {
    return typeof scenario?.sourceDataCardId === 'string' && scenario.sourceDataCardId ? [scenario.sourceDataCardId] : [];
  }, [scenario?.sourceDataCardId]);

  const selectedAuxScenarioDataCardIds = useMemo(() => {
    const out: string[] = [];
    auxScenarios.forEach((s) => {
      if (typeof s.sourceDataCardId === 'string' && s.sourceDataCardId) {
        out.push(s.sourceDataCardId);
      }
    });
    return out;
  }, [auxScenarios]);

  const selectedMaterialDataCardIds = useMemo(() => {
    const out: string[] = [];
    materials.forEach((material) => {
      if (typeof material.sourceDataCardId === 'string' && material.sourceDataCardId) {
        out.push(material.sourceDataCardId);
      }
    });
    return out;
  }, [materials]);

  const handleOpenCharacterDataModal = () => {
    setDataModalType('character');
    setShowBattleDataModal(true);
  };

  const handleOpenScenarioDataModal = () => {
    setDataModalType('scenario');
    setShowBattleDataModal(true);
  };

  const handleOpenAuxScenarioDataModal = () => {
    setDataModalType('auxScenario');
    setShowBattleDataModal(true);
  };

  const handleOpenMaterialDataModal = () => {
    setDataModalType('material');
    setShowBattleDataModal(true);
  };

  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  useEffect(() => {
    return () => {
      if (savedImageUrl && savedImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(savedImageUrl);
      }
    };
  }, [savedImageUrl]);

  const page = (
    <>
      <div className="magic-background-white">
        <div className="arena-page-shell mx-auto w-full max-w-[1380px] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div
            className="rounded-[28px] border p-5 sm:p-6 xl:p-8"
            style={{
              borderColor: 'var(--app-border-strong)',
              background: 'var(--app-surface-90)',
              boxShadow: 'var(--app-card-shadow)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <BattleHeader />
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm">
              <ArenaRankingLinks onOpenRankingModal={() => setShowRankingModal(true)} />
              <ArenaPageLinks variant="full" />
            </div>

            {multiplayer?.enabled ? (
              <ArenaMultiplayerPanel
                enabled
                origin={multiplayer.origin}
                authLoading={authLoading}
                isAuthenticated={isAuthenticated}
                displayName={user?.username ?? '玩家'}
              />
            ) : null}

            <ArenaEditorWorkspaceBoundary>
              <ArenaEditorWorkspaceLayout
                disabled={isGenerating}
                sections={[
                  {
                    kind: 'presetCharacters',
                    description: `已选 ${formatCombatantCount(presetCombatantCount, MAX_COMBATANTS)}`,
                    defaultOpen: true,
                    content: <PresetSelector />,
                  },
                  {
                    kind: 'characterDatabase',
                    description: `当前已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`,
                    defaultOpen: true,
                    content: (
                      <>
                        <DatabaseSelector
                          className="!mb-0"
                          title={null}
                          onOpenCharacterModal={handleOpenCharacterDataModal}
                          onRandomMatchCharacter={() => handleRandomMatch('character')}
                          isAuthenticated={isAuthenticated}
                          isGenerating={isGenerating}
                          isMatching={isMatching}
                          combatantCount={combatants.length}
                        />
                        <div className="mt-1 text-xs text-gray-600">
                          提示：浏览在线角色库可选择公开/私有数据卡；随机匹配仅从公开角色库中抽取。
                        </div>
                      </>
                    ),
                  },
                  {
                    kind: 'localImport',
                    description: '支持上传多个 .json 或直接粘贴文本',
                    defaultOpen: true,
                    keepMounted: true,
                    content: <RosterUploader />,
                  },
                  {
                    kind: 'roster',
                    description: `已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`,
                    defaultOpen: true,
                    keepMounted: true,
                    content: <CombatantList onShowDetails={(combatant) => setSelectedCombatant(combatant)} />,
                  },
                  {
                    kind: 'battleMode',
                    description: '不同模式会影响输出风格与计分规则',
                    defaultOpen: true,
                    content: <BattleModeSwitcher />,
                  },
                  ...(battleMode === 'scenario' ? [{
                    kind: 'scenario' as const,
                    description: scenarioSummary,
                    defaultOpen: true,
                    autoOpen: scenario.content === null,
                    keepMounted: true,
                    content: (
                      <ScenarioPanel
                        onOpenScenarioModal={handleOpenScenarioDataModal}
                        onRandomMatchScenario={() => handleRandomMatch('scenario')}
                        onOpenAuxScenarioModal={handleOpenAuxScenarioDataModal}
                        isAuthenticated={isAuthenticated}
                      />
                    ),
                  }] : []),
                  {
                    kind: 'materials',
                    description: `已选素材 ${materials.length}；参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`,
                    defaultOpen: false,
                    keepMounted: true,
                    content: <MaterialPanel onOpenMaterialModal={handleOpenMaterialDataModal} />,
                  },
                  {
                    kind: 'ranking',
                    description: '用于排位计分相关的一键检查/修复（高级）',
                    defaultOpen: false,
                    keepMounted: true,
                    content: <RankingQuickActions />,
                  },
                  {
                    kind: 'settings',
                    description: '建议保留默认；上下文过长或失败时可在这里精简',
                    defaultOpen: false,
                    keepMounted: true,
                    content: <BattleSettings />,
                  },
                  {
                    kind: 'story',
                    description: '这里的设置会直接影响生成风格与稳定性',
                    defaultOpen: true,
                    keepMounted: true,
                    content: (
                      <StoryOptions
                        languages={languages}
                        afterUserGuidance={(
                          <>
                            <QuestionnaireLorePanel />
                            <AdjudicatorPanel />
                          </>
                        )}
                      />
                    ),
                  },
                  {
                    kind: 'generationMode',
                    description: '流式生成可边生成边阅读；非流式适合一次性结果',
                    defaultOpen: false,
                    content: <GenerationModeSwitcher />,
                  },
                  {
                    kind: 'generationActions',
                    description: '确认设置后点击按钮生成战报',
                    collapsible: false,
                    content: (
                      <>
                        <BattleActions />
                        {error && (
                          <ErrorMessage
                            message={error}
                            className={`p-4 rounded-md mt-3 text-sm ${
                              error.startsWith('❌') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                            }`}
                          />
                        )}
                      </>
                    ),
                  },
                  {
                    kind: 'community',
                    description: 'QQ群 / 腾讯频道',
                    defaultOpen: false,
                    disabled: false,
                    content: <ArenaCommunitySection />,
                  },
                ]}
              />
            </ArenaEditorWorkspaceBoundary>
          </div>

          {multiplayer?.enabled ? (
            <ArenaMultiplayerResult onSaveImage={handleSaveImage} />
          ) : null}
          <BattleResult onSaveImage={handleSaveImage} />
          <BattleStorySessionPanel onSaveImage={handleSaveImage} />

          <div className="text-center" style={{ marginTop: '2rem' }}>
            <button onClick={() => window.location.assign('/')} className="footer-link">
              返回首页
            </button>
          </div>

          <Footer />
        </div>
      </div>

      {showImageModal && savedImageUrl ? (
        <ArenaRoomDialog
          open
          titleId="arena-saved-image-dialog-heading"
          title="保存战报图片"
          description="长按图片保存到相册。"
          widthClassName="max-w-lg"
          onClose={() => {
            setShowImageModal(false);
            setSavedImageUrl(null);
          }}
        >
          <div aria-label="战报图片" className="items-center flex flex-col p-2">
            <img src={savedImageUrl} alt="魔法少女战斗报告" className="w-full h-auto rounded-lg mx-auto" />
          </div>
        </ArenaRoomDialog>
      ) : null}

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={(card) => void handleSelectDataCard(card)}
        onToggleCard={
          dataModalType === 'character'
            ? (card, nextSelected) => void handleToggleCombatantDataCard(card, nextSelected)
            : (
              dataModalType === 'auxScenario'
                ? (card, nextSelected) => void handleToggleAuxScenarioDataCard(card, nextSelected)
                : (
                  dataModalType === 'material'
                    ? (card, nextSelected) => void handleToggleMaterialDataCard(card, nextSelected)
                    : undefined
                )
            )
        }
        selectedType={dataModalType === 'character' ? 'character' : (dataModalType === 'material' ? 'all' : 'scenario')}
        allowedTypes={dataModalType === 'material' ? [...ONLINE_DATA_CARD_TYPES] : undefined}
        titleOverride={
          dataModalType === 'auxScenario'
            ? '选择辅助情景'
            : (dataModalType === 'material' ? '选择素材' : undefined)
        }
        selectionMode={dataModalType === 'scenario' ? 'single' : 'multi'}
        selectedCardIds={
          dataModalType === 'character'
            ? selectedCharacterDataCardIds
            : (
              dataModalType === 'auxScenario'
                ? selectedAuxScenarioDataCardIds
                : (dataModalType === 'material' ? selectedMaterialDataCardIds : selectedScenarioDataCardIds)
            )
        }
        selectedCountOverride={
          dataModalType === 'character'
            ? combatants.length
            : (dataModalType === 'auxScenario' ? auxScenarios.length : (dataModalType === 'material' ? materials.length : undefined))
        }
        maxSelected={
          dataModalType === 'character'
            ? characterMaxSelected
            : (
              dataModalType === 'auxScenario'
                ? auxScenarios.length + referenceRemainingCapacity
                : (dataModalType === 'material' ? materials.length + referenceRemainingCapacity : undefined)
            )
        }
      />

      {selectedCombatant && (
        <DataCardDetailsModal
          isOpen
          onClose={() => setSelectedCombatant(null)}
          metaCardId={selectedCombatant.sourceDataCardId ? selectedCombatant.sourceDataCardId : null}
          card={{
            id: selectedCombatant.sourceDataCardId || selectedCombatant.filename,
            name:
              typeof selectedCombatant.sourceDataCardName === 'string' && selectedCombatant.sourceDataCardName.trim()
                ? selectedCombatant.sourceDataCardName
                : getCombatantDisplayName(selectedCombatant.data),
            description:
              typeof selectedCombatant.sourceDataCardDescription === 'string' &&
              selectedCombatant.sourceDataCardDescription.trim()
                ? selectedCombatant.sourceDataCardDescription
                : (selectedCombatant.isPreset ? '系统预设角色' : '本地角色设定'),
            type: 'character',
            data: JSON.stringify(selectedCombatant.data, null, 2),
            isPublic: Boolean(selectedCombatant.sourceIsPublic),
            usageCount: selectedCombatant.sourceDataCardUsageCount,
            likeCount: selectedCombatant.sourceDataCardLikeCount,
            favoriteCount: selectedCombatant.sourceDataCardFavoriteCount,
            author:
              typeof selectedCombatant.sourceAuthor === 'string' && selectedCombatant.sourceAuthor.trim()
                ? selectedCombatant.sourceAuthor
                : (selectedCombatant.isPreset ? '系统' : '—'),
            createdAt: selectedCombatant.sourceDataCardCreatedAt,
            updatedAt: selectedCombatant.sourceDataCardUpdatedAt,
          }}
        />
      )}

      <ArenaRankingModal isOpen={showRankingModal} onClose={() => setShowRankingModal(false)} />
    </>
  );

  if (!multiplayer?.enabled) return page;
  return (
    <ArenaRoomProvider
      enabled
      authenticated={isAuthenticated && !authLoading}
      origin={multiplayer.origin}
    >
      {page}
    </ArenaRoomProvider>
  );
}

function getCombatantDisplayName(data: any): string {
  return data?.codename || data?.name || data?.title || '未命名';
}
