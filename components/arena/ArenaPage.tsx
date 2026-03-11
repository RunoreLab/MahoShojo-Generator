'use client';

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { ErrorMessage } from '@/components/ErrorMessage';
import { qqGroups } from '@/lib/communityGroups';
import { useAuth } from '@/lib/useAuth';
import { config as appConfig } from '@/lib/config';
import type { Preset } from '@/lib/presets';
import { CollapsibleSection } from '@/components/shared/CollapsibleSection';

import { BattleHeader } from './components/BattleHeader';
import { PresetSelector } from './components/PresetSelector';
import { DatabaseSelector } from './components/DatabaseSelector';
import { RosterUploader } from './components/RosterUploader';
import { CombatantList } from './components/CombatantList';
import { ScenarioPanel } from './components/ScenarioPanel';
import { BattleSettings } from './components/BattleSettings';
import { AdjudicatorPanel } from './components/AdjudicatorPanel';
import { StoryOptions } from './components/StoryOptions';
import { QuestionnaireLorePanel } from './components/QuestionnaireLorePanel';
import { BattleActions } from './components/BattleActions';
import { BattleResult } from './components/BattleResult';
import { BattleStorySessionPanel } from './components/BattleStorySessionPanel';
import { BattleModeSwitcher } from './components/BattleModeSwitcher';
import { GenerationModeSwitcher } from './components/GenerationModeSwitcher';
import { ArenaStatistics } from './components/ArenaStatistics';
import { RankingQuickActions } from './components/RankingQuickActions';
import { useBattleStore } from './stores/useBattleStore';
import {
  BattleStoreState,
  CombatantData,
  formatCombatantCount,
  hasCombatantLimit,
  MAX_AUX_SCENARIOS,
  MAX_COMBATANTS,
} from './types';
import { useBattleActions } from './hooks/useBattleActions';
import { usePresetQuery, useLanguagesQuery, useStatsQuery } from './hooks/useArenaData';
import { ArenaRankingModal } from './components/ArenaRankingModal';

export function ArenaPage() {
  const { isAuthenticated } = useAuth();
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [dataModalType, setDataModalType] = useState<'character' | 'scenario' | 'auxScenario'>('character');
  const [selectedCombatant, setSelectedCombatant] = useState<CombatantData | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showRankingModal, setShowRankingModal] = useState(false);

  const combatants = useBattleStore((state: BattleStoreState) => state.combatants);
  const scenario = useBattleStore((state: BattleStoreState) => state.scenario);
  const auxScenarios = useBattleStore((state: BattleStoreState) => state.auxScenarios);
  const battleMode = useBattleStore((state: BattleStoreState) => state.battleMode);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const error = useBattleStore((state: BattleStoreState) => state.error);

  const { handleSelectDataCard, handleRandomMatch, handleToggleAuxScenarioDataCard, handleToggleCombatantDataCard } = useBattleActions();

  const { grouped: presetGrouped } = usePresetQuery();
  const { data: languages } = useLanguagesQuery();
  const { data: stats, isLoading: isLoadingStats } = useStatsQuery();

  const presetCombatantCount = useMemo(
    () => combatants.filter((item) => 'data' in item && (item as CombatantData).isPreset).length,
    [combatants],
  );
  const characterMaxSelected = hasCombatantLimit(MAX_COMBATANTS) ? MAX_COMBATANTS : undefined;

  const scenarioSummary = useMemo(() => {
    if (battleMode !== 'scenario') return '当前未启用情景模式';
    const titleRaw = (scenario.content as any)?.title ?? (scenario.content as any)?.name;
    const title = typeof titleRaw === 'string' ? titleRaw.trim() : '';
    const main = title || scenario.fileName || '未选择主情景';
    const auxCount = auxScenarios.length;
    return auxCount > 0 ? `主情景：${main}｜辅助：${auxCount}` : `主情景：${main}`;
  }, [auxScenarios.length, battleMode, scenario.content, scenario.fileName]);

  const presetInfo = useMemo(() => {
    const map = new Map<string, string>();
    if (presetGrouped) {
      presetGrouped.magicalGirl.forEach((preset: Preset) => map.set(preset.name, preset.description));
      presetGrouped.canshou.forEach((preset: Preset) => map.set(preset.name, preset.description));
    }
    return map;
  }, [presetGrouped]);

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

  return (
    <>
      <Head>
        <title>魔法少女竞技场 - MahoShojo Generator</title>
        <meta
          name="description"
          content="上传魔法少女、残兽或通用角色的设定，生成她们之间的战斗或日常故事！"
        />
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div
            className="card"
            style={{ border: '2px solid var(--app-border-strong)', background: 'var(--app-surface-90)' }}
          >
            <BattleHeader />
            <div className="flex justify-end mt-2">
              <div className="flex items-center gap-3 text-sm flex-wrap">
                <button
                  onClick={() => setShowRankingModal(true)}
                  className="text-blue-600 hover:underline font-semibold"
                >
                  快速查看排行榜
                </button>
                <Link href="/ranking" className="text-blue-600 hover:underline">
                  进入排行榜页
                </Link>
              </div>
            </div>

            <CollapsibleSection
              title="🎴 预设角色（内置）"
              description={`已选 ${formatCombatantCount(presetCombatantCount, MAX_COMBATANTS)}（可选项，常用可展开）`}
              defaultOpen={false}
              disabled={isGenerating}
              storageKey="arena.section.presetCharacters.open"
              className="mt-4"
            >
              <PresetSelector />
            </CollapsibleSection>

            <CollapsibleSection
              title="🌐 在线角色库 / 随机匹配"
              description={`当前已选 ${formatCombatantCount(combatants.length, MAX_COMBATANTS)}`}
              defaultOpen
              disabled={isGenerating}
              storageKey="arena.section.characterDatabase.open"
              className="mt-4"
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
              className="mt-4"
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
              className="mt-4"
            >
              <CombatantList onShowDetails={(combatant) => setSelectedCombatant(combatant)} />
            </CollapsibleSection>

            <CollapsibleSection
              title="🎮 模式选择"
              description="不同模式会影响输出风格与计分规则"
              defaultOpen
              disabled={isGenerating}
              storageKey="arena.section.battleMode.open"
              className="mt-4"
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
                className="mt-4"
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
              title="🏁 排位与快速设置"
              description="用于排位计分相关的一键检查/修复（高级）"
              defaultOpen={false}
              disabled={isGenerating}
              keepMounted
              storageKey="arena.section.rankingQuickActions.open"
              className="mt-4"
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
              className="mt-4"
            >
              <BattleSettings />
            </CollapsibleSection>

            <CollapsibleSection
              title="🧠 故事引导 / 裁判 / AI 模型"
              description="这里的设置会直接影响生成风格与稳定性"
              defaultOpen
              disabled={isGenerating}
              keepMounted
              storageKey="arena.section.storyOptions.open"
              className="mt-4"
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
              className="mt-4"
            >
              <GenerationModeSwitcher />
            </CollapsibleSection>

            <CollapsibleSection
              title="🚀 开始生成"
              description="确认设置后点击按钮生成战报"
              collapsible={false}
              className="mt-4"
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
              className="mt-4"
            >
              <div className="text-center">
                <div className="text-sm font-semibold">
                  点击加入QQ群（任选其一）：
                  <div className="text-sm text-blue-600 font-semibold">
                    {qqGroups.map((group, index) => (
                      <span key={group.groupCode}>
                        {index > 0 ? ' / ' : ' '}
                        <a
                          href={group.joinUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="hover:underline"
                          title={group.name}
                        >
                          {group.groupCode}
                        </a>
                      </span>
                    ))}
                  </div>
                </div>
              </div>
              <div className="text-center mt-3">
                <a
                  href="https://pd.qq.com/s/brisxifbl"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline font-semibold"
                >
                  点击加入腾讯频道
                </a>
              </div>
            </CollapsibleSection>
          </div>

          <BattleResult onSaveImage={handleSaveImage} />
          <BattleStorySessionPanel onSaveImage={handleSaveImage} />

          {appConfig.SHOW_STAT_DATA && (
            <ArenaStatistics stats={stats} isLoading={isLoadingStats} presetInfo={presetInfo} />
          )}

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
                : undefined
            )
        }
        selectedType={dataModalType === 'character' ? 'character' : 'scenario'}
        titleOverride={dataModalType === 'auxScenario' ? '选择辅助情景' : undefined}
        selectionMode={dataModalType === 'scenario' ? 'single' : 'multi'}
        selectedCardIds={
          dataModalType === 'character'
            ? selectedCharacterDataCardIds
            : (dataModalType === 'auxScenario' ? selectedAuxScenarioDataCardIds : selectedScenarioDataCardIds)
        }
        selectedCountOverride={
          dataModalType === 'character'
            ? combatants.length
            : (dataModalType === 'auxScenario' ? auxScenarios.length : undefined)
        }
        maxSelected={dataModalType === 'character' ? characterMaxSelected : (dataModalType === 'auxScenario' ? MAX_AUX_SCENARIOS : undefined)}
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
}

function getCombatantDisplayName(data: any): string {
  return data?.codename || data?.name || data?.title || '未命名';
}
