# Repository Guidelines

## Project Structure & Module Organization
- `pages/` exposes Next.js routes (`index.tsx`, `name.tsx`, `details.tsx`, `battle.tsx`, etc.) and API handlers under `pages/api/`.
- Reusable cards and modals live in `components/`; keep heavy logic near the route that owns it.
- AI plumbing sits in `lib/` (`ai.ts`, `config.ts`, `signature.ts`), shared types in `types/arena.d.ts`, assets in `public/`, global styles in `styles/`, utilities in `scripts/`, and fixtures/tests in `tests/`.

## Build, Test, and Development Commands
- `bun install` (or `npm install`) syncs dependencies; Bun is the preferred runtime for scripts and CI.
- `bun run dev` launches the Turbopack dev server on `http://localhost:3000`; `bun run build` + `bun run start` create and serve production bundles.
- `bun run preview` mirrors the Cloudflare Pages flow, `bun run lint` applies Next/ESLint rules, and `bun test` / `bun test --watch` execute Bun’s test runner.
- You need to run `bun run lint` to validate your code before commit.

## Coding Style & Naming Conventions
- TypeScript compilation is `strict`; export React 19 function components with PascalCase filenames and avoid anonymous defaults unless required.
- Favor `camelCase` helpers and descriptive enums for magical-girl states; `any` is permitted but document why when you use it.
- Import through the `@/*` alias instead of deep relative paths, and extend layout with Tailwind 4 utilities plus the shared gradient CSS.

## Testing Guidelines
- Add suites in `tests/` with the `*.test.ts` pattern (use `.test.js` only when exercising legacy code) and reuse fixtures like `tests/test.json`.
- Keep randomness deterministic—follow `tests/getWeightedRandomFromSeed.test.js` by seeding helpers and asserting on probabilities, not raw samples.
- Run `bun test` before each PR and call out meaningful logs or deltas in the PR description; mirror schema changes with updated fixtures and types.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes (`feat:`, `fix:`, `chore:`); the existing history mixes English/Chinese bodies after the prefix.
- Keep commits focused (UI, API, content) and avoid bundling generated JSON or assets with logic changes.
- PRs should outline scope, include screenshots or GIFs for UI updates, list commands executed (dev, lint, test), and flag new env vars or scripts while tagging the relevant owners.

## Environment & Configuration Tips
- Copy `env.example` to `.env.local`, provide provider credentials, and mirror advanced setups with `config/ai-providers.example.json`.
- Review `docs/DEPLOY.md` and `wrangler.toml` before Cloudflare Pages releases; run badge or content scripts via `bun tsx scripts/<name>.ts`.
- Store generated card exports outside Git and update `.gitignore` if new output folders appear.
