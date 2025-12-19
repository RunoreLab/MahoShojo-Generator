'use client';

import { useMemo, useState } from 'react';
import Head from 'next/head';

import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { useAuth } from '@/lib/useAuth';
import { config as appConfig } from '@/lib/config';
import { Preset } from '@/pages/api/get-presets';

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
import { useBattleStore } from './stores/useBattleStore';
import { BattleStoreState, CombatantData } from './types';
import { useBattleActions } from './hooks/useBattleActions';
import { usePresetQuery, useLanguagesQuery, useStatsQuery } from './hooks/useArenaData';

export function ArenaPage() {
  const { isAuthenticated } = useAuth();
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [dataModalType, setDataModalType] = useState<'character' | 'scenario'>('character');
  const [selectedCombatant, setSelectedCombatant] = useState<CombatantData | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

  const combatants = useBattleStore((state: BattleStoreState) => state.combatants);
  const battleMode = useBattleStore((state: BattleStoreState) => state.battleMode);
  const isGenerating = useBattleStore((state: BattleStoreState) => state.isGenerating);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const error = useBattleStore((state: BattleStoreState) => state.error);

  const { handleSelectDataCard, handleRandomMatch } = useBattleActions();

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
            {battleMode === 'scenario' && (
              <ScenarioPanel
                onOpenScenarioModal={handleOpenScenarioDataModal}
                onRandomMatchScenario={() => handleRandomMatch('scenario')}
                isAuthenticated={isAuthenticated}
              />
            )}
            <BattleSettings />
            <StoryOptions languages={languages} afterUserGuidance={<AdjudicatorPanel />} />
            <GenerationModeSwitcher />
            <BattleActions />
            <div className="text-center mt-3">
              <a
                href="https://qun.qq.com/universal-share/share?ac=1&busi_data=eyJncm91cENvZGUiOiIxMDU5ODMwOTUyIiwidG9rZW4iOiJNUFN6UVpBRVZNNU9COWpBa21DU1lxczRObXhiKy9kSzEvbHhOcnNpT1RBZUVVU3dtZ2hUQjJVNGtuYk5ISDhrIiwidWluIjoiMTAxOTcyNzcxMCJ9&data=DxfxSXDeGY3mgLKqoTGEoHkfqpums19TEW8Alu5Ikc3uCmV0O8YkLVLyRTMOp61VjFN387-7QL8-j2AFHUX2QXq525oXb8rl0lNhm0K453Q&svctype=5&tempid=h5_group_info"
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-blue-600 hover:underline font-semibold"
              >
                点击加入QQ交流群
              </a>
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
            <div className="flex justify-between items-center m-0">
              <div></div>
              <button
                onClick={() => setShowImageModal(false)}
                className="text-gray-500 hover:text-gray-700 text-3xl leading-none"
                style={{ marginRight: '0.5rem' }}
              >
                ×
              </button>
            </div>
            <p className="text-center text-sm text-gray-600" style={{ marginTop: '0.5rem' }}>
              📱 长按图片保存到相册
            </p>
            <div className="items-center flex flex-col" style={{ padding: '0.5rem' }}>
              <img src={savedImageUrl} alt="魔法少女战斗报告" className="w-full h-auto rounded-lg mx-auto" />
            </div>
          </div>
        </div>
      )}

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={(card) => {
          handleSelectDataCard(card);
          setShowBattleDataModal(false);
        }}
        selectedType={dataModalType}
      />

      {selectedCombatant && (
        <DataCardDetailsModal
          isOpen
          onClose={() => setSelectedCombatant(null)}
          card={{
            id: selectedCombatant.filename,
            name: getCombatantDisplayName(selectedCombatant.data),
            description: '角色详细设定',
            type: 'character',
            data: JSON.stringify(selectedCombatant.data, null, 2),
            isPublic: Boolean(selectedCombatant.isPreset),
          }}
        />
      )}
    </>
  );
}

function getCombatantDisplayName(data: any): string {
  return data?.codename || data?.name || data?.title || '未命名';
}
