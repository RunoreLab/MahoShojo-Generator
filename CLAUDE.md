# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MahoShojo-Generator (魔法少女生成器) is a Magical Girl Generator - an AI-powered web application that creates personalized magical girl characters. Built with Next.js 15, React 19, pnpm-managed TypeScript tooling, and Vitest for tests, it features a mobile-friendly design with a whimsical, magical theme.

## Commands

### Development
```bash
pnpm dev         # Start development server with Turbopack
pnpm build       # Build for production
pnpm start       # Start production server
pnpm lint        # Run ESLint
pnpm test        # Run Vitest tests
```

### Environment Setup
Create a `.env.local` file based on `env.example` with:
- `NEXT_PUBLIC_AI_API_KEY`: OpenAI API key
- `NEXT_PUBLIC_AI_BASE_URL`: API endpoint (optional, defaults to OpenAI)
- `NEXT_PUBLIC_AI_MODEL`: AI model (optional, defaults to gpt-3.5-turbo)

## Architecture

### Hybrid Routing Structure
The project uses both `pages/` (traditional) and `app/` (App Router) directories:
- Main application logic is in `pages/index.tsx`
- App Router is partially implemented in `app/` for future migration

### Core Components
- **pages/index.tsx**: Main magical girl generator interface
- **lib/ai.ts**: AI integration using Vercel AI SDK with OpenAI
- **lib/config.ts**: Environment configuration management
- **lib/utils.ts**: Utility functions including deterministic level generation

### AI Integration Pattern
Uses Vercel AI SDK with Zod schemas for type-safe responses:
```typescript
// Schema defined with zod
const magicalGirlSchema = z.object({
  magicalName: z.string(),
  attributes: z.object({...}),
  transformationSpell: z.string()
})

// AI generation with structured output
const { object } = await generateObject({
  model: openai(config.model),
  schema: magicalGirlSchema,
  prompt: generatePrompt(name)
})
```

### Level System
Character levels are deterministically generated based on name hash:
1. 种芽 (Seed) - Level 1
2. 叶 (Leaf) - Level 2  
3. 蕾 (Bud) - Level 3
4. 花 (Flower) - Level 4
5. 满开 (Full Bloom) - Level 5
6. 宝石权杖 (Gem Scepter) - Level 6

### Styling Approach
- Tailwind CSS 4 with custom animations
- shadcn/ui components (configured in components.json)
- Mobile-first responsive design
- Chinese language UI

## Key Dependencies
- **AI**: `@ai-sdk/openai`, `ai`, `zod`
- **UI**: `tailwindcss`, `lucide-react`, `class-variance-authority`
- **Image Export**: `html2canvas`
- **Framework**: `next`, `react`, `typescript`

## Development Notes
- No testing framework currently configured
- API keys are client-exposed (NEXT_PUBLIC_*)
- Project is bilingual with Chinese comments and UI text
- Uses Turbopack for faster development builds
