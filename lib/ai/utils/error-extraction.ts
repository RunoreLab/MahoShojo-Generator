import { getLogger } from '../../logger';

const log = getLogger('ai-error-extraction');

/**
 * 从 AI SDK 错误对象中提取上游返回的详细错误信息
 *
 * @param capturedError - 在 onError 回调中捕获的错误对象
 * @param result - AI SDK 返回的 result 对象
 * @param fallbackMessage - 当无法提取错误信息时使用的默认消息
 * @returns 提取出的错误信息
 */
export function extractUpstreamErrorMessage(
    capturedError: any,
    result?: any,
    fallbackMessage: string = '流意外结束，没有内容生成'
): string {
    let errorMessage = fallbackMessage;

    // 优先从 capturedError 中提取（onError 回调捕获的错误）
    if (capturedError) {
        try {
            const upstreamMessage =
                capturedError?.data?.error?.message ||
                capturedError?.message ||
                capturedError?.responseBody?.error?.message ||
                capturedError?.cause?.message;

            if (upstreamMessage) {
                const errorPrefix = capturedError.name || 'AI_Error';
                errorMessage = `${errorPrefix}: ${upstreamMessage}`;
            }
        } catch (e) {
            log.debug('无法从 capturedError 提取错误信息', { extractError: e });
        }
    }

    // 如果 capturedError 没有提供有用信息，尝试从 result 提取
    if (errorMessage === fallbackMessage && result) {
        try {
            const resultAny = result as any;
            const upstreamError =
                resultAny?.error?.data?.error?.message ||
                resultAny?.error?.message ||
                resultAny?.response?.error?.message ||
                resultAny?.cause?.message;

            if (upstreamError) {
                errorMessage = `流意外结束: ${upstreamError}`;
            }
        } catch (e) {
            log.debug('无法从 result 提取错误信息', { extractError: e });
        }
    }

    return errorMessage;
}

/**
 * 从捕获的错误对象中增强错误信息
 * 用于在 catch 块中提取上游返回的详细错误信息
 *
 * @param error - 捕获的错误对象
 * @returns 增强后的错误对象，如果无法提取则返回原始错误
 */
export function enhanceErrorWithUpstreamMessage(error: any): Error {
    try {
        const errorAny = error as any;

        // 检查是否是 AI SDK 的错误对象，尝试提取上游返回的详细错误信息
        const upstreamMessage =
            errorAny?.data?.error?.message ||
            errorAny?.error?.data?.error?.message ||
            errorAny?.responseBody?.error?.message ||
            errorAny?.cause?.message;

        if (upstreamMessage) {
            // 创建一个新的错误对象，包含上游的详细错误信息
            const errorPrefix = errorAny.name || 'AI_Error';
            const enhancedError = new Error(`${errorPrefix}: ${upstreamMessage}`);
            // 保留原始错误对象作为 cause
            (enhancedError as any).originalError = error;
            return enhancedError;
        }
    } catch (e) {
        // 提取错误信息失败，使用原始错误
        log.debug('无法提取上游错误信息', { extractError: e });
    }

    // 如果无法提取，返回原始错误
    return error instanceof Error ? error : new Error(String(error));
}
