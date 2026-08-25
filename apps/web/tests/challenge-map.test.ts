import { describe, expect, test } from 'vitest';

import { advanceMapVisibility, generateChallengeMap } from '@/lib/challenge/map';

const countMeaningfulSplits = (edges: Array<{ fromNodeId: string; toNodeId: string }>): number => {
  const outgoing = new Map<string, number>();
  edges.forEach((edge) => {
    outgoing.set(edge.fromNodeId, (outgoing.get(edge.fromNodeId) ?? 0) + 1);
  });

  return Array.from(outgoing.entries()).filter(([nodeId, count]) => nodeId !== 'S' && count >= 2).length;
};

const countMeaningfulMerges = (edges: Array<{ fromNodeId: string; toNodeId: string }>): number => {
  const incoming = new Map<string, number>();
  edges.forEach((edge) => {
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
  });

  return Array.from(incoming.values()).filter((count) => count >= 2).length;
};

const hasCrossLayerJump = (edges: Array<{ fromNodeId: string; toNodeId: string }>): boolean =>
  edges.some((edge) => {
    if (edge.fromNodeId === 'S') return false;
    const fromLayer = Number(edge.fromNodeId.split('-')[0]?.slice(1) ?? '0');
    const toLayer = Number(edge.toNodeId.split('-')[0]?.slice(1) ?? '0');
    return toLayer !== fromLayer + 1;
  });

const hasLongSingleLaneRun = (edges: Array<{ fromNodeId: string; toNodeId: string }>, threshold: number): boolean => {
  const outgoing = new Map<string, number>();
  edges.forEach((edge) => {
    outgoing.set(edge.fromNodeId, (outgoing.get(edge.fromNodeId) ?? 0) + 1);
  });

  let run = 0;
  for (let layer = 1; layer <= 7; layer += 1) {
    const currentNodes = Array.from(outgoing.entries()).filter(([nodeId]) => nodeId.startsWith(`L${layer}-`));
    const allSingleLane = currentNodes.length > 0 && currentNodes.every(([, count]) => count === 1);
    run = allSingleLane ? run + 1 : 0;
    if (run >= threshold) return true;
  }
  return false;
};

const getEdgeSignature = (edges: Array<{ fromNodeId: string; toNodeId: string }>): string =>
  edges
    .map((edge) => `${edge.fromNodeId}->${edge.toNodeId}`)
    .sort()
    .join('|');

describe('challenge map', () => {
  test('generateChallengeMap 满足受约束拓扑规则与特殊节点层级落点', () => {
    const map = generateChallengeMap({ runSeed: 'run-a', worldPresetId: 'arena' });

    expect(map.nodes).toHaveLength(14);
    expect(map.totalLayers).toBe(8);
    expect(map.nodes.filter((node) => node.layer === 1)).toHaveLength(2);
    expect(map.nodes.filter((node) => node.layer === 6)).toHaveLength(2);
    expect(map.nodes.filter((node) => node.layer === 7)).toHaveLength(1);
    expect(map.nodes.filter((node) => node.layer === 8)).toHaveLength(1);
    expect(map.nodes.filter((node) => node.nodeType === 'boss')).toHaveLength(1);
    expect(map.nodes.filter((node) => node.nodeType === 'elite')).toHaveLength(1);
    expect(map.nodes.filter((node) => node.nodeType === 'rest')).toHaveLength(1);
    expect(map.nodes.filter((node) => node.nodeType === 'shop')).toHaveLength(1);
    expect(map.nodes.filter((node) => node.nodeType === 'event')).toHaveLength(2);
    expect(map.nodes.find((node) => node.nodeType === 'elite')?.layer).toBeGreaterThanOrEqual(6);
    expect(map.nodes.find((node) => node.nodeType === 'elite')?.layer).toBeLessThanOrEqual(7);
    expect(map.nodes.find((node) => node.nodeType === 'rest')?.layer).toBeGreaterThanOrEqual(3);
    expect(map.nodes.find((node) => node.nodeType === 'rest')?.layer).toBeLessThanOrEqual(5);
    expect(map.nodes.find((node) => node.nodeType === 'shop')?.layer).toBeGreaterThanOrEqual(3);
    expect(map.nodes.find((node) => node.nodeType === 'shop')?.layer).toBeLessThanOrEqual(6);
    expect(countMeaningfulSplits(map.edges)).toBeGreaterThanOrEqual(2);
    expect(countMeaningfulMerges(map.edges)).toBeGreaterThanOrEqual(1);
    expect(hasLongSingleLaneRun(map.edges, 3)).toBe(false);
    expect(hasCrossLayerJump(map.edges)).toBe(false);
  });

  test('generateChallengeMap 会在不同 seed 下给出不同的边拓扑签名', () => {
    const signatures = new Set(
      ['run-a', 'run-b', 'run-c'].map((runSeed) =>
        getEdgeSignature(generateChallengeMap({ runSeed, worldPresetId: 'arena' }).edges)
      )
    );

    expect(signatures.size).toBeGreaterThanOrEqual(2);
  });

  test('advanceMapVisibility 会把已完成节点标记为 resolved，并把后续两层节点标记为 focused', () => {
    const map = generateChallengeMap({ runSeed: 'run-b', worldPresetId: 'arena' });

    const next = advanceMapVisibility(map, 'L2-N1');

    expect(next.nodes.find((node) => node.nodeId === 'L2-N1')?.visibility).toBe('resolved');
    expect(
      next.nodes
        .filter((node) => node.layer >= 3 && node.layer <= 4)
        .every((node) => node.visibility === 'focused')
    ).toBe(true);
  });
});
