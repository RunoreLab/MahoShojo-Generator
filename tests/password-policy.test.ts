import { describe, expect, test } from 'bun:test';
import {
  evaluatePasswordStrength,
  getPasswordPolicySummaryMessage,
  validatePasswordPolicy,
} from '@/lib/auth/password-policy';

describe('auth/password-policy', () => {
  test('弱密码应被拒绝并给出原因', () => {
    const result = validatePasswordPolicy('abc123', {
      username: 'alice',
      email: 'alice@example.com',
    });

    expect(result.ok).toBeFalse();
    expect(result.issues).toContain('min-length');
    expect(result.issues).toContain('insufficient-character-categories');
    expect(getPasswordPolicySummaryMessage(result.issues)).toContain('密码长度至少需要');
  });

  test('包含用户名/邮箱前缀的密码应被拒绝', () => {
    const result = validatePasswordPolicy('Alice@2026', {
      username: 'alice',
      email: 'alice@example.com',
    });

    expect(result.ok).toBeFalse();
    expect(result.issues).toContain('contains-username');
    expect(result.issues).toContain('contains-email-local-part');
  });

  test('满足规则的密码应通过', () => {
    const result = validatePasswordPolicy('K7$zvN4!q2', {
      username: 'alice',
      email: 'alice@example.com',
    });

    expect(result.ok).toBeTrue();
    expect(result.issues).toHaveLength(0);
    expect(result.strength.level === 'medium' || result.strength.level === 'strong').toBeTrue();
  });

  test('强密码评分应高于弱密码', () => {
    const weak = evaluatePasswordStrength('abc123');
    const strong = evaluatePasswordStrength('K7$zvN4!q2Lx');

    expect(strong.score).toBeGreaterThan(weak.score);
  });
});
