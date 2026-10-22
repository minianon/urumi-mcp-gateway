# Gateway HTTP API

The gateway exposes two surfaces on the same host (`app.<domain>`):

| Path      | Who calls it                     | Auth                                   |
|-----------|----------------------------------|----------------------------------------|
| `/mcp`    | MCP clients (Claude Code, Cursor, Inspector) and the dashboard chat agent | `Authorization: Bearer ugw_…` (user API key) |
| `/api/*`  | The React dashboard              | `urumi_session` httpOnly cookie        |

All `/api` bodies are JSON. Every mutating request (`POST`/`PATCH`/`PUT`/`DELETE`) must send the header
`X-Urumi-CSRF: 1`; combined with a `SameSite=Strict` cookie this blocks cross-site request forgery.

Errors always look like `{ "error": { "code": "not_found", "message": "Server not found" } }`.

Timestamps are ISO-8601 strings in UTC.

---

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` | `{ user }` + sets cookie |
| POST | `/api/auth/logout` | – | `{ ok: true }` |
| GET  | `/api/auth/me` | – | `{ user }` or 401 |
| GET  | `/api/auth/invite/:token` | – | `{ email, name, role }` (404 if invalid/expired) |
| POST | `/api/auth/accept-invite` | `{ token, password }` | `{ user }` + sets cookie |

`user = { id, email, name, role: "admin" | "member" }`

## Gateway info

`GET /api/info` → `{ mcpUrl, version, pod, toolNaming: "<server>__<tool>" }`

## Servers

Readable by every logged-in user (members never see `url` or credential metadata). Mutations are admin-only.

```
Server = {
  id, slug, name,
  url?,                       // admin only
  enabled, managed,           // managed = registered by Helm bootstrap config
  authType: "none" | "bearer" | "header",
  authHeaderName?,            // when authType = header
  hasCredential: boolean,     // the credential itself is NEVER returned
  timeoutMs,
  status: "connected" | "unreachable" | "disabled" | "connecting",
  statusReason?: string,      // e.g. "connect ECONNREFUSED 10.43.12.9:3000"
  lastCheckedAt?, connectedAt?,
  toolCount, pendingReviewCount,
  createdAt, updatedAt
}
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET    | `/api/servers` | – | `Server[]` |
| POST   | `/api/servers` | `{ name, slug, url, authType, authHeaderName?, credential?, timeoutMs?, enabled? }` | `Server` |
| POST   | `/api/servers/test` | same as create | `{ ok, toolCount?, tools?: string[], error? }` |
| PATCH  | `/api/servers/:id` | any of create fields; `credential: null` clears it, omitted keeps it | `Server` |
| DELETE | `/api/servers/:id` | – | `{ ok: true }` |
| POST   | `/api/servers/:id/refresh` | – | `Server` (reconnects and re-lists tools) |
| GET    | `/api/servers/:id/tools` | – | `Tool[]` |
| PATCH  | `/api/servers/:id/tools/:name` | `{ minRole?: "member"\|"admin", enabled?: boolean }` | `Tool` |
| POST   | `/api/servers/:id/tools/:name/approve` | – | `Tool` |

```
Tool = {
  name, exposedName,            // exposedName = "<slug>__<name>"
  title?, description, inputSchema, annotations?,
  status: "active" | "pending" | "changed",
     // pending  = appeared after the server was first approved, waiting for admin review
     // changed  = description/schema changed since approval (possible rug-pull); hidden until re-approved
  enabled: boolean,
  minRole: "member" | "admin",
  flags: string[],              // heuristic warnings, e.g. "mentions-other-tools", "instruction-override"
  approvedDefinition?: { description, inputSchema },   // present when status = changed
  firstSeenAt, lastSeenAt
}
```

A tool is visible to a user over MCP only when: server enabled AND connected, tool `status = active`, tool `enabled`, and the user's role ≥ `minRole`.

## Users (admin only)

```
User = { id, email, name, role, status: "invited" | "active" | "disabled", createdAt, lastLoginAt?, activeKeyCount }
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET    | `/api/users` | – | `User[]` |
| POST   | `/api/users/invite` | `{ email, name, role }` | `{ user, inviteUrl }` |
| POST   | `/api/users/:id/invite` | – | `{ inviteUrl }` (regenerates link) |
| PATCH  | `/api/users/:id` | `{ role?, status?: "active" \| "disabled" }` | `User` |
| DELETE | `/api/users/:id` | – | `{ ok: true }` |

## API keys

```
ApiKey = { id, name, prefix, createdAt, lastUsedAt?, revokedAt?, user?: { id, email, name } }
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET    | `/api/keys` | – | my `ApiKey[]` |
| POST   | `/api/keys` | `{ name }` | `{ key: ApiKey, secret: "ugw_…" }` – secret shown once |
| DELETE | `/api/keys/:id` | – | revokes (own key, or any key for admins) |
| GET    | `/api/admin/keys` | – | all `ApiKey[]` with `user` (admin) |

## Audit log

Members see only their own rows; admins see everyone's.

`GET /api/audit?userId=&serverSlug=&outcome=&client=&limit=50&before=<id>`

```
{ items: AuditEntry[], nextBefore?: number }
AuditEntry = {
  id, ts, userId?, userEmail?, keyPrefix?, client: "mcp" | "chat",
  method: "tools/call" | "tools/list" | "auth",
  serverSlug?, tool?, exposedName?,
  durationMs, outcome: "success" | "error" | "timeout" | "denied" | "unauthorized",
  error?, gatewayPod
}
```

## Stats

`GET /api/stats/overview?hours=24`

```
{
  totals: { calls, errors, errorRate, p50Ms, p95Ms },
  perServer: [{ serverSlug, calls, errors, p95Ms }],
  timeline:  [{ bucket, calls, errors }],      // hourly buckets
  topTools:  [{ exposedName, calls }]
}
```

## Chat agent

`GET /api/chat/config` → `{ enabled, provider, model, toolMode: "direct" | "search" }`

`POST /api/chat` with `{ message: string, history?: unknown[] }` responds with a
`text/event-stream`. Events:

| event | data |
|---|---|
| `tool_call`   | `{ id, name, arguments }` |
| `tool_result` | `{ id, name, ok, durationMs, preview }` |
| `message`     | `{ content }` – final assistant answer (markdown) |
| `error`       | `{ message }` |
| `done`        | `{ history }` – opaque transcript to send back with the next message |

The agent connects to the gateway's own `/mcp` endpoint as the logged-in user, so its calls are
authorised and audited exactly like an external client's (`client = "chat"`).
