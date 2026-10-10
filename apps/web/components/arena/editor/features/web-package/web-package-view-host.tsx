'use client';

import Link from 'next/link';
import type { ArenaWebPackageViewHost } from '@mahoshojo/ui-web/arena';
import { WebPackageBaseRisk } from '@/components/arena/components/WebPackageSafety';
import { LocalLibrarySavePreference } from '@/components/shared/LocalLibrarySavePreference';
import { LocalLibraryStatusNote } from '@/components/shared/LocalLibraryStatusNote';
import { describeWebPackageRemovalConsequences } from '@/lib/local-library/remove-local-web-package';

/** Browser storage, trust scan and navigation stay on the original Web host. */
export const webPackageViewHost: ArenaWebPackageViewHost = {
  copy: {
    sessionOrigin: '仅本次会话暂存（未写入本地库，刷新后需重新导入）',
    sessionNote: '仅本次会话暂存；刷新后需要重新导入。',
    libraryNote: '来自本机本地库；清除站点数据会一并删除，可随时在此重新导入。',
    libraryReadErrorHint: '这不代表已保存的 Web 包被删除；请检查浏览器是否允许本站使用本地存储后重试。',
    emptyImportHint: '导入本地 ZIP 即可使用。导入默认只对本次会话有效，勾选「导入时保存到本地库」可以让它在刷新后依然存在。',
    importNote: 'ZIP 在本浏览器解析并受限运行，不向服务器上传完整包。',
  },
  renderRisk: (ref) => <WebPackageBaseRisk packageRef={ref} />,
  renderHelpLink: (label) => <Link className="ml-1 underline hover:text-gray-700" href="/encyclopedia/web-report">{label}</Link>,
  libraryStatus: <LocalLibraryStatusNote />,
  renderSavePreference: (props) => <LocalLibrarySavePreference {...props} label="导入时保存到本地库" />,
  describeRemoval: describeWebPackageRemovalConsequences,
};
