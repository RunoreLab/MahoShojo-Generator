import { OnlineDataCardTypeSchema, OwnedDataCardCreateAcknowledgementSchema, OwnedDataCardReplaceAcknowledgementSchema,
  OwnedDataCardReplacementTargetResponseSchema, type OnlineDataCardType, type OwnedDataCardReplacementTarget } from '@mahoshojo/contracts/data-cards';
import { requestCardLibraryRoute } from './card-library-bridge';
import { DesktopCloudError, type InvokeFn } from './cloud-bridge';

export type PrivateResultCardType = 'character' | 'scenario';
export type CloudCreateOutcome = { kind: 'saved'; id: string } | { kind: 'rejected' | 'uncertain'; message: string };
export type CloudReplaceOutcome = { kind: 'saved'; id: string; pendingReview: boolean } | { kind: 'rejected' | 'uncertain' | 'conflict'; message: string };
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const CLOUD_CREATE_UNCERTAIN_MESSAGE = '云端保存结果不确定，服务器可能已创建副本。请先检查“我的云端卡”，再决定是否再次新建；再次新建可能产生重复副本。';
export const CLOUD_REPLACE_UNCERTAIN_MESSAGE = '云端替换结果不确定，服务器可能已更新数据卡。请先检查“我的云端卡”及待审版本，再决定是否重新选择目标；不会自动重发。';
export async function readPrivateCloudCapacity(invoke: InvokeFn, expectedUserId: number) {
  try {
    const response = await requestCardLibraryRoute(invoke, { routeId: 'user-capacity.query', expectedUserId });
    const body = record(response.body);
    if (response.status !== 200 || body?.success !== true || typeof body.capacity !== 'number' ||
      typeof body.usedSlots !== 'number' || !Number.isSafeInteger(body.capacity) || body.capacity <= 0 ||
      !Number.isSafeInteger(body.usedSlots) || body.usedSlots < 0) return null;
    return { capacity: body.capacity, usedSlots: body.usedSlots };
  } catch { return null; }
}
const localRejection = (cause: unknown) => cause instanceof DesktopCloudError && ['not-authenticated', 'invalid-request'].includes(cause.code);
const unavailable = '目标不存在或服务端暂不支持安全云端保存，请保留草稿并等待服务更新。';
/** One explicit dispatch. Full source bytes/fields are retained; server owns moderation and quota. */
export async function createCloudCard(invoke: InvokeFn, expectedUserId: number, form: {
  type: OnlineDataCardType; name: string; description: string; isPublic: 0 | 1; data: unknown;
}): Promise<CloudCreateOutcome> {
  if (!OnlineDataCardTypeSchema.safeParse(form.type).success || ![0, 1].includes(form.isPublic)) return { kind: 'rejected', message: '结果类型或可见性不受支持，请保留当前结果并检查来源' };
  if (!form.name.trim() || form.name.length > 20 || form.description.length > 300) return { kind: 'rejected', message: '请检查名称（1–20 字）和描述（最多 300 字）' };
  try {
    const response = await requestCardLibraryRoute(invoke, { routeId: 'data-cards.create', expectedUserId, body: form as never });
    const body = record(response.body);
    const ack = OwnedDataCardCreateAcknowledgementSchema.safeParse(body);
    if (response.status === 201 && ack.success && ack.data.ownerUserId === expectedUserId) return { kind: 'saved', id: ack.data.id };
    if ([404, 405].includes(response.status)) return { kind: 'rejected', message: unavailable };
    if (response.status === 409 && body?.error === 'ACCOUNT_MISMATCH') return { kind: 'rejected', message: '登录账号已改变，本次未创建。请重新确认账号；输入已保留' };
    if ([400, 401, 403, 413, 429].includes(response.status)) return { kind: 'rejected', message: typeof body?.error === 'string' ? body.error : `保存被拒绝（HTTP ${response.status}），输入已保留` };
    return { kind: 'uncertain', message: CLOUD_CREATE_UNCERTAIN_MESSAGE };
  } catch (cause) {
    return localRejection(cause) ? { kind: 'rejected', message: '账号状态或保存数据已改变，请重新确认后再保存；输入已保留' }
      : { kind: 'uncertain', message: CLOUD_CREATE_UNCERTAIN_MESSAGE };
  }
}
/** Compatibility helper: an explicit private copy, still protected by the new owned endpoint. */
export async function createPrivateCloudCopy(invoke: InvokeFn, expectedUserId: number, form: {
  name: string; description: string; data: unknown; type?: PrivateResultCardType;
}): Promise<CloudCreateOutcome> {
  if (form.type !== undefined && form.type !== 'character' && form.type !== 'scenario') return { kind: 'rejected', message: '结果类型不受支持，请保留当前结果并检查来源' };
  return createCloudCard(invoke, expectedUserId, { ...form, type: form.type ?? 'character', isPublic: 0 });
}
export async function readCloudReplaceTarget(invoke: InvokeFn, expectedUserId: number, id: string): Promise<
  { kind: 'ready'; target: OwnedDataCardReplacementTarget } | { kind: 'rejected'; message: string }
> {
  try {
    const response = await requestCardLibraryRoute(invoke, { routeId: 'data-cards.replace-target.query', expectedUserId, query: { id } });
    const parsed = OwnedDataCardReplacementTargetResponseSchema.safeParse(response.body);
    if (response.status === 200 && parsed.success && parsed.data.ownerUserId === expectedUserId && parsed.data.target.id === id.trim()) return { kind: 'ready', target: parsed.data.target };
    return { kind: 'rejected', message: [404, 405].includes(response.status) ? unavailable : '无法确认当前账号的替换目标，请重新选择；输入已保留' };
  } catch { return { kind: 'rejected', message: '读取替换目标失败，请重新选择；输入已保留' }; }
}
export async function replaceCloudCard(invoke: InvokeFn, expectedUserId: number, target: OwnedDataCardReplacementTarget, data: unknown): Promise<CloudReplaceOutcome> {
  try {
    const response = await requestCardLibraryRoute(invoke, { routeId: 'data-cards.replace', expectedUserId,
      body: { id: target.id, type: target.type, expectedVersion: target.version, data } as never });
    const body = record(response.body);
    const ack = OwnedDataCardReplaceAcknowledgementSchema.safeParse(body);
    if (response.status === 200 && ack.success && ack.data.ownerUserId === expectedUserId && ack.data.id === target.id.trim()) return { kind: 'saved', id: ack.data.id, pendingReview: ack.data.pendingReview };
    if (response.status === 409 && ['ACCOUNT_MISMATCH', 'TARGET_CHANGED'].includes(String(body?.error))) return { kind: 'conflict', message: '账号或目标数据卡已变化，本次未替换。请重新选择并确认目标；输入已保留' };
    if ([404, 405].includes(response.status)) return { kind: 'rejected', message: unavailable };
    if ([400, 401, 403, 413, 429].includes(response.status)) return { kind: 'rejected', message: typeof body?.error === 'string' ? body.error : `替换被拒绝（HTTP ${response.status}），输入已保留` };
    return { kind: 'uncertain', message: CLOUD_REPLACE_UNCERTAIN_MESSAGE };
  } catch (cause) {
    return localRejection(cause) ? { kind: 'rejected', message: '账号状态或替换数据已改变，请重新确认；输入已保留' }
      : { kind: 'uncertain', message: CLOUD_REPLACE_UNCERTAIN_MESSAGE };
  }
}
