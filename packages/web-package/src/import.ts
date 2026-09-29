import {
  WEB_PACKAGE_FORMAT,
  WEB_PACKAGE_FORMAT_VERSION,
  WEB_PACKAGE_MANIFEST_PATH,
  WEB_PACKAGE_TEXT_MEDIA_TYPES,
  type WebPackageManifest,
} from '@mahoshojo/contracts/web-package';
import {
  expandWebPackageArchive,
  normalizeWebPackageArchive,
  type ArchiveEntry,
} from './archive';
import { resolveWebPackageMediaType, WEB_PACKAGE_MEDIA_TYPE_EXTENSIONS } from './media-types';
import { digestWebPackageBytes, verifyWebPackage, type VerifiedWebPackage } from './verify';

export type WebPackageImportErrorCode =
  | 'not-a-zip'
  | 'empty-archive'
  | 'archive-too-large'
  | 'manifest-ambiguous'
  | 'manifest-nested'
  | 'manifest-invalid-json'
  | 'unsupported-format'
  | 'unsupported-format-version'
  | 'invalid-manifest-field'
  | 'file-outside-root'
  | 'undeclared-file'
  | 'missing-file'
  | 'duplicate-path'
  | 'unknown-media-type'
  | 'entry-not-found'
  | 'integrity';

const IMPORT_HINTS = {
  repack: '请确认选择的是 Web 包 ZIP，而不是其中的某个文件。',
  removeOrRename: '请移除或重命名该文件后重新打包。',
  deriveFiles: '也可以删除 web-package.json 中的 files 字段，改由归档自动派生。',
  entry: '请在包内放置 index.html，或在 web-package.json 中显式声明 entry。',
  supportedTypes: `当前支持的扩展名：${WEB_PACKAGE_MEDIA_TYPE_EXTENSIONS.join('、')}。`,
} as const;

/**
 * Import failures carry a stable code plus a remediation hint, so the UI can
 * tell a user what to change instead of echoing a bare validator message.
 */
export class WebPackageImportError extends Error {
  readonly code: WebPackageImportErrorCode;
  readonly hint: string;
  constructor(code: WebPackageImportErrorCode, message: string, hint: string) {
    super(message);
    this.name = 'WebPackageImportError';
    this.code = code;
    this.hint = hint;
  }
}

export type WebPackageImportResult = Readonly<{
  pkg: VerifiedWebPackage;
  /** Defaults applied, metadata dropped and normalization notes; user-facing. */
  diagnostics: readonly string[];
}>;

type Descriptor = WebPackageManifest['files'][number];

function fail(code: WebPackageImportErrorCode, message: string, hint: string): never {
  throw new WebPackageImportError(code, message, hint);
}

/**
 * Only *absent* manifest fields are defaulted. A field that is present but
 * invalid is an authoring error and fails loudly, so defaults never silently
 * overrule an author's explicit intent.
 */
const readOptionalString = (
  source: Record<string, unknown>,
  field: string,
  label: string,
): string | undefined => {
  const value = source[field];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !value) {
    fail('invalid-manifest-field', `Web 包 ${label} 的 ${field} 字段非法。`,
      `请把 ${field} 改为非空字符串，或直接删除该字段以使用默认值。`);
  }
  return value;
};

/** Content-addressed id so re-zipping a renamed folder keeps the same identity. */
const deriveLocalId = async (files: readonly ArchiveEntry[]): Promise<string> => {
  const lines = await Promise.all(files.map(async (file) => (
    `${file.path}\u0000${await digestWebPackageBytes(file.bytes)}`
  )));
  const digest = await digestWebPackageBytes(new TextEncoder().encode(lines.sort().join('\n')));
  const hex = digest.slice('sha256:'.length, 'sha256:'.length + 32);
  return `local.${hex}`;
};

/** Shallowest `index.html`, else shallowest HTML file. */
const detectEntry = (paths: readonly string[]): string | undefined => {
  const html = paths.filter((path) => path.toLowerCase().endsWith('.html'));
  const index = html.filter((path) => { const lower = path.toLowerCase(); return lower === 'index.html' || lower.endsWith('/index.html'); });
  const pool = index.length > 0 ? index : html;
  return pool.sort((left, right) => (
    left.split('/').length - right.split('/').length || (left < right ? -1 : 1)
  ))[0];
};

const requireMediaType = (path: string): string => {
  const mediaType = resolveWebPackageMediaType(path);
  if (!mediaType) {
    fail('unknown-media-type', `无法从文件名推断媒体类型：${path}`,
      `${IMPORT_HINTS.supportedTypes}也可在 web-package.json 的 files 中显式声明 mediaType。`);
  }
  return mediaType;
};

const describeZodFailure = (error: unknown): string | null => {
  const issues = (error as { issues?: ReadonlyArray<{ path: readonly unknown[]; message: string }> }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  return issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('；');
};

/** Declared `files` stay authoritative; only an absent table is derived. */
const resolveFileDescriptors = async (
  raw: Record<string, unknown>,
  files: readonly ArchiveEntry[],
  diagnostics: string[],
): Promise<readonly Descriptor[]> => {
  const declared = raw.files;
  if (declared === undefined) {
    diagnostics.push(`files 未声明，已按归档内 ${files.length} 个文件自动派生文件表、媒体类型与摘要。`);
    return Promise.all(files.map(async (file) => ({
      path: file.path,
      mediaType: requireMediaType(file.path),
      digest: await digestWebPackageBytes(file.bytes),
      size: file.bytes.byteLength,
    })));
  }
  if (!Array.isArray(declared)) {
    fail('invalid-manifest-field', `Web 包 ${WEB_PACKAGE_MANIFEST_PATH} 的 files 字段必须是数组。`,
      `请改为文件描述数组，或删除该字段以按归档自动派生。${IMPORT_HINTS.deriveFiles}`);
  }
  const declaredPaths = declared.map((file) => {
    const path = (file as { path?: unknown }).path;
    if (typeof path !== 'string' || !path) {
      fail('invalid-manifest-field', `Web 包 ${WEB_PACKAGE_MANIFEST_PATH} 的 files 条目缺少合法 path。`,
        `请为每个文件条目提供 path，或删除 files 字段改由归档自动派生。`);
    }
    return path;
  });
  if (new Set(declaredPaths.map((path) => path.toLowerCase())).size !== declaredPaths.length) {
    fail('duplicate-path', 'Web 包 files 中存在重复或大小写冲突的路径。',
      `请修正重复路径，或删除 files 字段改由归档自动派生。`);
  }
  const available = new Set(files.map((file) => file.path));
  const declaredSet = new Set(declaredPaths);
  for (const path of declaredPaths) {
    if (!available.has(path)) fail('missing-file', `Web 包 ZIP 缺少已声明文件：${path}`,
      `请补齐该文件，或删除 files 字段改由归档自动派生。`);
  }
  for (const file of files) {
    if (!declaredSet.has(file.path)) fail('undeclared-file', `Web 包 ZIP 包含未声明文件：${file.path}`,
      `请将该文件加入 files，或删除 files 字段改由归档自动派生。`);
  }
  return declared as readonly Descriptor[];
};

const buildGeneration = (
  raw: Record<string, unknown>,
  entry: string,
  diagnostics: string[],
): Record<string, unknown> => {
  const generation = raw.generation === undefined ? {} : raw.generation;
  if (!generation || typeof generation !== 'object' || Array.isArray(generation)) {
    fail('invalid-manifest-field', 'Web 包 generation 字段必须是对象。',
      '请改为对象，或删除该字段以默认替换自动识别的入口。');
  }
  const source = generation as Record<string, unknown>;
  if (source.mode !== undefined && source.mode !== 'replace') {
    fail('invalid-manifest-field', `Web 包 generation.mode 仅支持 replace，收到：${String(source.mode)}`,
      '请把 mode 改为 replace，或删除 generation 字段。');
  }
  const mediaType = readOptionalString(source, 'mediaType', 'generation');
  if (mediaType !== undefined && !(WEB_PACKAGE_TEXT_MEDIA_TYPES as readonly string[]).includes(mediaType)) {
    fail('invalid-manifest-field', `Web 包 generation.mediaType 不受支持：${mediaType}`,
      `V1 生成目标仅支持 ${WEB_PACKAGE_TEXT_MEDIA_TYPES.join('、')}。`);
  }
  const declaredTarget = readOptionalString(source, 'target', 'generation');
  if (declaredTarget === undefined) diagnostics.push('generation.target 未声明，已默认替换自动识别的入口文件。');
  if (mediaType === undefined) diagnostics.push('generation.mediaType 未声明，已默认使用 text/html。');
  const optional = (field: 'instructions' | 'schema' | 'assetCatalog'): Record<string, string> => {
    const value = readOptionalString(source, field, 'generation');
    return value === undefined ? {} : { [field]: value };
  };
  return {
    target: declaredTarget ?? entry,
    mode: 'replace',
    mediaType: mediaType ?? 'text/html',
    ...optional('instructions'),
    ...optional('schema'),
    ...optional('assetCatalog'),
  };
};

const buildManifest = async (
  raw: Record<string, unknown>,
  descriptors: readonly Descriptor[],
  files: readonly ArchiveEntry[],
  root: string,
  diagnostics: string[],
): Promise<Record<string, unknown>> => {
  if (raw.format !== undefined && raw.format !== WEB_PACKAGE_FORMAT) {
    fail('unsupported-format', `不支持的 Web 包格式：${String(raw.format)}`, `当前仅支持 ${WEB_PACKAGE_FORMAT}。`);
  }
  if (raw.formatVersion !== undefined && raw.formatVersion !== WEB_PACKAGE_FORMAT_VERSION) {
    fail('unsupported-format-version', `不支持的 Web 包格式版本：${String(raw.formatVersion)}`,
      `当前仅支持 formatVersion ${WEB_PACKAGE_FORMAT_VERSION}。`);
  }
  const paths = new Set(descriptors.map((file) => file.path));
  const declaredEntry = readOptionalString(raw, 'entry', WEB_PACKAGE_MANIFEST_PATH);
  const entry = declaredEntry ?? detectEntry([...paths]);
  if (entry === undefined) fail('entry-not-found', 'Web 包中没有可识别的 HTML 入口。', IMPORT_HINTS.entry);
  if (declaredEntry === undefined) diagnostics.push(`entry 未声明，已自动识别入口为 ${entry}。`);
  if (!paths.has(entry)) {
    fail('entry-not-found', `Web 包入口文件不存在：${entry}`, '请确认该文件在包内存在，或修正 entry 字段。');
  }
  const id = readOptionalString(raw, 'id', WEB_PACKAGE_MANIFEST_PATH) ?? await deriveLocalId(files);
  if (raw.id === undefined) diagnostics.push('id 未声明，已按包内容派生稳定的本地包 ID。');
  const version = readOptionalString(raw, 'version', WEB_PACKAGE_MANIFEST_PATH) ?? '1.0.0';
  if (raw.version === undefined) diagnostics.push('version 未声明，已默认使用 1.0.0。');
  const name = readOptionalString(raw, 'name', WEB_PACKAGE_MANIFEST_PATH) ?? (root || id);
  if (raw.name === undefined) diagnostics.push('name 未声明，已按包根目录或 ID 显示。');
  if (raw.capabilities === undefined) diagnostics.push('capabilities 未声明，已按空数组处理（不影响实际能力扫描）。');
  return {
    format: WEB_PACKAGE_FORMAT,
    formatVersion: WEB_PACKAGE_FORMAT_VERSION,
    id,
    version,
    name,
    entry,
    generation: buildGeneration(raw, entry, diagnostics),
    ...(raw.capabilities === undefined ? {} : { capabilities: raw.capabilities }),
    files: descriptors,
  };
};

const expandOrFail = (archive: Uint8Array): Record<string, Uint8Array> => {
  try {
    return expandWebPackageArchive(archive, (limit) => new WebPackageImportError(
      'archive-too-large',
      `Web 包解压后超过 ${Math.round(limit / 1024 / 1024)} MiB，已停止导入。`,
      '这是防止畸形归档耗尽内存的保护上限，不是 Web 包的产品大小限制；请精简包内容后重试。',
    ));
  } catch (error) {
    if (error instanceof WebPackageImportError) throw error;
    fail('not-a-zip', 'Web 包 ZIP 无法解析。', IMPORT_HINTS.repack);
  }
};

export const importWebPackageArchive = async (archive: Uint8Array): Promise<WebPackageImportResult> => {
  const diagnostics: string[] = [];
  const rawEntries = expandOrFail(archive);

  const normalized = normalizeWebPackageArchive({
    entries: rawEntries,
    manifestPath: WEB_PACKAGE_MANIFEST_PATH,
    ambiguousRoot: (candidates) => new WebPackageImportError('manifest-ambiguous',
      `归档中存在多个 ${WEB_PACKAGE_MANIFEST_PATH}：${candidates.join('、')}。`, '请只保留一个 Web 包根目录后重新打包。'),
    nestedManifest: (path, manifestPath) => new WebPackageImportError('manifest-nested',
      `${manifestPath} 位于多层嵌套目录：${path}`,
      '请直接打包 Web 包目录本身（使该文件位于根目录或一层子目录），而不是它的上级目录。'),
    fileOutsideRoot: (path, root) => new WebPackageImportError('file-outside-root',
      `归档中存在包根目录 ${root}/ 之外的文件：${path}`, '请只打包 Web 包目录本身，不要混入同级文件。'),
    invalidPath: (path) => new WebPackageImportError('invalid-manifest-field', `Web 包内包含非法路径：${path}`, IMPORT_HINTS.removeOrRename),
    strayEntry: (path) => new WebPackageImportError('undeclared-file', `Web 包 ZIP 包含未声明文件：${path}`,
      '请移除该多余条目后重新打包。'),
    directoryNotEmpty: (path) => new WebPackageImportError('undeclared-file', `Web 包 ZIP 包含非法目录条目：${path}`,
      '请移除该条目后重新打包。'),
  });

  if (normalized.dropped.length > 0) {
    diagnostics.push(`已忽略 ${normalized.dropped.length} 个归档工具元数据条目：${normalized.dropped.join('、')}`);
  }
  if (normalized.root) diagnostics.push(`已识别包根目录 ${normalized.root}/，导入后路径以此为基准。`);
  if (normalized.files.length === 0) fail('empty-archive', 'Web 包归档中没有任何文件。', IMPORT_HINTS.repack);

  const payload = new Map(normalized.files.map((file) => [file.path, file.bytes]));
  const manifestBytes = payload.get(WEB_PACKAGE_MANIFEST_PATH);
  let raw: Record<string, unknown> = {};
  if (manifestBytes) {
    payload.delete(WEB_PACKAGE_MANIFEST_PATH);
    raw = parseManifest(manifestBytes);
  } else {
    diagnostics.push(`未找到 ${WEB_PACKAGE_MANIFEST_PATH}，已按归档结构自动识别 Web 包。`);
  }
  if (payload.size === 0) fail('empty-archive', 'Web 包归档中除清单外没有任何文件。', IMPORT_HINTS.entry);

  const files = [...payload.entries()].map(([path, bytes]) => ({ path, bytes }))
    .sort((left, right) => (left.path < right.path ? -1 : 1));
  const descriptors = await resolveFileDescriptors(raw, files, diagnostics);
  const manifest = await buildManifest(raw, descriptors, files, normalized.root, diagnostics);
  if (descriptors.length !== files.length) {
    fail('undeclared-file', 'Web 包声明的文件数量与归档内容不一致。', IMPORT_HINTS.deriveFiles);
  }
  try {
    const pkg = await verifyWebPackage(manifest, files);
    return { pkg, diagnostics };
  } catch (error) {
    const zodFailure = describeZodFailure(error);
    if (zodFailure !== null) {
      fail('invalid-manifest-field', `Web 包清单未通过校验：${zodFailure}`,
        `请按提示修正 web-package.json，或删除该文件改由归档自动识别。`);
    }
    fail('integrity', `Web 包未通过完整性校验：${error instanceof Error ? error.message : String(error)}`,
      '请确认包内文件与声明一致；若是自制包，可删除 web-package.json 中的 files 字段改由归档自动派生。');
  }
};

const parseManifest = (bytes: Uint8Array): Record<string, unknown> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail('manifest-invalid-json', `Web 包 ${WEB_PACKAGE_MANIFEST_PATH} 不是合法 JSON。`,
      '请修正该文件的 JSON 语法，或删除它以按归档结构自动识别。');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    fail('manifest-invalid-json', `Web 包 ${WEB_PACKAGE_MANIFEST_PATH} 必须是 JSON 对象。`,
      '请改为 JSON 对象，或删除它以按归档结构自动识别。');
  }
  return parsed as Record<string, unknown>;
};
