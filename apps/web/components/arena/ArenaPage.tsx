'use client';

import { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import { useAuth } from '@/lib/useAuth';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
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

            <div className="mt-6 grid gap-5 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(340px,440px)_minmax(0,1fr)] xl:items-start">
              <div className="min-w-0 space-y-4">
                <CollapsibleSection
                  title="🎴 预设角色"
                  description={`已选 ${formatCombatantCount(presetCombatantCount, MAX_COMBATANTS)}`}
                  defaultOpen
                  disabled={isGenerating}
                  storageKey="arena.section.presetCharacters.open"
                >
                  <PresetSelector />
                </CollapsibleSection>

                <CollapsibleSection
                  title="🌐 在线角色库 / 随机匹配"
                  description={`当前已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`}
                  defaultOpen
                  disabled={isGenerating}
                  storageKey="arena.section.characterDatabase.open"
                >
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
                </CollapsibleSection>

                <CollapsibleSection
                  title="📁 本地导入（上传 / 粘贴）"
                  description="支持上传多个 .json 或直接粘贴文本"
                  defaultOpen
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.localImport.open"
                >
                  <RosterUploader />
                </CollapsibleSection>

                <CollapsibleSection
                  title="👥 已选角色 / 分队"
                  description={`已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`}
                  defaultOpen
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.combatants.open"
                >
                  <CombatantList onShowDetails={(combatant) => setSelectedCombatant(combatant)} />
                </CollapsibleSection>
              </div>

              <div className="min-w-0 space-y-4">
                <CollapsibleSection
                  title="🎮 模式选择"
                  description="不同模式会影响输出风格与计分规则"
                  defaultOpen
                  disabled={isGenerating}
                  storageKey="arena.section.battleMode.open"
                >
                  <BattleModeSwitcher />
                </CollapsibleSection>

                {battleMode === 'scenario' && (
                  <CollapsibleSection
                    title="🎭 情景设置"
                    description={scenarioSummary}
                    defaultOpen
                    autoOpen={scenario.content === null}
                    disabled={isGenerating}
                    keepMounted
                    storageKey="arena.section.scenario.open"
                  >
                    <ScenarioPanel
                      onOpenScenarioModal={handleOpenScenarioDataModal}
                      onRandomMatchScenario={() => handleRandomMatch('scenario')}
                      onOpenAuxScenarioModal={handleOpenAuxScenarioDataModal}
                      isAuthenticated={isAuthenticated}
                    />
                  </CollapsibleSection>
                )}

                <CollapsibleSection
                  title="📎 素材注入"
                  description={`已选素材 ${materials.length}；参考项合计 ${referenceItemCount}/${MAX_ARENA_REFERENCE_ITEMS}`}
                  defaultOpen={false}
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.materials.open"
                >
                  <MaterialPanel onOpenMaterialModal={handleOpenMaterialDataModal} />
                </CollapsibleSection>

                <CollapsibleSection
                  title="🏁 排位与快速设置"
                  description="用于排位计分相关的一键检查/修复（高级）"
                  defaultOpen={false}
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.rankingQuickActions.open"
                >
                  <RankingQuickActions />
                </CollapsibleSection>

                <CollapsibleSection
                  title="⚙️ 读写设置（历战 / 当前状态 / 叙事历史）"
                  description="建议保留默认；上下文过长或失败时可在这里精简"
                  defaultOpen={false}
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.battleSettings.open"
                >
                  <BattleSettings />
                </CollapsibleSection>

                <CollapsibleSection
                  title="🧠 故事引导 / 判定 / AI 模型"
                  description="这里的设置会直接影响生成风格与稳定性"
                  defaultOpen
                  disabled={isGenerating}
                  keepMounted
                  storageKey="arena.section.storyOptions.open"
                >
                  <StoryOptions
                    languages={languages}
                    afterUserGuidance={(
                      <>
                        <QuestionnaireLorePanel />
                        <AdjudicatorPanel />
                      </>
                    )}
                  />
                </CollapsibleSection>

                <CollapsibleSection
                  title="⚡ 生成方式"
                  description="流式生成可边生成边阅读；非流式适合一次性结果"
                  defaultOpen={false}
                  disabled={isGenerating}
                  storageKey="arena.section.generationMode.open"
                >
                  <GenerationModeSwitcher />
                </CollapsibleSection>

                <CollapsibleSection
                  title="🚀 开始生成"
                  description="确认设置后点击按钮生成战报"
                  collapsible={false}
                >
                  <BattleActions />
                  {error && (
                    <ErrorMessage
                      message={error}
                      className={`p-4 rounded-md mt-3 text-sm ${
                        error.startsWith('❌') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                      }`}
                    />
                  )}
                </CollapsibleSection>

                <CollapsibleSection
                  title="💬 社区"
                  description="QQ群 / 腾讯频道"
                  defaultOpen={false}
                  storageKey="arena.section.community.open"
                >
                  <ArenaCommunitySection />
                </CollapsibleSection>
              </div>
            </div>
          </div>

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

      {showImageModal && savedImageUrl && (
        <div
          className="fixed inset-0 bg-black flex items-center justify-center z-50"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem' }}
        >
          <div className="bg-white rounded-lg max-w-lg w-full max-h-[80vh] overflow-auto relative">
            <div className="sticky top-0 z-10 bg-white/95 backdrop-blur flex justify-end p-2">
              <button
                onClick={() => {
                  setShowImageModal(false);
                  setSavedImageUrl(null);
                }}
                aria-label="关闭"
                className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
              >
                ×
              </button>
            </div>
            <div className="px-4 pb-4">
              <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
                📱 长按图片保存到相册
              </p>
              <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
                <img src={savedImageUrl} alt="魔法少女战斗报告" className="w-full h-auto rounded-lg mx-auto" />
              </div>
            </div>
          </div>
        </div>
      )}

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
