import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as core from '@mahoshojo/ai-core/arena-generation';
import * as web from '@/lib/arena/stream-meta';
import { arenaStreamMetaCases } from '../../../fixtures/arena-generation/stream-meta-input';

const golden = JSON.parse(readFileSync(new URL('../../../fixtures/arena-generation/stream-meta-golden.json', import.meta.url), 'utf8'));
describe('Web stream metadata wrapper', () => {
  it('uses the shared functions for actual legacy consumers', () => {
    expect(web.extractStreamUpdateMeta).toBe(core.extractStreamUpdateMeta);
    expect(web.extractStreamTelemetryMeta).toBe(core.extractStreamTelemetryMeta);
    expect(web.stripAllStreamMetaComments).toBe(core.stripAllStreamMetaComments);
  });
  for (const fixture of arenaStreamMetaCases) {
    it(`retains frozen repair semantics: ${fixture.name}`, async () => {
      expect({
        start: web.findStreamUpdateMetaStart(fixture.raw),
        strip: web.stripStreamUpdateMetaComment(fixture.raw),
        markdown: web.stripAllStreamMetaComments(fixture.raw),
        update: await web.extractStreamUpdateMeta(fixture.raw).catch(error => ({ error: error.message })),
        telemetry: await web.extractStreamTelemetryMeta(fixture.raw),
      }).toEqual(golden[fixture.name]);
    });
  }
});
