import { readJsonOrTextFromResponse, resolveApiErrorMessage } from "@/lib/client/apiError";
import { formatHttpErrorMessage } from "@/lib/client/httpError";
import { normalizeModelScopeToken } from "@/lib/tachie/modelscope/error";

export interface ModelScopeGenerateOptions {
  model?: string;
  size?: string;
}

export interface ModelScopeTaskStatus {
  taskId: string;
  taskStatus: string;
  outputImages: string[];
  errorMessage?: string;
}

const readErrorFromResponse = async (response: Response, fallback: string): Promise<string> => {
  const { payload } = await readJsonOrTextFromResponse(response);
  const serverMessage = resolveApiErrorMessage({ payload, fallback });
  return formatHttpErrorMessage({ serverMessage, status: response.status, fallback });
};

export const generateModelScopeText2Image = async (
  modelscopeToken: string,
  prompt: string,
  options?: ModelScopeGenerateOptions,
): Promise<string> => {
  const token = normalizeModelScopeToken(modelscopeToken);
  if (!token) {
    throw new Error("ModelScope Token 不能为空，请粘贴有效 Token（支持自动去除 Bearer 前缀）");
  }

  const response = await fetch("/api/tachie/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "modelscope",
      modelscopeToken: token,
      prompt,
      modelscopeModel: options?.model,
      modelscopeSize: options?.size,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response, "ModelScope 立绘生成失败"));
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("ModelScope 返回结果异常");
  }

  const record = payload as Record<string, unknown>;
  const data = record.data && typeof record.data === "object"
    ? (record.data as Record<string, unknown>)
    : null;

  if (!data) {
    throw new Error("ModelScope 返回任务 ID 为空");
  }

  const taskId = data.generateUuid;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("ModelScope 返回任务 ID 为空");
  }

  return taskId.trim();
};

export const getModelScopeTaskStatus = async (
  modelscopeToken: string,
  taskId: string,
): Promise<ModelScopeTaskStatus> => {
  const token = normalizeModelScopeToken(modelscopeToken);
  if (!token) {
    throw new Error("ModelScope Token 不能为空，请粘贴有效 Token（支持自动去除 Bearer 前缀）");
  }

  const response = await fetch("/api/tachie/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "modelscope",
      modelscopeToken: token,
      generateUuid: taskId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response, "ModelScope 任务状态查询失败"));
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("ModelScope 任务状态返回异常");
  }

  const record = payload as Record<string, unknown>;
  const taskStatus = record.taskStatus;
  if (typeof taskStatus !== "string" || !taskStatus.trim()) {
    throw new Error("ModelScope 任务状态缺失");
  }

  const outputImagesRaw = record.outputImages;
  const outputImages = Array.isArray(outputImagesRaw)
    ? outputImagesRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  const errorMessage = typeof record.errorMessage === "string" ? record.errorMessage : undefined;

  return {
    taskId,
    taskStatus: taskStatus.trim().toUpperCase(),
    outputImages,
    ...(errorMessage ? { errorMessage } : {}),
  };
};
