import type { DesktopPublicCachePolicy } from '@mahoshojo/contracts/desktop-ipc';

import { applyPublicCachePolicy, type InvokeFn } from '../../platform/public-cache-bridge';
import type { DesktopConfigState, DesktopConfigStore } from '../config/desktop-config-store';

/**
 * `publicLibraryCache` 文件值 → 推给 native 的生效策略（D5.1-K1，
 * `DESK-CACHE-008`）。
 *
 * 文件级降级（`publicCacheDegraded`：组无法校验、文件 fatal 或读取失败）
 * 在这一个点收口为「暂停捕获 + 暂停淘汰」——`values.publicCache*` 的归一
 * 默认值绝不假装成用户意图推下去；native 收到的是降级后的唯一事实，
 * 不读配置文件也不做第二次域判定。
 */
export const effectivePublicCachePolicy = (
  state: DesktopConfigState,
): DesktopPublicCachePolicy => ({
  captureEnabled: !state.publicCacheDegraded && state.values.publicCacheCaptureEnabled,
  maxBytes: state.values.publicCacheMaxBytes,
  whenFull: state.publicCacheDegraded ? 'pause' : state.values.publicCacheWhenFull,
});

/**
 * 把 config store 的生效缓存策略持续同步到 native。
 *
 * 只在 config 达到终态（`ready` 或 `unavailable`）时推送——`idle`/`loading`
 * 不把「还没读到文件」当成一次策略变更。推送按内容去重：config snapshot 的
 * 每次发布（saving 标志、冲突草稿等）都会触发检查，但只有策略实际变化才发
 * IPC。推送失败不清除意图标记的反面：失败即恢复「未推送」，下一次状态发布
 * 会重试——native 侧策略与文件口径不会静默分叉。
 *
 * 返回取消订阅函数；进程级单例由调用方（`usePublicCachePolicySync`）保证。
 */
export const createPublicCachePolicySync = (
  store: DesktopConfigStore,
  deps: { readonly invoke: InvokeFn },
): (() => void) => {
  /** 最后一次成功发出的策略指纹；`null` = 尚未成功推送或上次失败。 */
  let pushed: string | null = null;
  /** 推送串行化：不允许两次 apply_policy 在途交叠。 */
  let chain: Promise<void> = Promise.resolve();

  const tick = (): void => {
    const state = store.getSnapshot();
    if (state.status !== 'ready' && state.status !== 'unavailable') return;
    const policy = effectivePublicCachePolicy(state);
    const fingerprint = JSON.stringify(policy);
    if (fingerprint === pushed) return;
    // 先记账再发：在途期间若状态再变，tick 重入比较的是同一个 fingerprint。
    pushed = fingerprint;
    chain = chain.then(async () => {
      try {
        await applyPublicCachePolicy(deps.invoke, policy);
      } catch {
        // 推送失败不吞成「已同步」——恢复未推送态，等下一次发布重试。
        pushed = null;
      }
    });
  };

  const unsubscribe = store.subscribe(tick);
  // 订阅前的既有终态（store 先被其它消费者 ready 过）也要覆盖一次。
  tick();
  return () => {
    unsubscribe();
    chain = Promise.resolve();
  };
};
