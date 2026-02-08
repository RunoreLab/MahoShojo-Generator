export interface ModelScopeGenerateOptions {
  model?: string;
}

export interface ModelScopeTaskStatus {
  taskId: string;
  taskStatus: string;
  outputImages: string[];
  errorMessage?: string;
}

const readErrorFromResponse = async (response: Response): Promise<string> => {
  const payload = await response.json().catch(() => null);
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const candidates = [record.error, record.message, record.msg, record.detail];
    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim();
      }
    }
  }
  return `HTTP error! status: ${response.status}`;
};

export const generateModelScopeText2Image = async (
  modelscopeToken: string,
  prompt: string,
  options?: ModelScopeGenerateOptions,
): Promise<string> => {
  const response = await fetch("/api/tachie/generate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "modelscope",
      modelscopeToken,
      prompt,
      modelscopeModel: options?.model,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response));
  }

  const payload = await response.json();
  if (!payload || typeof payload !== "object") {
    throw new Error("ModelScope 返回结果异常");
  }

  const record = payload as Record<string, unknown>;
  const data = record.data;
  if (!data || typeof data !== "object") {
    throw new Error("ModelScope 返回任务 ID 为空");
  }

  const taskId = (data as Record<string, unknown>).generateUuid;
  if (typeof taskId !== "string" || !taskId.trim()) {
    throw new Error("ModelScope 返回任务 ID 为空");
  }

  return taskId.trim();
};

export const getModelScopeTaskStatus = async (
  modelscopeToken: string,
  taskId: string,
): Promise<ModelScopeTaskStatus> => {
  const response = await fetch("/api/tachie/status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      source: "modelscope",
      modelscopeToken,
      generateUuid: taskId,
    }),
  });

  if (!response.ok) {
    throw new Error(await readErrorFromResponse(response));
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
