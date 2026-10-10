import type { ReactNode } from 'react';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { ExternalMediaPolicy } from '../markdown/text';

export type BattleReportHostPorts = Readonly<{
  /** No host policy means no external Markdown media loads. illustrationAsset is an explicit host-owned asset. */
  mediaPolicy?: ExternalMediaPolicy;
  extractReasoning?(markdown: string): AIReasoningEnvelope | null;
  generatedBy?: ReactNode;
  saveImage?(element: HTMLElement, context: { filename: string; title: string; kind: 'structured' | 'streaming' }): Promise<void>;
  downloadMarkdown?(content: string, filename: string): void;
  onImageSaveError?(error: unknown): void;
}>;
