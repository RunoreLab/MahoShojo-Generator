import { requestCardLibraryRoute } from './card-library-bridge';
import { DesktopCloudError, type InvokeFn } from './cloud-bridge';

export type CloudCreateOutcome =
  | { kind: 'saved'; id: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'uncertain'; message: string };
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
export const CLOUD_CREATE_UNCERTAIN_MESSAGE = '云端保存结果不确定，服务器可能已创建副本。请先检查“我的云端卡”，再决定是否再次新建；再次新建可能产生重复副本。';
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
/** 单次显式创建：不重试，不修改本地结果，不生成/清理签名字段。 */
export async function createPrivateCloudCopy(invoke: InvokeFn, expectedUserId: number, form: {
  name: string; description: string; data: unknown;
}): Promise<CloudCreateOutcome> {
  if (!form.name.trim() || form.name.length > 20 || form.description.length > 300) {
    return { kind: 'rejected', message: '请检查名称（1–20 字）和描述（最多 300 字）' };
  }
  try {
    const response = await requestCardLibraryRoute(invoke, {
      routeId: 'data-cards.create', expectedUserId,
      body: { type: 'character', name: form.name, description: form.description, data: form.data, isPublic: false } as never,
    });
    const body = record(response.body);
    if (response.status >= 200 && response.status < 300 && body?.success === true &&
      typeof body.id === 'string' && body.id.trim().length > 0) return { kind: 'saved', id: body.id };
    if ([400, 401, 403, 413, 429].includes(response.status)) {
      return { kind: 'rejected', message: typeof body?.error === 'string' ? body.error : `保存被拒绝（HTTP ${response.status}），输入已保留` };
    }
    return { kind: 'uncertain', message: CLOUD_CREATE_UNCERTAIN_MESSAGE };
  } catch (cause) {
    if (cause instanceof DesktopCloudError && ['not-authenticated', 'invalid-request'].includes(cause.code)) {
      return { kind: 'rejected', message: '账号状态或保存数据已改变，请重新确认后再保存；输入已保留' };
    }
    // 未知异常不能证明服务器未 insert。即使网络层无法获得响应也不重发。
    return { kind: 'uncertain', message: CLOUD_CREATE_UNCERTAIN_MESSAGE };
  }
}
