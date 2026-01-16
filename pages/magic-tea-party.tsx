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

import { useMagicTeaPartyChat } from '@/lib/magic-tea-party/useMagicTeaPartyChat';
import { useMagicTeaPartySessions } from '@/lib/magic-tea-party/useMagicTeaPartySessions';
import type { MagicTeaPartyMessage, MagicTeaPartyTachieAsset } from '@/lib/magic-tea-party/types';
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

  useEffect(() => {
    setTachieReferenceText('');
    setTachieAnchorMessageId(null);
    setTachieAssets([]);
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
