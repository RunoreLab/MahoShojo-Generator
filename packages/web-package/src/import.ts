import {
  WEB_PACKAGE_DECLARABLE_CAPABILITIES,
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
import { resolveWebPackageMediaType, WEB_PACKAGE_OPAQUE_MEDIA_TYPE } from './media-types';
import { buildGenerationReadinessHints } from './generation-readiness';
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
  | 'entry-not-found'
  | 'integrity';

const IMPORT_HINTS = {
  repack: '请确认选择的是 Web 包 ZIP，而不是其中的某个文件。',
  removeOrRename: '请移除或重命名该文件后重新打包。',
  deriveFiles: '也可以删除 web-package.json 中的 files 字段，改由归档自动派生。',
  entry: '请在包内放置 index.html，或在 web-package.json 中显式声明 entry。',
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

/**
 * 描述不了的文件按不透明二进制处理，而不是拒绝整个包。真正决定「这段字节
 * 会不会被执行」的是渲染器：`<script src>` 指向非 JavaScript 媒体类型会直接
 * 抛「脚本 MIME 不匹配」，非 CSS 资源也不会被当样式表解析。未知扩展名在导入
 * 层阻断使用，换来的是零安全收益。
 */
const describeMediaType = (path: string, diagnostics: string[]): string => {
  const mediaType = resolveWebPackageMediaType(path);
  if (mediaType) return mediaType;
  diagnostics.push(`${path} 的扩展名不在已知媒体类型表中，已按不透明二进制（${WEB_PACKAGE_OPAQUE_MEDIA_TYPE}）导入；`
    + `若该资源需要被页面按特定类型加载，请在 web-package.json 的 files 中显式声明 mediaType。`);
  return WEB_PACKAGE_OPAQUE_MEDIA_TYPE;
};

type ManifestIssue = Readonly<{ path: readonly unknown[]; code?: string; message: string }>;

/** 取值清单由 schema 派生，作者向文案不会在枚举变化后静默过期。 */
const DECLARABLE_CAPABILITIES_TEXT = WEB_PACKAGE_DECLARABLE_CAPABILITIES.join('、');

/**
 * zod 的诊断文本是英文的校验器语言，直接透给包作者等于让他去读实现。这里把
 * 已知的高频 authoring 错误翻译成「字段是什么 + 该怎么改」，未覆盖的仍保留
 * 原文并给出通用指引。
 */
const manifestIssueGuidance = (issue: ManifestIssue, entryPath: string): { message: string; hint: string } | null => {
  const field = issue.path.map(String).join('.');
  const leaf = String(issue.path[issue.path.length - 1] ?? '');
  if (issue.code === 'unrecognized_keys') {
    return {
      message: `web-package.json 含有当前版本不认识的字段：${field}`,
      hint: `清单只接受 format、formatVersion、id、version、name、entry、generation、capabilities、files；其余字段请删除。`,
    };
  }
  if (issue.path[0] === 'capabilities' && issue.code === 'invalid_value') {
    return {
      message: `${field} 不在 capabilities 允许值内。`,
      hint: `作者声明只用于对照预检结论，不是权限声明，当前只接受 ${DECLARABLE_CAPABILITIES_TEXT}；`
        + '站点存储、后台 Worker、宿主页面访问等能力由宿主预检自动检测并在授权对话框中列出，没有对应的声明词。',
    };
  }
  if (issue.path[0] === 'capabilities' && issue.code === 'custom') {
    return {
      message: 'capabilities 中有重复的能力声明。',
      hint: `同一项能力只需声明一次，请删除重复项；允许的取值为 ${DECLARABLE_CAPABILITIES_TEXT}。`,
    };
  }
  if ((issue.path[0] === 'id' || issue.path[0] === 'version') && issue.code === 'invalid_format') {
    return {
      message: `${field} 只能使用英文字母、数字、点、下划线与短横线，且必须以字母或数字开头。`,
      hint: `${field} 只用于包身份与版本比较；中文名称请写进 name 字段。`,
    };
  }
  if (leaf === 'mediaType' && issue.path[0] === 'files' && issue.code === 'invalid_format') {
    return {
      message: `${field} 必须是「类型/子类型」形式，不能带参数。`,
      hint: '例如 text/html、application/json、image/png；不要写成 "text/html; charset=utf-8"。',
    };
  }
  if (issue.code === 'custom') {
    if (issue.path[0] === 'entry') {
      return {
        message: 'entry 必须在包内存在，且媒体类型是 text/html。',
        hint: '请确认该文件确实在 ZIP 内；或删除 entry 字段，由导入自动识别最浅的 index.html。',
      };
    }
    if (leaf === 'target') {
      return {
        message: 'generation.target 必须指向包内已存在的文件，且其媒体类型与 generation.mediaType 一致。',
        hint: '两者都不声明时导入会默认用入口文件与 text/html；如果目标是 JSON 等数据文件，请同时声明 mediaType。',
      };
    }
    if (leaf === 'instructions' || leaf === 'schema' || leaf === 'assetCatalog' || leaf === 'example') {
      if (/must not be the entry/u.test(issue.message)) {
        return {
          message: `generation.${leaf} 不能指向入口文件 ${entryPath}。`,
          hint: '入口是一定会被执行的页面，不能同时当作提示材料交给 AI——那样它的代码就不会进入风险分析。'
            + '请另存一份提示文件（例如 ai/instructions.md）后指向它；范例可以直接指向 generation.target。',
        };
      }
      return {
        message: `generation.${leaf} 指向的文件不在包内。`,
        hint: `请把该文件一起打包，或删除 generation.${leaf} 字段。`,
      };
    }
    if (issue.path[0] === 'files') {
      return {
        message: 'files 中存在重复或保留的路径。',
        hint: '路径不能重复（不区分大小写），也不能是 web-package.json；或删除 files 字段改由归档自动派生。',
      };
    }
  }
  return null;
};

const describeManifestFailure = (error: unknown, entryPath: string): { message: string; hint: string } | null => {
  const issues = (error as { issues?: ManifestIssue[] }).issues;
  if (!Array.isArray(issues) || issues.length === 0) return null;
  const described = issues.map((issue) => {
    const guidance = manifestIssueGuidance(issue, entryPath);
    const field = issue.path.join('.') || '(root)';
    return guidance
      ? `${field}: ${guidance.message}`
      : `${field}: ${issue.message}`;
  });
  const known = issues.map((issue) => manifestIssueGuidance(issue, entryPath)?.hint).filter((hint): hint is string => Boolean(hint));
  return {
    message: `Web 包清单未通过校验：${described.join('；')}`,
    hint: known.length > 0
      ? [...new Set(known)].join(' ')
      : '请按提示修正 web-package.json，或删除该文件改由归档结构自动识别。',
  };
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
      mediaType: describeMediaType(file.path, diagnostics),
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

const optionalPromptFiles = (source: Record<string, unknown>): Record<string, string> => {
  const optional = (field: 'instructions' | 'schema' | 'assetCatalog' | 'example'): Record<string, string> => {
    const value = readOptionalString(source, field, 'generation');
    return value === undefined ? {} : { [field]: value };
  };
  return { ...optional('instructions'), ...optional('schema'), ...optional('assetCatalog'), ...optional('example') };
};

const buildGeneration = (
  raw: Record<string, unknown>,
  entry: string,
  descriptors: readonly Descriptor[],
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
  const target = declaredTarget ?? entry;
  if (declaredTarget === undefined) diagnostics.push('generation.target 未声明，已默认替换自动识别的入口文件。');
  // 目标已经在包内时，媒体类型由该文件自己的描述符决定。作者写了
  // `target: "static/events.json"` 却漏写 mediaType 时，默认 text/html 会
  // 撞上"target 必须与既有路径和媒体类型一致"，而那条消息完全不提 mediaType。
  const targetDescriptor = descriptors.find((file) => file.path.toLowerCase() === target.toLowerCase());
  const derivedMediaType = targetDescriptor?.mediaType;
  if (mediaType === undefined) {
    const resolved = derivedMediaType !== undefined && (WEB_PACKAGE_TEXT_MEDIA_TYPES as readonly string[]).includes(derivedMediaType)
      ? derivedMediaType
      : 'text/html';
    diagnostics.push(`generation.mediaType 未声明，已按目标文件 ${target} 推导为 ${resolved}。`);
    return {
      target,
      mode: 'replace',
      mediaType: resolved,
      ...optionalPromptFiles(source),
    };
  }
  return {
    target,
    mode: 'replace',
    mediaType,
    ...optionalPromptFiles(source),
  };
};

const MANIFEST_FIELDS: ReadonlySet<string> = new Set([
  'format', 'formatVersion', 'id', 'version', 'name', 'entry', 'generation', 'capabilities', 'files',
]);

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
  // canonical manifest 是 strict 的，未知顶层字段会被丢弃。与其静默吞掉作者
  // 的拼写错误（generationn、entrys），不如在导入诊断里点名。
  const ignored = Object.keys(raw).filter((key) => !MANIFEST_FIELDS.has(key)).sort();
  if (ignored.length > 0) {
    diagnostics.push(`web-package.json 中的 ${ignored.join('、')} 不属于当前清单字段，已忽略；`
      + '清单只接受 format、formatVersion、id、version、name、entry、generation、capabilities、files。');
  }
  return {
    format: WEB_PACKAGE_FORMAT,
    formatVersion: WEB_PACKAGE_FORMAT_VERSION,
    id,
    version,
    name,
    entry,
    generation: buildGeneration(raw, entry, descriptors, diagnostics),
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
  try {
    const pkg = await verifyWebPackage(manifest, files);
    diagnostics.push(...buildGenerationReadinessHints(pkg.manifest, {
      text: (path) => {
        const bytes = files.find((file) => file.path === path)?.bytes;
        if (!bytes) return null;
        try {
          return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        } catch {
          return null;
        }
      },
      json: (path) => {
        const bytes = files.find((file) => file.path === path)?.bytes;
        if (!bytes) return undefined;
        try {
          return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
        } catch {
          return undefined;
        }
      },
    }));
    return { pkg, diagnostics };
  } catch (error) {
    // `manifest` is the pre-validation draft here, so the entry is untyped until
    // the schema below accepts or rejects it; the guidance only echoes it back.
    const manifestFailure = describeManifestFailure(error, String(manifest.entry ?? ''));
    if (manifestFailure !== null) {
      fail('invalid-manifest-field', manifestFailure.message, manifestFailure.hint);
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
