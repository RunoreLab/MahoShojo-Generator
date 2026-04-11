import type { ChallengeNodeType, MapEdgeV1, MapNodeV1, MapStateV1, NodeVisibility } from '@/lib/challenge/types';

const ROOT_NODE_ID = 'S';
const TOTAL_LAYERS = 8;
const NODES_PER_LAYER: Record<number, number> = {
  1: 2,
  2: 2,
  3: 2,
  4: 2,
  5: 2,
  6: 2,
  7: 1,
  8: 1,
};

const hashStringToUint32 = (input: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

const mulberry32 = (seed: number): (() => number) => {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let x = Math.imul(t ^ (t >>> 15), 1 | t);
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
};

const buildNodeId = (layer: number, index: number): string => `L${layer}-N${index}`;

const seededShuffle = <T>(items: T[], seed: string): T[] => {
  const rng = mulberry32(hashStringToUint32(seed));
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
};

const getRiskHint = (nodeType: ChallengeNodeType): MapNodeV1['riskHint'] => {
  switch (nodeType) {
    case 'boss':
    case 'elite':
      return 'high';
    case 'event':
    case 'shop':
      return 'low';
    default:
      return 'mid';
  }
};

const getRewardHint = (nodeType: ChallengeNodeType): MapNodeV1['rewardHint'] => {
  switch (nodeType) {
    case 'boss':
    case 'elite':
      return 'high';
    case 'rest':
      return 'mid';
    case 'shop':
      return 'mid';
    default:
      return 'low';
  }
};

const buildBaseNodes = (): MapNodeV1[] => {
  const nodes: MapNodeV1[] = [];
  for (let layer = 1; layer <= TOTAL_LAYERS; layer += 1) {
    for (let index = 1; index <= NODES_PER_LAYER[layer]; index += 1) {
      const nodeId = buildNodeId(layer, index);
      const nodeType: ChallengeNodeType = layer === TOTAL_LAYERS ? 'boss' : 'battle';
      nodes.push({
        version: 1,
        nodeId,
        layer,
        nodeType,
        visibility: 'summary',
        riskHint: getRiskHint(nodeType),
        rewardHint: getRewardHint(nodeType),
        encounterRef: `arena:${nodeType}:${nodeId}`,
      });
    }
  }
  return nodes;
};

const assignSpecialNodeTypes = (nodes: MapNodeV1[], seed: string): MapNodeV1[] => {
  const next = nodes.map((node) => ({ ...node }));

  const getNode = (nodeId: string): MapNodeV1 => {
    const matched = next.find((node) => node.nodeId === nodeId);
    if (!matched) {
      throw new Error(`MAP_NODE_NOT_FOUND:${nodeId}`);
    }
    return matched;
  };

  const pickUnique = (candidates: string[], taken: Set<string>, pickSeed: string): string => {
    const matched = seededShuffle(candidates, pickSeed).find((nodeId) => !taken.has(nodeId));
    if (!matched) {
      throw new Error(`MAP_NODE_PICK_FAILED:${pickSeed}`);
    }
    taken.add(matched);
    return matched;
  };

  const taken = new Set<string>(['L8-N1']);
  const eliteCandidates = ['L6-N1', 'L6-N2', 'L7-N1'];
  const restCandidates = ['L3-N1', 'L3-N2', 'L4-N1', 'L4-N2', 'L5-N1', 'L5-N2'];
  const shopCandidates = ['L3-N1', 'L3-N2', 'L4-N1', 'L4-N2', 'L5-N1', 'L5-N2', 'L6-N1', 'L6-N2'];
  const eventCandidates = [
    'L1-N1',
    'L1-N2',
    'L2-N1',
    'L2-N2',
    'L3-N1',
    'L3-N2',
    'L4-N1',
    'L4-N2',
    'L5-N1',
    'L5-N2',
    'L6-N1',
    'L6-N2',
  ];

  const eliteNodeId = pickUnique(eliteCandidates, taken, `${seed}:elite`);
  const restNodeId = pickUnique(restCandidates, taken, `${seed}:rest`);
  const shopNodeId = pickUnique(shopCandidates, taken, `${seed}:shop`);
  const eventNodeIds = seededShuffle(eventCandidates, `${seed}:event`).filter((nodeId) => !taken.has(nodeId)).slice(0, 2);
  eventNodeIds.forEach((nodeId) => taken.add(nodeId));

  const assignments: Array<[string, ChallengeNodeType]> = [
    [eliteNodeId, 'elite'],
    [restNodeId, 'rest'],
    [shopNodeId, 'shop'],
    ...eventNodeIds.map((nodeId) => [nodeId, 'event'] as [string, ChallengeNodeType]),
  ];

  assignments.forEach(([nodeId, nodeType]) => {
    const node = getNode(nodeId);
    node.nodeType = nodeType;
    node.riskHint = getRiskHint(nodeType);
    node.rewardHint = getRewardHint(nodeType);
    node.encounterRef = `arena:${nodeType}:${nodeId}`;
  });

  return next;
};

const EDGE_TEMPLATE_PREFIX: Array<[string, string]> = [
  [ROOT_NODE_ID, 'L1-N1'],
  [ROOT_NODE_ID, 'L1-N2'],
  ['L1-N1', 'L2-N1'],
  ['L1-N1', 'L2-N2'],
  ['L1-N2', 'L2-N2'],
];

const EDGE_TEMPLATE_SUFFIXES: Array<Array<[string, string]>> = [
  [
    ['L2-N1', 'L3-N1'],
    ['L2-N2', 'L3-N1'],
    ['L2-N2', 'L3-N2'],
    ['L3-N1', 'L4-N1'],
    ['L3-N1', 'L4-N2'],
    ['L3-N2', 'L4-N2'],
    ['L4-N1', 'L5-N1'],
    ['L4-N2', 'L5-N1'],
    ['L4-N2', 'L5-N2'],
    ['L5-N1', 'L6-N1'],
    ['L5-N1', 'L6-N2'],
    ['L5-N2', 'L6-N2'],
    ['L6-N1', 'L7-N1'],
    ['L6-N2', 'L7-N1'],
    ['L7-N1', 'L8-N1'],
  ],
  [
    ['L2-N1', 'L3-N1'],
    ['L2-N1', 'L3-N2'],
    ['L2-N2', 'L3-N2'],
    ['L3-N1', 'L4-N1'],
    ['L3-N2', 'L4-N1'],
    ['L3-N2', 'L4-N2'],
    ['L4-N1', 'L5-N1'],
    ['L4-N1', 'L5-N2'],
    ['L4-N2', 'L5-N2'],
    ['L5-N1', 'L6-N1'],
    ['L5-N2', 'L6-N1'],
    ['L5-N2', 'L6-N2'],
    ['L6-N1', 'L7-N1'],
    ['L6-N2', 'L7-N1'],
    ['L7-N1', 'L8-N1'],
  ],
  [
    ['L2-N1', 'L3-N1'],
    ['L2-N2', 'L3-N1'],
    ['L2-N2', 'L3-N2'],
    ['L3-N1', 'L4-N1'],
    ['L3-N2', 'L4-N1'],
    ['L3-N2', 'L4-N2'],
    ['L4-N1', 'L5-N1'],
    ['L4-N1', 'L5-N2'],
    ['L4-N2', 'L5-N2'],
    ['L5-N1', 'L6-N1'],
    ['L5-N1', 'L6-N2'],
    ['L5-N2', 'L6-N1'],
    ['L6-N1', 'L7-N1'],
    ['L6-N2', 'L7-N1'],
    ['L7-N1', 'L8-N1'],
  ],
];

const pickEdgeTemplateIndex = (seed: string): number =>
  Array.from(seed).reduce((total, char) => total + char.charCodeAt(0), 0) % EDGE_TEMPLATE_SUFFIXES.length;

const buildEdges = (seed: string): MapEdgeV1[] => {
  const pairs = [...EDGE_TEMPLATE_PREFIX, ...EDGE_TEMPLATE_SUFFIXES[pickEdgeTemplateIndex(seed)]];

  return pairs.map(([fromNodeId, toNodeId], index) => ({
    version: 1,
    edgeId: `edge-${index + 1}`,
    fromNodeId,
    toNodeId,
  }));
};

export const advanceMapVisibility = (mapState: MapStateV1, currentNodeId: string): MapStateV1 => {
  const currentLayer = currentNodeId === ROOT_NODE_ID
    ? 0
    : mapState.nodes.find((node) => node.nodeId === currentNodeId)?.layer ?? 0;

  const nodes = mapState.nodes.map((node) => {
    let visibility: NodeVisibility = node.visibility === 'resolved' ? 'resolved' : 'summary';
    if (currentNodeId !== ROOT_NODE_ID && node.nodeId === currentNodeId) {
      visibility = 'resolved';
    } else if (node.layer >= currentLayer + 1 && node.layer <= currentLayer + 2) {
      visibility = 'focused';
    }

    return { ...node, visibility };
  });

  return {
    ...mapState,
    nodes,
  };
};

export const generateChallengeMap = (input: { runSeed: string; worldPresetId: string }): MapStateV1 => {
  const seed = `${input.worldPresetId}:${input.runSeed}`;
  const nodes = assignSpecialNodeTypes(buildBaseNodes(), seed);
  const baseMap: MapStateV1 = {
    version: 1,
    rootNodeId: ROOT_NODE_ID,
    totalLayers: TOTAL_LAYERS,
    bossNodeId: 'L8-N1',
    nodes,
    edges: buildEdges(seed),
  };

  return advanceMapVisibility(baseMap, ROOT_NODE_ID);
};
