import {
  DESKTOP_ARENA_HOSTED_LIMITS,
  DesktopArenaHostedRecoveryPointerSchema,
  type DesktopArenaHostedRecoveryPointer,
} from '@mahoshojo/contracts/desktop-arena-hosted';
import type { GenerationDraftStorage } from '../generation/session';

export const ARENA_HOSTED_RECOVERY_KEYS = Object.freeze({
  battle: 'mahoshojo.desktop.arena.battle.hosted-recovery.v1',
  arena: 'mahoshojo.desktop.arena.advanced.hosted-recovery.v1',
});
type Product = keyof typeof ARENA_HOSTED_RECOVERY_KEYS;
export interface ArenaHostedRecoveryState {
  pointer: DesktopArenaHostedRecoveryPointer | null;
  pendingRestore: boolean;
  blocked: boolean;
  saved: boolean;
  error: string | null;
}

export interface ArenaHostedRecoveryReplacement { expectedPreviousRequestId: string | null; revision: number }

/** One public pointer per product; no credentials, output body or new persistence backend. */
export class DesktopArenaHostedRecovery {
  private state: ArenaHostedRecoveryState = { pointer: null, pendingRestore: false, blocked: false, saved: true, error: null };
  private listeners = new Set<() => void>();
  private readonly key: string;
  private revision = 0;
  private persistedRaw: string | null = null;
  private preparedBackup: { requestId: string; state: ArenaHostedRecoveryState; raw: string | null } | null = null;

  constructor(private readonly storage: GenerationDraftStorage, private readonly product: Product) {
    this.key = ARENA_HOSTED_RECOVERY_KEYS[product];
    try {
      const raw = storage.getItem(this.key); this.persistedRaw = raw;
      if (raw !== null) {
        if (raw.length > DESKTOP_ARENA_HOSTED_LIMITS.recoveryPointerCodeUnits) throw new Error('pointer length');
        const pointer = this.validate(JSON.parse(raw));
        this.state = { pointer, pendingRestore: true, blocked: false, saved: true, error: null };
      }
    } catch {
      this.state = { pointer: null, pendingRestore: false, blocked: true, saved: false,
        error: '原服务器恢复指针无法读取，原件已保留。清除本机指针不会清除原生恢复身份；旧任务可能仍在运行，无法确认归属时不会重新创建。' };
    }
  }

  private validate(value: unknown) {
    const pointer = DesktopArenaHostedRecoveryPointerSchema.parse(value);
    if (pointer.product !== this.product) throw new Error('pointer product');
    return pointer;
  }
  private publish(patch: Partial<ArenaHostedRecoveryState>) {
    this.revision += 1; this.state = { ...this.state, ...patch }; this.listeners.forEach((listener) => listener());
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  captureReplacement(): ArenaHostedRecoveryReplacement { return { expectedPreviousRequestId: this.state.pointer?.requestId ?? null, revision: this.revision }; }
  isReplacementCurrent(value: ArenaHostedRecoveryReplacement): boolean {
    return value.revision === this.revision && value.expectedPreviousRequestId === (this.state.pointer?.requestId ?? null);
  }

  /** Must succeed before any native create; replacement consent names the exact old intent. */
  prepare(value: DesktopArenaHostedRecoveryPointer, replaceRequestId?: string, repair?: ArenaHostedRecoveryReplacement): boolean {
    // Repair is an explicit local CAS, independent of the Native exact replacement identity.
    if (repair && (!replaceRequestId || !this.isReplacementCurrent(repair))) {
      this.publish({ error: '本机恢复记录已变化，请重新检查身份并确认。' }); return false;
    }
    if (this.state.blocked && !repair) return false;
    const old = this.state.pointer;
    if (old?.requestId === value.requestId) {
      this.publish({ error: '该请求已有恢复记录，请查找或续流，不重新创建。' }); return false;
    }
    if (!repair && old && old.requestId !== value.requestId && replaceRequestId !== old.requestId) {
      this.publish({ error: '请先恢复或明确替换原恢复记录。连接状态不证明服务器已终结，放弃恢复不会停止服务器生成。' });
      return false;
    }
    try {
      if (this.storage.getItem(this.key) !== this.persistedRaw) throw new Error('local original changed');
      const pointer = this.validate(value);
      if (pointer.state !== 'prepared') throw new Error('not prepared');
      const raw = JSON.stringify(pointer), previous = { requestId: pointer.requestId, state: structuredClone(this.state), raw: this.persistedRaw };
      this.storage.setItem(this.key, raw); this.persistedRaw = raw; this.preparedBackup = previous;
      this.publish({ pointer, blocked: false, pendingRestore: false, saved: true, error: null });
      return true;
    } catch {
      this.publish({ saved: false, error: '恢复指针保存失败，未开始服务器生成。原指针仍受保护。' });
      return false;
    }
  }

  /** Only a checked Native prior-retained proof may restore the exact prewritten original. */
  rollbackPrepared(requestId: string): boolean {
    const prior = this.preparedBackup;
    if (!prior || prior.requestId !== requestId || this.state.pointer?.requestId !== requestId) return false;
    this.preparedBackup = null;
    try {
      if (this.storage.getItem(this.key) !== this.persistedRaw) {
        this.publish({ saved: false, error: '本机恢复记录已在外部变化，已保留新原件且未回写旧记录；请重新打开页面读取。' }); return false;
      }
      if (prior.raw === null) this.storage.removeItem(this.key); else this.storage.setItem(this.key, prior.raw);
      this.persistedRaw = prior.raw; this.publish(prior.state); return true;
    } catch {
      this.publish({ ...prior.state, saved: false, error: '原生确认新意图未占有，但原恢复指针回写失败；原身份仍在内存，请完整导出，勿重新创建。' }); return false;
    }
  }
  settlePrepared(requestId: string) { if (this.preparedBackup?.requestId === requestId) this.preparedBackup = null; }

  /** Post-dispatch persistence failure does not erase the live identity or restart the model. */
  update(requestId: string, patch: Partial<Pick<DesktopArenaHostedRecoveryPointer, 'generationId' | 'cursor' | 'state' | 'updatedAt'>>): boolean {
    if (this.state.blocked || !this.state.pointer || this.state.pointer.requestId !== requestId) return false;
    let pointer: DesktopArenaHostedRecoveryPointer;
    try { pointer = this.validate({ ...this.state.pointer, ...patch }); }
    catch { this.publish({ saved: false, error: '恢复状态不符合协议，保留上一次有效指针与已收到正文。' }); return false; }
    try {
      if (this.storage.getItem(this.key) !== this.persistedRaw) {
        this.publish({ pointer, saved: false, error: '本机恢复记录已在外部变化，已保留新原件；当前状态仅保留在内存，请完整导出并重新打开页面。' }); return false;
      }
      const raw = JSON.stringify(pointer); this.storage.setItem(this.key, raw); this.persistedRaw = raw;
      this.publish({ pointer, saved: true, error: null }); return true;
    } catch {
      this.publish({ pointer, saved: false, error: '最新恢复状态保存失败，当前任务与原文仍在内存；请完整导出。' }); return false;
    }
  }

  /** UI acknowledgement only. The native adapter still verifies the original actor. */
  acceptRestore(requestId: string): DesktopArenaHostedRecoveryPointer | null {
    if (this.state.blocked || this.state.pointer?.requestId !== requestId) return null;
    this.publish({ pendingRestore: false }); return structuredClone(this.state.pointer);
  }

  /** Caller obtains explicit discard consent, including for an unreadable original. */
  discard(): boolean {
    try {
      this.storage.removeItem(this.key); this.persistedRaw = null; this.preparedBackup = null;
      this.publish({ pointer: null, pendingRestore: false, blocked: false, saved: true, error: null }); return true;
    } catch {
      this.publish({ error: '恢复指针清除失败，原数据仍受保护。' }); return false;
    }
  }
}
