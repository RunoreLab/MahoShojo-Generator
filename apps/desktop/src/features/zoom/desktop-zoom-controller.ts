import {
  DESKTOP_ZOOM_PERCENT_OPTIONS,
  isDesktopZoomPercent,
  type DesktopZoomPercent,
} from '@mahoshojo/contracts/desktop-config';
import type { DesktopConfigStore } from '../config/desktop-config-store';

export interface DesktopZoomState {
  readonly actualPercent: DesktopZoomPercent | null;
  readonly requestedPercent: DesktopZoomPercent;
  readonly configuredPercent: DesktopZoomPercent;
  readonly temporary: boolean;
  readonly saving: boolean;
  readonly applying: boolean;
  readonly applyError: string | null;
  readonly saveError: string | null;
}

const describe = (cause: unknown): string => cause instanceof Error ? cause.message : '无法应用页面缩放';

/**
 * 配置只有既有 config store 一个 writer。requested 是有界的在途用户意图，
 * actual 只在 Native 确认后更新；读取失败时的临时值不伪装成已保存配置。
 */
export class DesktopZoomController {
  private state: DesktopZoomState = {
    actualPercent: null, requestedPercent: 100, configuredPercent: 100,
    temporary: false, saving: false, applying: false, applyError: null, saveError: null,
  };
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;
  private temporaryPercent: DesktopZoomPercent | null = null;
  private awaitingWrite = false;
  private lastConfigured: DesktopZoomPercent | null = null;
  private applyTarget: DesktopZoomPercent | null = null;
  private applyChain: Promise<void> | null = null;

  constructor(private readonly config: DesktopConfigStore, private readonly apply: (percent: DesktopZoomPercent) => Promise<DesktopZoomPercent>) {}

  getSnapshot = (): DesktopZoomState => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish(update: Partial<DesktopZoomState>): void {
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }

  async start(): Promise<void> {
    this.unsubscribe ??= this.config.subscribe(() => this.onConfig());
    await this.config.ready();
    this.onConfig();
    await this.applyChain;
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private onConfig(): void {
    const config = this.config.getSnapshot();
    if (config.status === 'idle' || config.status === 'loading') return;
    let saveError = this.state.saveError;
    let confirmedZoomIntent = false;
    if (!config.saving && this.awaitingWrite) {
      this.awaitingWrite = false;
      saveError = config.saveError;
      if (saveError === null && config.values.zoomPercent === this.state.requestedPercent) {
        this.temporaryPercent = null;
        confirmedZoomIntent = true;
      }
    }
    // 冲突的重新应用/放弃由共同配置反馈操作，不必再次经过缩放控件。
    if (!config.saving && config.saveError === null && !config.conflictedFields?.includes('zoomPercent')) {
      saveError = null;
    }
    const requestedPercent = !config.saving && !this.awaitingWrite
      ? this.temporaryPercent ?? config.values.zoomPercent
      : this.state.requestedPercent;
    this.publish({
      requestedPercent,
      configuredPercent: config.values.zoomPercent,
      temporary: this.temporaryPercent !== null,
      saving: config.saving && this.awaitingWrite,
      saveError,
    });
    // 迟到读取/外部重载不能盖掉本会话中明确选择的临时倍率。
    const target = this.temporaryPercent ?? config.values.zoomPercent;
    if (target !== this.lastConfigured || (confirmedZoomIntent && this.state.applyError !== null)) {
      this.lastConfigured = target;
      this.queueApply(target);
    }
  }

  setPercent = (percent: DesktopZoomPercent): void => {
    if (!isDesktopZoomPercent(percent)) return;
    this.publish({ requestedPercent: percent, saveError: null });
    if (this.config.editable()) {
      this.awaitingWrite = true;
      this.config.setField('zoomPercent', percent);
    } else {
      this.temporaryPercent = percent;
      this.lastConfigured = percent;
      this.publish({ temporary: true });
      this.queueApply(percent);
    }
  };

  step = (direction: -1 | 1): void => {
    const index = DESKTOP_ZOOM_PERCENT_OPTIONS.indexOf(this.state.requestedPercent);
    const next = DESKTOP_ZOOM_PERCENT_OPTIONS[Math.max(0, Math.min(DESKTOP_ZOOM_PERCENT_OPTIONS.length - 1, index + direction))];
    if (next !== this.state.requestedPercent) this.setPercent(next);
  };

  reset = (): void => { this.setPercent(100); };
  retry = (): void => { this.queueApply(this.temporaryPercent ?? this.state.configuredPercent); };

  private queueApply(percent: DesktopZoomPercent): void {
    this.applyTarget = percent;
    if (this.applyChain) return;
    this.applyChain = this.drainApply().finally(() => {
      this.applyChain = null;
      if (this.applyTarget !== null) this.queueApply(this.applyTarget);
    });
  }

  private async drainApply(): Promise<void> {
    this.publish({ applying: true, applyError: null });
    while (this.applyTarget !== null) {
      const percent = this.applyTarget;
      this.applyTarget = null;
      try {
        const actualPercent = await this.apply(percent);
        this.publish({ actualPercent, applyError: null });
      } catch (cause) {
        this.publish({ applyError: describe(cause) });
      }
    }
    this.publish({ applying: false });
  }
}

/** 只占用应用内的缩放组合；普通滚动、编辑快捷键和已消费事件保持原语义。 */
export function installDesktopZoomGestures(target: Window, controller: DesktopZoomController): () => void {
  let composing = false;
  let wheelDelta = 0;
  let lastWheelStep = -Infinity;
  let trailing: ReturnType<typeof setTimeout> | null = null;
  let wheelExpiry: ReturnType<typeof setTimeout> | null = null;
  const startComposition = () => { composing = true; };
  const endComposition = () => { composing = false; };
  const keydown = (event: KeyboardEvent) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || event.isComposing || composing || event.keyCode === 229) return;
    const direction = ['+', '='].includes(event.key) || event.code === 'NumpadAdd' ? 1
      : event.key === '-' || event.code === 'NumpadSubtract' ? -1 : null;
    const reset = event.key === '0';
    if (direction === null && !reset) return;
    event.preventDefault();
    if (reset) controller.reset();
    else controller.step(direction!);
  };
  const flushWheel = () => {
    trailing = null;
    const delta = wheelDelta;
    wheelDelta = 0;
    if (Math.abs(delta) < 40) return;
    controller.step(delta < 0 ? 1 : -1);
    lastWheelStep = Date.now();
  };
  const wheel = (event: WheelEvent) => {
    if (!event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented || composing || event.deltaY === 0) return;
    event.preventDefault();
    const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? target.innerHeight : 1);
    // 每事件有界；小触控板增量累积到阈值，尾部完整手势保留到节流窗口结束。
    wheelDelta = Math.max(-40, Math.min(40, wheelDelta + pixels));
    if (wheelExpiry !== null) clearTimeout(wheelExpiry);
    wheelExpiry = setTimeout(() => { wheelDelta = 0; wheelExpiry = null; }, 160);
    if (Math.abs(wheelDelta) < 40) return;
    const delay = Math.max(0, 120 - (Date.now() - lastWheelStep));
    if (delay === 0) flushWheel();
    else trailing ??= setTimeout(flushWheel, delay);
  };
  target.addEventListener('keydown', keydown);
  target.addEventListener('wheel', wheel, { passive: false });
  target.addEventListener('compositionstart', startComposition);
  target.addEventListener('compositionend', endComposition);
  target.addEventListener('blur', endComposition);
  return () => {
    target.removeEventListener('keydown', keydown);
    target.removeEventListener('wheel', wheel);
    target.removeEventListener('compositionstart', startComposition);
    target.removeEventListener('compositionend', endComposition);
    target.removeEventListener('blur', endComposition);
    if (trailing !== null) clearTimeout(trailing);
    if (wheelExpiry !== null) clearTimeout(wheelExpiry);
  };
}
