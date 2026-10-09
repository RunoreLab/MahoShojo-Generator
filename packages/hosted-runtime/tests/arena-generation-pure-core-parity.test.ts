import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { arenaModes, arenaDeliveries, arenaParityPayload } from '../../../fixtures/arena-generation/input';
import { assembleArenaGenerationPrompt, type ArenaPromptAdjudicationResult } from '@mahoshojo/ai-core/arena-generation';
import { buildArenaGenerationPrompt } from '../src/arena-generation/prompt';

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
describe('Arena production prompt frozen parity (76acdab3)', () => {
  for (const mode of arenaModes) for (const delivery of arenaDeliveries) {
    it(`${mode}/${delivery}`, async () => {
      const result = await buildArenaGenerationPrompt({ actorKey: 'anonymous:fixture', random: () => 0, payload: arenaParityPayload(mode, delivery) });
      const digest = createHash('sha256').update(JSON.stringify(result)).digest('hex');
      expect(result.prompt).toContain('雨城的约定');
      expect(result.prompt).toContain('旧约定仍有效');
      expect(result.prompt).not.toContain('excluded-signature');
      expect(digest).toBe(golden[`${mode}/${delivery}`]);
      const { __arenaServerContextV1: _context, adjudicationResults, ...payload } = arenaParityPayload(mode, delivery);
      void _context;
      expect(assembleArenaGenerationPrompt({
        payload,
        outputContract: delivery === 'non-stream' ? 'structured-report' : 'stream-markdown',
        reporterInfo: { name: '蓝星单推人', publication: '兽扑' },
        adjudicationResults: adjudicationResults as ArenaPromptAdjudicationResult[],
      })).toEqual(result);
    });
  }
});

it('keeps delivery-specific guidance truncation in Hosted, including boundary whitespace', async () => {
  const guidance = `${'字'.repeat(199)} 尾部完整保留`;
  for (const delivery of arenaDeliveries) {
    const payload = { ...arenaParityPayload('classic', delivery), userGuidance: `  ${guidance}  ` };
    const result = await buildArenaGenerationPrompt({ actorKey: 'fixture', payload, random: () => 0 });
    expect(result.metadata.userGuidance).toBe(delivery === 'non-stream' ? guidance.slice(0, 200) : guidance);
  }
});
