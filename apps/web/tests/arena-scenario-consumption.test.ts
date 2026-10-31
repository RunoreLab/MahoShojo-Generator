import { describe, expect, it } from 'vitest';
import { ArenaScenarioSchema } from '@mahoshojo/domain/arena-scenario';
import { ScenarioSchema } from '@/components/arena/utils/schemas';

describe('Arena shared scenario consumption schema', () => {
  it('uses the shared schema for every Web Arena consumer', () => {
    expect(ScenarioSchema).toBe(ArenaScenarioSchema);
  });
  it('keeps legacy elements and unknown nested/signature fields untouched', () => {
    const card = { title: '旧情景', elements: { scene: '旧场景', events: ['事件'], custom: true },
      metadata: { signature: 'sig', author: '作者' }, custom: { keep: true } };
    expect(ScenarioSchema.parse(card)).toEqual(card);
  });
  it('retains the Web legacy general alias behavior', () => {
    expect(ScenarioSchema.parse({ templateId: '通用情景', name: '旧标题', content: '正文', extra: true }))
      .toEqual({ templateId: '通用情景', title: '旧标题', content: '正文', extra: true });
  });
});
