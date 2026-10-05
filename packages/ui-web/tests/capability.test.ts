import { describe, expect, it } from 'vitest';

import {
  AVAILABLE,
  UNKNOWN_CAPABILITY,
  isCapabilityAvailable,
  readCapability,
  unavailable,
  type CapabilityAvailability,
} from '../src/capability/index';

describe('capability availability', () => {
  it('keeps "why not" type-level distinguishable so callers cannot collapse every reason into one state', () => {
    // DESK-PROD-003：MUST NOT 把未配置/需登录/服务失败/尚未实现都显示成"没有数据"。
    // 这几个原因必须是不同取值，而不是一个 disabled 加一句自由文本。
    const reasons = [
      unavailable('not-configured'),
      unavailable('requires-sign-in'),
      unavailable('service-unavailable'),
      unavailable('not-implemented'),
      unavailable('storage-unavailable'),
    ];

    const distinct = new Set(
      reasons.map((entry) => (entry.kind === 'unavailable' ? entry.reason : entry.kind)),
    );
    expect(distinct.size).toBe(5);
    for (const entry of reasons) {
      expect(isCapabilityAvailable(entry)).toBe(false);
    }
  });

  it('carries an optional detail without making it required', () => {
    expect(unavailable('not-configured')).toEqual({ kind: 'unavailable', reason: 'not-configured' });
    expect(unavailable('not-configured', '还没有配置 AI Provider')).toEqual({
      kind: 'unavailable',
      reason: 'not-configured',
      detail: '还没有配置 AI Provider',
    });
  });

  it('separates "the host did not say" from "the host said no"', () => {
    // 这是本模块存在的理由。合并这两者会让"忘记注入能力"与"确实不可用"在界面上完全一样，
    // 而前者永远是接入新切片时的 bug。
    expect(UNKNOWN_CAPABILITY.kind).toBe('unknown');
    expect(UNKNOWN_CAPABILITY).not.toHaveProperty('reason');
    expect(isCapabilityAvailable(UNKNOWN_CAPABILITY)).toBe(false);
    expect(isCapabilityAvailable(AVAILABLE)).toBe(true);
  });

  it('treats a missing entry as unknown rather than available', () => {
    const snapshot = { '/local-library': AVAILABLE } as const;

    expect(readCapability(snapshot, '/local-library')).toBe(AVAILABLE);
    // 缺键必须是 unknown。反过来（默认 available）会让任何忘记注入的新入口默认变成可点击，
    // 而这正是 DESK-PROD-001 禁止的"可点击但失效"。
    expect(readCapability(snapshot, '/encyclopedia')).toEqual(UNKNOWN_CAPABILITY);
  });

  it('does not read as an authorization or a trust signal', () => {
    // 能力状态只用于展示与调度。若将来有人想让它兼任 native ACL 或服务器授权的判断依据，
    // 形状上就已经带上了 reason/detail，容易被误用。这条把禁止事项固定下来。
    const availability: CapabilityAvailability = unavailable('service-unavailable', '上游 503');

    expect(JSON.stringify(availability)).not.toMatch(/token|scope|permission|signature/i);
  });
});