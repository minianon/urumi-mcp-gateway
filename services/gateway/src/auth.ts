import type { NextFunction, Request, Response } from 'express';
import type { Role } from './catalog.ts';
import { config } from './config.ts';
import { API_KEY_PREFIX, hashApiKey, signToken, verifyToken } from './crypto.ts';
import { pool, q1 } from './db.ts';
import { HttpError } from './util.ts';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: 'invited' | 'active' | 'disabled';
}

export const SESSION_COOKIE = 'urumi_session';
const AGENT_TOKEN_PREFIX = 'uat_';

// --- Dashboard sessions ---------------------------------------------------------------------

export function setSessionCookie(res: Response, userId: string) {
  const exp = Math.floor(Date.now() / 1000) + config.sessionTtlHours * 3600;
  res.cookie(SESSION_COOKIE, signToken({ typ: 'session', uid: userId, exp }), {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    path: '/',
    maxAge: config.sessionTtlHours * 3600 * 1000,
  });
}

async function loadActiveUser(id: string): Promise<User | undefined> {
  return q1<User>(`SELECT id, email, name, role, status FROM users WHERE id = $1 AND status = 'active'`, [id]);
}

/**
 * The cookie only carries the user id; role and status are re-read from the database on every
 * request, so demoting or disabling a user takes effect immediately.
 */
export async function requireUser(req: Request, res: Response, next: NextFunction) {
  const token = req.cookies?.[SESSION_COOKIE] as string | undefined;
  const session = token ? verifyToken<{ typ: 'session'; uid: string; exp: number }>(token, 'session') : undefined;
  const user = session && (await loadActiveUser(session.uid));
  if (!user) return next(new HttpError(401, 'unauthenticated', 'Please sign in'));
  res.locals.user = user;
  next();
}

export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if ((res.locals.user as User | undefined)?.role !== 'admin') return next(new HttpError(403, 'forbidden', 'Admin role required'));
  next();
}

export const currentUser = (res: Response) => res.locals.user as User;

/** Cross-site requests cannot set custom headers without a CORS preflight, which we never allow. */
export function requireCsrfHeader(req: Request, _res: Response, next: NextFunction) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.get('x-urumi-csrf') === '1') return next();
  next(new HttpError(403, 'csrf', 'Missing X-Urumi-CSRF header'));
}

// --- MCP endpoint auth ----------------------------------------------------------------------

export interface McpPrincipal {
  user: User;
  client: 'mcp' | 'chat';
  keyId?: string;
  keyPrefix?: string;
}

export type McpAuthResult =
  | { ok: true; principal: McpPrincipal }
  | { ok: false; reason: string; keyPrefix?: string; user?: Pick<User, 'id' | 'email'> };

/**
 * The chat agent is just another MCP client of the gateway. It authenticates with a short-lived
 * token minted for the logged-in user, so its calls go through the same authorisation, routing
 * and audit path as Claude Code or Cursor, attributed to that user.
 */
export function mintAgentToken(userId: string): string {
  return AGENT_TOKEN_PREFIX + signToken({ typ: 'agent', uid: userId, exp: Math.floor(Date.now() / 1000) + 300 });
}

const lastUsedWrites = new Map<string, number>();

export async function authenticateMcp(req: Request): Promise<McpAuthResult> {
  const header = req.get('authorization') ?? '';
  const m = header.match(/^Bearer\s+(\S+)$/i);
  if (!m) return { ok: false, reason: 'missing bearer token' };
  const token = m[1]!;

  if (token.startsWith(AGENT_TOKEN_PREFIX)) {
    const t = verifyToken<{ typ: 'agent'; uid: string; exp: number }>(token.slice(AGENT_TOKEN_PREFIX.length), 'agent');
    const user = t && (await loadActiveUser(t.uid));
    if (!user) return { ok: false, reason: 'invalid or expired agent token' };
    return { ok: true, principal: { user, client: 'chat' } };
  }

  if (!token.startsWith(API_KEY_PREFIX)) return { ok: false, reason: 'unrecognised token format', keyPrefix: token.slice(0, 12) };

  const row = await q1(
    `SELECT k.id AS key_id, k.prefix, k.revoked_at, u.id, u.email, u.name, u.role, u.status
       FROM api_keys k JOIN users u ON u.id = k.user_id
      WHERE k.key_hash = $1`,
    [hashApiKey(token)],
  );
  if (!row) return { ok: false, reason: 'unknown API key', keyPrefix: token.slice(0, 12) };
  const who = { id: row.id as string, email: row.email as string };
  if (row.revoked_at) return { ok: false, reason: 'API key has been revoked', keyPrefix: row.prefix, user: who };
  if (row.status !== 'active') return { ok: false, reason: `user is ${row.status}`, keyPrefix: row.prefix, user: who };

  // Throttle last_used_at writes to one per key per minute.
  const now = Date.now();
  if ((lastUsedWrites.get(row.key_id) ?? 0) < now - 60_000) {
    lastUsedWrites.set(row.key_id, now);
    void pool.query('UPDATE api_keys SET last_used_at = now() WHERE id = $1', [row.key_id]).catch(() => {});
  }
  return {
    ok: true,
    principal: {
      user: { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status },
      client: 'mcp',
      keyId: row.key_id,
      keyPrefix: row.prefix,
    },
  };
}
