export type TavernChunkType = 'tEXt' | 'iTXt' | 'zTXt';

export interface PngTextChunk {
  chunkType: TavernChunkType;
  keyword: string;
  text: string;
}

export interface TavernCardCandidate {
  keyword: string;
  chunkType: TavernChunkType;
  parseMethod: 'base64-json' | 'json' | 'inflate-base64-json' | 'inflate-json';
  parsed: unknown;
}

export interface TavernCardNormalized {
  spec?: string;
  specVersion?: string;
  sourceChunk?: string;

  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
  mesExample?: string;
  tags?: string[];

  avatar?: string;
  creator?: string;
  characterVersion?: string;
  createDate?: string;
  talkativeness?: number;
  fav?: boolean;
  creatorComment?: string;

  creatorNotes?: string;
  systemPrompt?: string;
  postHistoryInstructions?: string;
  alternateGreetings?: string[];
  groupOnlyGreetings?: string[];

  extensions?: Record<string, unknown>;
  characterBook?: unknown;
}

export interface TavernImportMeta {
  extractedAt: string;
  sourceChunk?: string;
  spec?: string;
  specVersion?: string;

  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  firstMes?: string;
  mesExample?: string;
  tags?: string[];

  candidates: Array<{
    keyword: string;
    chunkType: TavernChunkType;
    parseMethod: 'base64-json' | 'json' | 'inflate-base64-json' | 'inflate-json';
    ok: boolean;
    spec?: string;
    specVersion?: string;
    name?: string;
    sizeChars?: number;
  }>;

  warnings: string[];
  sizes?: {
    pngBytes?: number;
    selectedPayloadChars?: number;
  };
}

export type TavernParseErrorCode =
  | 'NOT_PNG'
  | 'PNG_SIGNATURE_MISMATCH'
  | 'PNG_TRUNCATED'
  | 'NO_TEXT_CHUNKS'
  | 'NO_TAVERN_CARD_FOUND'
  | 'PAYLOAD_DECODE_FAILED'
  | 'JSON_PARSE_FAILED';

export interface TavernParseError {
  code: TavernParseErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

export interface TavernParseResult {
  normalized: TavernCardNormalized;
  meta: TavernImportMeta;
  candidates: TavernCardCandidate[];
  selected: TavernCardCandidate;
}

export interface TavernWriteOptions {
  overwriteExisting?: boolean;
  includeCharaChunk?: boolean;
  includeCcv3Chunk?: boolean;
}

export interface TavernCardV3Data {
  name: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creator_notes?: string;
  system_prompt?: string;
  post_history_instructions?: string;
  tags?: string[];
  creator?: string;
  character_version?: string;
  alternate_greetings?: string[];
  group_only_greetings?: string[];
  extensions?: Record<string, unknown>;
  character_book?: unknown;
}

export interface TavernCardV3 {
  spec: 'chara_card_v3';
  spec_version: '3.0';
  data: TavernCardV3Data;
  name?: string;
  description?: string;
  personality?: string;
  scenario?: string;
  first_mes?: string;
  mes_example?: string;
  creatorcomment?: string;
  talkativeness?: number;
  fav?: boolean;
  tags?: string[];
}

