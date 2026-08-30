import { config as loadEnvironment } from 'dotenv';

loadEnvironment({
  path: ['.env.local', '.env'],
  quiet: true,
});

await import('#/main');
