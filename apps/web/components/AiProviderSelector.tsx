// Web 侧 AI Provider 选择器薄封装。
//
// 全部展示/状态/持久化逻辑已共源到 `@mahoshojo/ui-web/ai-provider`（D5.0b）；
// 本文件只注入 Web 宿主端口：localStorage、`/api/ai/channel-availability`、
// `mahoshojo:set-ai-provider-config` CustomEvent、Next `<Link>` 文档入口。
// 对外契约不变：默认导出 + `UserAIProviderConfig` re-export。

import React from 'react';
import Link from 'next/link';

import {
  AI_PROVIDER_SYNC_EVENT,
  AiProviderSelectorView,
  type AiChannelAvailabilityEntry,
  type AiProviderStoragePort,
  type AiProviderSyncDetail,
} from '@mahoshojo/ui-web/ai-provider';
import type { AIProviderOption } from '@/lib/ai/constants';
import { ChannelAvailabilityBadge } from '@/components/ChannelAvailabilityBadge';
import type { UserAIProviderConfig } from '@/lib/ai/custom-provider';

export type { UserAIProviderConfig } from '@/lib/ai/custom-provider';

interface AiProviderSelectorProps {
    onConfigChange: (config: UserAIProviderConfig | null) => void;
    storageNamespace?: string;
    allowSystemProvider?: boolean;
    label?: string;
}

const webLocalStoragePort: AiProviderStoragePort = {
    getItem: (key) => (typeof window === 'undefined' ? null : window.localStorage.getItem(key)),
    setItem: (key, value) => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(key, value);
    },
    removeItem: (key) => {
        if (typeof window === 'undefined') return;
        window.localStorage.removeItem(key);
    },
};

const loadChannelAvailability = async (): Promise<AiChannelAvailabilityEntry[] | null> => {
    try {
        const res = await fetch('/api/ai/channel-availability');
        if (!res.ok) return null;
        const data = await res.json();
        return (data?.entries ?? null) as AiChannelAvailabilityEntry[] | null;
    } catch {
        return null;
    }
};

const subscribeSync = (handler: (detail: AiProviderSyncDetail) => void) => {
    if (typeof window === 'undefined') return;
    const listener = (event: Event) => {
        handler((event as CustomEvent<AiProviderSyncDetail | undefined>).detail ?? {});
    };
    window.addEventListener(AI_PROVIDER_SYNC_EVENT, listener as EventListener);
    return () => window.removeEventListener(AI_PROVIDER_SYNC_EVENT, listener as EventListener);
};

const renderDocsLink = (provider: AIProviderOption) => (
    <div className="mt-4">
        <Link
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-lg bg-pink-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-transform hover:-translate-y-0.5 hover:bg-pink-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-pink-500"
        >
            前往获取 API Key
        </Link>
    </div>
);

const AiProviderSelector: React.FC<AiProviderSelectorProps> = ({
    onConfigChange,
    storageNamespace,
    allowSystemProvider,
    label,
}) => (
    <AiProviderSelectorView
        onConfigChange={onConfigChange}
        storage={webLocalStoragePort}
        storageNamespace={storageNamespace}
        allowSystemProvider={allowSystemProvider}
        label={label}
        loadChannelAvailability={loadChannelAvailability}
        renderAvailabilityBadge={(entry) => (
            <ChannelAvailabilityBadge availability={entry} compact />
        )}
        renderDocsLink={renderDocsLink}
        subscribeSync={subscribeSync}
        apiKeyStorageHint="API Key 仅存储于本地浏览器；请求时会随 HTTPS 发送到边缘函数用于转发调用，不会写入数据库或日志。"
    />
);

export default AiProviderSelector;
