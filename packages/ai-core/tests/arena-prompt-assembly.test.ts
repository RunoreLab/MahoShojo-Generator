import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { arenaModes, arenaDeliveries, arenaParityPayload } from '../../../fixtures/arena-generation/input';
import { assembleArenaGenerationPrompt, type ArenaPromptAdjudicationResult } from '../src/arena-generation';

// Captured from the unmodified production builder at 76acdab3; never regenerated in tests.
const golden: Record<string, string> = {
  "classic/stream": "cfa0466ff0aedb6a167deae48d45f2109838cfdaaf3224026bed76f3d0c5a6a5",
  "classic/non-stream": "6fac91a5b2bd849856e40314ff6793c19551d64534844ef28bcb1ca0e82cc186",
  "kizuna/stream": "c7b935af025af94191dfdc819a4078dab508a16d7ffd31cd9314f1c52bd9f008",
  "kizuna/non-stream": "211e2947db437e22a0d4f9d117c339d433466e7524fa0545348590eb00198fec",
  "daily/stream": "1d4d0fc0c669300d65870460c21193d2022d0e891a6aaf3d3bf0a976b699df79",
  "daily/non-stream": "66e665791e0b053d9e3167efad774508f60e1c903fded21e2fda7828dc14ef8b",
  "scenario/stream": "e9d2cc047db16d565c66d7a47e3db79797859edc3343d8e955b55e7f9924d89b",
  "scenario/non-stream": "3ad834d99775239606ed65993312eb5cfc687be14cc9ce8cc844564e6642c970"
};
describe('pure Arena prompt assembly', () => {
  for (const mode of arenaModes) for (const delivery of arenaDeliveries) {
    it(`matches the old Hosted bytes for ${mode}/${delivery} without server context`, () => {
      const { __arenaServerContextV1: _serverContext, adjudicationResults, ...payload } = arenaParityPayload(mode, delivery);
      void _serverContext;
      const before = JSON.stringify(payload);
      const random = vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('random must stay host-owned'); });
      try {
        const result = assembleArenaGenerationPrompt({
          payload,
          outputContract: delivery === 'non-stream' ? 'structured-report' : 'stream-markdown',
          reporterInfo: { name: '蓝星单推人', publication: '兽扑' },
          adjudicationResults: adjudicationResults as ArenaPromptAdjudicationResult[],
        });
        expect(createHash('sha256').update(JSON.stringify(result)).digest('hex')).toBe(golden[`${mode}/${delivery}`]);
        expect(JSON.stringify(payload)).toBe(before);
      } finally { random.mockRestore(); }
    });
  }

  it('takes output, reporter and adjudication only from explicit arguments', () => {
    const payload = {
      ...arenaParityPayload('classic', 'non-stream'),
      reporterInfo: { name: 'forged', publication: 'forged' },
      adjudicationResults: [{ description: 'ignored adjudication' }],
      webPackageRef: { id: 'ignored' },
      userGuidance: '边界后空白 ',
    };
    const result = assembleArenaGenerationPrompt({
      payload, outputContract: 'stream-markdown', adjudicationResults: null,
      reporterInfo: { name: '本地记者', publication: '本地新闻' },
    });
    expect(result.metadata.outputContract).toBe('stream-markdown');
    expect(result.metadata.reporterInfo).toEqual({ name: '本地记者', publication: '本地新闻' });
    expect(result.metadata.adjudicationResults).toBeNull();
    expect(result.metadata).not.toHaveProperty('webPackageRef');
    expect(result.prompt).not.toContain('ignored adjudication');
    expect(result.metadata.userGuidance).toBe('边界后空白 ');
  });
});
