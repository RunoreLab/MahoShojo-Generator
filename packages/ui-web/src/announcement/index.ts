/**
 * 共源公告视图。
 *
 * 数据契约在 `@mahoshojo/contracts/announcements`（纯数据，两端镜像）；本入口是
 * 「公告栏 + 详情弹窗」的宿主无关呈现：公告源、已读存储、站外媒体与外链打开
 * 全部由宿主注入。
 */
export {
  AnnouncementCenter,
  sortAnnouncements,
  type AnnouncementCenterProps,
  type AnnouncementDismissalStore,
} from './AnnouncementCenter';
