import { withPagesApiResponse } from '@/lib/pages-api-adapter';
import { getSignedUrl } from "@/lib/tachie/liblib/utils";
import type { GenerateResponse, ComfyUIAppParams } from "@/lib/tachie/liblib/types";
import {
  buildLibLibErrorPayload,
  extractLibLibCode,
  inferLibLibHttpStatus,
  parseLibLibJsonSafe,
} from "@/lib/tachie/liblib/error";
import {
  buildModelScopeErrorPayload,
  extractModelScopeTaskId,
  normalizeModelScopeToken,
  parseModelScopeJsonSafe,
} from "@/lib/tachie/modelscope/error";

async function handler(req: Request) {
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

  const MODELSCOPE_SIZE_WHITELIST = new Set([
    "928x1664",
    "1664x928",
    "1328x1328",
    "1104x1472",
    "1472x1104",
  ]);

  try {
    const payloadRaw = await req.json().catch(() => null);
    const payload = payloadRaw && typeof payloadRaw === "object"
      ? (payloadRaw as Record<string, unknown>)
      : {};

    const sourceRaw = typeof payload.source === "string" ? payload.source.trim().toLowerCase() : "";
    const source = sourceRaw === "modelscope" ? "modelscope" : "liblib";

    if (source === "modelscope") {
      const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
      const modelscopeToken = normalizeModelScopeToken(payload.modelscopeToken);
      const modelscopeModelRaw = typeof payload.modelscopeModel === "string" ? payload.modelscopeModel.trim() : "";
      const modelscopeModel = modelscopeModelRaw || "Stonego/XiabanmostyleV3";
      const modelscopeSizeRaw = typeof payload.modelscopeSize === "string" ? payload.modelscopeSize.trim() : "";
      const modelscopeSize = MODELSCOPE_SIZE_WHITELIST.has(modelscopeSizeRaw) ? modelscopeSizeRaw : "1328x1328";

      if (!prompt) {
        return new Response(
          JSON.stringify({ error: "缺少提示词：prompt 不能为空" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!modelscopeToken) {
        return new Response(
          JSON.stringify({ error: "缺少 ModelScope Token（可直接粘贴 Token，本系统会自动处理 Bearer 前缀）" }),
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
          size: modelscopeSize,
        }),
      });

      const raw = await response.text();
      const upstream = parseModelScopeJsonSafe(raw);

      if (!response.ok) {
        return new Response(
          JSON.stringify(buildModelScopeErrorPayload({
            status: response.status,
            payload: upstream,
            requestIdHeader: response.headers.get("x-request-id"),
          })),
          { status: response.status, headers: { "Content-Type": "application/json" } },
        );
      }

      const taskId = extractModelScopeTaskId(upstream);
      if (!taskId) {
        return new Response(
          JSON.stringify(buildModelScopeErrorPayload({
            status: 502,
            payload: upstream,
            fallbackError: "ModelScope 返回结果异常：缺少 task_id",
            requestIdHeader: response.headers.get("x-request-id"),
          })),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response(JSON.stringify({
        code: 0,
        msg: "success",
        data: {
          generateUuid: taskId,
        },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessKey = typeof payload.accessKey === "string" ? payload.accessKey.trim() : "";
    const secretKey = typeof payload.secretKey === "string" ? payload.secretKey.trim() : "";
    const prompt = typeof payload.prompt === "string" ? payload.prompt.trim() : "";
    if (!accessKey || !secretKey || !prompt) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const modeRaw = typeof payload.mode === 'string' ? payload.mode.trim() : '';
    const mode = modeRaw === 'illustration' ? 'illustration' : 'tachie';

    const preset = DEFAULT_WORKFLOWS[mode];
    const workflowUuid = isLibLibUuid(payload.workflowUuid) ? payload.workflowUuid.trim() : preset.workflowUuid;
    const templateUuid = isLibLibUuid(payload.templateUuid) ? payload.templateUuid.trim() : preset.templateUuid;
    const promptNodeId = parseNodeId(payload.promptNodeId) ?? preset.promptNodeId;

    const negativePrompt = typeof payload.negativePrompt === 'string' ? payload.negativePrompt.trim() : '';
    const negativePromptNodeId = parseNodeId(payload.negativePromptNodeId);

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

    const raw = await response.text();
    const upstream = parseLibLibJsonSafe(raw);

    if (!response.ok) {
      return new Response(
        JSON.stringify(buildLibLibErrorPayload({
          status: response.status,
          payload: upstream,
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const code = extractLibLibCode(upstream);
    if (code === null) {
      return new Response(
        JSON.stringify(buildLibLibErrorPayload({
          status: 502,
          payload: upstream,
          fallbackError: "LibLib 返回结果异常：缺少 code",
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    if (code !== 0) {
      const status = inferLibLibHttpStatus(code, 400);
      return new Response(
        JSON.stringify(buildLibLibErrorPayload({
          status,
          payload: upstream,
          fallbackError: "LibLib 立绘任务提交失败",
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = upstream as Partial<GenerateResponse>;
    const generateUuidRaw = result.data && typeof result.data === "object"
      ? (result.data as Record<string, unknown>).generateUuid
      : null;
    const generateUuid = typeof generateUuidRaw === "string" ? generateUuidRaw.trim() : "";

    if (!generateUuid) {
      return new Response(
        JSON.stringify(buildLibLibErrorPayload({
          status: 502,
          payload: upstream,
          fallbackError: "LibLib 返回结果异常：缺少 generateUuid",
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status: 502, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({
      code: 0,
      msg: "success",
      data: {
        generateUuid,
      },
    }), {
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

export default withPagesApiResponse(handler);
