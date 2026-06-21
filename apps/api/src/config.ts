import { z } from 'zod';

const INSECURE_SECRETS = new Set([
  'mama-babi-dev-jwt-secret-change-me',
  'secret',
  'changeme',
  'password',
  '12345678',
]);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().positive().default(3001),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('8h'),
  RATE_LIMIT_MAX_AUTH: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_MAX_API: z.coerce.number().int().positive().default(300),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const cfg = parsed.data;

  if (cfg.NODE_ENV === 'production') {
    if (INSECURE_SECRETS.has(cfg.JWT_SECRET)) {
      throw new Error('JWT_SECRET is insecure. Set a strong secret in production.');
    }
    if (cfg.CORS_ORIGIN === '*') {
      console.warn('[config] WARNING: CORS_ORIGIN=* in production. Restrict to your app origin.');
    }
  }

  return cfg;
}
