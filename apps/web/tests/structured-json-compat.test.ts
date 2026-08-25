import * as aiCoreStructuredJson from '@mahoshojo/ai-core/structured-json';
import * as legacyStructuredJson from '@/lib/ai/utils/structured-json';

describe('structured JSON legacy compatibility entrypoint', () => {
  it('forwards the canonical ai-core implementation', () => {
    expect(legacyStructuredJson.parseStructuredJsonWithSchema).toBe(
      aiCoreStructuredJson.parseStructuredJsonWithSchema,
    );
    expect(legacyStructuredJson.buildStructuredJsonInstructionFromZodSchema).toBe(
      aiCoreStructuredJson.buildStructuredJsonInstructionFromZodSchema,
    );
  });
});
