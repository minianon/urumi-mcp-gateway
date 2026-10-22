import express from 'express';
import { z } from 'zod';
import { currentUser, requireAdmin } from '../auth.ts';
import { config } from '../config.ts';
import { generateApiKey, randomToken, sha256 } from '../crypto.ts';
import { q, q1 } from '../db.ts';
import { publish } from '../events.ts';
import { h, HttpError } from '../util.ts';

export const usersRouter = express.Router();
export const keysRouter = express.Router();
export const adminKeysRouter = express.Router();

const MAX_ACTIVE_KEYS = 10;

const userSelect = `
  SELECT u.id, u.email, u.name, u.role, u.status, u.created_at AS "createdAt", u.last_login_at AS "lastLoginAt",
         (SELECT count(*)::int FROM api_keys k WHERE k.user_id = u.id AND k.revoked_at IS NULL) AS "activeKeyCount"
    FROM users u`;

async function newInvite(userId: string): Promise<string> {
  const token = randomToken(24);
  await q(`UPDATE users SET invite_token_hash = $2, invite_expires_at = now() + make_interval(hours => $3) WHERE id = $1`, [
    userId,
    sha256(token),
    config.inviteTtlHours,
  ]);
  return `${config.publicUrl}/invite/${token}`;
}

async function assertNotLastAdmin(userId: string) {
  const { count } = (await q1<{ count: number }>(`SELECT count(*)::int AS count FROM users WHERE role = 'admin' AND status = 'active' AND id <> $1`, [userId]))!;
  if (count === 0) throw new HttpError(409, 'last_admin', 'There must be at least one active admin');
}

// --- Users (admin) ----------------------------------------------------------------------------

usersRouter.use(requireAdmin);

usersRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(await q(`${userSelect} ORDER BY u.created_at`));
  }),
);

usersRouter.post(
  '/invite',
  h(async (req, res) => {
    const input = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(1).max(80), role: z.enum(['admin', 'member']) }).parse(req.body);
    if (await q1('SELECT 1 FROM users WHERE email = $1', [input.email])) throw new HttpError(409, 'conflict', 'A user with this email already exists');
    const { id } = (await q1<{ id: string }>(`INSERT INTO users (email, name, role, status) VALUES ($1, $2, $3, 'invited') RETURNING id`, [input.email, input.name, input.role]))!;
    const inviteUrl = await newInvite(id);
    res.status(201).json({ user: await q1(`${userSelect} WHERE u.id = $1`, [id]), inviteUrl });
  }),
);

usersRouter.post(
  '/:id/invite',
  h(async (req, res) => {
    const u = await q1('SELECT status FROM users WHERE id = $1', [req.params.id]);
    if (!u) throw new HttpError(404, 'not_found', 'User not found');
    if (u.status !== 'invited') throw new HttpError(409, 'already_active', 'User has already accepted their invite');
    res.json({ inviteUrl: await newInvite(req.params.id as string) });
  }),
);

usersRouter.patch(
  '/:id',
  h(async (req, res) => {
    const me = currentUser(res);
    const input = z.object({ role: z.enum(['admin', 'member']).optional(), status: z.enum(['active', 'disabled']).optional() }).parse(req.body);
    const u = await q1('SELECT id, role, status FROM users WHERE id = $1', [req.params.id]);
    if (!u) throw new HttpError(404, 'not_found', 'User not found');
    if (u.id === me.id && (input.role === 'member' || input.status === 'disabled')) throw new HttpError(409, 'self', 'You cannot demote or disable yourself');
    if (u.role === 'admin' && (input.role === 'member' || input.status === 'disabled')) await assertNotLastAdmin(u.id);
    if (input.status === 'active' && u.status === 'invited') throw new HttpError(409, 'invited', 'User must accept the invite first');
    await q(`UPDATE users SET role = COALESCE($2, role), status = COALESCE($3, status) WHERE id = $1`, [u.id, input.role ?? null, input.status ?? null]);
    await publish('users_changed');
    res.json(await q1(`${userSelect} WHERE u.id = $1`, [u.id]));
  }),
);

usersRouter.delete(
  '/:id',
  h(async (req, res) => {
    const me = currentUser(res);
    const u = await q1('SELECT id, role FROM users WHERE id = $1', [req.params.id]);
    if (!u) throw new HttpError(404, 'not_found', 'User not found');
    if (u.id === me.id) throw new HttpError(409, 'self', 'You cannot delete yourself');
    if (u.role === 'admin') await assertNotLastAdmin(u.id);
    await q('DELETE FROM users WHERE id = $1', [u.id]); // cascades to api_keys; audit rows keep the email
    await publish('users_changed');
    res.json({ ok: true });
  }),
);

// --- API keys (self-service) ----------------------------------------------------------------

const keyCols = `k.id, k.name, k.prefix, k.created_at AS "createdAt", k.last_used_at AS "lastUsedAt", k.revoked_at AS "revokedAt"`;

keysRouter.get(
  '/',
  h(async (_req, res) => {
    res.json(await q(`SELECT ${keyCols} FROM api_keys k WHERE k.user_id = $1 ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`, [currentUser(res).id]));
  }),
);

keysRouter.post(
  '/',
  h(async (req, res) => {
    const me = currentUser(res);
    const { name } = z.object({ name: z.string().trim().min(1).max(60) }).parse(req.body);
    const { count } = (await q1<{ count: number }>(`SELECT count(*)::int AS count FROM api_keys WHERE user_id = $1 AND revoked_at IS NULL`, [me.id]))!;
    if (count >= MAX_ACTIVE_KEYS) throw new HttpError(409, 'too_many_keys', `You already have ${MAX_ACTIVE_KEYS} active keys; revoke one first`);
    const k = generateApiKey();
    const key = await q1(`INSERT INTO api_keys (user_id, name, prefix, key_hash) VALUES ($1, $2, $3, $4) RETURNING id, name, prefix, created_at AS "createdAt"`, [
      me.id,
      name,
      k.prefix,
      k.hash,
    ]);
    // The plaintext key exists only in this response. We store an HMAC of it.
    res.status(201).json({ key, secret: k.secret });
  }),
);

keysRouter.delete(
  '/:id',
  h(async (req, res) => {
    const me = currentUser(res);
    const key = await q1('SELECT id, user_id, revoked_at FROM api_keys WHERE id = $1', [req.params.id]).catch(() => undefined);
    if (!key || (key.user_id !== me.id && me.role !== 'admin')) throw new HttpError(404, 'not_found', 'Key not found');
    if (!key.revoked_at) await q('UPDATE api_keys SET revoked_at = now(), revoked_by = $2 WHERE id = $1', [key.id, me.id]);
    res.json({ ok: true });
  }),
);

adminKeysRouter.get(
  '/',
  requireAdmin,
  h(async (_req, res) => {
    const rows = await q(
      `SELECT ${keyCols}, json_build_object('id', u.id, 'email', u.email, 'name', u.name) AS "user"
         FROM api_keys k JOIN users u ON u.id = k.user_id
        ORDER BY k.revoked_at NULLS FIRST, k.created_at DESC`,
    );
    res.json(rows);
  }),
);
