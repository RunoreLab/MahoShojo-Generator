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
