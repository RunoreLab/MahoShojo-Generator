import { z } from './zod';

export const WEB_PACKAGE_FORMAT = 'mahoshojo-web-package' as const;
export const WEB_PACKAGE_FORMAT_VERSION = 1 as const;
export const WEB_PACKAGE_MANIFEST_PATH = 'manifest.json' as const;
export const WEB_PACKAGE_TEXT_MEDIA_TYPES = [
  'text/html', 'text/plain', 'text/markdown', 'text/css', 'text/javascript',
  'application/javascript', 'application/json', 'image/svg+xml',
] as const;

const DigestSchema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const IdentitySchema = z.string().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
const MediaTypeSchema = z.string().max(128).regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/u);
const ByteLengthSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ReservedFileStem = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;

/** Portable relative paths; case folding is also checked when comparing file identities. */
export const WebPackagePathSchema = z.string().min(1).max(512).superRefine((path, context) => {
  if (path.split('/').some((part) => (
    !/^[a-zA-Z0-9._-]+$/u.test(part) || part === '.' || part === '..'
    || part.endsWith('.') || ReservedFileStem.test(part)
  ))) {
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
    instructions: WebPackagePathSchema,
    schema: WebPackagePathSchema.optional(),
    assetCatalog: WebPackagePathSchema.optional(),
  }).strict(),
  capabilities: z.array(z.enum(['scripts', 'audio', 'video', 'network'])).max(4),
  files: z.array(WebPackageFileDescriptorSchema).min(1).max(1024),
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
  for (const key of ['instructions', 'schema', 'assetCatalog'] as const) {
    const path = manifest.generation[key];
    if (path && !manifest.files.some((file) => file.path === path)) {
      context.addIssue({ code: 'custom', path: ['generation', key], message: 'prompt file must exist' });
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
