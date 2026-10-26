import type { Metadata } from 'next';
import Link from 'next/link';
import { Download } from 'lucide-react';

import { DESKTOP_RELEASE } from '@/lib/desktop-release';
import { getDesktopRelease } from '@/lib/desktop-release-server';

// 发布状态使用显式 runtime cache；不让构建期 ISR 固定筹备态页面。
export const revalidate = 0;

export const metadata: Metadata = {
  title: '桌面客户端下载 - 魔法少女生成器',
  description: '查看魔法少女生成器 Windows 桌面版的正式发布状态、安装方式与数据迁移提醒。',
};

export default async function DesktopDownloadPage() {
  const release = await getDesktopRelease();
  const published = release.status === 'published' ? release : null;

  return (
    <main className="magic-background-white min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <section className="rounded-2xl border border-(--app-border-strong) bg-(--app-surface) p-6 shadow-(--app-shadow-lg) sm:p-10">
          <span className="inline-flex rounded-full border border-(--app-border-strong) bg-(--app-surface) px-3 py-1 text-xs font-medium text-(--app-text)">
            Windows 64 位 · 桌面客户端
          </span>
          <h1 className="mt-4 text-3xl font-bold text-(--app-text) sm:text-4xl">
            魔法少女生成器 · 桌面版
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-(--app-text-muted)">
            在电脑上使用创作、竞技场与本地作品库等功能。桌面版与网页端属于同一产品，
            但本地数据保存在各自的设备存储中，并不会因为登录同一账号就自动同步。
          </p>

          <div className="mt-6 rounded-xl border border-(--app-border-strong) bg-(--app-surface-80) p-5">
            {published ? (
              <>
                <p className="font-semibold text-(--app-text)">桌面版 v{published.version} 已开放下载</p>
                <a
                  href={published.installerUrl}
                  className="mt-3 inline-flex items-center justify-center gap-2 rounded-lg border border-(--app-text) bg-(--app-surface) px-5 py-3 font-semibold text-(--app-text) underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                >
                  <Download size={18} aria-hidden="true" />
                  下载 Windows 安装包（x64）
                </a>
                <p className="mt-3 text-sm text-(--app-text-muted)">
                  <a className="text-(--app-text) underline underline-offset-2" href={published.sha256Url}>
                    查看 SHA256 校验文件
                  </a>
                  {' · '}建议从本站进入官方 GitHub Release 下载并核对校验值。
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-(--app-text)">{release.status === 'unavailable' ? '暂时无法查询下载状态' : `正式版 v${DESKTOP_RELEASE.version} 正在准备中`}</p>
                <p className="mt-2 text-sm leading-relaxed text-(--app-text-muted)">
                  {release.status === 'unavailable'
                    ? 'GitHub 暂时不可达或请求受限，请稍后重试，也可以通过下方项目链接查看 Releases。'
                    : '桌面端已完成多轮 Beta 测试，目前正在收尾正式安装包验收。正式版安装包尚未开放下载，请留意本站公告。'}
                </p>
              </>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-(--app-border) p-4">
              <h2 className="font-semibold text-(--app-text)">首次安装</h2>
              <p className="mt-2 text-sm leading-relaxed text-(--app-text-muted)">
                首发支持 Windows 11 x64；Windows 10 22H2 兼容情况以发布说明为准。缺少 Microsoft WebView2 运行时的设备，安装时需要联网下载；
                在线账号、公开库以及云端 AI 服务仍需要网络。
              </p>
            </div>
            <div className="rounded-xl border border-(--app-border) p-4">
              <h2 className="font-semibold text-(--app-text)">已有 Beta 或网页本地内容</h2>
              <p className="mt-2 text-sm leading-relaxed text-(--app-text-muted)">
                升级前请先备份重要的本地卡片、会话与作品。网页浏览器本地库和桌面端本地库相互独立；
                不要删除旧版应用或清除网站数据来尝试“同步”。
              </p>
            </div>
          </div>

          <div className="mt-5 rounded-lg border border-(--app-border-strong) bg-(--app-surface-80) p-4 text-sm leading-relaxed text-(--app-text)">
            <strong>关于 Windows 安装警告：</strong>首版暂不对安装程序进行 Windows 发行者代码签名，
            系统可能提示“未知发布者”或显示 SmartScreen 信誉警告。这与应用内更新所需的包签名是两回事。
            请仅通过官方入口获取安装包并校验 SHA256；不确定来源时不要安装，也不需要关闭系统安全防护。
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-4 text-sm">
            <Link className="font-medium text-(--app-text) underline underline-offset-4" href="/encyclopedia/desktop-client">
              阅读桌面版安装与数据指南
            </Link>
            <a
              className="font-medium text-(--app-text) underline underline-offset-4"
              href="https://github.com/RunoreLab/MahoShojo-Generator"
              target="_blank"
              rel="noopener noreferrer"
            >
              项目 GitHub 仓库
            </a>
            <Link className="font-medium text-(--app-text-muted) underline underline-offset-4" href="/">
              返回首页
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
