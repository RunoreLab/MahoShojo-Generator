'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import BattleDataModal from '@/components/BattleDataModal';
import { ChallengeBootstrapPanel } from '@/components/challenge/ChallengeBootstrapPanel';
import { ChallengeLobby } from '@/components/challenge/ChallengeLobby';
import { ChallengeMapPage } from '@/components/challenge/ChallengeMapPage';
import { ChallengeSummaryPage } from '@/components/challenge/ChallengeSummaryPage';
import { NodeResolutionPanel } from '@/components/challenge/NodeResolutionPanel';
import { useChallengeController } from '@/components/challenge/hooks/useChallengeController';
import { ImagePreviewModal } from '@/components/shared/ImagePreviewModal';
import { useAuth } from '@/lib/useAuth';

export type ChallengePageController = ReturnType<typeof useChallengeController>;

export function ChallengePageView({
  controller,
  isAuthenticated = false,
}: {
  controller: ChallengePageController;
  isAuthenticated?: boolean;
}) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [savedImageUrl, setSavedImageUrl] = useState<string | null>(null);
  const [showBattleDataModal, setShowBattleDataModal] = useState(false);

  const handleSaveImage = (imageUrl: string) => {
    setSavedImageUrl(imageUrl);
    setShowImageModal(true);
  };

  useEffect(() => {
    if (controller.stage === 'node') return;
    setShowImageModal(false);
    setSavedImageUrl(null);
  }, [controller.stage]);

  useEffect(() => {
    if (controller.stage === 'lobby') return;
    setShowBattleDataModal(false);
  }, [controller.stage]);

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,237,244,0.95),_rgba(255,255,255,0.98)_55%,_rgba(250,246,255,1))] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-4 pb-10 pt-6 sm:px-6 lg:px-8">
        <header className="rounded-[28px] border border-rose-200/70 bg-white/85 px-6 py-5 shadow-[0_20px_60px_rgba(244,114,182,0.12)] backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-rose-500">挑战模式</p>
              <div>
                <h1 className="text-3xl font-semibold text-slate-900">本轮挑战</h1>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  先用本地闭环跑通竞技场挑战流程：快照确认、路线推进、节点结算与终局总结。
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <Link
                href="/arena"
                className="rounded-full border border-slate-300 px-4 py-2 text-slate-700 transition hover:border-rose-300 hover:text-rose-600"
              >
                返回竞技场
              </Link>
              <Link
                href="/creator"
                className="rounded-full border border-rose-300 bg-rose-50 px-4 py-2 text-rose-600 transition hover:bg-rose-100"
              >
                去创建角色卡
              </Link>
            </div>
          </div>
        </header>

        {controller.error ? (
          <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {controller.error}
          </div>
        ) : null}

        <main className="mt-6 flex-1">
          {controller.stage === 'lobby' ? (
            <ChallengeLobby
              worldTitle={controller.worldTitle}
              recentRuns={controller.recentRuns}
              unlocks={controller.allUnlocks}
              isLoadingRecentRuns={controller.isLoadingRecentRuns}
              isAuthenticated={isAuthenticated}
              isSubmitting={controller.isBusy}
              isMatching={controller.isMatching}
              entrantSummary={controller.selectedEntrantSummary}
              rawEditorText={controller.rawEditorText}
              selectionError={controller.selectionError}
              localImportError={controller.localImportError}
              editorError={controller.editorError}
              isEditorDirty={controller.isEditorDirty}
              advancedEditorRevealToken={controller.advancedEditorRevealToken}
              onRawEditorTextChange={controller.setRawEditorText}
              onApplyEditorText={() => void controller.applyEditorText()}
              onOpenCharacterPicker={() => setShowBattleDataModal(true)}
              onRandomMatchEntrant={() => void controller.randomMatchEntrant()}
              onImportEntrantFile={(file) => void controller.importEntrantFromFile(file)}
              onImportEntrantText={(text) => void controller.importEntrantFromText(text)}
              onLoadDemoCard={controller.loadDemoCard}
              onClearEntrant={controller.clearEntrantCard}
              onRevealAdvancedEditor={controller.revealAdvancedEditor}
              onPrepareChallenge={() => void controller.prepareChallenge()}
              onUserProviderConfigChange={controller.setUserProviderConfig}
              onResumeRun={(runId) => void controller.resumeRun(runId)}
              onDeleteRun={(runId) => void controller.deleteRun(runId)}
            />
          ) : null}

          {controller.stage === 'bootstrap' && controller.bootstrapDraft ? (
            <ChallengeBootstrapPanel
              worldTitle={controller.worldTitle}
              playerSnapshot={controller.bootstrapDraft.playerSnapshot}
              usedBootstrapReroll={controller.bootstrapDraft.usedBootstrapReroll}
              onReroll={() => void controller.rerollBootstrap()}
              onAccept={() => void controller.acceptBootstrap()}
              onBack={() => void controller.cancelBootstrap()}
            />
          ) : null}

          {controller.stage === 'map' && controller.runState ? (
            <ChallengeMapPage
              worldTitle={controller.worldTitle}
              runState={controller.runState}
              latestNodeSummary={controller.latestNodeSummary}
              onEnterNode={(nodeId) => void controller.enterNode(nodeId)}
            />
          ) : null}

          {controller.stage === 'node' && controller.currentEncounter ? (
            <NodeResolutionPanel
              encounter={controller.currentEncounter}
              latestStoryText={controller.latestStoryText}
              isResolving={controller.isResolving}
              note={controller.note}
              selectedOptionId={controller.selectedOptionId}
              selectedRecommendedActionId={controller.selectedRecommendedActionId}
              recommendedActions={controller.recommendedActions}
              viewMode={controller.nodeViewMode}
              enemyDisplayState={controller.enemyDisplayState}
              storyCardState={controller.storyCardState}
              onSaveImage={handleSaveImage}
              onUserProviderConfigChange={controller.setUserProviderConfig}
              onRecommendedActionChange={controller.setSelectedRecommendedActionId}
              onSelectOption={controller.setSelectedOptionId}
              onNoteChange={controller.setNote}
              onResolve={() => void controller.resolveCurrentNode()}
              onStopGeneration={controller.stopNodeResolution}
              onBackToMap={controller.backToMap}
            />
          ) : null}

          {controller.stage === 'summary' && controller.runState ? (
            <ChallengeSummaryPage
              worldTitle={controller.worldTitle}
              runState={controller.runState}
              summaryText={controller.summaryText}
              newUnlocks={controller.newUnlocks}
              onBackToLobby={controller.backToLobby}
            />
          ) : null}
        </main>
      </div>

      <ImagePreviewModal
        isOpen={showImageModal}
        imageUrl={savedImageUrl}
        onClose={() => {
          setShowImageModal(false);
          setSavedImageUrl(null);
        }}
      />

      <BattleDataModal
        isOpen={showBattleDataModal}
        onClose={() => setShowBattleDataModal(false)}
        onSelectCard={(card) => void controller.selectEntrantFromDataCard(card)}
        selectedType="character"
        selectionMode="single"
      />
    </div>
  );
}

export function ChallengePage() {
  const controller = useChallengeController();
  const { isAuthenticated } = useAuth();
  return <ChallengePageView controller={controller} isAuthenticated={isAuthenticated} />;
}
