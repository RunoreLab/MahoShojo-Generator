import { describe, it, expect } from 'bun:test';
import { urlSignature, getSignedUrl } from '@/lib/tachie/liblib/utils';

describe('lib/tachie/liblib/utils', () => {
    it('urlSignature: 当 url 为空时返回 undefined', async () => {
        expect(await urlSignature('' as unknown as string, '1234567890')).toBeUndefined();
    });

    it('urlSignature: 返回对象包含 signature/timestamp/signatureNonce，且 signature 为 URL-safe base64', async () => {
        const result = await urlSignature('/api/generate/webui/status', '1234567890');
        expect(result).toBeDefined();
        expect(typeof result!.timestamp).toBe('number');
        expect(typeof result!.signatureNonce).toBe('string');
        expect(result!.signatureNonce.length).toBe(16);
        expect(typeof result!.signature).toBe('string');
        expect(result!.signature.length).toBeGreaterThan(0);
        expect(result!.signature).not.toMatch(/[+=/]/);
    });

    it('getSignedUrl: 生成包含签名参数的 URL 查询串，并且 Timestamp 合理', async () => {
        const now = Date.now();
        const url = await getSignedUrl('lMG-xx', '1234567890', '/api/generate/webui/status');
        console.log(url);
        expect(url.startsWith('https://openapi.liblibai.cloud/api/generate/webui/status?')).toBe(true);

        const qs = url.split('?')[1] ?? '';
        const params = new URLSearchParams(qs);
        expect(params.get('AccessKey')).toBeTruthy();
        const tsStr = params.get('Timestamp');
        const nonce = params.get('SignatureNonce');
        const sig = params.get('Signature');

        expect(tsStr).toBeTruthy();
        expect(nonce).toBeTruthy();
        expect(sig).toBeTruthy();

        const ts = Number(tsStr);
        expect(Number.isFinite(ts)).toBe(true);
        // 与当前时间不超过 10s 的偏差
        expect(Math.abs(ts - now) < 10_000).toBe(true);
        // Nonce 和签名格式校验
        expect((nonce as string).length).toBe(16);
        expect((sig as string)).not.toMatch(/[+=/]/);
    });
});


