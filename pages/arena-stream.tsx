import { useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Head from 'next/head';
import { useRouter } from 'next/router';

import StreamingBattleReportCard from '@/components/stream/StreamingBattleReportCard';
import { quickCheck } from '@/lib/sensitive-word-filter';
import { SocialLinks } from '@/components/SocialLinks';
import { useBattleStore } from '@/components/arena/stores/useBattleStore';
import { BattleStoreState, CombatantData } from '@/components/arena/types';
import BattleDataModal from '@/components/BattleDataModal';
import DataCardDetailsModal from '@/components/DataCardDetailsModal';
import Footer from '@/components/Footer';
import { useAuth } from '@/lib/useAuth';
import { config as appConfig } from '@/lib/config';
import { Preset } from '@/pages/api/get-presets';
import { BattleHeader } from '@/components/arena/components/BattleHeader';
import { PresetSelector } from '@/components/arena/components/PresetSelector';
import { DatabaseSelector } from '@/components/arena/components/DatabaseSelector';
import { RosterUploader } from '@/components/arena/components/RosterUploader';
import { CombatantList } from '@/components/arena/components/CombatantList';
import { ScenarioPanel } from '@/components/arena/components/ScenarioPanel';
import { BattleSettings } from '@/components/arena/components/BattleSettings';
import { AdjudicatorPanel } from '@/components/arena/components/AdjudicatorPanel';
import { StoryOptions } from '@/components/arena/components/StoryOptions';
import { BattleModeSwitcher } from '@/components/arena/components/BattleModeSwitcher';
import { ArenaStatistics } from '@/components/arena/components/ArenaStatistics';
import { StreamBattleActions } from '@/components/arena/components/StreamBattleActions';
import { useBattleActions } from '@/components/arena/hooks/useBattleActions';
import { usePresetQuery, useLanguagesQuery, useStatsQuery } from '@/components/arena/hooks/useArenaData';

function ArenaStreamPageContent() {
  const { isAuthenticated } = useAuth();
  const router = useRouter();
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);
  const [dataModalType, setDataModalType] = useState<'character' | 'scenario'>('character');
  const [selectedCombatant, setSelectedCombatant] = useState<CombatantData | null>(null);
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);

  const combatants = useBattleStore((state: BattleStoreState) => state.combatants);
  const battleMode = useBattleStore((state: BattleStoreState) => state.battleMode);
  const selectedLevel = useBattleStore((state: BattleStoreState) => state.selectedLevel);
  const scenario = useBattleStore((state: BattleStoreState) => state.scenario);
  const language = useBattleStore((state: BattleStoreState) => state.selectedLanguage);
  const adjudicationEvents = useBattleStore((state: BattleStoreState) => state.adjudicationEvents);
  const storyLength = useBattleStore((state: BattleStoreState) => state.storyLength);
  const customProvider = useBattleStore((state: BattleStoreState) => state.userProviderConfig);
  const isMatching = useBattleStore((state: BattleStoreState) => state.isMatching);
  const settings = useBattleStore((state: BattleStoreState) => state.settings);

  const { handleSelectDataCard, handleRandomMatch } = useBattleActions();

  const { grouped: presetGrouped } = usePresetQuery();
  const { data: languages } = useLanguagesQuery();
  const { data: stats, isLoading: isLoadingStats } = useStatsQuery();

  // 流式生成状态
  const [completion, setCompletion] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [streamError, setStreamError] = useState<Error | null>(null);

  const redirectToArrested = (reason?: string) => {
    if (reason && reason.trim().length > 0) {
      router.push({ pathname: '/arrested', query: { reason } });
    } else {
      router.push('/arrested');
    }
  };

  const checkSensitiveContent = async (text?: string | null, reason?: string) => {
    if (!appConfig.ENABLE_SENSITIVE_WORD_FILTER || !text || !text.trim()) {
      return false;
    }
    const result = await quickCheck(text);
    if (result.shouldRedirectToArrested) {
      redirectToArrested(reason);
      return true;
    }
    return false;
  };

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

  const handleGenerate = async () => {
    const minParticipants = (battleMode === 'daily' || battleMode === 'scenario') ? 1 : 2;
    if (combatants.length < minParticipants) {
      alert(`该模式需要至少 ${minParticipants} 位角色`);
      return;
    }

    // 情景模式检查
    if (battleMode === 'scenario' && !scenario.content) {
      alert('⚠️ 情景模式下，请先上传一个情景文件。');
      return;
    }

    // 构建 teams 对象
    const teams: Record<number, string[]> = {};
    combatants.forEach((combatant) => {
      if ('teamId' in combatant && combatant.teamId) {
        if (!teams[combatant.teamId]) teams[combatant.teamId] = [];
        const name = 'data' in combatant ? (combatant.data.codename || combatant.data.name) : '';
        if (name) teams[combatant.teamId].push(name);
      }
    });

    setIsLoading(true);
    setStreamError(null);
    setCompletion('');

    try {
      const requestBody = {
        combatants,
        selectedLevel,
        mode: battleMode,
        userGuidance: settings.userGuidance,
        scenario: scenario.content,
        teams: Object.keys(teams).length > 0 ? teams : undefined,
        language,
        useArenaHistory: settings.readArenaHistory,
        arenaHistoryReadLimit: settings.isArenaHistoryUnlimited ? null : settings.readArenaHistoryLimit,
        readArenaHistory: settings.readArenaHistory,
        readCurrentState: settings.readCurrentState,
        adjudicationEvents,
        storyLength,
        customProvider,
      };
      const payloadString = JSON.stringify(requestBody);
      if (await checkSensitiveContent(payloadString, '使用危险符文')) {
        setIsLoading(false);
        return;
      }

      console.log('🔍 [DEBUG] 发送请求:', {
        mode: battleMode,
        hasScenario: !!scenario.content,
        scenarioKeys: scenario.content ? Object.keys(scenario.content) : null,
        combatantsCount: combatants.length,
      });

      const response = await fetch('/api/arena/generate-stream', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('❌ [DEBUG] 响应错误:', errorData);
        throw new Error(errorData.error || '生成失败');
      }

      console.log('✅ [DEBUG] 响应成功，开始读取流');

      // 读取流式响应
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error('无法读取响应流');
      }

      let accumulatedText = '';
      let chunkCount = 0;
      let abortedDueToSensitiveWord = false;

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          console.log(`✅ [DEBUG] 流读取完成，共接收 ${chunkCount} 个块，总长度: ${accumulatedText.length}`);
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        chunkCount++;
        accumulatedText += chunk;

        if (chunkCount <= 3) {
          console.log(`📦 [DEBUG] 收到第 ${chunkCount} 个块，大小: ${chunk.length}，内容预览: ${chunk.substring(0, 50)}...`);
        }

        setCompletion(accumulatedText);

        if (
          !abortedDueToSensitiveWord &&
          (await checkSensitiveContent(accumulatedText, '输出内容触发安全策略'))
        ) {
          abortedDueToSensitiveWord = true;
          try {
            await reader.cancel();
          } catch (cancelError) {
            console.warn('取消流读取失败', cancelError);
          }
          break;
        }
      }

      setIsLoading(false);
      if (abortedDueToSensitiveWord) {
        return;
      }
    } catch (error) {
      console.error('生成失败:', error);
      setStreamError(error instanceof Error ? error : new Error('未知错误'));
      setIsLoading(false);
    }
  };

  return (
    <>
      <Head>
        <title>魔法少女竞技场·流 - MahoShojo Generator</title>
        <meta
          name="description"
          content="上传魔法少女、残兽或通用角色的设定，流式生成她们之间的战斗或日常故事！"
        />
      </Head>
      <div className="magic-background-white">
        <div className="container">
          <div className="card" style={{ border: '2px solid #ccc', background: '#f9f9f9' }}>
            <BattleHeader />
            <div className="text-center mb-4">
              <span className="inline-block bg-pink-100 text-pink-800 text-xs font-semibold px-3 py-1 rounded-full">
                🌸 流式生成版本 - 实时观看战报生成过程
              </span>
            </div>
            <PresetSelector />
            <DatabaseSelector
              onOpenCharacterModal={handleOpenCharacterDataModal}
              onRandomMatchCharacter={() => handleRandomMatch('character')}
              isAuthenticated={isAuthenticated}
              isGenerating={isLoading}
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

            <StreamBattleActions onGenerate={handleGenerate} isLoading={isLoading} />

            {/* 流式战报显示区域 */}
            {completion && (
              <div className="mt-6">
                <StreamingBattleReportCard
                  content={completion}
                  onSaveImage={handleSaveImage}
                  mode={battleMode}
                  isStreaming={isLoading}
                />
              </div>
            )}

            <SocialLinks />

            {streamError && (
              <div className="p-4 rounded-md my-4 text-sm whitespace-pre-wrap bg-red-100 text-red-800">
                ❌ 生成失败: {streamError.message}
              </div>
            )}
          </div>

          {appConfig.SHOW_STAT_DATA && (
            <ArenaStatistics stats={stats} isLoading={isLoadingStats} presetInfo={presetInfo} />
          )}

          <div className="text-center" style={{ marginTop: '2rem' }}>
            <button
              onClick={() => window.location.assign('/arena')}
              className="footer-link"
              style={{ marginRight: '1rem' }}
            >
              切换到标准版
            </button>
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

export default function ArenaStreamPage() {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <QueryClientProvider client={queryClient}>
      <ArenaStreamPageContent />
    </QueryClientProvider>
  );
}
