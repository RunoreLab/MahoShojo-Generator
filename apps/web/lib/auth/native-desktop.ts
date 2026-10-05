import {
  DESKTOP_AUTH_GRANT_TTL_SECONDS,
  DesktopAuthorizeQuerySchema,
  type DesktopAuthorizeQuery,
} from '@mahoshojo/contracts/desktop-cloud';

import { getSecureRandomValues, sha256Hex } from '@/lib/crypto';

/**
 * `desktop-auth-v1` 原生授权窄协议的服务端核心。
 *
 * 设计（RFC 8252 loopback + RFC 7636 PKCE S256 的最小变体）：
 *
 * 1. native 绑定 `127.0.0.1:0`、生成 state 与 PKCE verifier，打开系统浏览器到
 *    `/auth/desktop?state=&code_challenge=&code_challenge_method=S256&redirect_uri=`；
 * 2. 授权页确认已登录后 POST `/api/auth/native/grant`：服务端以会话身份签发一次性
 *    grant（120 秒、绑定 challenge/state/redirectUri），只回传 redirectUrl；
 * 3. 浏览器 GET `http://127.0.0.1:<port>/callback?code=&state=`，native 校验 state
 *    后 POST `/api/auth/native/exchange`（code + verifier）换取正式会话 cookie。
 *
 * 凭据边界：code 只在回跳 URL 与一次性存储键的散列中出现；服务端 DB 只存
 * `sha256(code)` 派生键 + JSON 记录，不存明文 code；verifier 永不离开 native。
 */

/** grant 存储的 identifier 前缀；`consumeVerificationValue` 按此键原子消费。 */
export const DESKTOP_GRANT_IDENTIFIER_PREFIX = 'desktop-native-grant:';

const toBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  // 等价于 btoa + 替换；运行时不依赖 Node Buffer（CF workers / edge 均可用）。
  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '');
};

const generateRandomBase64Url = (byteCount: number): string => {
  const bytes = new Uint8Array(byteCount);
  getSecureRandomValues(bytes);
  return toBase64Url(bytes);
};

/** 一次性 grant code：32B 随机 → 43 字符 base64url。 */
export const generateDesktopGrantCode = (): string => generateRandomBase64Url(32);

/** code 的散列派生键：DB 记录与消费都按此键定位，不接触明文 code。 */
export const desktopGrantIdentifierFromCode = async (code: string): Promise<string> =>
  `${DESKTOP_GRANT_IDENTIFIER_PREFIX}${await sha256Hex(code)}`;

const sha256Base64Url = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return toBase64Url(new Uint8Array(digest));
};

/**
 * PKCE S256 校验。失败一律返回 false（调用方统一映射 `invalid-grant`，
 * 不向客户端区分 code 不存在 / 已消费 / verifier 不匹配）。
 */
export const verifyDesktopCodeVerifier = async (
  codeVerifier: string,
  codeChallenge: string,
): Promise<boolean> => {
  const computed = await sha256Base64Url(codeVerifier);
  if (computed.length !== codeChallenge.length) return false;
  // 长度固定的常量时间比较；两边均为 base64url ASCII。
  let diff = 0;
  for (let index = 0; index < computed.length; index += 1) {
    diff |= computed.charCodeAt(index) ^ codeChallenge.charCodeAt(index);
  }
  return diff === 0;
};

/** 回跳 URL：严格使用服务端记录的 redirectUri，不接受调用方传入的查询参数。 */
export const buildDesktopGrantRedirectUrl = (input: {
  redirectUri: string;
  code: string;
  state: string;
}): string => {
  const url = new URL(input.redirectUri);
  url.searchParams.set('code', input.code);
  url.searchParams.set('state', input.state);
  return url.toString();
};

/** 授权页 query 的完整校验（页面与服务端共用同一 schema 来源）。 */
export const parseDesktopAuthorizeQuery = (
  params: Record<string, string | string[] | undefined>,
):
  | { ok: true; query: DesktopAuthorizeQuery }
  | { ok: false; reason: 'missing' | 'invalid' } => {
  const flat = {
    state: params.state,
    code_challenge: params.code_challenge,
    code_challenge_method: params.code_challenge_method,
    redirect_uri: params.redirect_uri,
  };
  if (Object.values(flat).some((value) => value === undefined || Array.isArray(value))) {
    return { ok: false, reason: 'missing' };
  }
  const parsed = DesktopAuthorizeQuerySchema.safeParse(flat);
  return parsed.success ? { ok: true, query: parsed.data } : { ok: false, reason: 'invalid' };
};

/** grant 记录在 verification.value 里的 JSON 载荷。 */
export type DesktopGrantRecordPayload = {
  v: 1;
  authUserId: string;
  businessUserId: number;
  codeChallenge: string;
  redirectUri: string;
  state: string;
};

export const encodeDesktopGrantRecord = (payload: DesktopGrantRecordPayload): string =>
  JSON.stringify(payload);

export const decodeDesktopGrantRecord = (value: string): DesktopGrantRecordPayload | null => {
  try {
    const parsed = JSON.parse(value) as Partial<DesktopGrantRecordPayload>;
    if (
      parsed?.v !== 1
      || typeof parsed.authUserId !== 'string'
      || typeof parsed.businessUserId !== 'number'
      || typeof parsed.codeChallenge !== 'string'
      || typeof parsed.redirectUri !== 'string'
      || typeof parsed.state !== 'string'
    ) {
      return null;
    }
    return parsed as DesktopGrantRecordPayload;
  } catch {
    return null;
  }
};

export const DESKTOP_GRANT_EXPIRES_IN_SECONDS = DESKTOP_AUTH_GRANT_TTL_SECONDS;
