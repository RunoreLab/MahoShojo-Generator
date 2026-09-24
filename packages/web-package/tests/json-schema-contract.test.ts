import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertJsonSchema202012 } from '../src/json-schema';

type SuiteCase = {
  description: string;
  schema: unknown;
  tests: { description: string; data: unknown; valid: boolean | null }[];
};

type SuiteFile = {
  suite: string;
  provenance: {
    mode: 'manual-curation';
    upstreamCommit: string;
    upstreamCommitDate: string;
    upstreamRoot: string;
    sourceFiles: string[];
    note: string;
  };
  dialect: string;
  groups: SuiteCase[];
};

const suite = JSON.parse(
  readFileSync(fileURLToPath(new URL('./fixtures/json-schema-2020-12-subset.json', import.meta.url)), 'utf8'),
) as SuiteFile;

describe('JSON Schema Draft 2020-12 official-suite subset contract', () => {
  it('loads a curated official-suite subset for the declared dialect', () => {
    expect(suite.dialect).toBe('https://json-schema.org/draft/2020-12/schema');
    expect(suite.groups.length).toBeGreaterThanOrEqual(20);
    expect(suite.suite).toContain('json-schema-org/JSON-Schema-Test-Suite');
    expect(suite.provenance.mode).toBe('manual-curation');
    expect(suite.provenance.upstreamCommit).toMatch(/^[0-9a-f]{40}$/u);
    expect(suite.provenance.upstreamRoot).toBe('tests/draft2020-12');
    expect(suite.provenance.sourceFiles).toContain('ref.json');
    expect(suite.provenance.sourceFiles).toContain('unevaluatedProperties.json');
  });

  for (const group of suite.groups) {
    it(group.description, () => {
      for (const test of group.tests) {
        if (test.valid === null) {
          expect(() => assertJsonSchema202012(group.schema, test.data), test.description).toThrow();
          continue;
        }
        if (test.valid) {
          expect(() => assertJsonSchema202012(group.schema, test.data), test.description).not.toThrow();
        } else {
          expect(() => assertJsonSchema202012(group.schema, test.data), test.description).toThrow('JSON Schema 校验失败');
        }
      }
    });
  }
});
