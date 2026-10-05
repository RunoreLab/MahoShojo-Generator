import { describe, expect, it } from 'vitest';

import {
  arenaRoomGenerationErrorCopy,
  arenaRoomGenerationStatusLabel,
} from '@/components/arena/multiplayer/presentation/generation-copy';

// Web 包输出契约失败此前塌缩成 generation-failed，用户只会看到"请稍后重试"，
// 而重试不会改变结果。这里锁定"不可重试"必须有自己的可执行文案。
describe('房间战报失败文案', () => {
  it('为不可重试的 Web 包输出失败给出专门文案', () => {
    const copy = arenaRoomGenerationErrorCopy('web-package-output-invalid');
    expect(copy.known).toBe(true);
    expect(copy.message).toContain('Web 包');
    expect(copy.message).toContain('重试不会改变结果');
  });

  it('未知错误码仍回退到通用文案并标记为未知', () => {
    expect(arenaRoomGenerationErrorCopy('SOMETHING_ELSE')).toEqual({
      message: '生成没有完成，请稍后重试。',
      known: false,
    });
    expect(arenaRoomGenerationErrorCopy('generation-failed').known).toBe(false);
  });

  it('阶段标签不暴露内部错误码', () => {
    expect(arenaRoomGenerationStatusLabel({ phase: 'failed', finalAuthoritative: false, errorCode: 'web-package-output-invalid' }))
      .toBe('生成失败');
  });
});
