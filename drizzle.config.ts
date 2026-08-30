import type { Config } from 'drizzle-kit';

export default {
  schema: ['./apps/web/lib/db/schema/**/*.ts'],
  out: './drizzle',
  dialect: 'sqlite',
  strict: true,
  verbose: true,
} satisfies Config;
