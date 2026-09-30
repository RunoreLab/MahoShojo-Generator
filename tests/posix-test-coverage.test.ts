import { describe, expect, it } from 'vitest';
import {
  hasBash,
  hasCaseSensitiveFs,
  hasSh,
  hasSymlink,
  posixPython,
} from './support/posix';

const runningInCI = process.env.CI === 'true';

describe.skipIf(!runningInCI)('POSIX 专用仓库测试的执行前提', () => {
  it('CI 必须具备 POSIX 能力，否则相关测试会被静默跳过', () => {
    expect({
      sh: hasSh,
      bash: hasBash,
      symlink: hasSymlink,
      caseSensitiveFs: hasCaseSensitiveFs,
      python: posixPython !== undefined,
    }).toEqual({
      sh: true,
      bash: true,
      symlink: true,
      caseSensitiveFs: true,
      python: true,
    });
  });
});