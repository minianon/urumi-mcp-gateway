import type {
  ApiKey,
  AuditFilters,
  AuditPage,
  ChatConfig,
  GatewayInfo,
  Role,
  Server,
  ServerInput,
  ServerPatch,
  ServerTestResult,
  SessionUser,
  StatsOverview,
  Tool,
  User,
  UserStatus,
} from './types'

export const CSRF_HEADER = 'X-Urumi-CSRF'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

/* ------------------------------------------------------------------ */
/* 401 handling                                                       */
/* ------------------------------------------------------------------ */

const PUBLIC_PATHS = [/^\/login\/?$/, /^\/invite\//]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((re) => re.test(pathname))
}

let onUnauthorized: () => void = () => {
  if (isPublicPath(window.location.pathname)) return
  const next = window.location.pathname + window.location.search
  window.location.assign(`/login?next=${encodeURIComponent(next)}`)
}

/** Lets the app swap the hard redirect for a router navigation + cache reset. */
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn
}

export function handleUnauthorized() {
  onUnauthorized()
}

/* ------------------------------------------------------------------ */
/* fetch wrapper                                                      */
/* ------------------------------------------------------------------ */

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

interface RequestOptions {
  body?: unknown
  signal?: AbortSignal
  /** Don't trigger the global "go to login" behaviour on 401 (login form, session probe). */
  allowUnauthorized?: boolean
}

export function isMutating(method: string) {
  return method !== 'GET' && method !== 'HEAD'
}

export async function parseError(res: Response): Promise<ApiError> {
  let code = `http_${res.status}`
  let message = res.statusText || `Request failed (${res.status})`
  try {
    const data: unknown = await res.json()
    if (data && typeof data === 'object' && 'error' in data) {
      const e = (data as { error?: { code?: unknown; message?: unknown } }).error
      if (typeof e?.code === 'string') code = e.code
      if (typeof e?.message === 'string') message = e.message
    }
  } catch {
    /* non-JSON error body (e.g. an ingress 502 page) */
  }
  if ((res.status === 502 || res.status === 503 || res.status === 504) && code.startsWith('http_')) {
    message = 'The gateway is unavailable right now. Please try again shortly.'
  }
  return new ApiError(res.status, code, message)
}

export async function request<T>(method: Method, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json'
  if (isMutating(method)) headers[CSRF_HEADER] = '1'

  let res: Response
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: 'same-origin',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(0, 'network_error', 'Network error: could not reach the gateway')
  }

  if (!res.ok) {
    const err = await parseError(res)
    if (res.status === 401 && !opts.allowUnauthorized) handleUnauthorized()
    throw err
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  if (!text) return undefined as T
  try {
    return JSON.parse(text) as T
  } catch {
    throw new ApiError(res.status, 'invalid_response', 'The gateway returned an unexpected response')
  }
}

const get = <T>(path: string, signal?: AbortSignal) => request<T>('GET', path, { signal })
const post = <T>(path: string, body?: unknown) => request<T>('POST', path, { body })
const patch = <T>(path: string, body: unknown) => request<T>('PATCH', path, { body })
const del = <T>(path: string) => request<T>('DELETE', path)

const enc = encodeURIComponent

function qs(params: Record<string, string | number | undefined | null>) {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/* ------------------------------------------------------------------ */
/* endpoints                                                          */
/* ------------------------------------------------------------------ */

export const api = {
  auth: {
    /** Session probe: resolves to null when not logged in instead of redirecting. */
    async me(): Promise<SessionUser | null> {
      try {
        const r = await request<{ user: SessionUser }>('GET', '/api/auth/me', { allowUnauthorized: true })
        return r.user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    login: (email: string, password: string) =>
      request<{ user: SessionUser }>('POST', '/api/auth/login', {
        body: { email, password },
        allowUnauthorized: true,
      }),
    logout: () => request<{ ok: true }>('POST', '/api/auth/logout', { allowUnauthorized: true }),
    invite: (token: string) =>
      request<{ email: string; name: string; role: Role }>('GET', `/api/auth/invite/${enc(token)}`, {
        allowUnauthorized: true,
      }),
    acceptInvite: (token: string, password: string) =>
      request<{ user: SessionUser }>('POST', '/api/auth/accept-invite', {
        body: { token, password },
        allowUnauthorized: true,
      }),
  },

  info: () => get<GatewayInfo>('/api/info'),

  servers: {
    list: () => get<Server[]>('/api/servers'),
    create: (body: ServerInput) => post<Server>('/api/servers', body),
    test: (body: ServerInput) => post<ServerTestResult>('/api/servers/test', body),
    update: (id: string, body: ServerPatch) => patch<Server>(`/api/servers/${enc(id)}`, body),
    remove: (id: string) => del<{ ok: true }>(`/api/servers/${enc(id)}`),
    refresh: (id: string) => post<Server>(`/api/servers/${enc(id)}/refresh`),
    tools: (id: string) => get<Tool[]>(`/api/servers/${enc(id)}/tools`),
    updateTool: (id: string, name: string, body: { minRole?: Role; enabled?: boolean }) =>
      patch<Tool>(`/api/servers/${enc(id)}/tools/${enc(name)}`, body),
    approveTool: (id: string, name: string) =>
      post<Tool>(`/api/servers/${enc(id)}/tools/${enc(name)}/approve`),
  },

  users: {
    list: () => get<User[]>('/api/users'),
    invite: (body: { email: string; name: string; role: Role }) =>
      post<{ user: User; inviteUrl: string }>('/api/users/invite', body),
    regenerateInvite: (id: string) => post<{ inviteUrl: string }>(`/api/users/${enc(id)}/invite`),
    update: (id: string, body: { role?: Role; status?: Exclude<UserStatus, 'invited'> }) =>
      patch<User>(`/api/users/${enc(id)}`, body),
    remove: (id: string) => del<{ ok: true }>(`/api/users/${enc(id)}`),
  },

  keys: {
    mine: () => get<ApiKey[]>('/api/keys'),
    all: () => get<ApiKey[]>('/api/admin/keys'),
    create: (name: string) => post<{ key: ApiKey; secret: string }>('/api/keys', { name }),
    revoke: (id: string) => del<unknown>(`/api/keys/${enc(id)}`),
  },

  audit: (filters: AuditFilters & { limit?: number; before?: number }) =>
    get<AuditPage>(
      `/api/audit${qs({
        userId: filters.userId,
        serverSlug: filters.serverSlug,
        outcome: filters.outcome,
        client: filters.client,
        limit: filters.limit ?? 50,
        before: filters.before,
      })}`,
    ),

  stats: (hours: number) => get<StatsOverview>(`/api/stats/overview${qs({ hours })}`),

  chat: {
    config: () => get<ChatConfig>('/api/chat/config'),
  },
}
