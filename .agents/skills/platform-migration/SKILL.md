---
name: platform-migration
description: Use for platform-rearchitecture, runtime migration, hosted/local routing changes, storage/session/DR migrations, or staged movement between old and new application boundaries in MahoShojo-Generator. Do not use for isolated feature work inside one already-stable runtime.
---

# Platform Migration

## Workflow

1. Read `docs/AGENTS.md`, `docs/README.md`, the relevant topic page, accepted architecture/ADR/spec, migration plan and current code/CI facts.
2. Write down current state, target state and the exact migration gap. Do not describe target architecture as already deployed.
3. Preserve trust boundaries and compatibility while moving one coherent seam at a time. Prefer adapters/versioned contracts over hidden app→app coupling.
4. For stateful components, reason explicitly about ownership, idempotency, retries, fencing, failover, rollback and old/new coexistence.
5. Keep feature flags/configuration from becoming a way to bypass accepted MUST/MUST NOT semantics.
6. Validate the migrated seam with targeted tests and realistic recovery/failure cases. Expand to cross-runtime/full verification at cutover-level boundaries.
7. Update migration/topic/status documentation when actual state changes; do not rewrite historical reports to manufacture consistency.

## High-risk boundary

Production deploy/cutover, remote migration, secret changes and irreversible data operations require explicit user authorization even if the implementation is ready.
