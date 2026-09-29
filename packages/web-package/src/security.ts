import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import { isWebPackageBinaryMediaType } from './media-types';
import type { ResolvedWebPackage, WebPackageInstance } from './index';

// 2: 收紧 inline handler / data: / site-storage 规则，跳过提示词与 Markdown 文件，
// 并把 XML 命名空间标识符排除在网络目的地之外。旧版本签发的长期信任必须重新确认。
export const WEB_PACKAGE_SCAN_VERSION = 2;
export const WEB_PACKAGE_TRUST_POLICY_VERSION = 1;
export const WEB_PACKAGE_RISK_LABELS = {
  scripts: '脚本执行', audio: '音频', video: '视频', network: '网络访问',
  'host-page-access': '宿主页面访问', 'site-storage': '站点存储',
  'dynamic-execution': '动态代码', workers: '后台 Worker',
  'service-worker': 'Service Worker 持久执行', navigation: '导航、窗口或下载',
  'sensitive-api': '敏感浏览器能力',
} as const;
export type WebPackageRiskCategory = keyof typeof WEB_PACKAGE_RISK_LABELS;
export type WebPackageRiskFinding = Readonly<{
  category: WebPackageRiskCategory;
  source: 'base' | 'overlay';
  path: string;
  evidence: string;
}>;
export type WebPackageRiskProfile = Readonly<{
  packageRef: WebPackageRef;
  generatedDigest?: string;
  scannerVersion: number;
  policyVersion: number;
  declared: readonly string[];
  categories: readonly WebPackageRiskCategory[];
  findings: readonly WebPackageRiskFinding[];
  externalOrigins: readonly string[];
  uncertainty: readonly string[];
  status: 'complete' | 'partial';
  fingerprint: string;
}>;
export type WebPackageTrustGrant = Readonly<{
  packageDigest: string;
  generatedDigest: string;
  scope: 'instance' | 'revision';
  scannerVersion: number;
  policyVersion: number;
  categories: readonly WebPackageRiskCategory[];
  externalOrigins: readonly string[];
  uncertainty: readonly string[];
  profileStatus: 'complete' | 'partial';
}>;

// 只限制启发式扫描成本，不限制包的导入或运行大小。未扫描部分显式标为未知。
const MAX_SCAN_FILE_BYTES = 512 * 1024;
const MAX_SCAN_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FINDINGS = 512;
/** 授权对话框要指名道姓，否则"未分析"对用户不可行动；条目过多只列前若干个。 */
const MAX_LISTED_UNSCANNED = 8;
const encoder = new TextEncoder();
const listPaths = (paths: readonly string[]): string => (paths.length <= MAX_LISTED_UNSCANNED
  ? paths.join('、')
  : `${paths.slice(0, MAX_LISTED_UNSCANNED).join('、')} 等 ${paths.length} 个文件`);
const sorted = <T extends string>(items: Iterable<T>): T[] => [...new Set(items)].sort();
/**
 * Host-page access is matched only where markup cannot imitate it. `top` is a
 * ubiquitous CSS property and class name, and `.parent`/`#parent`/`--parent`
 * are selectors or custom properties, so an unqualified `top` is not reported
 * and bare globals must not sit behind a selector or property sigil. The scan
 * is a heuristic prompt rather than an enforcement boundary: a miss costs one
 * warning, a false positive costs trust in every other warning.
 */
const HOST_PAGE_ACCESS = /(?:window|self|globalThis|frames)\s*\.\s*(?:parent|top|opener|frameElement)\b|(?:^|[^\w.$\-#])(?:parent|opener|frameElement)\b/u;
/**
 * Inline event-handler attribute: only real when the whole attribute name is
 * `on…` inside a tag. `oneTime = true` is an ordinary identifier, and
 * `data-one=` / `aria-on*` are prefixed attribute names, not handlers.
 */
const INLINE_HANDLER_ATTRIBUTE = /\bon[a-z]+\s*=/giu;
const isInlineHandlerAttribute = (text: string, index: number): boolean => {
  if (index > 0 && !/\s/u.test(text[index - 1] ?? '')) return false;
  const open = text.lastIndexOf('<', index);
  if (open < 0) return false;
  const close = text.indexOf('>', open);
  if (close >= 0 && close < index) return false;
  return /^<\/?[A-Za-z][^<>]*$/u.test(text.slice(open, index));
};
/** `data:image/png;base64,…` is an inline asset, not executable script content. */
const EXECUTABLE_DATA_URL = /\bblob:|(?:data|blob):(?:text|application)\/(?:x-)?(?:java|ecma)script\b/iu;
/** `cookie`/`caches` appear in ordinary prose; require the actual access site. */
const SITE_STORAGE = /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel)\b|\bdocument\s*\.\s*cookie\b|\bcaches\s*\.\s*(?:open|match|has|delete|keys)\b/u;
/** XML namespaces and DOCTYPE identifiers are identifiers, never fetched. */
const XML_IDENTIFIERS = /\bxmlns(?::[A-Za-z_][\w.-]*)?\s*=\s*(?:"[^"]*"|'[^']*')|\bxsi:schemaLocation\s*=\s*(?:"[^"]*"|'[^']*')|<!DOCTYPE[^>]*>/giu;

type RiskRule = readonly [
  WebPackageRiskCategory,
  RegExp,
  ((_text: string, _match: RegExpExecArray) => boolean)?,
];

const rules: readonly RiskRule[] = [
  ['scripts', /<script\b|javascript\s*:/iu],
  ['scripts', INLINE_HANDLER_ATTRIBUTE, (_text, match) => isInlineHandlerAttribute(_text, match.index)],
  ['audio', /<audio\b|\bAudio(?:Context)?\s*\(/u],
  ['video', /<video\b/iu],
  ['network', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|https?:\/\/|wss?:\/\//u],
  ['host-page-access', HOST_PAGE_ACCESS],
  ['site-storage', SITE_STORAGE],
  ['dynamic-execution', /\b(?:eval|Function|WebAssembly)\s*[.(]|\bimport\s*\(/iu],
  ['dynamic-execution', EXECUTABLE_DATA_URL],
  ['workers', /\b(?:Worker|SharedWorker)\s*\(/u],
  ['service-worker', /\bserviceWorker\b|ServiceWorkerContainer/u],
  ['navigation', /\b(?:window\s*\.\s*open|location\s*[.=]|download\s*=)|target\s*=\s*["']?_blank/u],
  ['sensitive-api', /\b(?:clipboard|getUserMedia|geolocation|Notification|PaymentRequest|requestDevice|showOpenFilePicker|showSaveFilePicker)\b/u],
];
/**
 * 是否按内容决定文本扫描：声明的媒体类型由包作者给出，可以与真实内容不符
 * （把脚本声明成 `image/png` 就能让整段文本扫描被跳过），所以扫描与否最终由
 * 「严格 UTF-8 解码是否成功」决定。媒体类型名单只用于一件事——体量超过预算的
 * 已知二进制不值得尝试解码，也不构成"未扫描"缺口。
 */
const activeType = (type: string): boolean => /(?:html|javascript|css|svg\+xml)$/u.test(type);
/**
 * 提示投影输入（instructions / schema / assetCatalog）不是运行时资源：其中的
 * 代码片段、URL 与 "不要使用 cookie" 之类的说明都只是创作参考文本。把它们当作
 * 运行时代码扫描，会让一个完全本地的包长期挂着"网络访问""站点存储"警告。
 */
const isPromptProjectionFile = (base: ResolvedWebPackage, path: string): boolean => {
  const { instructions, schema, assetCatalog } = base.manifest.generation;
  return path === instructions || path === schema || path === assetCatalog;
};
/** Markdown 在浏览器里没有执行语义；其内容只可能被读取它的脚本解释。 */
const isDocumentationFile = (type: string): boolean => type === 'text/markdown';

const firstConfirmedMatch = (
  pattern: RegExp,
  text: string,
  confirm?: (_text: string, _match: RegExpExecArray) => boolean,
): RegExpExecArray | null => {
  const scanner = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
  for (const match of text.matchAll(scanner)) {
    if (!confirm || confirm(text, match)) return match;
  }
  return null;
};

function scan(base: ResolvedWebPackage, instance?: WebPackageInstance): WebPackageRiskProfile {
  const findings: WebPackageRiskFinding[] = [];
  const categories = new Set<WebPackageRiskCategory>();
  const origins = new Set<string>();
  const uncertainty = new Set<string>(['启发式扫描无法证明安全；未检测到不代表没有此能力。']);
  let status: 'complete' | 'partial' = 'complete';
  let remaining = MAX_SCAN_TOTAL_BYTES;
  const overlayPath = instance?.overlay.targetPath;
  const overlayBytes = instance ? encoder.encode(instance.overlay.generatedContent) : null;
  const byPath = (left: { path: string }, right: { path: string }): number => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  /**
   * 生成目标先扫，基础包用剩余预算。授权判断依赖生成目标的扫描结论，让基础包按
   * 路径序抢走预算会把最该被扫描的文件挤掉——这个方向性错误即使 fail-closed 也
   * 救不回来。同路径的基础包描述符由 overlay 取代，与既有行为一致。
   */
  const files = [
    ...(instance ? [{ path: instance.overlay.targetPath, mediaType: instance.overlay.targetMediaType, size: overlayBytes!.length, digest: instance.overlay.generatedDigest }] : []),
    ...base.manifest.files.filter((file) => file.path !== overlayPath).sort(byPath),
  ];
  const add = (category: WebPackageRiskCategory, path: string, source: 'base' | 'overlay', evidence: string) => {
    categories.add(category);
    if (findings.length < MAX_FINDINGS) findings.push({ category, path, source, evidence: evidence.slice(0, 160) });
    else { status = 'partial'; uncertainty.add('部分风险证据未展开。'); }
  };
  let skippedPromptFiles = 0;
  const overBudget: string[] = [];
  const undecodable: string[] = [];
  for (const file of files) {
    const isOverlay = file.path === overlayPath;
    const source = isOverlay ? 'overlay' : 'base';
    const type = isOverlay ? instance!.overlay.targetMediaType : file.mediaType;
    const size = isOverlay ? overlayBytes!.length : file.size;
    if (type.startsWith('audio/')) add('audio', file.path, source, '包内音频资源');
    if (type.startsWith('video/')) add('video', file.path, source, '包内视频资源');
    if (type.includes('javascript')) add('scripts', file.path, source, 'JavaScript 文件');
    if (type === 'application/wasm' || file.path.endsWith('.wasm')) {
      add('dynamic-execution', file.path, source, 'WebAssembly 二进制，未分析其行为');
      uncertainty.add('包内包含无法静态分析的二进制执行内容。');
    }
    const scanned = isOverlay || !(isPromptProjectionFile(base, file.path) || isDocumentationFile(type));
    if (!scanned) skippedPromptFiles += 1;
    if (!scanned) continue;
    if (size > MAX_SCAN_FILE_BYTES || size > remaining) {
      // 已知二进制本来就扫不出东西，不该因此把档案标成"未完成"。
      if (!isWebPackageBinaryMediaType(type)) {
        status = 'partial';
        overBudget.push(file.path);
      }
      continue;
    }
    remaining -= size;
    let text: string;
    try {
      const bytes = isOverlay ? overlayBytes : base.readFile(file.path);
      if (!bytes) throw new Error('missing');
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      // 真实二进制在严格 UTF-8 下解码失败，跳过不构成扫描缺口。
      if (!isWebPackageBinaryMediaType(type)) {
        status = 'partial';
        undecodable.push(file.path);
      }
      continue;
    }
    // 命名空间与 DOCTYPE 里的 URL 是标识符，不是会被取回的网络目的地。
    const scannable = type === 'image/svg+xml' || type.endsWith('+xml') || type === 'text/xml' || type === 'application/xml'
      ? text.replace(XML_IDENTIFIERS, ' ')
      : text;
    for (const [category, pattern, confirm] of rules) {
      const match = firstConfirmedMatch(pattern, scannable, confirm);
      if (match) add(category, file.path, source, scannable.slice(Math.max(0, match.index - 24), match.index + 100));
    }
    for (const match of scannable.matchAll(/(?:https?|wss?):\/\/[^\s"'<>`\\)\]}]+/gu)) {
      try { origins.add(new URL(match[0]).origin); } catch { uncertainty.add('存在无法解析的网络地址。'); }
    }
  }
  if (skippedPromptFiles > 0) {
    uncertainty.add(`包内 ${skippedPromptFiles} 个提示词/说明文件未按运行时能力扫描；其中的代码片段与地址只是创作参考文本。`);
  }
  if (overBudget.length > 0) {
    uncertainty.add(`以下文本超过预检体量或预算上限，未分析：${listPaths(overBudget)}。此限制不影响包导入，也不表示其中没有能力。`);
  }
  if (undecodable.length > 0) {
    uncertainty.add(`以下文本无法按 UTF-8 读取或解码，未分析：${listPaths(undecodable)}。此限制不影响包导入，也不表示其中没有能力。`);
  }
  if (categories.has('network')) uncertainty.add('网络目的地可能动态构造；远程内容未下载、未分析，可能随时变化。');
  if (categories.has('dynamic-execution')) uncertainty.add('动态代码或模块加载使实际行为无法仅由文本确定。');
  const targetType = base.manifest.generation.mediaType;
  uncertainty.add(activeType(targetType)
    ? 'AI 生成目标可执行代码或加载资源，后续生成可能改变实际能力。'
    : 'AI 生成数据可能被 Runtime 解释为 URL、HTML 或指令，不能视为能力固定。');
  const fields = {
    packageRef: { ...base.ref }, ...(instance ? { generatedDigest: instance.overlay.generatedDigest } : {}),
    scannerVersion: WEB_PACKAGE_SCAN_VERSION, policyVersion: WEB_PACKAGE_TRUST_POLICY_VERSION,
    declared: sorted(base.manifest.capabilities), categories: sorted(categories), findings,
    externalOrigins: sorted(origins), uncertainty: sorted(uncertainty), status,
  };
  // 完整稳定的内容标识，而不是安全签名；不把片段内容插入 HTML。
  const fingerprint = JSON.stringify({ ...fields, findings: undefined });
  return Object.freeze({ ...fields, fingerprint });
}

export const scanWebPackageBase = (base: ResolvedWebPackage): WebPackageRiskProfile => scan(base);
export const scanWebPackageInstance = (instance: WebPackageInstance): WebPackageRiskProfile => scan(instance.base, instance);

const digest = (value: unknown): value is string => typeof value === 'string' && /^sha256:[0-9a-f]{64}$/u.test(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 2048 && value.every((item) => typeof item === 'string' && item.length <= 4096);
export function parseWebPackageTrustGrant(input: unknown): WebPackageTrustGrant | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (!digest(value.packageDigest) || !digest(value.generatedDigest)
    || (value.scope !== 'instance' && value.scope !== 'revision')
    || value.scannerVersion !== WEB_PACKAGE_SCAN_VERSION || value.policyVersion !== WEB_PACKAGE_TRUST_POLICY_VERSION
    || !strings(value.categories) || !value.categories.every((c) => Object.prototype.hasOwnProperty.call(WEB_PACKAGE_RISK_LABELS, c))
    || !strings(value.externalOrigins) || !strings(value.uncertainty)
    || (value.profileStatus !== 'complete' && value.profileStatus !== 'partial')) return null;
  return value as unknown as WebPackageTrustGrant;
}

export function createWebPackageTrustGrant(profile: WebPackageRiskProfile, scope: 'instance' | 'revision'): WebPackageTrustGrant {
  if (!profile.generatedDigest) throw new Error('同源授权必须绑定已完成的生成目标');
  if (scope === 'revision' && profile.status !== 'complete') throw new Error('扫描不完整时仅可授权本次结果');
  return Object.freeze({ packageDigest: profile.packageRef.digest, generatedDigest: profile.generatedDigest, scope,
    scannerVersion: profile.scannerVersion, policyVersion: profile.policyVersion, categories: [...profile.categories],
    externalOrigins: [...profile.externalOrigins], uncertainty: [...profile.uncertainty], profileStatus: profile.status });
}

export function canReuseWebPackageTrust(input: unknown, profile: WebPackageRiskProfile): boolean {
  const grant = parseWebPackageTrustGrant(input);
  if (!grant || !profile.generatedDigest || grant.packageDigest !== profile.packageRef.digest
    || grant.scannerVersion !== profile.scannerVersion || grant.policyVersion !== profile.policyVersion) return false;
  if (grant.scope === 'instance' && grant.generatedDigest !== profile.generatedDigest) return false;
  if (grant.scope === 'revision' && (grant.profileStatus !== 'complete' || profile.status !== 'complete')) return false;
  if (grant.profileStatus !== profile.status) return false;
  return profile.categories.every((item) => grant.categories.includes(item))
    && profile.externalOrigins.every((item) => grant.externalOrigins.includes(item))
    && profile.uncertainty.every((item) => grant.uncertainty.includes(item));
}
