// Mirrors docs/API.md. Keep in sync with the gateway contract.

export type Role = 'admin' | 'member'

export interface SessionUser {
  id: string
  email: string
  name: string
  role: Role
}

export interface GatewayInfo {
  mcpUrl: string
  version: string
  pod: string
  toolNaming: string
}

export type AuthType = 'none' | 'bearer' | 'header'
export type ServerStatus = 'connected' | 'unreachable' | 'disabled' | 'connecting'

export interface Server {
  id: string
  slug: string
  name: string
  url?: string
  enabled: boolean
  managed: boolean
  authType: AuthType
  authHeaderName?: string
  hasCredential: boolean
  timeoutMs: number
  status: ServerStatus
  statusReason?: string
  lastCheckedAt?: string
  connectedAt?: string
  toolCount: number
  pendingReviewCount: number
  createdAt: string
  updatedAt: string
}

export interface ServerInput {
  name: string
  slug: string
  url: string
  authType: AuthType
  authHeaderName?: string
  credential?: string
  timeoutMs?: number
  enabled?: boolean
}

/** PATCH body: any create field; `credential: null` clears it, omitted keeps it. */
export type ServerPatch = Partial<Omit<ServerInput, 'credential'>> & { credential?: string | null }

export interface ServerTestResult {
  ok: boolean
  toolCount?: number
  tools?: string[]
  error?: string
}

export type ToolStatus = 'active' | 'pending' | 'changed'

export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
  [key: string]: unknown
}

export interface Tool {
  name: string
  exposedName: string
  title?: string
  description: string
  inputSchema: unknown
  annotations?: ToolAnnotations
  status: ToolStatus
  enabled: boolean
  minRole: Role
  flags: string[]
  approvedDefinition?: { description: string; inputSchema: unknown }
  firstSeenAt: string
  lastSeenAt: string
}

export type UserStatus = 'invited' | 'active' | 'disabled'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  status: UserStatus
  createdAt: string
  lastLoginAt?: string
  activeKeyCount: number
}

export interface ApiKey {
  id: string
  name: string
  prefix: string
  createdAt: string
  lastUsedAt?: string
  revokedAt?: string
  user?: { id: string; email: string; name: string }
}

export type AuditClient = 'mcp' | 'chat'
export type AuditOutcome = 'success' | 'error' | 'timeout' | 'denied' | 'unauthorized'
export type AuditMethod = 'tools/call' | 'tools/list' | 'auth'

export interface AuditEntry {
  id: number
  ts: string
  userId?: string
  userEmail?: string
  keyPrefix?: string
  client: AuditClient
  method: AuditMethod
  serverSlug?: string
  tool?: string
  exposedName?: string
  durationMs: number
  outcome: AuditOutcome
  error?: string
  gatewayPod: string
}

export interface AuditPage {
  items: AuditEntry[]
  nextBefore?: number
}

export interface AuditFilters {
  userId?: string
  serverSlug?: string
  outcome?: AuditOutcome | ''
  client?: AuditClient | ''
}

export interface StatsOverview {
  totals: { calls: number; errors: number; errorRate: number; p50Ms: number; p95Ms: number }
  perServer: { serverSlug: string; calls: number; errors: number; p95Ms: number }[]
  timeline: { bucket: string; calls: number; errors: number }[]
  topTools: { exposedName: string; calls: number }[]
}

export interface ChatConfig {
  enabled: boolean
  provider: string
  model: string
  toolMode: 'direct' | 'search'
}

export type ChatEvent =
  | { type: 'tool_call'; data: { id: string; name: string; arguments: unknown } }
  | { type: 'tool_result'; data: { id: string; name: string; ok: boolean; durationMs: number; preview: unknown } }
  | { type: 'message'; data: { content: string } }
  | { type: 'error'; data: { message: string } }
  | { type: 'done'; data: { history: unknown[] } }
