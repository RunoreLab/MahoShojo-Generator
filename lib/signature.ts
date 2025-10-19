// lib/signature.ts
const subtle = crypto.subtle;

// 使用一个Promise来缓存密钥的导入过程，避免重复导入
let secretKeyPromise: Promise<CryptoKey | null> | null = null;

type SignatureSanitizationOptions = {
    ignoreKeys?: string[];
    ignoreKeyPrefixes?: string[];
};

type StripResult<T> = {
    value: T;
    changed: boolean;
};

const DEFAULT_SANITIZATION_OPTIONS: Required<SignatureSanitizationOptions> = {
    ignoreKeys: [],
    ignoreKeyPrefixes: ['_']
};

/**
 * 判断某个键在签名过程中是否应该被忽略。
 * @param key - 当前字段名。
 * @param options - 配置项。
 * @returns 如果应忽略则返回 true。
 */
const shouldIgnoreKey = (key: string, options: Required<SignatureSanitizationOptions>): boolean => {
    if (options.ignoreKeys.includes(key)) {
        return true;
    }
    return options.ignoreKeyPrefixes.some(prefix => key.startsWith(prefix));
};

/**
 * 递归移除对象中需要忽略的字段，同时尽可能重用未修改的引用以减少额外分配。
 * @param input - 待处理的数据。
 * @param options - 忽略规则。
 * @returns 包含处理后数据及是否发生变更的结果。
 */
const stripIgnoredKeysDeep = <T>(input: T, options: Required<SignatureSanitizationOptions>): StripResult<T> => {
    if (Array.isArray(input)) {
        let mutated = false;
        const result = input.map(item => {
            const { value: sanitizedItem, changed } = stripIgnoredKeysDeep(item, options);
            if (changed) {
                mutated = true;
            }
            if (!mutated && sanitizedItem !== item) {
                mutated = true;
            }
            return sanitizedItem;
        });

        if (!mutated) {
            return { value: input, changed: false };
        }
        return { value: result as unknown as T, changed: true };
    }

    if (input !== null && typeof input === 'object') {
        const original = input as Record<string, any>;
        let mutated = false;
        const result: Record<string, any> = {};

        for (const [key, value] of Object.entries(original)) {
            if (shouldIgnoreKey(key, options)) {
                mutated = true;
                continue;
            }

            const { value: sanitizedChild, changed: childChanged } = stripIgnoredKeysDeep(value, options);
            if (childChanged) {
                mutated = true;
            }
            if (!mutated && sanitizedChild !== value) {
                mutated = true;
            }
            result[key] = sanitizedChild;
        }

        if (!mutated && Object.keys(result).length === Object.keys(original).length) {
            return { value: input, changed: false };
        }

        return { value: result as unknown as T, changed: true };
    }

    return { value: input, changed: false };
};

/**
 * [修改] 异步获取用于HMAC签名的密钥。
 * 密钥从环境变量 SIGNATURE_SECRET_KEY 中读取。
 * 如果环境变量未设置，将打印警告并返回 null，而不是抛出错误。
 * @returns {Promise<CryptoKey | null>} 返回一个Promise，解析为CryptoKey或null。
 */
const getSecretKey = (): Promise<CryptoKey | null> => {
    // 如果已经有正在进行的Promise，直接返回它
    if (secretKeyPromise) {
        return secretKeyPromise;
    }

    // 否则，创建一个新的Promise来导入密钥
    secretKeyPromise = (async () => {
        const secret = process.env.SIGNATURE_SECRET_KEY;

        // [核心修改] 如果密钥不存在，则打印警告并返回null
        if (!secret) {
            console.warn('⚠️ 警告: SIGNATURE_SECRET_KEY 环境变量未配置。数据签名功能已禁用，所有生成的数据将不包含原生签名。');
            return null;
        }

        const encoder = new TextEncoder();
        try {
            return await subtle.importKey(
                'raw', // 密钥格式
                encoder.encode(secret), // 将字符串密钥编码为Uint8Array
                { name: 'HMAC', hash: 'SHA-256' }, // 算法参数
                false, // non-exportable
                ['sign', 'verify'] // 密钥用途
            );
        } catch (e) {
            console.error("导入HMAC密钥失败:", e);
            // 失败时也返回null
            return null;
        }
    })();
    
    return secretKeyPromise;
};

/**
 * 递归地对对象的键进行排序，以确保JSON字符串的稳定性。
 * 这是生成一致哈希值的关键步骤。无论对象的键顺序如何，排序后生成的JSON字符串都是相同的。
 * @param obj 需要排序的对象
 * @returns 键已按字母顺序排序的新对象
 */
const sortObjectKeys = (obj: any): any => {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        // 如果是数组，则递归地对数组中的每个元素进行排序
        return obj.map(sortObjectKeys);
    }
    // 获取对象的所有键并按字母顺序排序
    const sortedKeys = Object.keys(obj).sort((a, b) => a.localeCompare(b));
    const result: { [key: string]: any } = {};
    for (const key of sortedKeys) {
        // 递归地对子对象的值进行排序
        result[key] = sortObjectKeys(obj[key]);
    }
    return result;
};

/**
 * 将ArrayBuffer转换为十六进制字符串。
 * @param buffer - 需要转换的ArrayBuffer。
 * @returns 返回十六进制格式的字符串。
 */
const bufferToHex = (buffer: ArrayBuffer): string => {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
};

/**
 * 为一个对象生成HMAC-SHA256签名。
 * @param data - 需要签名的对象。
 * @returns 返回十六进制格式的签名字符串，如果密钥未设置则返回null。
 */
export const generateSignature = async (data: object): Promise<string | null> => {
    const key = await getSecretKey();
    if (!key) return null;

    // 创建一个不包含现有签名的新对象以进行签名
    // 这是为了确保即使传入的对象已经有签名，我们也能生成正确的签名
    const dataToSign = { ...data };
    if ('signature' in dataToSign) {
        delete (dataToSign as any).signature;
    }

    // 1. 对对象的键进行递归排序，确保JSON字符串的稳定性
    const sortedData = sortObjectKeys(dataToSign);
    
    // 2. 将排序后的对象序列化为JSON字符串
    const jsonString = JSON.stringify(sortedData);
    
    // 3. 对JSON字符串进行签名
    const encoder = new TextEncoder();
    const signatureBuffer = await subtle.sign('HMAC', key, encoder.encode(jsonString));
    
    // 4. 将签名结果转换为十六进制字符串以便存储和传输
    return bufferToHex(signatureBuffer);
};

/**
 * 验证一个带有签名的对象的完整性。
 * @param dataWithSignature - 包含`signature`字段的完整对象。
 * @returns 如果签名有效则返回 `true`，否则返回 `false`。
 */
export const verifySignature = async (dataWithSignature: any): Promise<boolean> => {
    const key = await getSecretKey();
    if (!key) return false; // 如果没有密钥，所有内容都视为无效

    if (typeof dataWithSignature !== 'object' || dataWithSignature === null || typeof dataWithSignature.signature !== 'string') {
        return false; // 没有签名或格式不正确则无效
    }

    const { signature, ...dataToVerify } = dataWithSignature;

    const candidates: object[] = [dataToVerify];

    const { value: sanitizedWithoutPrivateFields, changed: removedPrivateFields } = stripIgnoredKeysDeep(
        dataToVerify,
        DEFAULT_SANITIZATION_OPTIONS
    );

    if (removedPrivateFields) {
        candidates.push(sanitizedWithoutPrivateFields);
    }

    for (const candidate of candidates) {
        const expectedSignature = await generateSignature(candidate);
        if (!expectedSignature) {
            continue;
        }

        if (signature.length !== expectedSignature.length) {
            continue;
        }

        if (signature === expectedSignature) {
            return true;
        }
    }

    return false;
};
