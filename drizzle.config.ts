import type { Config } from 'drizzle-kit';

export default {
  schema: ['./packages/hosted-runtime/src/db/schema/**/*.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
} satisfies Config;
