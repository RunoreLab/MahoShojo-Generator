// LibLib API 响应类型定义

// 生图状态枚举
export enum GenerateStatus {
  WAITING = 1,      // 等待执行
  PROCESSING = 2,   // 执行中
  GENERATED = 3,    // 已生图
  AUDITING = 4,     // 审核中
  SUCCESS = 5,      // 成功
  FAILED = 6,       // 失败
  TIMEOUT = 7       // 超时
}

export const getStatusDescription = (status: number): string => {
  switch (status) {
    case GenerateStatus.WAITING: return "等待执行";
    case GenerateStatus.PROCESSING: return "执行中";
    case GenerateStatus.GENERATED: return "已生图";
    case GenerateStatus.AUDITING: return "审核中";
    case GenerateStatus.SUCCESS: return "成功";
    case GenerateStatus.FAILED: return "失败";
    case GenerateStatus.TIMEOUT: return "超时";
    default: return `未知状态: ${status}`;
  }
};

export interface GenerateResponse {
  code: number;
  msg: string;
  data: {
    generateUuid: string;
  };
}

export interface StatusResponse {
  code: number;
  msg: string;
  data: {
    generateUuid: string;
    generateStatus: number;
    percentCompleted: number;
    generateMsg: string;
    pointsCost: number;
    accountBalance: number;
    images: Array<{
      imageUrl: string;
      seed: number;
      auditStatus: number;
    }>;
  };
}

export interface GenerateParams {
  templateUuid?: string;
  generateParams: {
    checkPointId: string;
    prompt?: string;
    negativePrompt?: string;
    sampler: number;
    steps: number;
    cfgScale: number;
    width: number;
    height: number;
    imgCount: number;
    randnSource: number;
    seed: number;
    restoreFaces: number;
    additionalNetwork?: Array<{
      modelId: string;
      weight: number;
    }>;
    hiResFixInfo?: {
      hiresSteps: number;
      hiresDenoisingStrength: number;
      upscaler: number;
      resizedWidth: number;
      resizedHeight: number;
    };
  };
}

export interface ComfyUIAppParams {
  workflowUuid?: string;
  [key: string]: unknown;
}
