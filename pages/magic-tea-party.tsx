import Head from 'next/head';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

import type { UserAIProviderConfig } from '@/components/AiProviderSelector';
import Footer from '@/components/Footer';
import { MagicTeaPartyCardModals } from '@/components/magic-tea-party/CardModals';
import { MagicTeaPartyChatComposer } from '@/components/magic-tea-party/ChatComposer';
import { MagicTeaPartyChatTimeline } from '@/components/magic-tea-party/ChatTimeline';
import { MagicTeaPartyHero } from '@/components/magic-tea-party/Hero';
import { MagicTeaPartySessionSidebar } from '@/components/magic-tea-party/SessionSidebar';
import { MagicTeaPartySessionSetupPanel } from '@/components/magic-tea-party/SessionSetupPanel';
import { MagicTeaPartySummaryPanel } from '@/components/magic-tea-party/SummaryPanel';
import { MagicTeaPartyTachiePanel } from '@/components/magic-tea-party/TachiePanel';

import { readMagicTeaPartyDraft, writeMagicTeaPartyDraft } from '@/lib/magic-tea-party/drafts';
import { buildMagicTeaPartyHistory } from '@/lib/magic-tea-party/history';
import { useMagicTeaPartyChat } from '@/lib/magic-tea-party/useMagicTeaPartyChat';
import { useMagicTeaPartySessions } from '@/lib/magic-tea-party/useMagicTeaPartySessions';
import type { MagicTeaPartyMessage, MagicTeaPartyRole, MagicTeaPartyTachieAsset, MagicTeaPartyUpdateDraft } from '@/lib/magic-tea-party/types';
import { useAuth } from '@/lib/useAuth';

export default function MagicTeaPartyPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [globalError, setGlobalError] = useState<string | null>(null);
  const [userProviderConfig, setUserProviderConfig] = useState<UserAIProviderConfig | null>(null);

  const {
    sessions,
    activeSessionId,
    setActiveSessionId,
    activeSession,
    messages,
    setMessages,
    preferences,
    applyPreferencePatch,
    persistSession,
    createSession,
    deleteSession,
    handleSessionImported,
    applyPreset,
    updateActiveSessionSettings,
    updateActiveSessionRoles,
    updateActiveSessionScenarios,
    onToggleRoleCard,
    onToggleScenarioCard,
    onUploadRoles,
    onUploadScenarios,
    selectedRoleCardIds,
    selectedScenarioCardIds,
    playerOptions,
    updateSessionTitle,
    lockSessionTitle,
    updatePlayerRole,
  } = useMagicTeaPartySessions({
    username: user?.username,
    userProviderConfig,
    onGlobalError: setGlobalError,
  });

  const {
    isGenerating,
    isSummarizing,
    summaryError,
    stopGenerating,
    sendMessage,
    continueGeneration,
    generateChoices,
    regenerateMessage,
    generateSummary,
    clearSummary,
  } = useMagicTeaPartyChat({
    activeSession,
    activeSessionId,
    messages,
    setMessages,
    persistSession,
    preferences,
    userProviderConfig,
    onGlobalError: setGlobalError,
    router,
  });

  const [showRoleModal, setShowRoleModal] = useState(false);
  const [showScenarioModal, setShowScenarioModal] = useState(false);

  const [draft, setDraft] = useState('');
  const [tachieReferenceText, setTachieReferenceText] = useState('');
  const [tachieAnchorMessageId, setTachieAnchorMessageId] = useState<string | null>(null);
  const [tachieAssets, setTachieAssets] = useState<MagicTeaPartyTachieAsset[]>([]);
  const [updateDrafts, setUpdateDrafts] = useState<MagicTeaPartyUpdateDraft[] | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateRangeSize, setUpdateRangeSize] = useState<number>(20);
  const [isGeneratingUpdates, setIsGeneratingUpdates] = useState(false);
  const [isApplyingUpdates, setIsApplyingUpdates] = useState(false);

  useEffect(() => {
    if (!activeSessionId) {
      setDraft('');
      return;
    }
    const storedDraft = readMagicTeaPartyDraft(activeSessionId);
    setDraft(storedDraft ?? '');
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSessionId) return;
    writeMagicTeaPartyDraft(activeSessionId, draft);
  }, [activeSessionId, draft]);

  useEffect(() => {
    setTachieReferenceText('');
    setTachieAnchorMessageId(null);
    setTachieAssets([]);
    setUpdateDrafts(null);
    setUpdateError(null);
  }, [activeSessionId]);

  useEffect(() => {
    if (!activeSession) return;
    if (tachieReferenceText.trim()) return;

    const toPlainText = (message: MagicTeaPartyMessage): string => {
      const segments = Array.isArray(message.segments) ? message.segments : null;
      if (segments && segments.length > 0) {
        const lines: string[] = [];
        for (const seg of segments) {
          if (!seg) continue;
          if (seg.type === 'narration') {
            const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
            if (text) lines.push(text);
            continue;
          }
          if (seg.type === 'dialogue') {
            const speaker =
              typeof (seg as any).speakerName === 'string' && String((seg as any).speakerName).trim()
                ? String((seg as any).speakerName).trim()
                : typeof (seg as any).speakerId === 'string'
                  ? (activeSession.roles ?? []).find((r) => r.id === String((seg as any).speakerId))?.name || String((seg as any).speakerId)
                  : '';
            const text = typeof (seg as any).text === 'string' ? String((seg as any).text).trim() : '';
            if (text) lines.push(speaker ? `${speaker}: ${text}` : text);
            continue;
          }
        }
        return lines.join('\n').trim();
      }
      return (message.content ?? '').trim();
    };

    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant' && (m.content || '').trim() && m.status !== 'error');
    if (lastAssistant) {
      setTachieReferenceText(toPlainText(lastAssistant).slice(0, 2000));
      setTachieAnchorMessageId(lastAssistant.id);
      return;
    }

    const lastUser = [...messages].reverse().find((m) => m.role === 'user' && (m.content || '').trim());
    if (lastUser) {
      setTachieReferenceText(toPlainText(lastUser).slice(0, 2000));
      setTachieAnchorMessageId(lastUser.id);
    }
  }, [activeSession, messages, tachieReferenceText]);

  const resolveWriteSettings = () => {
    const writeArenaHistory = activeSession?.settings.writeArenaHistory ?? preferences.writeArenaHistory;
    const writeCurrentState = activeSession?.settings.writeCurrentState ?? preferences.writeCurrentState;
    return { writeArenaHistory: Boolean(writeArenaHistory), writeCurrentState: Boolean(writeCurrentState) };
  };

  const ensureProviderReady = (): boolean => {
    if (!userProviderConfig) {
      setGlobalError('请先配置模型与 API Key。');
      return false;
    }
    if (userProviderConfig.providerId === 'system') {
      setGlobalError('魔法茶会已禁用 system，请使用自备 Key。');
      return false;
    }
    if (!userProviderConfig.apiKey?.trim()) {
      setGlobalError('API Key 不能为空。');
      return false;
    }
    if (!userProviderConfig.modelId?.trim()) {
      setGlobalError('请先选择模型。');
      return false;
    }
    return true;
  };

  const handleGenerateUpdateDrafts = async () => {
    if (!activeSession) return;
    if (isGenerating || isSummarizing || isGeneratingUpdates || isApplyingUpdates) return;
    if (!ensureProviderReady()) return;

    const { writeArenaHistory, writeCurrentState } = resolveWriteSettings();
    if (!writeArenaHistory && !writeCurrentState) {
      setUpdateError('请先开启写入历战记录或当前状态。');
      return;
    }

    const history = buildMagicTeaPartyHistory(messages, { includeEmptyContent: false });
    if (history.length === 0) {
      setUpdateError('还没有可用于更新的对话。');
      return;
    }

    const rangeSize = Math.max(1, Math.min(200, updateRangeSize || 20));
    const sliced = history.slice(-rangeSize);
    const messageRange = {
      fromMessageId: sliced[0]?.id,
      toMessageId: sliced[sliced.length - 1]?.id,
      count: sliced.length,
    };

    setUpdateError(null);
    setIsGeneratingUpdates(true);

    try {
      const response = await fetch('/api/magic-tea-party/generate-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          sessionTitle: activeSession.title,
          messages: sliced,
          summary: activeSession.summary,
          roles: activeSession.roles ?? [],
          messageRange,
          settings: {
            writeArenaHistory,
            writeCurrentState,
            language: activeSession.settings.language ?? preferences.language,
            userDisplayName: activeSession.settings.userDisplayName ?? preferences.userDisplayName,
          },
          customProvider: userProviderConfig,
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;
        setUpdateError(errorMessage);
        return;
      }

      const drafts = Array.isArray(payload?.drafts) ? (payload.drafts as MagicTeaPartyUpdateDraft[]) : [];
      if (drafts.length === 0) {
        setUpdateError('未生成任何更新草案。');
        return;
      }
      setUpdateDrafts(drafts);
    } catch (error) {
      const message = error instanceof Error ? error.message : '生成更新草案失败';
      setUpdateError(message);
    } finally {
      setIsGeneratingUpdates(false);
    }
  };

  const handleApplyUpdates = async () => {
    if (!activeSession) return;
    if (!updateDrafts || updateDrafts.length === 0) {
      setUpdateError('没有可写入的草案。');
      return;
    }
    if (isGenerating || isSummarizing || isGeneratingUpdates || isApplyingUpdates) return;

    const { writeArenaHistory, writeCurrentState } = resolveWriteSettings();
    if (!writeArenaHistory && !writeCurrentState) {
      setUpdateError('请先开启写入历战记录或当前状态。');
      return;
    }

    setUpdateError(null);
    setIsApplyingUpdates(true);

    try {
      const response = await fetch('/api/magic-tea-party/apply-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: activeSession.id,
          sessionTitle: activeSession.title,
          drafts: updateDrafts,
          roles: activeSession.roles ?? [],
          settings: { writeArenaHistory, writeCurrentState },
        }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage =
          typeof payload?.error === 'string'
            ? payload.error
            : typeof payload?.message === 'string'
              ? payload.message
              : `请求失败（${response.status}）`;
        setUpdateError(errorMessage);
        return;
      }

      const updatedRoles = Array.isArray(payload?.updatedRoles) ? (payload.updatedRoles as MagicTeaPartyRole[]) : [];
      if (updatedRoles.length > 0) {
        await updateActiveSessionRoles(updatedRoles);
      } else if (activeSession.roles) {
        await updateActiveSessionRoles(activeSession.roles);
      }
      setUpdateDrafts(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : '写入失败';
      setUpdateError(message);
    } finally {
      setIsApplyingUpdates(false);
    }
  };

  return (
    <>
      <Head>
        <title>魔法茶会</title>
        <meta name="description" content="基于角色卡/情景卡的长期对话与剧情体验（本地存储，自备 API Key）" />
      </Head>

      <div className="magic-background-white">
        <div className="container !max-w-[1200px]">
          <div className="card !max-w-none">
            <MagicTeaPartyHero globalError={globalError} />

            <div className="mt-6 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
              <MagicTeaPartySessionSidebar
                sessions={sessions}
                activeSessionId={activeSessionId}
                activeSession={activeSession}
                preferences={preferences}
                onCreateSession={(presetId) => void createSession(presetId)}
                onSelectSession={setActiveSessionId}
                onDeleteSession={(sessionId) => void deleteSession(sessionId)}
                onSessionImported={handleSessionImported}
                onPresetSelected={(presetId) => applyPreset(presetId)}
                onProviderConfigChange={setUserProviderConfig}
                onPreferenceChange={applyPreferencePatch}
                onSessionSettingChange={updateActiveSessionSettings}
              />

              <main className="space-y-4 min-w-0">
                <MagicTeaPartySessionSetupPanel
                  activeSession={activeSession}
                  playerOptions={playerOptions}
                  onOpenRoleModal={() => setShowRoleModal(true)}
                  onOpenScenarioModal={() => setShowScenarioModal(true)}
                  onUploadRoles={onUploadRoles}
                  onUploadScenarios={onUploadScenarios}
                  onUpdateRoles={(roles) => void updateActiveSessionRoles(roles)}
                  onUpdateScenarios={(scenario, auxScenarios) => void updateActiveSessionScenarios(scenario, auxScenarios)}
                  onUpdatePlayerRole={updatePlayerRole}
                  onUpdateTitle={updateSessionTitle}
                  onLockTitle={lockSessionTitle}
                />
                <MagicTeaPartySummaryPanel
                  activeSession={activeSession}
                  isGenerating={isGenerating}
                  isSummarizing={isSummarizing}
                  summaryError={summaryError}
                  hasMessages={messages.length > 0}
                  onGenerateSummary={() => void generateSummary()}
                  onClearSummary={() => void clearSummary()}
                  onPersistSession={persistSession}
                  updateDrafts={updateDrafts}
                  updateRangeSize={updateRangeSize}
                  isGeneratingUpdates={isGeneratingUpdates}
                  isApplyingUpdates={isApplyingUpdates}
                  updateError={updateError}
                  onUpdateRangeSizeChange={setUpdateRangeSize}
                  onGenerateUpdates={() => void handleGenerateUpdateDrafts()}
                  onApplyUpdates={() => void handleApplyUpdates()}
                  onClearUpdateDrafts={() => setUpdateDrafts(null)}
                />

                <div className="rounded-xl border border-pink-100 bg-white p-4">
                  <MagicTeaPartyChatTimeline
                    activeSession={activeSession}
                    preferences={preferences}
                    messages={messages}
                    isGenerating={isGenerating}
                    tachieAssets={tachieAssets}
                    anchorMessageId={tachieAnchorMessageId}
                    onStopGenerating={stopGenerating}
                    onSelectChoice={(text) => void sendMessage(text)}
                    onUseAsReference={(target, plainText) => {
                      setTachieReferenceText(plainText);
                      setTachieAnchorMessageId(target.id);
                    }}
                    onRegenerate={(target) => void regenerateMessage(target)}
                  />

                  <MagicTeaPartyChatComposer
                    activeSession={activeSession}
                    preferences={preferences}
                    draft={draft}
                    onDraftChange={setDraft}
                    onSend={(value) => {
                      if (!value.trim()) return;
                      void sendMessage(value).then((sent) => {
                        if (sent) setDraft('');
                      });
                    }}
                    onContinue={() => void continueGeneration()}
                    onGenerateChoices={() => void generateChoices()}
                    isGenerating={isGenerating}
                    hasMessages={messages.length > 0}
                  />
                </div>

                {activeSession ? (
                  <MagicTeaPartyTachiePanel
                    session={activeSession}
                    messages={messages}
                    referenceText={tachieReferenceText}
                    onReferenceTextChange={setTachieReferenceText}
                    anchorMessageId={tachieAnchorMessageId}
                    onAnchorMessageIdChange={setTachieAnchorMessageId}
                    onAssetsUpdated={setTachieAssets}
                  />
                ) : null}

                <Footer className="footer mt-4" />
              </main>
            </div>
          </div>
        </div>

        <MagicTeaPartyCardModals
          showRoleModal={showRoleModal}
          showScenarioModal={showScenarioModal}
          selectedRoleCardIds={selectedRoleCardIds}
          selectedScenarioCardIds={selectedScenarioCardIds}
          onCloseRoleModal={() => setShowRoleModal(false)}
          onCloseScenarioModal={() => setShowScenarioModal(false)}
          onToggleRoleCard={onToggleRoleCard}
          onToggleScenarioCard={onToggleScenarioCard}
        />
      </div>
    </>
  );
}
