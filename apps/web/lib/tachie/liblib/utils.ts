import randomString from "string-random";

// CORS 代理选项 - 如果直连失败可以使用代理
const USE_CORS_PROXY = false; // 设为 true 使用 CORS 代理
const CORS_PROXY = "https://cors-anywhere.herokuapp.com/";
const BASE_URL = USE_CORS_PROXY
    ? `${CORS_PROXY}https://openapi.liblibai.cloud`
    : "https://openapi.liblibai.cloud";

// 生成签名
export const urlSignature = async (url: string, secretKey: string) => {
    if (!url) return;
    const timestamp = Date.now(); // 当前时间戳
    const signatureNonce = randomString(16); // 随机字符串，你可以任意设置，这个没有要求
    // 原文 = URl地址 + "&" + 毫秒时间戳 + "&" + 随机字符串
    const str = `${url}&${timestamp}&${signatureNonce}`;

    // 使用 Web Crypto API 替代 Node.js crypto
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secretKey),
        { name: "HMAC", hash: "SHA-1" },
        false,
        ["sign"]
    );

    const signature_buffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(str)
    );

    // 转换为 base64
    const signature_array = new Uint8Array(signature_buffer);
    const hash = btoa(String.fromCharCode(...Array.from(signature_array)));

    // 最后一步： encodeBase64URLSafeString(密文)
    // 这一步很重要，生成安全字符串。java、Python 以外的语言，可以参考这个 JS 的处理
    const signature = hash
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    return {
        signature,
        timestamp,
        signatureNonce,
    };
};

// 例子：原本查询生图进度接口是 https://openapi.liblibai.cloud/api/generate/webui/status
// 加密后，url 就变更为 https://openapi.liblibai.cloud/api/generate/webui/status?AccessKey={YOUR_ACCESS_KEY}&Signature={签名}&Timestamp={时间戳}&SignatureNonce={随机字符串}
/**
 * 获取签名后的 URL
 * @param accessKey 访问密钥
 * @param endpoint 原始 API 端点如 /api/generate/webui/status
 * @returns 签名后的 URL
 */
export const getSignedUrl = async (accessKey: string, secretKey: string, endpoint: string) => {
    const result = await urlSignature(endpoint, secretKey);
    const { signature, timestamp, signatureNonce } = result || {
        signature: "",
        timestamp: 0,
        signatureNonce: "",
    };
    return `${BASE_URL}${endpoint}?AccessKey=${accessKey}&Signature=${signature}&Timestamp=${timestamp}&SignatureNonce=${signatureNonce}`;
};