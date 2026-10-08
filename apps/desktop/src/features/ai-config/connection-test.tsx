// 「测试当前连接」共享件（D5.1-AIP-4）。
//
// 设置页与生成页共用同一测试语义：目标 = 当前解析出的 profile + 生效模型；
// 切换目标时中止在途测试并丢弃迟到终态（run identity），卸载同样中止
// （Direct 默认无应用层硬超时，挂着没人收会一直占流）。

import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

import { createDesktopAiExecutionPort } from '../../platform/desktop-ai-execution';
import { DesktopAiError } from '../../platform/direct-ai-bridge';
import type { ResolvedDesktopAiTarget } from './desktop-ai-config';

export type ConnectionTestState =
  | { status: 'idle' }
  | { status: 'running' }
  | { status: 'done'; text: string }
  | { status: 'cancelled' }
  | { status: 'failed'; message: string };

export const useConnectionTest = (target: ResolvedDesktopAiTarget) => {
  const [testState, setTestState] = useState<ConnectionTestState>({ status: 'idle' });
  const testAbortRef = useRef<AbortController | null>(null);
  // run identity：切换目标时 revision++，旧 run 的迟到终态不得再写 UI。
  const testRevisionRef = useRef(0);

  const runConnectionTest = async () => {
    const profile = target.profile;
    const mode = target.mode;
    const modelId = target.modelId;
    if (!profile || !mode || !modelId || testState.status === 'running') return;
    const revision = ++testRevisionRef.current;
    setTestState({ status: 'running' });
    const controller = new AbortController();
    testAbortRef.current = controller;
    // 目标已切换时迟到的结果直接丢弃——新旧目标之间的状态不串台。
    const isCurrentRun = () => revision === testRevisionRef.current;
    try {
      const result = await createDesktopAiExecutionPort({
        invoke,
        profileId: profile.id,
      }).execute(
        {
          requestId: `conn-test-${crypto.randomUUID()}`,
          contractVersion: 1,
          mode,
          modelId,
          messages: [{ role: 'user', content: '用一句话介绍你自己。' }],
        },
        controller.signal,
      );
      if (!isCurrentRun()) return;
      setTestState(
        result.status === 'completed'
          ? { status: 'done', text: result.output.text ?? '' }
          : result.status === 'cancelled'
            ? { status: 'cancelled' }
            : { status: 'failed', message: result.error.message ?? result.error.code },
      );
    } catch (cause) {
      if (!isCurrentRun()) return;
      setTestState(
        controller.signal.aborted
          ? { status: 'cancelled' }
          : {
              status: 'failed',
              message:
                cause instanceof DesktopAiError
                  ? `${cause.code}: ${cause.message}`
                  : cause instanceof Error
                    ? cause.message
                    : '连接测试失败',
            },
      );
    } finally {
      if (testAbortRef.current === controller) testAbortRef.current = null;
    }
  };

  const cancelConnectionTest = () => {
    testAbortRef.current?.abort();
  };

  // 用字段值做依赖而不是拼字符串，id/modelId 含分隔符也不会误判。
  const testTargetId = target.profile?.id ?? null;
  const testTargetModel = target.modelId;
  useEffect(() => {
    testRevisionRef.current += 1;
    testAbortRef.current?.abort();
    setTestState({ status: 'idle' });
  }, [testTargetId, testTargetModel]);
  useEffect(
    () => () => {
      testRevisionRef.current += 1;
      testAbortRef.current?.abort();
    },
    [],
  );

  return { testState, runConnectionTest, cancelConnectionTest };
};

/** 测试按钮与结果行；仅在客户端目标可执行时由宿主挂载。 */
export const ConnectionTestSection = ({ target }: { target: ResolvedDesktopAiTarget }) => {
  const { testState, runConnectionTest, cancelConnectionTest } = useConnectionTest(target);
  return (
    <>
      <div className="flex gap-2">
        {testState.status === 'running' ? (
          <button
            type="button"
            className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
            onClick={cancelConnectionTest}
          >
            取消测试
          </button>
        ) : (
          <button
            type="button"
            className="rounded-lg border border-(--app-border-strong) px-3 py-1.5 text-xs"
            onClick={() => void runConnectionTest()}
          >
            测试当前连接
          </button>
        )}
      </div>
      {testState.status === 'done' && (
        <p className="battle-lite-subtle-text whitespace-pre-wrap text-xs">
          测试输出：{testState.text || '（空）'}
        </p>
      )}
      {testState.status === 'cancelled' && (
        <p className="battle-lite-subtle-text text-xs">测试已取消。</p>
      )}
      {testState.status === 'failed' && (
        <p className="battle-lite-subtle-text text-xs">测试失败：{testState.message}</p>
      )}
    </>
  );
};
