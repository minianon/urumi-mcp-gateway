import express from 'express';
import { z } from 'zod';
import { currentUser, requireUser, SESSION_COOKIE, setSessionCookie } from '../auth.ts';
import { config } from '../config.ts';
import { hashPassword, sha256, verifyPassword } from '../crypto.ts';
import { q, q1 } from '../db.ts';
import { h, HttpError } from '../util.ts';

export const sessionRouter = express.Router();

const publicUser = (u: { id: string; email: string; name: string; role: string }) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

// Simple brute-force brake: 10 failed attempts per email+IP per 10 minutes (per replica).
const failures = new Map<string, { n: number; until: number }>();
const DUMMY_HASH = await hashPassword('timing-equaliser');

sessionRouter.post(
  '/login',
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1).max(200) }).parse(req.body);
    const k = `${email}|${req.ip}`;
    const f = failures.get(k);
    if (f && f.n >= 10 && f.until > Date.now()) throw new HttpError(429, 'too_many_attempts', 'Too many failed attempts, try again in a few minutes');

    const user = await q1(`SELECT id, email, name, role, status, password_hash FROM users WHERE email = $1`, [email]);
    // Always run scrypt so response time does not reveal whether the email exists.
    const valid = await verifyPassword(password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !valid || user.status !== 'active') {
      failures.set(k, { n: (f && f.until > Date.now() ? f.n : 0) + 1, until: Date.now() + 10 * 60_000 });
      throw new HttpError(401, 'invalid_credentials', user?.status === 'disabled' && valid ? 'This account is disabled' : 'Invalid email or password');
    }
    failures.delete(k);
    await q('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
    setSessionCookie(res, user.id);
    res.json({ user: publicUser(user) });
  }),
);

sessionRouter.post('/logout', (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
  res.json({ ok: true });
});

sessionRouter.get('/me', requireUser, (_req, res) => {
  res.json({ user: publicUser(currentUser(res)) });
});

async function findInvite(token: string) {
  return q1(`SELECT id, email, name, role FROM users WHERE invite_token_hash = $1 AND invite_expires_at > now() AND status = 'invited'`, [sha256(token)]);
}

sessionRouter.get(
  '/invite/:token',
  h(async (req, res) => {
    const u = await findInvite(req.params.token as string);
    if (!u) throw new HttpError(404, 'invalid_invite', 'This invite link is invalid or has expired');
    res.json({ email: u.email, name: u.name, role: u.role });
  }),
);

sessionRouter.post(
  '/accept-invite',
  h(async (req, res) => {
    const { token, password } = z.object({ token: z.string().min(10), password: z.string().min(10, 'Use at least 10 characters').max(200) }).parse(req.body);
    const u = await findInvite(token);
    if (!u) throw new HttpError(404, 'invalid_invite', 'This invite link is invalid or has expired');
    await q(
      `UPDATE users SET password_hash = $2, status = 'active', invite_token_hash = NULL, invite_expires_at = NULL, last_login_at = now() WHERE id = $1`,
      [u.id, await hashPassword(password)],
    );
    setSessionCookie(res, u.id);
    res.json({ user: publicUser(u) });
  }),
);

export const infoRouter = express.Router();
infoRouter.get('/', (_req, res) => {
  res.json({ mcpUrl: `${config.publicUrl}/mcp`, version: config.version, pod: config.podName, toolNaming: '<server>__<tool>' });
});
