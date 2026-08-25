import type { ChallengeMapLayout } from '@/lib/challenge/map-layout';
import { ChallengeMapNode } from '@/components/challenge/map/ChallengeMapNode';

const VIEWBOX_WIDTH = 720;
const TOP_PADDING = 90;
const NODE_CENTER_X = VIEWBOX_WIDTH / 2;
const NODE_CENTER_OFFSET_Y = TOP_PADDING;

const EDGE_CLASS_NAMES: Record<ChallengeMapLayout['edges'][number]['state'], string> = {
  completed: 'stroke-amber-400',
  available: 'stroke-rose-400',
  locked: 'stroke-slate-300',
};

type ChallengeMapStageProps = {
  layout: ChallengeMapLayout;
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string) => void;
};

const resolveNodePoint = (layout: ChallengeMapLayout, nodeId: string): { x: number; y: number } | null => {
  if (nodeId === 'S') {
    return { x: NODE_CENTER_X, y: 24 };
  }

  const node = layout.nodes.find((item) => item.nodeId === nodeId);
  if (!node) return null;
  return {
    x: NODE_CENTER_X + node.x,
    y: NODE_CENTER_OFFSET_Y + node.y,
  };
};

export function ChallengeMapStage({
  layout,
  selectedNodeId,
  onSelectNode,
}: ChallengeMapStageProps) {
  const maxY = Math.max(...layout.nodes.map((node) => node.y), 0);
  const stageHeight = maxY + TOP_PADDING + 90;

  return (
    <section
      aria-label="挑战沙盘"
      className="relative overflow-hidden rounded-[30px] border border-rose-200/70 bg-[radial-gradient(circle_at_50%_0%,rgba(255,237,213,0.75),rgba(255,255,255,0.92)_45%,rgba(255,241,242,0.88))] p-5 shadow-[0_20px_60px_rgba(244,114,182,0.14)]"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-rose-500">路线概览</p>
          <h3 className="mt-2 text-2xl font-semibold text-slate-900">挑战沙盘</h3>
        </div>
        <p className="text-sm text-slate-500">选择节点查看情报，再通过详情区进入。</p>
      </div>

      <div className="mt-5 overflow-x-auto pb-3">
        <div className="relative mx-auto min-w-[680px]" style={{ height: stageHeight }}>
          <svg
            className="absolute inset-0 h-full w-full"
            viewBox={`0 0 ${VIEWBOX_WIDTH} ${stageHeight}`}
            role="img"
            aria-label="挑战路线连线"
          >
            {layout.edges.map((edge) => {
              const from = resolveNodePoint(layout, edge.fromNodeId);
              const to = resolveNodePoint(layout, edge.toNodeId);
              if (!from || !to) return null;
              const controlY = (from.y + to.y) / 2;
              return (
                <path
                  key={edge.edgeId}
                  d={`M ${from.x} ${from.y} C ${from.x} ${controlY}, ${to.x} ${controlY}, ${to.x} ${to.y}`}
                  className={`${EDGE_CLASS_NAMES[edge.state]} fill-none`}
                  strokeWidth={edge.state === 'available' ? 5 : 3}
                  strokeLinecap="round"
                  strokeDasharray={edge.state === 'locked' ? '8 10' : undefined}
                  opacity={edge.state === 'locked' ? 0.45 : 0.9}
                />
              );
            })}
          </svg>

          <div className="absolute left-1/2 top-6 flex -translate-x-1/2 items-center gap-2 rounded-full border border-amber-200 bg-white/85 px-3 py-1 text-xs font-medium text-amber-700">
            <span className="size-2 rounded-full bg-amber-400" />
            起点
          </div>

          {layout.nodes.map((node) => (
            <ChallengeMapNode
              key={node.nodeId}
              layoutNode={node}
              isSelected={selectedNodeId === node.nodeId}
              left={NODE_CENTER_X + node.x}
              top={NODE_CENTER_OFFSET_Y + node.y}
              onSelect={onSelectNode}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

