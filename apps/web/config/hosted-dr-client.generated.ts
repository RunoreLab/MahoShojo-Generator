// 此文件由 config/hosted-dr-capabilities.json 生成，请勿手工编辑。
export const hostedDrStableOrigin = "https://api.mahoshojo.colanns.me" as const;
export const hostedDrPreviewOrigin = "https://homura-preview.colanns.me" as const;
export const hostedDrControlPlaneProvisioning = "not-provisioned" as const;
export const hostedDrProductionFallbackReadiness = "deferred" as const;
export const hostedDrClientRouting = {
  "defaultMode": "client-preflight",
  "managedControlPlane": "optional-disabled",
  "primaryOrigin": "https://homura.colanns.me",
  "drOrigin": "https://mahoshojo.colanns.me",
  "primaryProbePath": "/api/health/ready",
  "drProbePath": "/api/hosted/dr-readiness",
  "preflightTimeoutMs": 1500,
  "contractVersion": "g25e1-v1"
} as const;
export const hostedDrClientOperations = [
  {
    "route": "/api/arena/generate",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "fail-closed",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/arena/generate-stream",
    "method": "DELETE",
    "requestClass": "durably-idempotent-command",
    "drMode": "fail-closed",
    "replayPolicy": "operation-id-required",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/arena/generate-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "fail-closed",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/arena/generation-requests/[generationRequestId]",
    "method": "GET",
    "requestClass": "safe-read",
    "drMode": "safe-read",
    "replayPolicy": "safe-read-only",
    "contractStatus": "verified"
  },
  {
    "route": "/api/arena/generations/[generationId]",
    "method": "GET",
    "requestClass": "safe-read",
    "drMode": "safe-read",
    "replayPolicy": "safe-read-only",
    "contractStatus": "verified"
  },
  {
    "route": "/api/arena/generations/[generationId]/cancel",
    "method": "POST",
    "requestClass": "durably-idempotent-command",
    "drMode": "fail-closed",
    "replayPolicy": "operation-id-required",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/arena/generations/[generationId]/stream",
    "method": "GET",
    "requestClass": "safe-read",
    "drMode": "safe-read",
    "replayPolicy": "safe-read-only",
    "contractStatus": "verified"
  },
  {
    "route": "/api/arena/repair-combatant-meta",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "fail-closed",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/arena/session/generate-next",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "fail-closed",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/creator/generate",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/creator/generate-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-battle-story",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "fail-closed",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "fail-closed-verified"
  },
  {
    "route": "/api/generate-canshou",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-canshou-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-free",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-free-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-game-card",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-magical-girl",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-magical-girl-details",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-magical-girl-details-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-scenario",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-scenario-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-sublimation",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/generate-sublimation-stream",
    "method": "POST",
    "requestClass": "non-idempotent-operation",
    "drMode": "new-request-only",
    "replayPolicy": "never-after-dispatch",
    "contractStatus": "verified"
  },
  {
    "route": "/api/hosted/dr-readiness",
    "method": "GET",
    "requestClass": "safe-read",
    "drMode": "safe-read",
    "replayPolicy": "safe-read-only",
    "contractStatus": "verified"
  },
  {
    "route": "/api/hosted/dr-readiness",
    "method": "HEAD",
    "requestClass": "safe-read",
    "drMode": "safe-read",
    "replayPolicy": "safe-read-only",
    "contractStatus": "verified"
  }
] as const;
