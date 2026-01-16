import { generateText2Image, getGenerateStatus, calculateProgress } from "./liblib";
import { getStatusDescription, GenerateStatus } from "./liblib/types";

export type TachieSource = "liblib";
export type TachieGenerateMode = 'tachie' | 'illustration';

export interface TachieGenerationRequest {
    source: TachieSource;
    accessKey: string;
    secretKey: string;
    prompt: string;
    mode?: TachieGenerateMode;
    workflowUuid?: string;
    templateUuid?: string;
    promptNodeId?: number;
    negativePrompt?: string;
    negativePromptNodeId?: number;
}

export interface TachieGenerationResult {
    success: boolean;
    imageUrl?: string;
    error?: string;
    seed?: number;
    auditStatus?: number;
    generateUuid?: string;
    generateStatus?: number;
    statusDescription?: string;
    percentCompleted?: number;
}

/**
 * 带实时进度监听的立绘生成管理器
 * @param request 生成请求参数
 * @param onProgress 进度回调函数
 * @returns 生成结果
 */
export const generateTachieWithProgress = async (
    request: TachieGenerationRequest,
    onProgress?: (progress: number, status: string) => void
): Promise<TachieGenerationResult> => {
    try {
        switch (request.source) {
            case "liblib": {
                // 提交生图任务
                onProgress?.(5, "正在提交生成任务...");
                const generateUuid = await generateText2Image(
                    request.accessKey,
                    request.secretKey,
                    request.prompt,
                    {
                        mode: request.mode,
                        workflowUuid: request.workflowUuid,
                        templateUuid: request.templateUuid,
                        promptNodeId: request.promptNodeId,
                        negativePrompt: request.negativePrompt,
                        negativePromptNodeId: request.negativePromptNodeId,
                    }
                );

                onProgress?.(10, "任务已提交，开始生成...");
                let attempts = 0;
                const maxAttempts = 30;
                const interval = 12000; // 12秒轮询

                // 实时轮询状态并更新进度
                while (attempts < maxAttempts) {
                    const status = await getGenerateStatus(request.accessKey, request.secretKey, generateUuid);
                    const progress = calculateProgress(status.generateStatus, attempts);
                    const statusText = getStatusDescription(status.generateStatus);

                    onProgress?.(progress, statusText);

                    // 检查完成状态
                    switch (status.generateStatus) {
                        case GenerateStatus.SUCCESS:
                            onProgress?.(100, "生成完成！");
                            if (status.images && status.images.length > 0) {
                                const firstImage = status.images[0];
                                return {
                                    success: true,
                                    imageUrl: firstImage.imageUrl,
                                    seed: firstImage.seed,
                                    auditStatus: firstImage.auditStatus,
                                    generateUuid,
                                    generateStatus: status.generateStatus,
                                    statusDescription: getStatusDescription(status.generateStatus),
                                    percentCompleted: 100
                                };
                            } else {
                                return {
                                    success: false,
                                    error: "没有生成的图片",
                                    generateUuid,
                                    generateStatus: status.generateStatus,
                                    statusDescription: getStatusDescription(status.generateStatus),
                                    percentCompleted: 100
                                };
                            }

                        case GenerateStatus.FAILED:
                            throw new Error(`生成失败: ${status.generateMsg || getStatusDescription(status.generateStatus)}`);

                        case GenerateStatus.TIMEOUT:
                            throw new Error(`生成超时: ${status.generateMsg || "任务创建30分钟后超时"}`);
                    }

                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, interval));
                    }
                }

                throw new Error("生成超时: 达到最大轮询次数");
            }
            default:
                return {
                    success: false,
                    error: `不支持的生成源: ${request.source}`,
                };
        }
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "生成失败",
        };
    }
};
