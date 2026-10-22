import express from 'express';
import { z } from 'zod';
import { currentUser, requireAdmin } from '../auth.ts';
import { flagsFor, loadCatalog, type CatalogTool } from '../catalog.ts';
import { decryptSecret, encryptSecret } from '../crypto.ts';
import { q, q1 } from '../db.ts';
import { publish } from '../events.ts';
import { SsrfError, validateUpstreamUrl } from '../ssrf.ts';
import { headersFor, testConnection, upstreams, type ServerRow } from '../upstreams.ts';
import { h, HttpError } from '../util.ts';
import { config } from '../config.ts';

export const serversRouter = express.Router();

const FORBIDDEN_HEADERS = new Set(['host', 'content-length', 'content-type', 'cookie', 'connection', 'transfer-encoding', 'mcp-session-id', 'mcp-protocol-version', 'accept']);

const ServerInput = z.object({
  name: z.string().trim().min(1).max(80),
  slug: z
    .string()
    .regex(/^[a-z][a-z0-9-]{0,23}$/, 'Slug: lowercase letters, digits and dashes, max 24 chars, starting with a letter')
    .refine((s) => s !== 'gateway', '"gateway" is reserved'),
  url: z.string().url().max(2000),
  authType: z.enum(['none', 'bearer', 'header']).default('none'),
  authHeaderName: z
    .string()
    .regex(/^[A-Za-z0-9-]{1,64}$/)
    .refine((v) => !FORBIDDEN_HEADERS.has(v.toLowerCase()), 'That header cannot be overridden')
    .optional()
    .nullable(),
  credential: z.string().max(8192).nullable().optional(),
  timeoutMs: z.number().int().min(1_000).max(120_000).optional(),
  enabled: z.boolean().optional(),
});

// PATCH must not inherit defaults: an omitted field means "leave unchanged".
const ServerPatch = z.object({
  name: ServerInput.shape.name.optional(),
  url: ServerInput.shape.url.optional(),
  authType: z.enum(['none', 'bearer', 'header']).optional(),
  authHeaderName: ServerInput.shape.authHeaderName,
  credential: ServerInput.shape.credential,
  timeoutMs: ServerInput.shape.timeoutMs,
  enabled: ServerInput.shape.enabled,
});

async function checkUrl(url: string) {
  try {
    await validateUpstreamUrl(url);
  } catch (err) {
    if (err instanceof SsrfError) throw new HttpError(400, 'url_not_allowed', err.message);
    throw err;
  }
}

function serialize(row: ServerRow, isAdmin: boolean, tools: CatalogTool[]) {
  const live = upstreams.statusOf(row.id);
  const mine = tools.filter((t) => t.serverId === row.id);
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    ...(isAdmin ? { url: row.url, authHeaderName: row.auth_header_name ?? undefined } : {}),
    enabled: row.enabled,
    managed: row.managed,
    authType: row.auth_type,
    hasCredential: Boolean(row.credential_enc), // the credential itself never leaves the server
    timeoutMs: row.timeout_ms,
    status: row.enabled ? (live?.status ?? row.status) : 'disabled',
    statusReason: row.enabled ? (live ? live.reason : row.status_reason) ?? undefined : undefined,
    lastCheckedAt: row.last_checked_at,
    connectedAt: live?.connectedAt ?? row.connected_at ?? undefined,
    toolCount: mine.length,
    pendingReviewCount: mine.filter((t) => t.status !== 'active').length,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getRow(id: string): Promise<ServerRow> {
  const row = await q1<ServerRow>('SELECT * FROM servers WHERE id = $1', [id]).catch(() => undefined);
  if (!row) throw new HttpError(404, 'not_found', 'Server not found');
  return row;
}

async function changed(id?: string) {
  await upstreams.reload();
  if (id) await upstreams.settle(id);
  await publish('servers_changed');
}

serversRouter.get(
  '/',
  h(async (_req, res) => {
    const isAdmin = currentUser(res).role === 'admin';
    const [rows, tools] = await Promise.all([q<ServerRow>('SELECT * FROM servers ORDER BY managed DESC, created_at'), loadCatalog()]);
    res.json(rows.map((r) => serialize(r, isAdmin, tools)));
  }),
);

serversRouter.post(
  '/test',
  requireAdmin,
  h(async (req, res) => {
    const input = ServerInput.partial({ name: true, slug: true }).parse(req.body);
    await checkUrl(input.url);
    const r = await testConnection(input.url, headersFor(input.authType, input.authHeaderName ?? null, input.credential ?? null));
    res.json(r.ok ? { ok: true, toolCount: r.tools.length, tools: r.tools } : r);
  }),
);

serversRouter.post(
  '/',
  requireAdmin,
  h(async (req, res) => {
    const input = ServerInput.parse(req.body);
    if (input.authType === 'header' && !input.authHeaderName) throw new HttpError(400, 'invalid', 'Header name is required for custom header auth');
    await checkUrl(input.url);
    if (await q1('SELECT 1 FROM servers WHERE slug = $1', [input.slug])) throw new HttpError(409, 'conflict', `Slug "${input.slug}" is already in use`);
    const row = (await q1<ServerRow>(
      `INSERT INTO servers (slug, name, url, auth_type, auth_header_name, credential_enc, timeout_ms, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        input.slug,
        input.name,
        input.url,
        input.authType,
        input.authType === 'header' ? input.authHeaderName : null,
        input.credential ? encryptSecret(input.credential) : null,
        input.timeoutMs ?? config.upstream.defaultTimeoutMs,
        input.enabled ?? true,
      ],
    ))!;
    await changed(row.id);
    res.status(201).json(serialize(await getRow(row.id), true, await loadCatalog()));
  }),
);

serversRouter.patch(
  '/:id',
  requireAdmin,
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    const input = ServerPatch.parse(req.body);
    const touchesConnection = input.url !== undefined || input.authType !== undefined || input.authHeaderName !== undefined || input.credential !== undefined;
    if (row.managed && touchesConnection) throw new HttpError(409, 'managed', 'This server is managed by Helm; change its URL/credential in the chart values');
    if (input.url) await checkUrl(input.url);

    const authType = input.authType ?? row.auth_type;
    let credentialEnc = row.credential_enc;
    if (input.credential === null || authType === 'none') credentialEnc = null;
    else if (input.credential) credentialEnc = encryptSecret(input.credential);

    await q(
      `UPDATE servers SET name = $2, url = $3, auth_type = $4, auth_header_name = $5, credential_enc = $6, timeout_ms = $7, enabled = $8, updated_at = now()
        WHERE id = $1`,
      [
        row.id,
        input.name ?? row.name,
        input.url ?? row.url,
        authType,
        authType === 'header' ? (input.authHeaderName ?? row.auth_header_name) : null,
        credentialEnc,
        input.timeoutMs ?? row.timeout_ms,
        input.enabled ?? row.enabled,
      ],
    );
    await changed(row.id);
    res.json(serialize(await getRow(row.id), true, await loadCatalog()));
  }),
);

serversRouter.delete(
  '/:id',
  requireAdmin,
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    if (row.managed) throw new HttpError(409, 'managed', 'This server is managed by Helm; disable it here or remove it from the chart values');
    await q('DELETE FROM servers WHERE id = $1', [row.id]);
    await changed();
    res.json({ ok: true });
  }),
);

serversRouter.post(
  '/:id/refresh',
  requireAdmin,
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    await upstreams.refresh(row.id);
    await publish('tools_changed');
    res.json(serialize(await getRow(row.id), true, await loadCatalog()));
  }),
);

// --- Tools of one server ----------------------------------------------------------------------

function serializeTool(t: CatalogTool, allNames: string[]) {
  const others = allNames.filter((n) => n !== t.name && n !== t.exposedName);
  return {
    name: t.name,
    exposedName: t.exposedName,
    title: t.definition.title,
    description: t.definition.description,
    inputSchema: t.definition.inputSchema,
    annotations: t.definition.annotations,
    status: t.status,
    enabled: t.enabled,
    minRole: t.minRole,
    flags: flagsFor(t.definition, others),
    ...(t.status === 'changed' && t.approvedDefinition
      ? { approvedDefinition: { description: t.approvedDefinition.description, inputSchema: t.approvedDefinition.inputSchema } }
      : {}),
    firstSeenAt: t.firstSeenAt,
    lastSeenAt: t.lastSeenAt,
  };
}

async function toolsOf(serverId: string) {
  const all = await loadCatalog();
  const names = all.flatMap((t) => [t.exposedName]);
  return { tools: all.filter((t) => t.serverId === serverId), names };
}

serversRouter.get(
  '/:id/tools',
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    const { tools, names } = await toolsOf(row.id);
    res.json(tools.map((t) => serializeTool(t, names)));
  }),
);

serversRouter.patch(
  '/:id/tools/:name',
  requireAdmin,
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    const input = z.object({ minRole: z.enum(['member', 'admin']).optional(), enabled: z.boolean().optional() }).parse(req.body);
    const updated = await q1(
      `UPDATE server_tools SET min_role = COALESCE($3, min_role), enabled = COALESCE($4, enabled) WHERE server_id = $1 AND name = $2 RETURNING name`,
      [row.id, req.params.name, input.minRole ?? null, input.enabled ?? null],
    );
    if (!updated) throw new HttpError(404, 'not_found', 'Tool not found');
    await publish('tools_changed');
    const { tools, names } = await toolsOf(row.id);
    res.json(serializeTool(tools.find((t) => t.name === req.params.name)!, names));
  }),
);

serversRouter.post(
  '/:id/tools/:name/approve',
  requireAdmin,
  h(async (req, res) => {
    const row = await getRow(req.params.id as string);
    const updated = await q1(
      `UPDATE server_tools SET approved_definition = definition, approved_hash = def_hash WHERE server_id = $1 AND name = $2 RETURNING name`,
      [row.id, req.params.name],
    );
    if (!updated) throw new HttpError(404, 'not_found', 'Tool not found');
    await publish('tools_changed');
    const { tools, names } = await toolsOf(row.id);
    res.json(serializeTool(tools.find((t) => t.name === req.params.name)!, names));
  }),
);

/** Used by bootstrap to compare without re-encrypting on every restart. */
export function sameCredential(enc: string | null, plain: string | null): boolean {
  if (!enc || !plain) return !enc && !plain;
  try {
    return decryptSecret(enc) === plain;
  } catch {
    return false;
  }
}
