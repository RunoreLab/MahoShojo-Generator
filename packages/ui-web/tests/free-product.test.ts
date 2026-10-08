import { describe, expect, it } from 'vitest';
import {
  FREE_GENERATION_SCHEMA_IDS,
  FREE_STREAM_SCHEMA_IDS,
} from '@mahoshojo/ai-core/free-generation';
import {
  FREE_SCHEMA_OPTIONS,
  buildFreeFieldGuide,
  formatBytes,
  freeSchemaOptionsForMode,
} from '../src/free';

describe('FREE_SCHEMA_OPTIONS（free 产品定义，双端共源）', () => {
  it('覆盖 ai-core 全部 schema id，label/kind 钉住 canonical 文案', () => {
    expect(new Set(FREE_SCHEMA_OPTIONS.map((option) => option.id)))
      .toEqual(new Set(FREE_GENERATION_SCHEMA_IDS));
    expect(FREE_SCHEMA_OPTIONS).toEqual([
      { id: 'magical-girl', label: '魔法少女（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
      { id: 'canshou', label: '残兽（结构化）', description: '完整字段结构，适合后续升华/竞技场联动；自由生成产物为非原生。', kind: 'character' },
      { id: 'general', label: '通用角色卡（Markdown）', description: '只有 name/content，适合自由发挥与长线维护。', kind: 'character' },
      { id: 'scenario', label: '情景（结构化）', description: 'elements 结构化字段，适合与竞技场/进阶玩法联动。', kind: 'scenario' },
      { id: 'general-scenario', label: '通用情景卡（Markdown）', description: '只有 title/content，适合自由发挥与长线维护。', kind: 'scenario' },
    ]);
  });

  it('流式模式的可选 Schema 收敛为 ai-core 流式白名单', () => {
    expect(freeSchemaOptionsForMode('stream').map((option) => option.id))
      .toEqual([...FREE_STREAM_SCHEMA_IDS]);
    expect(freeSchemaOptionsForMode('non-stream')).toBe(FREE_SCHEMA_OPTIONS);
  });
});

describe('buildFreeFieldGuide（字段速览文案）', () => {
  it('每个 schema 返回非空速览文本', () => {
    for (const option of FREE_SCHEMA_OPTIONS) {
      expect(buildFreeFieldGuide(option.id)).toContain('字段速览');
    }
  });

  it('结构化卡的说明声明不生成 signature', () => {
    for (const schemaId of ['magical-girl', 'canshou', 'scenario'] as const) {
      expect(buildFreeFieldGuide(schemaId)).toContain('不会生成 signature');
    }
  });
});

describe('formatBytes（free 页面字节展示）', () => {
  it('按 KB/MB 动态精度格式化', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(2048)).toBe('2.00 KB');
    expect(formatBytes(512 * 1024)).toBe('512 KB');
    expect(formatBytes(2 * 1024 * 1024)).toBe('2.00 MB');
  });
});
