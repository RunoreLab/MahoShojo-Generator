import { describe, expect, test } from 'bun:test';

import { advanceMapVisibility, generateChallengeMap } from '@/lib/challenge/map';

const assertAtLeastOneSplitAndMerge = (edges: Array<{ fromNodeId: string; toNodeId: string }>): boolean => {
  const outgoing = new Map<string, number>();
  const incoming = new Map<string, number>();

  edges.forEach((edge) => {
    outgoing.set(edge.fromNodeId, (outgoing.get(edge.fromNodeId) ?? 0) + 1);
    incoming.set(edge.toNodeId, (incoming.get(edge.toNodeId) ?? 0) + 1);
  });

  const hasSplit = Array.from(outgoing.entries()).some(([nodeId, count]) => nodeId !== 'S' && count >= 2);
  const hasMerge = Array.from(incoming.values()).some((count) => count >= 2);
  return hasSplit && hasMerge;
};

describe('challenge map', () => {
  test('generateChallengeMap 生成 8 层 14 节点并满足固定节点配比与层级落点', () => {
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
    expect(assertAtLeastOneSplitAndMerge(map.edges)).toBe(true);
    expect(
      map.edges.every((edge) => {
        if (edge.fromNodeId === 'S') return true;
        const fromLayer = Number(edge.fromNodeId.split('-')[0]?.slice(1) ?? '0');
        const toLayer = Number(edge.toNodeId.split('-')[0]?.slice(1) ?? '0');
        return toLayer === fromLayer + 1;
      })
    ).toBe(true);
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
