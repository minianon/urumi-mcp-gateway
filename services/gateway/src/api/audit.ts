import express from 'express';
import { z } from 'zod';
import { currentUser } from '../auth.ts';
import { q, q1 } from '../db.ts';
import { h } from '../util.ts';

export const auditRouter = express.Router();
export const statsRouter = express.Router();

/** Members only ever see their own rows; admins see everyone's. */
auditRouter.get(
  '/',
  h(async (req, res) => {
    const me = currentUser(res);
    const f = z
      .object({
        userId: z.string().uuid().optional(),
        serverSlug: z.string().max(40).optional(),
        outcome: z.enum(['success', 'error', 'timeout', 'denied', 'unauthorized']).optional(),
        client: z.enum(['mcp', 'chat']).optional(),
        method: z.enum(['tools/call', 'tools/list', 'auth']).optional(),
        limit: z.coerce.number().int().min(1).max(200).default(50),
        before: z.coerce.number().int().positive().optional(),
      })
      .parse(req.query);

    const where: string[] = [];
    const params: unknown[] = [];
    const add = (sql: string, v: unknown) => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (me.role !== 'admin') add('user_id = ?', me.id);
    else if (f.userId) add('user_id = ?', f.userId);
    if (f.serverSlug) add('server_slug = ?', f.serverSlug);
    if (f.outcome) add('outcome = ?', f.outcome);
    if (f.client) add('client = ?', f.client);
    if (f.method) add('method = ?', f.method);
    if (f.before) add('id < ?', f.before);
    params.push(f.limit + 1);

    const rows = await q(
      `SELECT id::int, ts, user_id AS "userId", user_email AS "userEmail", key_prefix AS "keyPrefix", client, method,
              server_slug AS "serverSlug", tool, exposed_name AS "exposedName", duration_ms AS "durationMs", outcome, error,
              gateway_pod AS "gatewayPod"
         FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    const more = rows.length > f.limit;
    const items = more ? rows.slice(0, f.limit) : rows;
    res.json({ items, nextBefore: more ? items[items.length - 1].id : undefined });
  }),
);

statsRouter.get(
  '/overview',
  h(async (req, res) => {
    const me = currentUser(res);
    const { hours } = z.object({ hours: z.coerce.number().int().min(1).max(24 * 31).default(24) }).parse(req.query);
    const scope = me.role === 'admin' ? '' : 'AND user_id = $2';
    const params = me.role === 'admin' ? [hours] : [hours, me.id];
    const base = `FROM audit_log WHERE method = 'tools/call' AND ts > now() - make_interval(hours => $1) ${scope}`;

    const [totals, perServer, timeline, topTools] = await Promise.all([
      q1(
        `SELECT count(*)::int AS calls, count(*) FILTER (WHERE outcome <> 'success')::int AS errors,
                COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS "p50Ms",
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS "p95Ms" ${base}`,
        params,
      ),
      q(
        `SELECT COALESCE(server_slug, 'unknown') AS "serverSlug", count(*)::int AS calls,
                count(*) FILTER (WHERE outcome <> 'success')::int AS errors,
                COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms), 0)::int AS "p95Ms"
           ${base} GROUP BY 1 ORDER BY calls DESC`,
        params,
      ),
      q(
        `WITH buckets AS (
           SELECT generate_series(date_trunc('hour', now() - make_interval(hours => $1 - 1)), date_trunc('hour', now()), interval '1 hour') AS bucket
         ), counts AS (
           SELECT date_trunc('hour', ts) AS bucket, count(*)::int AS calls, count(*) FILTER (WHERE outcome <> 'success')::int AS errors ${base} GROUP BY 1
         )
         SELECT b.bucket, COALESCE(c.calls, 0) AS calls, COALESCE(c.errors, 0) AS errors
           FROM buckets b LEFT JOIN counts c USING (bucket) ORDER BY b.bucket`,
        params,
      ),
      q(`SELECT exposed_name AS "exposedName", count(*)::int AS calls ${base} AND exposed_name IS NOT NULL GROUP BY 1 ORDER BY calls DESC LIMIT 8`, params),
    ]);
    res.json({
      totals: { ...totals, errorRate: totals!.calls ? totals!.errors / totals!.calls : 0 },
      perServer,
      timeline,
      topTools,
    });
  }),
);
