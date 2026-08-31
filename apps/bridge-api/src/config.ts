import { z } from 'zod';

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().positive().default(4170),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().min(1),
  BRIDGE_TOKEN_PEPPER: z.string().min(32),
  BRIDGE_REQUIRE_TENANT_HEADER: z
    .string()
    .default('true')
    .transform((value) => value !== 'false'),

  BRIDGE_PILOT_TENANT_ID: optionalString,
  BIDWRIGHT_BASE_URL: optionalString,
  BIDWRIGHT_SERVICE_EMAIL: optionalString,
  BIDWRIGHT_SERVICE_PASSWORD: optionalString,
  BIDWRIGHT_ORG_SLUG: optionalString,
  BIDWRIGHT_EXPECTED_ORG_ID: optionalString,
  BIDWRIGHT_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
});

export type BridgeConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BridgeConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) throw new Error(`Invalid environment: ${result.error.message}`);
  return result.data;
}
