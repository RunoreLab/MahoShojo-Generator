// AI 推理（reasoning）信封的共享类型。
//
// 此前在 `apps/web/types/ai-reasoning.ts` 与
// `packages/hosted-runtime/src/node-runtime/types.ts` 各有一份逐字拷贝；
// 字段既出现在 hosted SSE 事件里、也出现在客户端展示层，因此 canonical 定义
// 收敛到 contracts。形状不变，只是声明位置收敛。

export type AIReasoningStatus = 'idle' | 'thinking' | 'done' | 'unavailable' | 'error';

export type AIReasoningSource = 'sdk' | 'provider' | 'heuristic' | 'unknown';

export interface AIReasoningPart {
  id?: string;
  text: string;
  source?: AIReasoningSource;
  createdAt?: string;
}

export interface AIReasoningEnvelope {
  status: AIReasoningStatus;
  source: AIReasoningSource;
  summary?: string | null;
  text?: string | null;
  parts?: AIReasoningPart[];
  reasoningTokens?: number | null;
  anomalyFlags?: string[] | null;
  errorMessage?: string | null;
}
