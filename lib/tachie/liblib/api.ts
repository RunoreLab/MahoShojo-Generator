import type { GenerateResponse, StatusResponse } from "./types";
import { GenerateStatus, getStatusDescription } from "./types";
import { readJsonOrTextFromResponse, resolveApiErrorMessage } from "@/lib/client/apiError";
import { formatHttpErrorMessage } from "@/lib/client/httpError";

export type LibLibTachieMode = 'tachie' | 'illustration';

export type LibLibTachieGenerateOptions = {
  mode?: LibLibTachieMode;
  workflowUuid?: string;
  templateUuid?: string;
  promptNodeId?: number;
  negativePrompt?: string;
  negativePromptNodeId?: number;
};

const readErrorFromResponse = async (response: Response, fallback: string): Promise<string> => {
  const { payload } = await readJsonOrTextFromResponse(response);
  const serverMessage = resolveApiErrorMessage({ payload, fallback });
  return formatHttpErrorMessage({ serverMessage, status: response.status, fallback });
};

/**
 * 文生图接口 - 提交生图任务
 * @param accessKey LibLib Access Key
 * @param secretKey LibLib Secret Key
 * @param prompt 提示词
 * @param options 可选：模式/工作流/节点参数（用于不同工作流与插画生成）
 * @returns 生图任务UUID
 */
export const generateText2Image = async (
  accessKey: string,
  secretKey: string,
  prompt: string,
  options?: LibLibTachieGenerateOptions
): Promise<string> => {
  const response = await fetch("/api/tachie/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessKey,
      secretKey,
      prompt,
      ...(options && typeof options === 'object' ? options : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response, 'LibLib 立绘生成失败'));
  }

  const result: GenerateResponse = await response.json();
  const generateUuid = result?.data?.generateUuid;
  if (typeof generateUuid !== 'string' || !generateUuid.trim()) {
    throw new Error('LibLib 返回任务 ID 为空');
  }
  return generateUuid.trim();
};

/**
 * 查询生图结果
 * @param accessKey LibLib Access Key  
 * @param secretKey LibLib Secret Key
 * @param generateUuid 生图任务UUID
 * @returns 生图状态和结果
 */
export const getGenerateStatus = async (
  accessKey: string,
  secretKey: string,
  generateUuid: string
): Promise<StatusResponse["data"]> => {
  const response = await fetch("/api/tachie/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      accessKey,
      secretKey,
      generateUuid,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response, 'LibLib 任务状态查询失败'));
  }

  const result: StatusResponse = await response.json();
  if (!result || typeof result !== 'object' || !result.data || typeof result.data !== 'object') {
    throw new Error('LibLib 任务状态返回异常');
  }
  return result.data;
};

/**
 * 轮询等待生图完成
 * @param accessKey LibLib Access Key
 * @param secretKey LibLib Secret Key
 * @param generateUuid 生图任务UUID  
 * @param maxAttempts 最大轮询次数，默认30次
 * @param interval 轮询间隔(ms)，默认15秒
 * @returns 最终生图结果
 */
export const waitForGeneration = async (
  accessKey: string,
  secretKey: string,
  generateUuid: string,
  maxAttempts: number = 30,
  interval: number = 15000
): Promise<StatusResponse["data"]> => {
  let attempts = 0;

  while (attempts < maxAttempts) {
    const status = await getGenerateStatus(accessKey, secretKey, generateUuid);

    // 根据状态判断是否完成或失败
    switch (status.generateStatus) {
      case GenerateStatus.SUCCESS:
        return status;

      case GenerateStatus.FAILED:
        throw new Error(`生成失败: ${status.generateMsg || getStatusDescription(status.generateStatus)}`);

      case GenerateStatus.TIMEOUT:
        throw new Error(`生成超时: ${status.generateMsg || "任务创建30分钟后超时"}`);

      case GenerateStatus.WAITING:
      case GenerateStatus.PROCESSING:
      case GenerateStatus.GENERATED:
      case GenerateStatus.AUDITING:
        // 继续等待
        break;

      default:
        // 未知状态，也继续等待
        console.warn(`未知生成状态: ${status.generateStatus}`);
    }

    attempts++;
    await new Promise(resolve => setTimeout(resolve, interval));
  }

  throw new Error("生成超时: 达到最大轮询次数");
};

/**
 * 根据生成状态计算进度百分比
 * @param status 生成状态
 * @param attempts 尝试次数
 * @returns 进度百分比 (0-100)
 */
export const calculateProgress = (status: number, attempts: number = 0): number => {
  switch (status) {
    case GenerateStatus.WAITING:
      return Math.min(10 + attempts * 2, 30);
    case GenerateStatus.PROCESSING:
      return Math.min(30 + attempts * 5, 80);
    case GenerateStatus.GENERATED:
      return 85;
    case GenerateStatus.AUDITING:
      return 90;
    case GenerateStatus.SUCCESS:
      return 100;
    default:
      return Math.min(attempts * 2, 50);
  }
};
