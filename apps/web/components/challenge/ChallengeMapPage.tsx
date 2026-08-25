'use client';

import { useEffect, useState } from 'react';

import { ChallengeMapNodeDetail } from '@/components/challenge/map/ChallengeMapNodeDetail';
import { ChallengeMapSidebar } from '@/components/challenge/map/ChallengeMapSidebar';
import { ChallengeMapStage } from '@/components/challenge/map/ChallengeMapStage';
import { getSelectableNodeIdsForMap } from '@/components/challenge/hooks/useChallengeController';
import { buildChallengeMapLayout } from '@/lib/challenge/map-layout';
import { getChallengeResourcePresentation, getChallengeWorldPreset } from '@/lib/challenge/world-registry';
import type { ChallengeWorldId, RunStateV1 } from '@/lib/challenge/types';

type ChallengeMapPageProps = {
  worldTitle: string;
  runState: RunStateV1;
  latestNodeSummary: string;
  onEnterNode: (nodeId: string) => void;
};

export function ChallengeMapPage({
  worldTitle,
  runState,
  latestNodeSummary,
  onEnterNode,
}: ChallengeMapPageProps) {
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const mapState = runState.mapState;
  const worldPreset = getChallengeWorldPreset(runState.worldPresetId as ChallengeWorldId);
  const presentation = getChallengeResourcePresentation(worldPreset.resourcePresentationId);

  useEffect(() => {
    setSelectedNodeId(null);
  }, [runState.runId, runState.currentNodeId, runState.visitedNodeCount]);

  if (!mapState) {
    return (
      <section className="rounded-[28px] border border-slate-200 bg-white/90 p-6 shadow-[0_16px_48px_rgba(148,163,184,0.10)]">
        <h2 className="text-2xl font-semibold text-slate-900">挑战地图</h2>
        <p className="mt-3 text-sm text-slate-500">地图尚未生成。</p>
      </section>
    );
  }

  const selectableNodeIds = getSelectableNodeIdsForMap(runState);
  const layout = buildChallengeMapLayout({
    mapState,
    selectableNodeIds,
    selectedNodeId,
  });
  const resolvedSelectedNodeId = layout.selectedNodeId;
  const selectedLayoutNode = layout.nodes.find((node) => node.nodeId === resolvedSelectedNodeId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(300px,0.78fr)_minmax(0,1.22fr)]">
      <ChallengeMapSidebar
        worldTitle={worldTitle}
        runState={runState}
        nodeCount={mapState.nodes.length}
        latestNodeSummary={latestNodeSummary}
        presentation={presentation}
      />

      <div className="space-y-4">
        <ChallengeMapStage
          layout={layout}
          selectedNodeId={resolvedSelectedNodeId}
          onSelectNode={setSelectedNodeId}
        />
        <ChallengeMapNodeDetail layoutNode={selectedLayoutNode} onEnterNode={onEnterNode} />
      </div>
    </div>
  );
}
