/**
 * 能力可用状态。
 *
 * 它回答的是**产品展示与调度**问题：这个入口在本运行时能不能用、不能用的原因是什么。它**不是** Tauri
 * capability 授权，也不是服务器授权，更不是数据可信性证明（`DESK-PROD-003`、`DESK-PROD-009`）。
 *
 * ## 为什么状态是这五个，而不是三个
 *
 * `DESK-PROD-003` 要求「MUST NOT 把这些状态都显示成'没有数据'」。因此「未配置」「需登录」「服务失败」
 * 「尚未实现」必须是**类型上可区分**的，而不是一个 `disabled: boolean` 加一句自由文本——那种形状会让
 * 每个调用点各自编文案，并且迟早把四种原因塌缩成同一种灰色禁用。
 *
 * `unknown` 之所以单独存在，是因为它是唯一一个**信息量为负**的状态：调用方没有给出原因。文案层必须
 * 把它当作缺陷来看待，因此类型用「无 reason」而不是「reason 可选」。
 */

export type CapabilityReason =
  /** 需要用户先完成某项配置（典型：AI Provider 尚未配置）。 */
  | 'not-configured'
  /** 需要登录或远端授权，而当前会话没有。 */
  | 'requires-sign-in'
  /** 在线服务不可达或返回失败。与 `not-configured` 分开是因为处置方式不同：重试有意义，改配置没有。 */
  | 'service-unavailable'
  /** 该能力在当前运行时/当前阶段尚未交付。 */
  | 'not-implemented'
  /** 本地存储不可用（IndexedDB 被拒、SQLite 初始化失败等）。 */
  | 'storage-unavailable';

export type CapabilityAvailability =
  | { readonly kind: 'available' }
  | { readonly kind: 'unavailable'; readonly reason: CapabilityReason; readonly detail?: string }
  /**
   * 调用方没给出原因。
   *
   * 它与 `unavailable` 分开而不是合并，正是为了让「忘记说明原因」在代码里可见：给宿主注入能力时，
   * 写不出原因就应该先补上，而不是让用户看到一个没有解释的禁用按钮。
   */
  | { readonly kind: 'unknown' };

export const AVAILABLE: CapabilityAvailability = { kind: 'available' };

export const unavailable = (
  reason: CapabilityReason,
  detail?: string,
): CapabilityAvailability => ({
  kind: 'unavailable',
  reason,
  ...(detail === undefined ? {} : { detail }),
});

export const isCapabilityAvailable = (availability: CapabilityAvailability): boolean =>
  availability.kind === 'available';

/**
 * 一组能力的快照，键是产品路径。
 *
 * 用产品路径而不是组件 id 作键，是为了让宿主在一个地方回答「这台机器上有哪些页面」，而共享视图只做
 * 按路径查表。缺键一律按 {@link UNKNOWN_CAPABILITY} 处理——**不**按 available，否则新增一个忘记注入的
 * 入口会默认变成可点击。
 */
export type CapabilitySnapshot = Readonly<Record<string, CapabilityAvailability>>;

export const UNKNOWN_CAPABILITY: CapabilityAvailability = { kind: 'unknown' };

export const readCapability = (
  capabilities: CapabilitySnapshot,
  href: string,
): CapabilityAvailability => capabilities[href] ?? UNKNOWN_CAPABILITY;