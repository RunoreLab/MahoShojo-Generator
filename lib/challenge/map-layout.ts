import type { MapEdgeV1, MapNodeV1, MapStateV1 } from '@/lib/challenge/types';

export type ChallengeMapLayoutNodeState = 'completed' | 'available' | 'focused' | 'hidden';
export type ChallengeMapLayoutEdgeState = 'completed' | 'available' | 'locked';

export type ChallengeMapLayoutNode = {
  nodeId: string;
  layer: number;
  trackSlot: number;
  x: number;
  y: number;
  state: ChallengeMapLayoutNodeState;
  canEnter: boolean;
  node: MapNodeV1;
};

export type ChallengeMapLayoutEdge = {
  edgeId: string;
  fromNodeId: string;
  toNodeId: string;
  state: ChallengeMapLayoutEdgeState;
  edge: MapEdgeV1;
};

export type ChallengeMapLayout = {
  nodes: ChallengeMapLayoutNode[];
  edges: ChallengeMapLayoutEdge[];
  selectedNodeId: string | null;
};

type ChallengeMapLayoutInput = {
  mapState: MapStateV1;
  selectableNodeIds: string[];
  selectedNodeId: string | null;
};

const LAYER_GAP = 180;
const TRACK_GAP = 160;

const getNodeState = (node: MapNodeV1, canEnter: boolean): ChallengeMapLayoutNodeState => {
  if (node.visibility === 'resolved') return 'completed';
  if (canEnter) return 'available';
  if (node.visibility === 'focused') return 'focused';
  return 'hidden';
};

const getSelectedNodeId = (nodes: ChallengeMapLayoutNode[], selectedNodeId: string | null): string | null => {
  if (selectedNodeId && nodes.some((node) => node.nodeId === selectedNodeId)) {
    return selectedNodeId;
  }

  const firstAvailable = nodes.find((node) => node.canEnter);
  if (firstAvailable) return firstAvailable.nodeId;

  const latestCompleted = [...nodes]
    .filter((node) => node.state === 'completed')
    .sort((left, right) => right.layer - left.layer || left.trackSlot - right.trackSlot)[0];
  if (latestCompleted) return latestCompleted.nodeId;

  return nodes.find((node) => node.state === 'focused')?.nodeId ?? null;
};

const getEdgeState = (
  edge: MapEdgeV1,
  nodeStateById: Map<string, ChallengeMapLayoutNode>
): ChallengeMapLayoutEdgeState => {
  const fromNode = nodeStateById.get(edge.fromNodeId);
  const toNode = nodeStateById.get(edge.toNodeId);

  if (fromNode?.state === 'completed' && toNode?.state === 'completed') {
    return 'completed';
  }

  if (toNode?.canEnter) {
    return 'available';
  }

  return 'locked';
};

export const buildChallengeMapLayout = (input: ChallengeMapLayoutInput): ChallengeMapLayout => {
  const nodesByLayer = new Map<number, MapNodeV1[]>();
  input.mapState.nodes.forEach((node) => {
    const layerNodes = nodesByLayer.get(node.layer) ?? [];
    layerNodes.push(node);
    nodesByLayer.set(node.layer, layerNodes);
  });

  const selectableNodeIds = new Set(input.selectableNodeIds);
  const nodes = Array.from(nodesByLayer.entries())
    .sort((left, right) => left[0] - right[0])
    .flatMap(([layer, layerNodes]) =>
      [...layerNodes]
        .sort((left, right) => left.nodeId.localeCompare(right.nodeId))
        .map((node, index, allNodes) => {
          const trackSlot = index - (allNodes.length - 1) / 2;
          const canEnter = selectableNodeIds.has(node.nodeId);
          return {
            nodeId: node.nodeId,
            layer,
            trackSlot,
            x: trackSlot * TRACK_GAP,
            y: (layer - 1) * LAYER_GAP,
            state: getNodeState(node, canEnter),
            canEnter,
            node,
          };
        })
    );

  const nodeStateById = new Map(nodes.map((node) => [node.nodeId, node]));
  const edges = input.mapState.edges.map((edge) => ({
    edgeId: edge.edgeId,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    state: getEdgeState(edge, nodeStateById),
    edge,
  }));

  return {
    nodes,
    edges,
    selectedNodeId: getSelectedNodeId(nodes, input.selectedNodeId),
  };
};
