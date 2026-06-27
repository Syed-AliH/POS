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
  /** Legacy alias — prefer PORT (Railway, Render, etc.) */
  API_PORT: z.coerce.number().int().positive().optional(),
  PORT: z.coerce.number().int().positive().optional(),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  CORS_ORIGIN: z.string().default('*'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('never'),
  RATE_LIMIT_MAX_AUTH: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_MAX_API: z.coerce.number().int().positive().default(300),
});

export type AppConfig = Omit<z.infer<typeof envSchema>, 'PORT' | 'API_PORT'> & {
  API_PORT: number;
};

function resolveListenPort(cfg: z.infer<typeof envSchema>): number {
  // PORT is the standard env var on cloud hosts (Railway, Render, Fly, etc.)
  if (process.env.PORT) {
    const port = Number(process.env.PORT);
    if (Number.isFinite(port) && port > 0) return port;
  }
  if (cfg.PORT && cfg.PORT > 0) return cfg.PORT;
  if (cfg.API_PORT && cfg.API_PORT > 0) return cfg.API_PORT;
  if (process.env.API_PORT) {
    const port = Number(process.env.API_PORT);
    if (Number.isFinite(port) && port > 0) return port;
  }
  return 3001;
}

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  const cfg = parsed.data;
  const { PORT: _port, API_PORT: _apiPort, ...rest } = cfg;
  const API_PORT = resolveListenPort(cfg);

  if (cfg.NODE_ENV === 'production') {
    if (INSECURE_SECRETS.has(cfg.JWT_SECRET)) {
      throw new Error('JWT_SECRET is insecure. Set a strong secret in production.');
    }
    if (cfg.CORS_ORIGIN === '*') {
      console.warn('[config] WARNING: CORS_ORIGIN=* in production. Restrict to your app origin.');
    }
  }

  return { ...rest, API_PORT };
}

/** Omit expiry when configured as never — JWT tokens then do not expire. */
export function jwtSignOptions(expiresIn: string): { expiresIn?: string | number } {
  const normalized = expiresIn.trim().toLowerCase();
  if (!normalized || normalized === 'never' || normalized === 'none' || normalized === '0') {
    return {};
  }
  return { expiresIn };
}
