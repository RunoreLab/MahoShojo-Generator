// Both /battle and /arena retain this import surface while using the pure core.
export {
  STREAM_UPDATE_META_MARKERS,
  STREAM_TELEMETRY_META_MARKER,
  StreamUpdateMetaSchema,
  StreamTelemetryMetaSchema,
  findStreamUpdateMetaStart,
  stripStreamUpdateMetaComment,
  stripAllStreamMetaComments,
  extractStreamUpdateMeta,
  extractStreamTelemetryMeta,
  splitStreamMeta,
} from '@mahoshojo/ai-core/arena-generation';
export type {
  StreamUpdateMetaStartKind,
  StreamUpdateMetaStartHit,
  StreamUpdateMeta,
  StreamTelemetryMeta,
  StreamUpdateImpact,
  NormalizedStreamUpdateMeta,
  ExtractedStreamMeta,
  NormalizedStreamTelemetryMeta,
  ExtractedStreamTelemetryMeta,
  StrippedStreamMetaComment,
} from '@mahoshojo/ai-core/arena-generation';
