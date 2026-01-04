// lib/r2.ts
import { AwsClient } from 'aws4fetch';

type UploadBody = string | ArrayBuffer | Uint8Array | Blob | ReadableStream | null;

interface PutObjectOptions {
    contentType?: string;
    contentEncoding?: string;
    cacheControl?: string;
    metadata?: Record<string, string>;
}

interface PresignOptions {
    method?: 'GET' | 'PUT' | 'DELETE';
    expiresInSeconds?: number;
    responseContentType?: string;
}

interface R2Result<T = undefined> {
    success: boolean;
    status?: number;
    data?: T;
    error?: string;
}

interface R2ObjectSummary {
    key: string;
    size: number;
    lastModified?: string;
    etag?: string;
    storageClass?: string;
}

const required = {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    bucketName: process.env.R2_BUCKET_NAME,
};

const accountId =
    process.env.CF_ACCOUNT_ID ||
    process.env.CLOUDFLARE_ACCOUNT_ID ||
    process.env.R2_ACCOUNT_ID;

const endpoint =
    process.env.R2_ENDPOINT ||
    (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : undefined);

const r2Client =
    required.accessKeyId && required.secretAccessKey
        ? new AwsClient({
            accessKeyId: required.accessKeyId,
            secretAccessKey: required.secretAccessKey,
            region: 'auto',
            service: 's3',
        })
        : null;

function assertConfig() {
    if (!required.accessKeyId || !required.secretAccessKey) {
        throw new Error('缺少 R2 Access Key 配置，无法执行对象存储操作');
    }
    if (!required.bucketName) {
        throw new Error('缺少 R2 bucket 名称配置');
    }
    if (!endpoint) {
        throw new Error('缺少 R2 endpoint 配置，无法拼接对象访问地址');
    }
    if (!r2Client) {
        throw new Error('R2 客户端未正确初始化');
    }
}

const buildObjectUrl = (key: string): string => {
    assertConfig();
    const sanitizedKey = key.replace(/^\/+/, '');
    const encodedKey = sanitizedKey
        .split('/')
        .map(segment => encodeURIComponent(segment))
        .join('/');
    return `${endpoint}/${required.bucketName}/${encodedKey}`;
};

const normalizeBody = (body: UploadBody): BodyInit | undefined => {
    if (body === null) return undefined;
    if (typeof body === 'string') return body;
    if (body instanceof ArrayBuffer || body instanceof Uint8Array || body instanceof Blob || body instanceof ReadableStream) {
        return body as BodyInit;
    }
    throw new Error('不支持的 R2 上传体类型');
};

/**
 * 上传对象到 R2
 * @param key 对象键，可以包含文件夹比如 test/xxx.txt
 * @param body 上传体内容
 * @param options 上传选项
 * @returns 上传结果，包含一个 etag 用于识别对象版本
 */
export async function putObject(
    key: string,
    body: UploadBody,
    options: PutObjectOptions = {}
): Promise<R2Result<{ etag: string | null }>> {
    try {
        assertConfig();
        const url = buildObjectUrl(key);
        const headers = new Headers();

        if (options.contentType) {
            headers.set('Content-Type', options.contentType);
        }
        if (options.contentEncoding) {
            headers.set('Content-Encoding', options.contentEncoding);
        }
        if (options.cacheControl) {
            headers.set('Cache-Control', options.cacheControl);
        }
        if (options.metadata) {
            for (const [metaKey, value] of Object.entries(options.metadata)) {
                headers.set(`x-amz-meta-${metaKey}`, value);
            }
        }

        const signed = await r2Client!.sign(url, {
            method: 'PUT',
            headers,
            body: normalizeBody(body),
        });

        const response = await fetch(signed.url, signed);
        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, status: response.status, error: errorText || 'R2 上传失败' };
        }

        return {
            success: true,
            status: response.status,
            data: { etag: response.headers.get('etag') },
        };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
}

/**
 * 读取对象为文本（服务端使用），不向客户端暴露 R2 URL。
 */
export async function getObjectText(
    key: string,
    options: { responseContentType?: string; expiresInSeconds?: number } = {}
): Promise<R2Result<{ text: string }>> {
    try {
        assertConfig();
        const url = await generatePresignedUrl(key, {
            method: 'GET',
            expiresInSeconds: options.expiresInSeconds ?? 120,
            ...(options.responseContentType ? { responseContentType: options.responseContentType } : {}),
        });
        const res = await fetch(url, { method: 'GET' });
        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            return { success: false, status: res.status, error: errorText || 'R2 读取失败' };
        }
        const text = await res.text();
        return { success: true, status: res.status, data: { text } };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
}

/**
 * 删除 R2 中的对象
 * @param key 对象键，可以包含文件夹比如 test/xxx.txt
 * @returns 删除结果
 */
export async function deleteObject(key: string): Promise<R2Result> {
    try {
        assertConfig();
        const url = buildObjectUrl(key);
        const signed = await r2Client!.sign(url, { method: 'DELETE' });
        const response = await fetch(signed.url, signed);

        if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            return { success: false, status: response.status, error: errorText || 'R2 删除失败' };
        }

        return { success: true, status: response.status };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
}

/**
 * 生成 R2 对象的预签名 URL 供客户端读取下载，避免 Cloudflare Worker 长时间占用
 * @param key 对象键，可以包含文件夹比如 test/xxx.txt
 * @param options 预签名选项
 * @returns 预签名 URL
 */
export async function generatePresignedUrl(key: string, options: PresignOptions = {}): Promise<string> {
    assertConfig();
    const method = options.method || 'GET';
    const expires = options.expiresInSeconds ?? 3600;
    const url = new URL(buildObjectUrl(key));

    if (options.responseContentType) {
        url.searchParams.set('response-content-type', options.responseContentType);
    }

    url.searchParams.set('X-Amz-Expires', `${expires}`);

    const signed = await r2Client!.sign(url, {
        method,
        aws: { signQuery: true },
        headers: options.responseContentType ? { 'response-content-type': options.responseContentType } : undefined,
    });

    return signed.url;
}

/**
 * 列出 R2 存储桶中的对象的 key
 * @param prefix 前缀，用于筛选对象（如 'test/' 会列出所有 test/ 开头的对象）
 * @returns 对象列表结果，包含对象键、大小、类型等
 */
export const listObjects = async (prefix: string): Promise<R2Result<R2ObjectSummary[]>> => {
    try {
        assertConfig();
        const sanitizedPrefix = prefix.replace(/^\/+/, '');
        const url = new URL(`${endpoint}/${required.bucketName}`);
        url.searchParams.set('list-type', '2');
        if (sanitizedPrefix) {
            url.searchParams.set('prefix', sanitizedPrefix);
        }

        const signed = await r2Client!.sign(url, { method: 'GET' });
        const response = await fetch(signed.url, signed);

        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, status: response.status, error: errorText || 'R2 对象列表获取失败' };
        }

        const xml = await response.text();
        const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
        const tagValue = (block: string, tag: string): string | null => {
            const match = block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`));
            if (!match) return null;
            return match[1]
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&amp;/g, '&')
                .trim();
        };

        const data: R2ObjectSummary[] = [];
        let match: RegExpExecArray | null;
        while ((match = contentsRegex.exec(xml)) !== null) {
            const block = match[1];
            const key = tagValue(block, 'Key');
            if (!key) continue;
            const sizeValue = tagValue(block, 'Size');
            data.push({
                key,
                size: sizeValue ? parseInt(sizeValue, 10) : 0,
                lastModified: tagValue(block, 'LastModified') || undefined,
                etag: tagValue(block, 'ETag') || undefined,
                storageClass: tagValue(block, 'StorageClass') || undefined,
            });
        }

        return { success: true, status: response.status, data };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : '未知错误' };
    }
};
