import { getSignedUrl } from "@/lib/tachie/liblib/utils";
import type { GenerateResponse, ComfyUIAppParams } from "@/lib/tachie/liblib/types";

export const config = {
  runtime: 'edge',
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
  const { accessKey, secretKey, prompt } = payload ?? {};

  if (!accessKey || !secretKey || !prompt) {
    return new Response(
      JSON.stringify({ error: "Missing required parameters" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
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
