---
name: code-review
description: Use when reviewing MahoShojo-Generator code, a branch, commit range, pull request, or implementation against current behavior and accepted ADR/spec requirements. Do not use when the primary request is to implement a known fix.
---

# Code Review

## Review priorities

Find behavior, security, data, compatibility and migration regressions. Lint/format problems that CI can mechanically report are not primary findings unless they reveal a deeper defect.

## Workflow

1. Resolve the actual target branch/commit range and current repository facts before comparing with docs.
2. Read `docs/AGENTS.md`, `docs/README.md`, the relevant topic page, and applicable accepted ADR/spec only for the affected domain.
3. Check especially:
   - accepted MUST/MUST NOT requirements;
   - illegal app→app, package→app, cross-runtime deep imports, or client→server-secret dependencies;
   - credential leakage, increased client trust, or server-authority bypass;
   - API/DTO/schema/wire changes without synchronized producer/consumer/adapter/compatibility tests;
   - migrations, release, secrets, permissions or cutover paths missing fail-closed behavior, rollback, idempotency or auditability;
   - tests that prove only compilation/happy path while missing the actual regression risk.
4. Report findings ordered by severity with file/behavior evidence, impact, and a concrete closure criterion.
5. Distinguish confirmed defects from design questions and optional cleanup. Do not inflate style preferences into blockers.

## Verdict

When useful, end with an overall `Block`, `Changes required`, or `Looks good with minor follow-ups` assessment tied to the requested scope.
