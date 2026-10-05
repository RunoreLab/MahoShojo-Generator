---
name: api-contract-change
description: Use when changing API/DTO/schema/wire-format contracts, SSE/event payloads, shared protocol packages, or producer/consumer mappings across MahoShojo-Generator runtimes. Do not use for implementation-only changes that preserve the existing contract.
---

# API Contract Change

## Workflow

1. Locate the canonical schema/contract and applicable accepted ADR/spec from the relevant docs topic.
2. Enumerate every producer, consumer, mapper/adapter, persistence/replay path, public projection and compatibility test before editing.
3. Separate internal telemetry/server fields from public client contracts; do not leak server-only authority or secrets through a convenience projection.
4. Decide compatibility behavior explicitly: additive/backward-compatible, versioned, migration required, or intentionally breaking.
5. Modify the canonical contract first, then synchronize producers/consumers and regenerate derived artifacts using existing repo tools.
6. Add regression coverage at the boundary that previously allowed drift, including replay/reconnect paths when the protocol supports them.
7. Run targeted contract/runtime tests first; expand to workspace/global verification only when shared boundaries changed.

## Stop / ask

Ask only when the desired breaking/compatibility policy is genuinely unresolved by current accepted docs or when production migration/cutover authorization is required.
