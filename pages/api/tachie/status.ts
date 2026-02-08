import { getSignedUrl } from "@/lib/tachie/liblib/utils";
import type { StatusResponse } from "@/lib/tachie/liblib/types";

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

  const payload = await req.json();
  const sourceRaw = typeof payload?.source === "string" ? payload.source.trim().toLowerCase() : "";
  const source = sourceRaw === "modelscope" ? "modelscope" : "liblib";

  try {
    if (source === "modelscope") {
      const modelscopeToken = typeof payload?.modelscopeToken === "string" ? payload.modelscopeToken.trim() : "";
      const taskIdRaw = typeof payload?.generateUuid === "string" ? payload.generateUuid.trim() : "";

      if (!modelscopeToken || !taskIdRaw) {
        return new Response(
          JSON.stringify({ error: "Missing required parameters" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      const response = await fetch(`https://api-inference.modelscope.cn/v1/tasks/${encodeURIComponent(taskIdRaw)}`, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${modelscopeToken}`,
          "Content-Type": "application/json",
          "X-ModelScope-Task-Type": "image_generation",
        },
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

      const taskStatusRaw = upstream.task_status;
      const taskStatus = typeof taskStatusRaw === "string" ? taskStatusRaw.trim().toUpperCase() : "UNKNOWN";
      const outputImagesRaw = upstream.output_images;
      const outputImages = Array.isArray(outputImagesRaw)
        ? outputImagesRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        : [];

      const errorMessageRaw = upstream.message;
      const errorMessage = typeof errorMessageRaw === "string" ? errorMessageRaw : undefined;

      return new Response(JSON.stringify({
        taskStatus,
        outputImages,
        ...(errorMessage ? { errorMessage } : {}),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { accessKey, secretKey, generateUuid } = payload;
    if (!accessKey || !secretKey || !generateUuid) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const endpoint = "/api/generate/comfy/status";
    const signedUrl = await getSignedUrl(accessKey, secretKey, endpoint);

    const response = await fetch(signedUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ generateUuid }),
    });

    if (!response.ok) {
      return new Response(
        JSON.stringify({ error: `LibLib API error: ${response.status}` }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
      );
    }

    const result: StatusResponse = await response.json();

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
    console.error("Status API error:", error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : "Internal server error"
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
