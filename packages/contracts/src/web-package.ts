import { z } from './zod';

export const WEB_PACKAGE_FORMAT = 'mahoshojo-web-package' as const;
export const WEB_PACKAGE_FORMAT_VERSION = 1 as const;
export const WEB_PACKAGE_MANIFEST_PATH = 'web-package.json' as const;
export const WEB_PACKAGE_TEXT_MEDIA_TYPES = [
  'text/html', 'text/plain', 'text/markdown', 'text/css', 'text/javascript',
  'application/javascript', 'application/json', 'image/svg+xml',
] as const;

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const IdentitySchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
const MediaTypeSchema = z.string().max(128).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u);
/**
 * Media type 形状的唯一权威：Desktop 的 webpkg IPC 契约在同包内直接复用它，
 * 不另写一份 regex——两个判据一旦分叉，resolver 的 Content-Type 决策就会与
 * manifest 校验不一致。名字按对外契约风格加 `WebPackage` 前缀导出。
 */
export const WebPackageMediaTypeSchema = MediaTypeSchema;
const ByteLengthSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ReservedFileStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
// Controls, Windows-invalid filename characters, path separators and '%'
// (percent would make logical paths ambiguous under URL decoding).
const ForbiddenPathChar = /[\u0000-\u001f\u007f<>:"|?*%\\]/u;

/** Portable relative paths; case folding is also checked when comparing file identities. */
export const WebPackagePathSchema = z.string().min(1).max(512).superRefine((path, context) => {
  if (path.startsWith('/') || ForbiddenPathChar.test(path)
    || path.split('/').some((part) => (
      !part || part === '.' || part === '..'
      || part.endsWith('.') || part.endsWith(' ') || ReservedFileStem.test(part)
    ))
  ) {
    context.addIssue({ code: 'custom', message: 'must be a portable relative package path' });
  }
});

export const WebPackageRefSchema = z.object({
  id: IdentitySchema,
  version: IdentitySchema,
  digest: DigestSchema,
}).strict();
export type WebPackageRef = z.infer<typeof WebPackageRefSchema>;

export const WebPackageFileDescriptorSchema = z.object({
  path: WebPackagePathSchema,
  mediaType: MediaTypeSchema,
  digest: DigestSchema,
  size: ByteLengthSchema,
}).strict();
export type WebPackageFileDescriptor = z.infer<typeof WebPackageFileDescriptorSchema>;

const TargetPathSchema = WebPackagePathSchema.refine(
  (path) => path.toLowerCase() !== WEB_PACKAGE_MANIFEST_PATH,
  'generation cannot replace the package manifest',
);

/**
 * 作者可声明的能力，取值刻意少于预检的风险类别。
 *
 * 声明是作者对宿主预检结论的补充说明，不是权限授予，也不构成安全结论。它不与
 * 预检类别同步扩展：两份同源词表一旦对齐，作者声明就会变成预检结果的影子副本，
 * 既可能因漂移而说谎，也会让读者把一份"看起来完整"的清单当成授权。真正的安全
 * 事实始终来自预检；声明的价值只在于让作者写错的地方可见。
 */
export const WEB_PACKAGE_DECLARABLE_CAPABILITIES = ['scripts', 'audio', 'video', 'network'] as const;
export type WebPackageDeclarableCapability = (typeof WEB_PACKAGE_DECLARABLE_CAPABILITIES)[number];

export const WebPackageManifestSchema = z.object({
  format: z.literal(WEB_PACKAGE_FORMAT),
  formatVersion: z.literal(WEB_PACKAGE_FORMAT_VERSION),
  id: IdentitySchema,
  version: IdentitySchema,
  name: z.string().min(1).max(256),
  entry: WebPackagePathSchema,
  generation: z.object({
    target: TargetPathSchema,
    mode: z.literal('replace'),
    mediaType: z.enum(WEB_PACKAGE_TEXT_MEDIA_TYPES),
    instructions: WebPackagePathSchema.optional(),
    schema: WebPackagePathSchema.optional(),
    assetCatalog: WebPackagePathSchema.optional(),
    /**
     * Opt-in reference for the target file, projected to the model the same
     * bounded way as `instructions`. Never filled in automatically: a target
     * that is a placeholder (the shipped preset's is) would teach the model to
     * emit the placeholder.
     *
     * Two uses, deliberately sharing one field: a small shape sample (a few
     * records) or a complete working reference implementation (for example a
     * playable game whose mechanics the model adapts to the cast). Only the
     * second is large, so the byte budget is sized for it — roughly a 33k-token
     * reference against a 128k system prompt budget. A truncated reference is
     * worse than none, so the budget rejects rather than clips.
     */
    example: WebPackagePathSchema.optional(),
  }).strict(),
  // 唯一性检查已经把长度限制在枚举大小以内：多出一项必然重复。不再叠加 `.max()`，
  // 否则重复声明会同时得到 `too_big`（"最多 4 项"，而 4 正是允许的取值数）与
  // "必须唯一"两条互相干扰的英文原文。
  capabilities: z.array(z.enum(WEB_PACKAGE_DECLARABLE_CAPABILITIES)).default([]),
  files: z.array(WebPackageFileDescriptorSchema).min(1),
}).strict().superRefine((manifest, context) => {
  const paths = new Set<string>();
  for (const [index, file] of manifest.files.entries()) {
    const normalized = file.path.toLowerCase();
    if (paths.has(normalized) || normalized === WEB_PACKAGE_MANIFEST_PATH) {
      context.addIssue({ code: 'custom', path: ['files', index, 'path'], message: 'duplicate or reserved package path' });
    }
    paths.add(normalized);
  }
  const entry = manifest.files.find((file) => file.path === manifest.entry);
  if (entry?.mediaType !== 'text/html') {
    context.addIssue({ code: 'custom', path: ['entry'], message: 'entry must exist and be text/html' });
  }
  for (const key of ['instructions', 'schema', 'assetCatalog', 'example'] as const) {
    const path = manifest.generation[key];
    if (path && !manifest.files.some((file) => file.path === path)) {
      context.addIssue({ code: 'custom', path: ['generation', key], message: 'prompt file must exist' });
    }
    // A prompt projection input is read as model context and never loaded, so it
    // is exempt from runtime scanning. That exemption must not reach the entry:
    // the entry always executes, and an author pointing `instructions` (or
    // `example`) at it would otherwise hide that code from the risk profile
    // that the trust grant is decided on.
    if (path && path === manifest.entry) {
      context.addIssue({ code: 'custom', path: ['generation', key], message: 'prompt file must not be the entry' });
    }
  }
  const target = manifest.files.find((file) => file.path.toLowerCase() === manifest.generation.target.toLowerCase());
  if (target && (target.path !== manifest.generation.target || target.mediaType !== manifest.generation.mediaType)) {
    context.addIssue({ code: 'custom', path: ['generation', 'target'], message: 'target must match the existing path and media type' });
  }
  if (new Set(manifest.capabilities).size !== manifest.capabilities.length) {
    context.addIssue({ code: 'custom', path: ['capabilities'], message: 'capabilities must be unique' });
  }
});
export type WebPackageManifest = z.infer<typeof WebPackageManifestSchema>;

export const WebPackageArtifactSchema = z.object({
  packageRef: WebPackageRefSchema,
  targetPath: TargetPathSchema,
  targetMediaType: z.enum(WEB_PACKAGE_TEXT_MEDIA_TYPES),
  generatedDigest: DigestSchema,
}).strict();
export type WebPackageArtifact = z.infer<typeof WebPackageArtifactSchema>;

export const WebPackageOverlaySchema = WebPackageArtifactSchema.extend({ generatedContent: z.string() }).strict();
export type WebPackageOverlay = z.infer<typeof WebPackageOverlaySchema>;

/** Renderer transport is deliberately separate from package identity and logical paths. */
export type WebPackageRenderLocation = { kind: 'srcdoc'; html: string } | { kind: 'url'; url: string };

/** Source adapters may grow (online) without changing package identity or overlay semantics. */
export type WebPackageSourceKind = 'builtin' | 'local' | 'online';

/**
 * Client-authored Prompt Projection for local packages the server cannot resolve.
 * Structural trust only: host authority, target contract and safety stay server-owned.
 */
export const WebPackagePromptProjectionSchema = z.object({
  package: z.object({
    id: IdentitySchema,
    name: z.string().min(1).max(256),
    version: IdentitySchema,
    digest: DigestSchema,
  }),
  entry: WebPackagePathSchema,
  target: z.object({
    path: TargetPathSchema,
    mediaType: z.enum(WEB_PACKAGE_TEXT_MEDIA_TYPES),
    mode: z.literal('replace'),
  }),
  instructions: z.string().optional(),
  schema: z.unknown().optional(),
  assetCatalog: z.unknown().optional(),
  example: z.string().optional(),
}).superRefine((projection, context) => {
  const encoder = new TextEncoder();
  const utf8Bytes = (value: unknown): number => encoder.encode(JSON.stringify(value ?? '')).byteLength;
  if (projection.instructions !== undefined && utf8Bytes(projection.instructions) > 131_072) {
    context.addIssue({ code: 'custom', path: ['instructions'], message: 'instructions exceeds projection byte budget' });
  }
  if (projection.schema !== undefined && utf8Bytes(projection.schema) > 262_144) {
    context.addIssue({ code: 'custom', path: ['schema'], message: 'schema exceeds projection byte budget' });
  }
  if (projection.assetCatalog !== undefined && utf8Bytes(projection.assetCatalog) > 131_072) {
    context.addIssue({ code: 'custom', path: ['assetCatalog'], message: 'assetCatalog exceeds projection byte budget' });
  }
  // Sized for the larger of the two uses: a complete working reference
  // implementation is tens of KiB of code, a shape sample is a few records.
  // A truncated reference teaches the model to emit a broken artefact, so this
  // rejects rather than clips; the real ceiling is the Arena prompt budget,
  // which rejects the whole request with 413.
  if (projection.example !== undefined && utf8Bytes(projection.example) > 131_072) {
    context.addIssue({ code: 'custom', path: ['example'], message: 'example exceeds projection byte budget' });
  }
});
export type WebPackagePromptProjection = z.infer<typeof WebPackagePromptProjectionSchema>;
