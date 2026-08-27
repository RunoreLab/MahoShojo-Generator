import { describe, expect, it } from 'vitest';
import {
  evaluateHostedDrVersionGate,
  type HostedDrVersionGateInput,
} from '../src/hosted-dr';

const evaluate = (
  input: Partial<HostedDrVersionGateInput> = {},
) => evaluateHostedDrVersionGate({
  stage: 'rollout',
  primaryContractVersion: 'g25e1-v2',
  drContractVersion: 'g25e1-v1',
  clientContractVersion: 'g25e1-v1',
  schemaState: 'expanded',
  ...input,
});

describe('Hosted DR version skew gate', () => {
  it('G25E2-VERSION-SKEW：允许同一 contract family 内一个版本的 expand skew', () => {
    expect(evaluate({ stage: 'expand' })).toMatchObject({
      allowed: true,
      reason: 'compatible',
    });
  });

  it('允许 shared core rollout 后 client 从旧版本切到新版本', () => {
    expect(evaluate({
      stage: 'rollout',
      clientContractVersion: 'g25e1-v2',
    })).toMatchObject({
      allowed: true,
      reason: 'compatible',
    });
  });

  it.each([
    ['跨 contract family', { primaryContractVersion: 'g25e2-v2' }],
    ['过大版本偏差', { drContractVersion: 'g25e1-v4', clientContractVersion: 'g25e1-v2' }],
    ['client 不在双端兼容窗口', { clientContractVersion: 'g25e1-v0' }],
    ['没有 expand schema', { schemaState: 'contracted' }],
  ] as const)('%s 时 fail closed', (_label, input) => {
    expect(evaluate(input)).toMatchObject({ allowed: false });
  });

  it('对超过一个版本的偏差返回 skew-too-large，而不是被其他分支偶然拒绝', () => {
    expect(evaluate({
      drContractVersion: 'g25e1-v4',
      clientContractVersion: 'g25e1-v2',
    })).toEqual({ allowed: false, reason: 'skew-too-large' });
  });

  it('未知阶段 fail closed，而不是落入兼容分支', () => {
    expect(evaluate({ stage: 'unknown' as HostedDrVersionGateInput['stage'] })).toMatchObject({
      allowed: false,
      reason: 'invalid-stage',
    });
  });

  it('版本不一致时阻断 destructive contract cleanup', () => {
    expect(evaluateHostedDrVersionGate({
      stage: 'contract',
      primaryContractVersion: 'g25e1-v2',
      drContractVersion: 'g25e1-v1',
      clientContractVersion: 'g25e1-v2',
      schemaState: 'contracted',
      cleanupRequested: true,
    })).toMatchObject({
      allowed: false,
      reason: 'cleanup-blocked',
    });
  });

  it('仅在双端/client 对齐且 schema 已收缩时允许 cleanup', () => {
    expect(evaluateHostedDrVersionGate({
      stage: 'contract',
      primaryContractVersion: 'g25e1-v2',
      drContractVersion: 'g25e1-v2',
      clientContractVersion: 'g25e1-v2',
      schemaState: 'contracted',
      cleanupRequested: true,
    })).toMatchObject({
      allowed: true,
      reason: 'compatible',
    });
  });
});
