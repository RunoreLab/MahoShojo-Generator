import type { ReactNode } from 'react';
import type { AIReasoningEnvelope } from '@mahoshojo/contracts/ai-reasoning';
import type { ExternalMediaPolicy } from '../markdown/text';

export type BattleReportHostPorts = Readonly<{
  /** No host policy means no external Markdown media loads. illustrationAsset is an explicit host-owned asset. */
  mediaPolicy?: ExternalMediaPolicy;
  /** When provided, owns all report links (including relative/fragment/scheme URLs), confirmation, protocol validation and errors. Missing port preserves native Web navigation. */
  onNavigateExternal?(href: string): void | Promise<void>;
  extractReasoning?(markdown: string): AIReasoningEnvelope | null;
  generatedBy?: ReactNode;
  saveImage?(element: HTMLElement, context: { filename: string; title: string; kind: 'structured' | 'streaming' }): Promise<void>;
  downloadMarkdown?(content: string, filename: string): void;
  onImageSaveError?(error: unknown): void;
}>;
