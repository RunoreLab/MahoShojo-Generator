import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  DESKTOP_PROFILE_SIGNATURE_MAX_LENGTH,
  DesktopCloudSaveSignatureRequestSchema,
  DesktopCloudSaveSignatureResultSchema,
} from '../src/desktop-cloud';

const fixture = JSON.parse(readFileSync(
  path.join(import.meta.dirname, '..', 'fixtures', 'desktop-profile-signature.json'), 'utf8',
)) as {
  maxLength: number;
  validRequests: { input: unknown; normalizedSignature: string }[];
  invalidRequestJson: string[];
  validResults: unknown[];
  invalidResultJson: string[];
};

describe('个性签名窄写入 TS/Rust 共用 wire fixture', () => {
  it('输入按 UTF-16 计数，规范化 CRLF 但不 trim 或截断', () => {
    expect(DESKTOP_PROFILE_SIGNATURE_MAX_LENGTH).toBe(fixture.maxLength);
    for (const { input, normalizedSignature } of fixture.validRequests) {
      expect(DesktopCloudSaveSignatureRequestSchema.parse(input).signature).toBe(normalizedSignature);
    }
  });

  it('拒绝额外 HTTP/头像/未知字段、错误账号、越界与孤立代理项', () => {
    for (const input of fixture.invalidRequestJson) {
      expect(DesktopCloudSaveSignatureRequestSchema.safeParse(JSON.parse(input)).success, input).toBe(false);
    }
  });

  it('native 返回必须具备原始账号与确认文本，不允许凭据或伪造缺省值', () => {
    for (const result of fixture.validResults) {
      expect(DesktopCloudSaveSignatureResultSchema.parse(result)).toEqual(result);
    }
    for (const result of fixture.invalidResultJson) {
      expect(DesktopCloudSaveSignatureResultSchema.safeParse(JSON.parse(result)).success, result).toBe(false);
    }
  });
});
