import type { WebPackageRef } from '@mahoshojo/contracts/web-package';
import type { ResolvedWebPackage, WebPackageInstance } from './index';

export const WEB_PACKAGE_SCAN_VERSION = 1;
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
const rules: readonly [WebPackageRiskCategory, RegExp][] = [
  ['scripts', /<script\b|\bon\w+\s*=|javascript\s*:/iu],
  ['audio', /<audio\b|\bAudio(?:Context)?\s*\(/u],
  ['video', /<video\b/iu],
  ['network', /\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon)\b|https?:\/\/|wss?:\/\//u],
  ['host-page-access', HOST_PAGE_ACCESS],
  ['site-storage', /\b(?:localStorage|sessionStorage|indexedDB|BroadcastChannel|cookie|caches)\b/u],
  ['dynamic-execution', /\b(?:eval|Function|WebAssembly)\s*[.(]|\bimport\s*\(|(?:blob|data):(?:text\/javascript|application\/javascript)?/u],
  ['workers', /\b(?:Worker|SharedWorker)\s*\(/u],
  ['service-worker', /\bserviceWorker\b|ServiceWorkerContainer/u],
  ['navigation', /\b(?:window\s*\.\s*open|location\s*[.=]|download\s*=)|target\s*=\s*["']?_blank/u],
  ['sensitive-api', /\b(?:clipboard|getUserMedia|geolocation|Notification|PaymentRequest|requestDevice|showOpenFilePicker|showSaveFilePicker)\b/u],
];
const textType = (type: string): boolean => type.startsWith('text/') || /(?:json|javascript|svg\+xml|xml)$/u.test(type);
const activeType = (type: string): boolean => /(?:html|javascript|css|svg\+xml)$/u.test(type);

function scan(base: ResolvedWebPackage, instance?: WebPackageInstance): WebPackageRiskProfile {
  const findings: WebPackageRiskFinding[] = [];
  const categories = new Set<WebPackageRiskCategory>();
  const origins = new Set<string>();
  const uncertainty = new Set<string>(['启发式扫描无法证明安全；未检测到不代表没有此能力。']);
  let status: 'complete' | 'partial' = 'complete';
  let remaining = MAX_SCAN_TOTAL_BYTES;
  const files = [...base.manifest.files];
  if (instance && !files.some((file) => file.path === instance.overlay.targetPath)) {
    files.push({ path: instance.overlay.targetPath, mediaType: instance.overlay.targetMediaType,
      size: new TextEncoder().encode(instance.overlay.generatedContent).length, digest: instance.overlay.generatedDigest });
  }
  const add = (category: WebPackageRiskCategory, path: string, source: 'base' | 'overlay', evidence: string) => {
    categories.add(category);
    if (findings.length < MAX_FINDINGS) findings.push({ category, path, source, evidence: evidence.slice(0, 160) });
    else { status = 'partial'; uncertainty.add('部分风险证据未展开。'); }
  };
  for (const file of [...files].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)) {
    const isOverlay = Boolean(instance && file.path === instance.overlay.targetPath);
    const source = isOverlay ? 'overlay' : 'base';
    const type = isOverlay ? instance!.overlay.targetMediaType : file.mediaType;
    const size = isOverlay ? new TextEncoder().encode(instance!.overlay.generatedContent).length : file.size;
    if (type.startsWith('audio/')) add('audio', file.path, source, '包内音频资源');
    if (type.startsWith('video/')) add('video', file.path, source, '包内视频资源');
    if (type.includes('javascript')) add('scripts', file.path, source, 'JavaScript 文件');
    if (type === 'application/wasm' || file.path.endsWith('.wasm')) {
      add('dynamic-execution', file.path, source, 'WebAssembly 二进制，未分析其行为');
      uncertainty.add('包内包含无法静态分析的二进制执行内容。');
    }
    if (!textType(type)) continue;
    if (size > MAX_SCAN_FILE_BYTES || size > remaining) {
      status = 'partial'; uncertainty.add('部分文本超过扫描预算，未分析；此限制不影响包导入。'); continue;
    }
    remaining -= size;
    let text: string;
    try {
      const bytes = isOverlay ? new TextEncoder().encode(instance!.overlay.generatedContent) : base.readFile(file.path);
      if (!bytes) throw new Error('missing');
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch { status = 'partial'; uncertainty.add('存在无法读取或解码的文本文件。'); continue; }
    for (const [category, pattern] of rules) {
      const match = pattern.exec(text);
      if (match) add(category, file.path, source, text.slice(Math.max(0, match.index - 24), match.index + 100));
    }
    for (const match of text.matchAll(/(?:https?|wss?):\/\/[^\s"'<>`\\)\]}]+/gu)) {
      try { origins.add(new URL(match[0]).origin); } catch { uncertainty.add('存在无法解析的网络地址。'); }
    }
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
