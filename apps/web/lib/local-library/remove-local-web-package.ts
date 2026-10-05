'use client';

import { listStagedLocalWebPackages, unstageLocalWebPackage } from '@mahoshojo/web-package';
import type { LocalWebPackageRecordV1 } from '@mahoshojo/local-library/web-package-record';

import { getLocalWebPackageRepository } from './web-package-repository';
import { WEB_PACKAGE_TRUST_KEY_PREFIX } from '@/lib/web-package/trust';

/**
 * 「从本机删除一个 Web 包」的完整闭环。
 *
 * 与「移除选择」是两件不同的事：移除只让本次生成回到自由 Web，删除则让这个包在本机
 * 彻底不再可选。旧实现只有前者，用户一旦认定某个 ZIP 不可信就再也删不掉它。
 *
 * 一次性清掉四处会各自独立地让包"还活着"的状态：
 * 1. 本地库记录（**purge**：记录与 archive 字节一起消失，而不是软删留字节）；
 * 2. 会话 staging（否则本次会话仍能选中它）；
 * 3. 同源信任授权的 localStorage 键（否则重新导入同样字节会静默恢复信任、跳过三秒确认）；
 * 4. 指向它的 `webPackageRef`（否则下次会话恢复出一个指向已删除包的陈旧选择）。
 *
 * 这里用 `purge` 而不是 `delete`，因为本流程对用户的承诺是"从这台设备移除"，而仓储的
 * `delete` 是回收站语义：它保留 ZIP 字节，使 `restore` 能真正恢复可用状态。把承诺
 * "彻底移除"的入口接到软删上，会让用户以为字节已经消失、实际却仍留在磁盘上。
 * 回收站本身暂无 UI 入口，`restore` 的用户路径留待本地数据管理页面。
 *
 * 历史战报里引用的同一 digest 会退化为 `missing-package` 回退；这是无法两全的取舍，
 * UI 必须在确认前说清楚。
 */
export interface RemoveLocalWebPackageResult {
  clearedSelection: boolean;
  clearedTrustGrant: boolean;
  clearedStaging: boolean;
}

/**
 * @returns true 表示确实移除了一条持久授权；false 表示本来就没有或浏览器拒绝删除。
 * 两者对用户不是同一件事：前者无感，后者 MUST 提示手动清除站点权限。
 */
export const revokePersistedWebPackageTrust = (digest: string): boolean => {
  if (typeof window === 'undefined') return false;
  const key = WEB_PACKAGE_TRUST_KEY_PREFIX + digest;
  try {
    const existed = window.localStorage.getItem(key) !== null;
    window.localStorage.removeItem(key);
    return existed && window.localStorage.getItem(key) === null;
  } catch {
    // 隐私模式下读取/删除可能失败；调用方据此提示用户手动清除站点权限。
    return false;
  }
};

export const removeLocalWebPackage = async (
  record: LocalWebPackageRecordV1,
  options: { activeRefDigest: string | null; clearSelection: () => void },
): Promise<RemoveLocalWebPackageResult> => {
  await getLocalWebPackageRepository().purge(record.id);

  let clearedStaging = false;
  for (const staged of listStagedLocalWebPackages()) {
    if (staged.ref.digest !== record.ref.digest) continue;
    unstageLocalWebPackage(staged.ref);
    clearedStaging = true;
  }

  const clearedTrustGrant = revokePersistedWebPackageTrust(record.ref.digest);

  const clearedSelection = options.activeRefDigest === record.ref.digest;
  if (clearedSelection) options.clearSelection();

  return { clearedSelection, clearedTrustGrant, clearedStaging };
};

/**
 * 删除时会被一并清掉的本地状态。确认对话框用它把后果讲清楚——
 * 措辞与实际删除行为同源，避免两处各写一份而悄悄漂移。
 */
export const describeWebPackageRemovalConsequences = (target: {
  title: string;
  digest: string;
  sessionOnly?: boolean;
}): string[] => {
  if (target.sessionOnly) {
    return [
      `「${target.title}」只存在于本次会话，移除后需要重新导入 ZIP。`,
      '它没有写入本地库，因此不影响任何历史战报。',
    ];
  }
  const lines = [
    `「${target.title}」的 ZIP 将从这台设备的本地库中移除。`,
    '历史上引用了这份 Web 包的战报将无法再原样重放，会退化为纯文本结果。',
    '该包的同源授权也会一并撤销；重新导入同样字节时需要重新确认。',
  ];
  if (typeof window !== 'undefined' && window.localStorage.getItem(WEB_PACKAGE_TRUST_KEY_PREFIX + target.digest) !== null) {
    lines.push('当前浏览器确实保存着它的同源授权，删除后会一并失效。');
  }
  return lines;
};
