import { ARENA_CANONICAL_RESOURCE_LIMITS } from '@mahoshojo/contracts/arena-capabilities';
import {
  WebPackageOverlaySchema,
  WebPackagePromptProjectionSchema,
  WebPackageRefSchema,
  type WebPackageArtifact,
  type WebPackageOverlay,
  type WebPackagePromptProjection,
  type WebPackageRef,
} from '@mahoshojo/contracts/web-package';

export type ArenaWebPackageQualificationFailure = 'meta' | 'identity' | 'target';

/** Only fixed diagnostics: generated source never belongs in an error channel. */
export class ArenaWebPackageQualificationError extends Error {
  constructor(readonly failure: ArenaWebPackageQualificationFailure) {
    super(`ARENA_WEB_PACKAGE_QUALIFICATION_${failure.toUpperCase()}`);
    this.name = 'ArenaWebPackageQualificationError';
  }
}

export type ArenaWebPackageOutputInput = {
  ref: WebPackageRef;
  /** Frozen canonical projection, when the host has one. Never model-authored. */
  projection?: WebPackagePromptProjection;
  /** Target from the strict stream projector, without its control trailer. */
  content: string;
  /** Only a successful strict projector meta event, never a display-title fallback. */
  meta: unknown;
  /**
   * Bind an existing web-package overlay creator to the host's frozen verified
   * base/projection. It owns target normalization, schema/UTF-8 validation and
   * digest calculation; this core does not resolve packages or use global staging.
   */
  // eslint-disable-next-line no-unused-vars -- Type-only host port parameters.
  createOverlay(_content: string, _options: { maxBytes: number }): Promise<WebPackageOverlay>;
};

const sameRef = (left: WebPackageRef, right: WebPackageRef): boolean => (
  left.id === right.id && left.version === right.version && left.digest === right.digest
);

/**
 * Shared final package qualification, not completion or execution authority.
 * The caller first verifies its own completed/stop and scope, then rechecks its
 * scope after awaiting. Free Web deliberately does not use this stricter gate.
 * The overlay contains normalized target bytes; keep raw transport separately.
 * Creator errors (including WebPackageTargetError and cancellation) pass through.
 */
export const qualifyArenaWebPackageOutput = async (
  input: ArenaWebPackageOutputInput,
): Promise<{ overlay: WebPackageOverlay; artifact: WebPackageArtifact }> => {
  const meta = input.meta as { version?: unknown; report?: { headline?: unknown; winner?: unknown } } | null;
  if (meta?.version !== 1 || !meta.report
    || typeof meta.report.headline !== 'string' || !meta.report.headline.trim()
    || typeof meta.report.winner !== 'string' || !meta.report.winner.trim()) {
    throw new ArenaWebPackageQualificationError('meta');
  }
  // Snapshot expectations before any async host work.
  const ref = WebPackageRefSchema.parse(input.ref);
  const projection = input.projection === undefined ? undefined : WebPackagePromptProjectionSchema.parse(input.projection);
  if (projection && !sameRef(ref, projection.package)) throw new ArenaWebPackageQualificationError('identity');
  const overlay = WebPackageOverlaySchema.parse(await input.createOverlay(input.content, {
    maxBytes: ARENA_CANONICAL_RESOURCE_LIMITS.outputContentBytes,
  }));
  if (!sameRef(ref, overlay.packageRef)) throw new ArenaWebPackageQualificationError('identity');
  if (projection && (overlay.targetPath !== projection.target.path || overlay.targetMediaType !== projection.target.mediaType)) {
    throw new ArenaWebPackageQualificationError('target');
  }
  const artifact: WebPackageArtifact = {
    packageRef: { ...overlay.packageRef },
    targetPath: overlay.targetPath,
    targetMediaType: overlay.targetMediaType,
    generatedDigest: overlay.generatedDigest,
  };
  return { overlay, artifact };
};
