import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

const battleEngineSource = readFileSync(
  new URL('../components/arena/hooks/useBattleEngine.ts', import.meta.url),
  'utf8',
);

describe('arena snapshot bootstrap telemetry restore', () => {
  test('snapshot handler 与 telemetry 事件共用同一份客户端 telemetry 解析', () => {
    const snapshotStart = battleEngineSource.indexOf("if (event === 'snapshot')");
    const snapshotSource = battleEngineSource.slice(
      snapshotStart,
      battleEngineSource.indexOf("if (event === 'telemetry')"),
    );
    expect(snapshotSource).toContain('applyTelemetryPayload(payload.telemetry)');
    expect(snapshotSource).toMatch(
      /payload\?\.telemetry && typeof payload\.telemetry === 'object'/u,
    );

    const telemetrySource = battleEngineSource.slice(
      battleEngineSource.indexOf("if (event === 'telemetry')"),
      battleEngineSource.indexOf("if (event === 'meta')"),
    );
    expect(telemetrySource).toContain('applyTelemetryPayload(payload)');
    expect(telemetrySource).not.toContain('normalizeUsage(payload?.usage');
  });

  test('telemetry 解析只接受公开契约字段并保留旧 replay 存量兼容', () => {
    const helperSource = battleEngineSource.slice(
      battleEngineSource.indexOf('const applyTelemetryPayload'),
      battleEngineSource.indexOf('const handleSseEvent'),
    );
    expect(helperSource).toContain('normalizeUsage(telemetryPayload?.usage ?? null)');
    expect(helperSource).toContain('telemetryPayload?.narrativeHistoryReadCount');
    expect(helperSource).toContain("telemetryPayload?.aiModel === 'string'");
    expect(helperSource).toContain("telemetryPayload?.model === 'string'");
  });
});
