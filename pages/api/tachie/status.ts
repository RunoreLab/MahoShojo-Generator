import { getSignedUrl } from "@/lib/tachie/liblib/utils";
import type { StatusResponse } from "@/lib/tachie/liblib/types";
import {
  buildLibLibErrorPayload,
  extractLibLibCode,
  inferLibLibHttpStatus,
  parseLibLibJsonSafe,
} from "@/lib/tachie/liblib/error";
import {
  buildModelScopeErrorPayload,
  extractModelScopeMessage,
  extractModelScopeOutputImages,
  extractModelScopeTaskStatus,
  normalizeModelScopeToken,
  parseModelScopeJsonSafe,
} from "@/lib/tachie/modelscope/error";

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const payloadRaw = await req.json().catch(() => null);
    const payload = payloadRaw && typeof payloadRaw === "object"
      ? (payloadRaw as Record<string, unknown>)
      : {};

    const sourceRaw = typeof payload.source === "string" ? payload.source.trim().toLowerCase() : "";
    const source = sourceRaw === "modelscope" ? "modelscope" : "liblib";

    if (source === "modelscope") {
      const modelscopeToken = normalizeModelScopeToken(payload.modelscopeToken);
      const taskIdRaw = typeof payload.generateUuid === "string" ? payload.generateUuid.trim() : "";

      if (!taskIdRaw) {
        return new Response(
          JSON.stringify({ error: "缺少任务 ID：generateUuid 不能为空" }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        );
      }

      if (!modelscopeToken) {
        return new Response(
          JSON.stringify({ error: "缺少 ModelScope Token（可直接粘贴 Token，本系统会自动处理 Bearer 前缀）" }),
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

      const taskStatus = extractModelScopeTaskStatus(upstream) ?? "UNKNOWN";
      const outputImages = extractModelScopeOutputImages(upstream);
      const message = extractModelScopeMessage(upstream);
      const messageLower = message?.toLowerCase();
      const hasMeaningfulMessage = Boolean(
        message
        && messageLower
        && messageLower !== "success"
        && messageLower !== "ok",
      );

      return new Response(JSON.stringify({
        taskStatus,
        outputImages,
        ...(hasMeaningfulMessage ? { errorMessage: message } : {}),
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessKey = typeof payload.accessKey === "string" ? payload.accessKey.trim() : "";
    const secretKey = typeof payload.secretKey === "string" ? payload.secretKey.trim() : "";
    const generateUuid = typeof payload.generateUuid === "string" ? payload.generateUuid.trim() : "";
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
          fallbackError: "LibLib 立绘状态查询失败",
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status, headers: { "Content-Type": "application/json" } }
      );
    }

    const result = upstream as Partial<StatusResponse>;
    const hasData = result.data && typeof result.data === "object";
    if (!hasData) {
      return new Response(
        JSON.stringify(buildLibLibErrorPayload({
          status: 502,
          payload: upstream,
          fallbackError: "LibLib 返回结果异常：缺少 data",
          requestIdHeader: response.headers.get("x-request-id"),
        })),
        { status: 502, headers: { "Content-Type": "application/json" } }
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
