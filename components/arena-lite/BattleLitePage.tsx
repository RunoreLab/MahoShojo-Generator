'use client';

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';
import { useAuth } from '@/lib/useAuth';

import { BattleActions } from '@/components/arena/components/BattleActions';
import { BattleModeSwitcher } from '@/components/arena/components/BattleModeSwitcher';
import { BattleResult } from '@/components/arena/components/BattleResult';
import { BattleStorySessionPanel } from '@/components/arena/components/BattleStorySessionPanel';
import { CombatantList } from '@/components/arena/components/CombatantList';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';
import { GenerationModeSwitcher } from '@/components/arena/components/GenerationModeSwitcher';
import { PresetSelector } from '@/components/arena/components/PresetSelector';
import { RosterUploader } from '@/components/arena/components/RosterUploader';
import { ArenaRankingModal } from '@/components/arena/components/ArenaRankingModal';
import { useBattleActions } from '@/components/arena/hooks/useBattleActions';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import {
  type BattleStoreState,
  type CombatantData,
  formatCombatantCount,
  hasCombatantLimit,
  MAX_COMBATANTS,
} from '@/components/arena/types';
import { getCombatantDisplayName } from '@/components/arena/utils/characterValidator';
import { ArenaCommunitySection } from '@/components/arena/shared/ArenaCommunitySection';
import { ArenaPageLinks } from '@/components/arena/shared/ArenaPageLinks';
import { ArenaRankingLinks } from '@/components/arena/shared/ArenaRankingLinks';

import { BattleLiteHeader } from './BattleLiteHeader';
import { BattleLiteScenarioSection } from './BattleLiteScenarioSection';
import { BattleLiteStoryOptions } from './BattleLiteStoryOptions';

export function BattleLitePage() {
  const { isAuthenticated } = useAuth();
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [dataModalType, setDataModalType] = useState<'character' | 'scenario'>('character');
  const [selectedCombatant, setSelectedCombatant] = useState<CombatantData | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showRankingModal, setShowRankingModal] = useState(false);

  const combatants = useBattleStore((state: BattleStoreState) => state.combatants);
  const scenario = useBattleStore((state: BattleStoreState) => state.scenario);
  const battleMode = useBattleStore((state: BattleStoreState) => state.battleMode);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const error = useBattleStore((state: BattleStoreState) => state.error);
  const applyBattleLiteDefaults = useBattleStore((state: BattleStoreState) => state.applyBattleLiteDefaults);

  const { handleSelectDataCard, handleRandomMatch, handleToggleCombatantDataCard } = useBattleActions();

  const presetCombatantCount = useMemo(
    () => combatants.filter((item) => 'data' in item && (item as CombatantData).isPreset).length,
    [combatants],
  );
  const characterMaxSelected = hasCombatantLimit(MAX_COMBATANTS) ? MAX_COMBATANTS : undefined;

  const selectedCharacterDataCardIds = useMemo(() => {
    const out: string[] = [];
    combatants.forEach((combatant) => {
      if ('sourceDataCardId' in combatant && typeof combatant.sourceDataCardId === 'string' && combatant.sourceDataCardId) {
        out.push(combatant.sourceDataCardId);
      }
    });
    return out;
  }, [combatants]);

  const selectedScenarioDataCardIds = useMemo(() => {
    return typeof scenario?.sourceDataCardId === 'string' && scenario.sourceDataCardId ? [scenario.sourceDataCardId] : [];
  }, [scenario?.sourceDataCardId]);

  const handleOpenCharacterDataModal = () => {
    setDataModalType('character');
    setShowBattleDataModal(true);
  };

  const handleOpenScenarioDataModal = () => {
    setDataModalType('scenario');
    setShowBattleDataModal(true);
  };

  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  useEffect(() => {
    applyBattleLiteDefaults();
  }, [applyBattleLiteDefaults]);

  useEffect(() => {
    return () => {
      if (savedImageUrl && savedImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(savedImageUrl);
      }
    };
  }, [savedImageUrl]);

  return (
    <>
      <Head>
        <title>魔法少女竞技场（简洁版） - MahoShojo Generator</title>
        <meta
          name="description"
          content="面向新用户的简洁单列竞技场页：更轻量地选择角色、情景并开始生成战报。"
        />
      </Head>

      <div className="magic-background-white">
        <div className="mx-auto w-full max-w-[820px] px-4 pb-8 pt-6 sm:px-6 lg:px-8">
          <div
            className="rounded-[30px] border px-4 py-5 sm:px-6 sm:py-6"
            style={{
              borderColor: 'var(--app-border-strong)',
              background: 'var(--app-surface-90)',
              boxShadow: 'var(--app-card-shadow)',
              backdropFilter: 'blur(10px)',
            }}
          >
            <BattleLiteHeader />

            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <ArenaRankingLinks onOpenRankingModal={() => setShowRankingModal(true)} />
              <ArenaPageLinks variant="lite" />
            </div>

            <div className="mt-6 space-y-4">
              <CollapsibleSection
                title="🎴 预设角色"
                description={`已选 ${formatCombatantCount(presetCombatantCount, MAX_COMBATANTS)}，适合快速开始`}
                defaultOpen
                disabled={isGenerating}
                storageKey="battle-lite.section.presetCharacters.open"
              >
                <PresetSelector />
              </CollapsibleSection>

              <CollapsibleSection
                title="🌐 在线角色库 / 随机匹配"
                description={`当前已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`}
                defaultOpen={false}
                disabled={isGenerating}
                storageKey="battle-lite.section.characterDatabase.open"
              >
                <DatabaseSelector
                  className="!mb-0"
                  title={null}
                  layout="column"
                  onOpenCharacterModal={handleOpenCharacterDataModal}
                  onRandomMatchCharacter={() => handleRandomMatch('character')}
                  isAuthenticated={isAuthenticated}
                  isGenerating={isGenerating}
                  isMatching={isMatching}
                  combatantCount={combatants.length}
                />
                <div className="mt-2 text-xs text-gray-600">
                  提示：浏览在线角色库可选择公开/私有数据卡；随机匹配仅从公开角色库中抽取。
                </div>
              </CollapsibleSection>

              <CollapsibleSection
                title="📁 本地导入（上传 / 粘贴）"
                description="支持上传多个 .json 或直接粘贴文本"
                defaultOpen={false}
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.localImport.open"
              >
                <RosterUploader />
              </CollapsibleSection>

              <CollapsibleSection
                title="👥 已选角色 / 分队"
                description={`已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`}
                defaultOpen
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.combatants.open"
              >
                <CombatantList onShowDetails={(combatant) => setSelectedCombatant(combatant)} />
              </CollapsibleSection>

              <CollapsibleSection
                title="🎮 模式选择"
                description="不同模式会影响输出风格与计分规则"
                defaultOpen
                disabled={isGenerating}
                storageKey="battle-lite.section.battleMode.open"
              >
                <BattleModeSwitcher />
              </CollapsibleSection>

              {battleMode === 'scenario' && (
                <CollapsibleSection
                  title="🎭 情景设置"
                  description={scenario.content ? '仅保留主情景，避免主流程过载' : '当前还未选择主情景'}
                  defaultOpen
                  autoOpen={scenario.content === null}
                  disabled={isGenerating}
                  keepMounted
                  storageKey="battle-lite.section.scenario.open"
                >
                  <BattleLiteScenarioSection
                    onOpenScenarioModal={handleOpenScenarioDataModal}
                    isAuthenticated={isAuthenticated}
                  />
                </CollapsibleSection>
              )}

              <CollapsibleSection
                title="🧠 故事方向引导 / AI 提供商"
                description="保留故事方向引导与自定义 AI 提供商，其余高级项交给完整版"
                defaultOpen
                disabled={isGenerating}
                keepMounted
                storageKey="battle-lite.section.storyOptions.open"
              >
                <BattleLiteStoryOptions />
              </CollapsibleSection>

              <CollapsibleSection
                title="⚡ 生成方式"
                description="流式生成可边生成边阅读；非流式适合一次性结果"
                defaultOpen={false}
                disabled={isGenerating}
                storageKey="battle-lite.section.generationMode.open"
              >
                <GenerationModeSwitcher />
              </CollapsibleSection>

              <CollapsibleSection
                title="🚀 开始生成"
                description="确认设置后点击按钮生成战报"
                collapsible={false}
              >
                <BattleActions showAdvancedUtilities={false} />
                {error ? (
                  <ErrorMessage
                    message={error}
                    className={`mt-3 rounded-md p-4 text-sm ${
                      error.startsWith('❌') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                    }`}
                  />
                ) : null}
              </CollapsibleSection>

              <CollapsibleSection
                title="💬 社区"
                description="QQ群 / 腾讯频道"
                defaultOpen={false}
                storageKey="battle-lite.section.community.open"
              >
                <ArenaCommunitySection />
              </CollapsibleSection>
            </div>
          </div>

          <BattleResult onSaveImage={handleSaveImage} />
          <BattleStorySessionPanel onSaveImage={handleSaveImage} />

          <div className="mt-8 text-center">
            <button onClick={() => window.location.assign('/')} className="footer-link">
              返回首页
            </button>
          </div>

          <Footer />
        </div>
      </div>

      {showImageModal && savedImageUrl ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black"
          style={{ backgroundColor: 'rgba(0, 0, 0, 0.7)', paddingLeft: '2rem', paddingRight: '2rem' }}
        >
          <div className="relative max-h-[80vh] w-full max-w-lg overflow-auto rounded-lg bg-white">
            <div className="sticky top-0 z-10 flex justify-end bg-white/95 p-2 backdrop-blur">
              <button
                onClick={() => {
                  setShowImageModal(false);
                  setSavedImageUrl(null);
                }}
                aria-label="关闭"
                className="text-3xl leading-none text-gray-500 hover:text-gray-700"
              >
                ×
              </button>
            </div>
            <div className="px-4 pb-4">
              <p className="mt-2 text-center text-sm text-gray-600">📱 长按图片保存到相册</p>
              <div className="flex flex-col items-center p-2">
                <img src={savedImageUrl} alt="魔法少女战斗报告" className="mx-auto h-auto w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>
      ) : null}

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={(card) => void handleSelectDataCard(card)}
        onToggleCard={
          dataModalType === 'character'
            ? (card, nextSelected) => void handleToggleCombatantDataCard(card, nextSelected)
            : undefined
        }
        selectedType={dataModalType === 'character' ? 'character' : 'scenario'}
        selectionMode={dataModalType === 'scenario' ? 'single' : 'multi'}
        selectedCardIds={dataModalType === 'character' ? selectedCharacterDataCardIds : selectedScenarioDataCardIds}
        selectedCountOverride={dataModalType === 'character' ? combatants.length : undefined}
        maxSelected={dataModalType === 'character' ? characterMaxSelected : undefined}
      />

      {selectedCombatant ? (
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
      ) : null}

      <ArenaRankingModal isOpen={showRankingModal} onClose={() => setShowRankingModal(false)} />
    </>
  );
}
