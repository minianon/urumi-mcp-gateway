import os from 'node:os';
import { z } from 'zod';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}
const num = (name: string, def: number) => (process.env[name] ? Number(process.env[name]) : def);
const bool = (name: string, def: boolean) => (process.env[name] ? process.env[name] === 'true' : def);
const list = (name: string) =>
  (process.env[name] ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/**
 * Upstream servers registered from Helm values (the WooCommerce server and friends).
 * Credentials are NOT in this JSON: `credentialEnv` names an env var that is populated from a
 * Kubernetes Secret, so the ConfigMap never contains secrets.
 */
const BootstrapServer = z.object({
  slug: z.string(),
  name: z.string(),
  url: z.string().url(),
  authType: z.enum(['none', 'bearer', 'header']).default('none'),
  authHeaderName: z.string().optional(),
  credentialEnv: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  adminOnlyTools: z.array(z.string()).default([]),
});
export type BootstrapServer = z.infer<typeof BootstrapServer>;

export const config = {
  port: num('PORT', 8080),
  metricsPort: num('METRICS_PORT', 9464),
  podName: process.env.POD_NAME ?? os.hostname(),
  version: process.env.APP_VERSION ?? '1.0.0',

  /** Public origin of the dashboard/gateway, e.g. https://app.example.com */
  publicUrl: required('PUBLIC_URL').replace(/\/$/, ''),
  databaseUrl: required('DATABASE_URL'),

  /** HMAC key for session cookies, MCP session ids and chat-agent tokens. */
  sessionSecret: required('SESSION_SECRET'),
  /** 32-byte base64 key for AES-256-GCM encryption of upstream credentials at rest. */
  encryptionKey: Buffer.from(required('ENCRYPTION_KEY'), 'base64'),
  /** Server-side pepper for API key hashes: a DB dump alone cannot be used to test guessed keys. */
  apiKeyPepper: required('API_KEY_PEPPER'),
  cookieSecure: bool('COOKIE_SECURE', false),
  sessionTtlHours: num('SESSION_TTL_HOURS', 12),
  inviteTtlHours: num('INVITE_TTL_HOURS', 72),

  bootstrapAdmin: {
    email: process.env.BOOTSTRAP_ADMIN_EMAIL,
    name: process.env.BOOTSTRAP_ADMIN_NAME ?? 'Admin',
    password: process.env.BOOTSTRAP_ADMIN_PASSWORD,
  },
  bootstrapServers: z.array(BootstrapServer).parse(JSON.parse(process.env.BOOTSTRAP_SERVERS ?? '[]')),

  upstream: {
    defaultTimeoutMs: num('UPSTREAM_DEFAULT_TIMEOUT_MS', 15_000),
    connectTimeoutMs: num('UPSTREAM_CONNECT_TIMEOUT_MS', 5_000),
    healthIntervalMs: num('UPSTREAM_HEALTH_INTERVAL_MS', 10_000),
    pingTimeoutMs: num('UPSTREAM_PING_TIMEOUT_MS', 3_000),
    maxResultBytes: num('UPSTREAM_MAX_RESULT_BYTES', 512 * 1024),
    maxDescriptionChars: num('UPSTREAM_MAX_DESCRIPTION_CHARS', 2_000),
  },

  ssrf: {
    enabled: bool('SSRF_PROTECTION', true),
    /** Exact hostnames that may resolve to private addresses (cluster-internal MCP servers). */
    allowedHosts: list('SSRF_ALLOWED_HOSTS'),
  },

  rateLimitPerMinute: num('RATE_LIMIT_PER_MINUTE', 120),

  llm: {
    provider: process.env.LLM_PROVIDER ?? 'groq',
    baseUrl: process.env.LLM_BASE_URL ?? 'https://api.groq.com/openai/v1',
    model: process.env.LLM_MODEL ?? 'openai/gpt-oss-120b',
    apiKey: process.env.LLM_API_KEY ?? '',
    maxSteps: num('AGENT_MAX_STEPS', 8),
    /** Above this many tools the agent switches to search_tools/call_tool mode. */
    directToolLimit: num('AGENT_DIRECT_TOOL_LIMIT', 40),
  },
};
