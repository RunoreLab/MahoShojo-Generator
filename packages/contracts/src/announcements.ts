import { z } from './zod';

/**
 * 产品公告的内容契约（D5.1-P1，DESK-PARITY-003）。
 *
 * `announcements.json` 是**内容权威源**（`content/announcements.json`），Web 静态伺服、
 * Desktop 原生窄通道读取：它不是本地库数据，也不进 SQLite——它只在两个宿主各自的
 * 公告视图里被消费。这里定义的是那份文件与「native 透传 JSON → renderer」两段边界
 * 共用的形状：两侧各自用它校验，不通过类型断言假装远端数据已合法。
 *
 * 刻意只放纯数据形状：排序/置顶规则、QQ 群占位展开与「最新公告是否已读」属于展示层
 * 知识，归 `@mahoshojo/ui-web/announcement`。
 */

/** 单条公告。`id` 是关闭状态的持久化键，必须稳定且非空。 */
export const AnnouncementSchema = z
  .object({
    id: z.string().min(1).max(200),
    /** `YYYY-MM-DD`。公告按日历日期排序，不带时刻语义。 */
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    title: z.string().min(1).max(500),
    /** Markdown 正文；允许 `{{QQ_GROUPS}}` 占位符由共享渲染层展开。 */
    content: z.string().min(1).max(100_000),
    publisher: z.string().min(1).max(200).optional(),
    pinned: z.boolean().optional(),
  })
  .strict();
export type Announcement = z.infer<typeof AnnouncementSchema>;

/** 公告文件本体是公告数组；条数上限拒绝畸形大文件进 renderer。 */
export const AnnouncementListSchema = z.array(AnnouncementSchema).max(200);

/**
 * fail-closed 解析：结构不合法时返回 `null` 而不是抛异常，让宿主把
 * 「公告源损坏」当作不可展示的数据对待——不猜、不截断、不降级成空公告冒充
 * 「暂无公告」（DESK-ONLINE-017 的失败语义同一条线）。
 */
export const parseAnnouncementList = (raw: unknown): Announcement[] | null => {
  const parsed = AnnouncementListSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
};
