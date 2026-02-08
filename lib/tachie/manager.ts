import { generateText2Image, getGenerateStatus, calculateProgress } from "./liblib";
import { getStatusDescription, GenerateStatus } from "./liblib/types";
import { generateModelScopeText2Image, getModelScopeTaskStatus } from "./modelscope/api";

export type TachieSource = "liblib" | "modelscope";
export type TachieGenerateMode = 'tachie' | 'illustration';

export interface TachieGenerationRequest {
    source: TachieSource;
    accessKey?: string;
    secretKey?: string;
    modelscopeToken?: string;
    modelscopeModel?: string;
    modelscopeSize?: string;
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

const calculateModelScopeProgress = (taskStatus: string, attempts: number): number => {
    switch (taskStatus) {
        case "PENDING":
            return Math.min(10 + attempts * 3, 35);
        case "RUNNING":
            return Math.min(35 + attempts * 5, 90);
        case "SUCCEED":
            return 100;
        case "FAILED":
            return Math.min(35 + attempts * 4, 95);
        default:
            return Math.min(15 + attempts * 4, 88);
    }
};

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
                const accessKey = request.accessKey?.trim();
                const secretKey = request.secretKey?.trim();
                if (!accessKey || !secretKey) {
                    throw new Error("请填写 LibLib Access Key 和 Secret Key");
                }

                // 提交生图任务
                onProgress?.(5, "正在提交生成任务...");
                const generateUuid = await generateText2Image(
                    accessKey,
                    secretKey,
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
                    const status = await getGenerateStatus(accessKey, secretKey, generateUuid);
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
            case "modelscope": {
                const modelscopeToken = request.modelscopeToken?.trim();
                if (!modelscopeToken) {
                    throw new Error("请填写 ModelScope Token");
                }

                onProgress?.(5, "正在提交 ModelScope 任务...");
                const taskId = await generateModelScopeText2Image(
                    modelscopeToken,
                    request.prompt,
                    {
                        model: request.modelscopeModel,
                        size: request.modelscopeSize,
                    },
                );

                onProgress?.(10, "任务已提交，开始轮询状态...");
                let attempts = 0;
                const maxAttempts = 60;
                const interval = 10000;

                while (attempts < maxAttempts) {
                    const status = await getModelScopeTaskStatus(modelscopeToken, taskId);
                    const progress = calculateModelScopeProgress(status.taskStatus, attempts);
                    onProgress?.(progress, `ModelScope ${status.taskStatus}`);

                    if (status.taskStatus === "SUCCEED") {
                        if (status.outputImages.length > 0) {
                            onProgress?.(100, "生成完成！");
                            return {
                                success: true,
                                imageUrl: status.outputImages[0],
                                generateUuid: taskId,
                                statusDescription: `ModelScope ${status.taskStatus}`,
                                percentCompleted: 100,
                            };
                        }
                        throw new Error("ModelScope 返回成功状态，但没有生成图片");
                    }

                    if (status.taskStatus === "FAILED") {
                        throw new Error(`生成失败: ${status.errorMessage || "ModelScope 任务失败"}`);
                    }

                    attempts++;
                    if (attempts < maxAttempts) {
                        await new Promise(resolve => setTimeout(resolve, interval));
                    }
                }

                throw new Error("生成超时: ModelScope 达到最大轮询次数");
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
