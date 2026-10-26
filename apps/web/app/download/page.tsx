import type { Metadata } from 'next';
import Link from 'next/link';

import { DESKTOP_RELEASE, getPublishedDesktopRelease } from '@/lib/desktop-release';

export const metadata: Metadata = {
  title: '桌面客户端下载 - 魔法少女生成器',
  description: '查看魔法少女生成器 Windows 桌面版的正式发布状态、安装方式与数据迁移提醒。',
};

export default function DesktopDownloadPage() {
  const published = getPublishedDesktopRelease(DESKTOP_RELEASE);

  return (
    <main className="magic-background-white min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-4xl">
        <section className="card rounded-2xl border border-pink-200 p-6 sm:p-10">
          <span className="inline-flex rounded-full bg-pink-100 px-3 py-1 text-xs font-medium text-pink-800">
            Windows 64 位 · 桌面客户端
          </span>
          <h1 className="mt-4 text-3xl font-bold text-(--app-text) sm:text-4xl">
            魔法少女生成器 · 桌面版
          </h1>
          <p className="mt-3 max-w-2xl leading-relaxed text-(--app-text-muted)">
            在电脑上使用创作、竞技场与本地作品库等功能。桌面版与网页端属于同一产品，
            但本地数据保存在各自的设备存储中，并不会因为登录同一账号就自动同步。
          </p>

          <div className="mt-6 rounded-xl border border-pink-200 bg-pink-50/80 p-5 dark:bg-pink-950/20">
            {published ? (
              <>
                <p className="font-semibold text-(--app-text)">桌面版 v{published.version} 已开放下载</p>
                <a
                  href={published.installerUrl}
                  className="mt-3 inline-flex items-center justify-center rounded-lg bg-pink-600 px-5 py-3 font-semibold text-white transition-colors hover:bg-pink-700"
                >
                  下载 Windows 安装包（x64）
                </a>
                <p className="mt-3 text-sm text-(--app-text-muted)">
                  <a className="underline underline-offset-2 hover:text-pink-700" href={published.sha256Url}>
                    查看 SHA256 校验文件
                  </a>
                  {' · '}建议从本站进入官方 GitHub Release 下载并核对校验值。
                </p>
              </>
            ) : (
              <>
                <p className="font-semibold text-(--app-text)">正式版 v{DESKTOP_RELEASE.version} 正在准备中</p>
                <p className="mt-2 text-sm leading-relaxed text-(--app-text-muted)">
                  桌面端已完成多轮 Beta 测试，目前正在收尾发布构建、更新机制和正式安装包验收。
                  <strong> 正式版安装包尚未开放下载。</strong>请留意本站公告；现在无需寻找第三方安装包。
                </p>
              </>
            )}
          </div>

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-(--app-border) p-4">
              <h2 className="font-semibold text-(--app-text)">首次安装</h2>
              <p className="mt-2 text-sm leading-relaxed text-(--app-text-muted)">
                首发计划提供 Windows x64 安装程序。部分设备首次启动可能需要安装 Microsoft WebView2 运行时；
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

          <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm leading-relaxed text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
            <strong>关于 Windows 安装警告：</strong>首版暂不对安装程序进行 Windows 发行者代码签名，
            系统可能提示“未知发布者”或显示 SmartScreen 信誉警告。这与应用内更新所需的包签名是两回事。
            请仅通过官方入口获取安装包并校验 SHA256；不确定来源时不要安装，也不需要关闭系统安全防护。
          </div>

          <div className="mt-7 flex flex-wrap items-center gap-4 text-sm">
            <Link className="font-medium text-pink-700 underline underline-offset-4 hover:text-pink-800" href="/encyclopedia/desktop-client">
              阅读桌面版安装与数据指南
            </Link>
            <a
              className="font-medium text-pink-700 underline underline-offset-4 hover:text-pink-800"
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
