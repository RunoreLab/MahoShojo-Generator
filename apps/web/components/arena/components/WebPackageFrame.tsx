'use client';

import { useEffect, useRef, useState } from 'react';
import { WEB_PACKAGE_RUNNER_PATH } from '@/lib/web-package/runner-client';

export const WEB_PACKAGE_FRAME_ALLOW = "camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'; serial 'none'; display-capture 'none'";

/** 首次准备消息仅用于投递本地页面，不允许子框架请求宿主 API、文件或升级权限。 */
export function WebPackageFrame({ html, trusted, className }: {
  html: string;
  trusted: boolean;
  className?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const [started, setStarted] = useState(false);
  const [loadError, setLoadError] = useState(false);
  useEffect(() => {
    let delivered = false;
    const timer = window.setTimeout(() => { if (!delivered) setLoadError(true); }, 30_000);
    const receive = (event: MessageEvent) => {
      if (delivered || event.source !== frame.current?.contentWindow
        || event.origin !== (trusted ? window.location.origin : 'null')
        || event.data?.type !== 'maho-web-package:ready' || event.data?.nonce !== nonce) return;
      delivered = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', receive);
      // Opaque iframe 必须使用 '*'，接收窗口与一次性 nonce 已精确绑定。
      frame.current?.contentWindow?.postMessage({ type: 'maho-web-package:mount', nonce, html }, trusted ? window.location.origin : '*');
    };
    window.addEventListener('message', receive);
    setStarted(true);
    return () => { window.clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [html, nonce, trusted]);
  return <>
    {loadError ? <p role="status" className="p-3 text-sm text-amber-700">Web 包运行页未能就绪。请重新加载；生成目标仍可查看和下载。</p> : null}
    <iframe
      ref={frame}
      title="AI Web 战报"
      sandbox={trusted ? 'allow-scripts allow-same-origin' : 'allow-scripts'}
      referrerPolicy="no-referrer"
      allow={WEB_PACKAGE_FRAME_ALLOW}
      src={started ? `${WEB_PACKAGE_RUNNER_PATH}?instance=${nonce}` : undefined}
      data-testid="arena-web-document"
      data-web-package-mode={trusted ? 'trusted' : 'restricted'}
      className={className}
    />
  </>;
}
