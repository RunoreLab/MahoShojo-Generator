import { getSignedUrl } from "@/lib/tachie/liblib/utils";
import type { GenerateResponse, ComfyUIAppParams } from "@/lib/tachie/liblib/types";

export const config = {
  runtime: 'edge',
};

const parseJsonSafe = (raw: string): Record<string, unknown> => {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
};

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  const DEFAULT_WORKFLOWS = {
    tachie: {
      workflowUuid: "34fed183375249dfbe293fa99d753cc5",
      templateUuid: "4df2efa0f18d46dc9758803e478eb51c",
      promptNodeId: 105,
    },
    illustration: {
      workflowUuid: "34fed183375249dfbe293fa99d753cc5",
      templateUuid: "4df2efa0f18d46dc9758803e478eb51c",
      promptNodeId: 105,
    },
  } as const;

  const isLibLibUuid = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{32}$/i.test(value.trim());
  const parseNodeId = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      const id = Math.floor(value);
      if (id >= 1 && id <= 9999) return id;
      return null;
    }
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (!trimmed) return null;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) return null;
      const id = Math.floor(num);
      if (id >= 1 && id <= 9999) return id;
      return null;
    }
    return null;
  };

  const payload = await req.json();
  const sourceRaw = typeof payload?.source === "string" ? payload.source.trim().toLowerCase() : "";
  const source = sourceRaw === "modelscope" ? "modelscope" : "liblib";

  try {
    if (source === "modelscope") {
      const prompt = typeof payload?.prompt === "string" ? payload.prompt.trim() : "";
      const modelscopeToken = typeof payload?.modelscopeToken === "string" ? payload.modelscopeToken.trim() : "";
      const modelscopeModelRaw = typeof payload?.modelscopeModel === "string" ? payload.modelscopeModel.trim() : "";
      const modelscopeModel = modelscopeModelRaw || "Stonego/XiabanmostyleV3";

      if (!modelscopeToken || !prompt) {
        return new Response(
          JSON.stringify({ error: "Missing required parameters" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const response = await fetch("https://api-inference.modelscope.cn/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${modelscopeToken}`,
          "Content-Type": "application/json",
          "X-ModelScope-Async-Mode": "true",
        },
        body: JSON.stringify({
          model: modelscopeModel,
          prompt,
        }),
      });

      const raw = await response.text();
      const upstream = parseJsonSafe(raw);

      if (!response.ok) {
        const messageCandidates = [upstream.message, upstream.msg, upstream.error, upstream.detail];
        const message = messageCandidates.find((item): item is string => typeof item === "string" && item.trim().length > 0);
        return new Response(
          JSON.stringify({ error: message || `ModelScope API error: ${response.status}` }),
          { status: response.status, headers: { "Content-Type": "application/json" } },
        );
      }

      const taskId = upstream.task_id;
      if (typeof taskId !== "string" || !taskId.trim()) {
        return new Response(
          JSON.stringify({ error: "ModelScope API error: task_id missing" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          generateUuid: taskId.trim(),
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { accessKey, secretKey, prompt } = payload ?? {};
    if (!accessKey || !secretKey || !prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const modeRaw = typeof payload?.mode === 'string' ? payload.mode.trim() : '';
    const mode = modeRaw === 'illustration' ? 'illustration' : 'tachie';

    const preset = DEFAULT_WORKFLOWS[mode];
    const workflowUuid = isLibLibUuid(payload?.workflowUuid) ? payload.workflowUuid.trim() : preset.workflowUuid;
    const templateUuid = isLibLibUuid(payload?.templateUuid) ? payload.templateUuid.trim() : preset.templateUuid;
    const promptNodeId = parseNodeId(payload?.promptNodeId) ?? preset.promptNodeId;

    const negativePrompt = typeof payload?.negativePrompt === 'string' ? payload.negativePrompt.trim() : '';
    const negativePromptNodeId = parseNodeId(payload?.negativePromptNodeId);

    const endpoint = "/api/generate/comfyui/app";
    const signedUrl = await getSignedUrl(accessKey, secretKey, endpoint);

    // 预设参数
    const generateParams: ComfyUIAppParams = {
      [String(promptNodeId)]: {
        class_type: "CLIPTextEncode",
        inputs: {
          text: prompt
        }
      },
      ...(negativePrompt && negativePromptNodeId
        ? {
            [String(negativePromptNodeId)]: {
              class_type: "CLIPTextEncode",
              inputs: {
                text: negativePrompt
              }
            }
          }
        : {}),
      workflowUuid
    };
    const response = await fetch(signedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        templateUuid,
        generateParams: generateParams
      }),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `LibLib API error: ${response.status}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const result: GenerateResponse = await response.json();

    if (result.code !== 0) {
      return new Response(
        JSON.stringify({ error: `LibLib API error: ${result.msg}` }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  } catch (error) {
    console.error("Generate API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
