---
name: release-readiness
description: Use when preparing or reviewing a MahoShojo-Generator version release, release candidate, changelog/docs readiness, deployment impact, migration notes, or final pre-release verification. Do not use for ordinary feature implementation before release preparation begins.
---

# Release Readiness

## Workflow

1. Resolve the target version/branch and inspect current manifests, CI, release/deployment workflows and relevant accepted specs.
2. Build a release delta from actual commits/code rather than from memory or old announcements.
3. Check user-facing docs, changelog/release notes, configuration/env changes, migrations, compatibility, rollback and operational impact.
4. Verify that headline features have appropriate tests and that known limitations are described without overstating completion.
5. Run the repository's current release/verification commands that are proportionate to the release scope. Reuse existing CI evidence when valid rather than rerunning expensive checks mechanically.
6. Separate "code is release-ready" from actual publishing. Do not create tags, GitHub releases, deploy production or rotate secrets without explicit authorization.

## Output

Report blockers, required release notes/migrations, checks actually run, checks inherited from CI, and any manual/external validation still pending.
