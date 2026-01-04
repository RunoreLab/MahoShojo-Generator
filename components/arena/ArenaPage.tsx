'use client';

import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';
import Link from 'next/link';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { qqGroups } from '@/lib/communityGroups';
import { useAuth } from '@/lib/useAuth';
import { config as appConfig } from '@/lib/config';
import type { Preset } from '@/lib/presets';

import { BattleHeader } from './components/BattleHeader';
import { PresetSelector } from './components/PresetSelector';
import { DatabaseSelector } from './components/DatabaseSelector';
import { RosterUploader } from './components/RosterUploader';
import { CombatantList } from './components/CombatantList';
import { ScenarioPanel } from './components/ScenarioPanel';
import { BattleSettings } from './components/BattleSettings';
import { AdjudicatorPanel } from './components/AdjudicatorPanel';
import { StoryOptions } from './components/StoryOptions';
import { BattleActions } from './components/BattleActions';
import { BattleResult } from './components/BattleResult';
import { BattleModeSwitcher } from './components/BattleModeSwitcher';
import { GenerationModeSwitcher } from './components/GenerationModeSwitcher';
import { ArenaStatistics } from './components/ArenaStatistics';
import { RankingQuickActions } from './components/RankingQuickActions';
import { useBattleStore } from './stores/useBattleStore';
import { BattleStoreState, CombatantData, MAX_AUX_SCENARIOS, MAX_COMBATANTS } from './types';
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

  const { handleSelectDataCard, handleRandomMatch, handleToggleAuxScenarioDataCard } = useBattleActions();

  const { grouped: presetGrouped } = usePresetQuery();
  const { data: languages } = useLanguagesQuery();
  const { data: stats, isLoading: isLoadingStats } = useStatsQuery();

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
          <div className="card" style={{ border: '2px solid #ccc', background: '#f9f9f9' }}>
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
            <PresetSelector />
            <DatabaseSelector
              onOpenCharacterModal={handleOpenCharacterDataModal}
              onRandomMatchCharacter={() => handleRandomMatch('character')}
              isAuthenticated={isAuthenticated}
              isGenerating={isGenerating}
              isMatching={isMatching}
              combatantCount={combatants.length}
            />
            <RosterUploader />
            <CombatantList onShowDetails={(combatant) => setSelectedCombatant(combatant)} />
            <BattleModeSwitcher />
            <RankingQuickActions />
            {battleMode === 'scenario' && (
              <ScenarioPanel
                onOpenScenarioModal={handleOpenScenarioDataModal}
                onRandomMatchScenario={() => handleRandomMatch('scenario')}
                onOpenAuxScenarioModal={handleOpenAuxScenarioDataModal}
                isAuthenticated={isAuthenticated}
              />
            )}
            <BattleSettings />
            <StoryOptions languages={languages} afterUserGuidance={<AdjudicatorPanel />} />
            <GenerationModeSwitcher />
            <BattleActions />
            <div className="text-center mt-3">
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
            {error && (
              <div
                className={`p-4 rounded-md my-4 text-sm whitespace-pre-wrap ${error.startsWith('❌') ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                  }`}
              >
                {error}
              </div>
            )}
          </div>

          <BattleResult onSaveImage={handleSaveImage} />

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
          dataModalType === 'auxScenario'
            ? (card, nextSelected) => void handleToggleAuxScenarioDataCard(card, nextSelected)
            : undefined
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
        maxSelected={dataModalType === 'character' ? MAX_COMBATANTS : (dataModalType === 'auxScenario' ? MAX_AUX_SCENARIOS : undefined)}
      />

      {selectedCombatant && (
        <DataCardDetailsModal
          isOpen
          onClose={() => setSelectedCombatant(null)}
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
