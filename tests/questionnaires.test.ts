import { describe, expect, it } from 'bun:test';
import { buildMagicalQuestionMeta } from '@/lib/questionnaires';

describe('问卷字段配置', () => {
  it('角色名字问题允许输入至多 100 字', () => {
    const [firstQuestion] = buildMagicalQuestionMeta(1);
    expect(firstQuestion.maxLength).toBe(100);
  });
});
