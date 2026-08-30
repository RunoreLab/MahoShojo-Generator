import type { GeneralCharacterData } from '@/lib/schemas';

export const WANTU_CARD_KINDS = [
  'character',
  'location',
  'event',
  'setting',
  'item',
  'story',
  'faction',
] as const;

export type WantuCardKind = (typeof WANTU_CARD_KINDS)[number];

export interface WantuCard extends Record<string, unknown> {
  id?: string;
  cardKind: WantuCardKind;
  name: string;
  content: string;
  fields?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  references?: unknown[];
  visualAssets?: unknown[];
  generationHints?: Record<string, unknown>;
}

export type WantuCharacterExportMode = 'interop' | 'roundTrip';
export type MahoshojoOriginalTemplate = 'magical-girl' | 'canshou' | 'general' | 'unknown';

export interface MahoshojoRoundTripSource {
  id?: string;
  type?: string;
  name?: string;
}

export interface MahoshojoRoundTripExtension {
  version: 1;
  originalTemplate: MahoshojoOriginalTemplate;
  originalData: unknown;
  source?: MahoshojoRoundTripSource;
}

export interface ToWantuCharacterCardOptions {
  mode?: WantuCharacterExportMode;
  source?: MahoshojoRoundTripSource;
}

export interface FromWantuCharacterCardOptions {
  restoreOriginal?: boolean;
}

export type ImportedWantuCharacterData = GeneralCharacterData & {
  wantuCard: WantuCard;
};

export type WantuParseResult =
  | { success: true; data: WantuCard }
  | { success: false; error: string; issues: string[] };

export type FromWantuCharacterResult =
  | {
      success: true;
      data: ImportedWantuCharacterData | Record<string, unknown>;
      restored: boolean;
      warnings: string[];
    }
  | { success: false; error: string; issues: string[] };

export interface WantuArenaMaterialCandidate {
  id: string;
  kind: WantuCardKind;
  name: string;
  content: WantuCard;
  fileName: string | null;
  sourceDataCardId?: string;
  sourceDataCardUpdatedAt?: string;
}

export interface ArenaMaterialCandidateOptions {
  fileName?: string | null;
  sourceDataCardId?: string;
  sourceDataCardUpdatedAt?: string;
}

export type ArenaMaterialCandidateResult =
  | { success: true; data: WantuArenaMaterialCandidate; warnings: string[] }
  | { success: false; error: string; issues: string[] };

export interface WantuDataCard {
  format: 'wantu-data-card';
  formatVersion: number;
  exportedAt: string;
  app: { id: string; name: string };
  card: {
    schemaVersion: number;
    id: string;
    cardType: { genreId: string; categoryId: string; typeId: string };
    name: string;
    domains: Record<string, { kind: string; status: string; value: unknown }>;
    meta: Record<string, unknown>;
  };
  assets?: Array<{
    digest: string;
    domainKey: string;
    fileName: string;
    mimeType: string;
    byteSize: number;
    dataBase64: string;
  }>;
}
