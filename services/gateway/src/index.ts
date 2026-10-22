import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError } from 'zod';
import { auditRouter, statsRouter } from './api/audit.ts';
import { chatRouter } from './api/chat.ts';
import { serversRouter } from './api/servers.ts';
import { infoRouter, sessionRouter } from './api/session.ts';
import { adminKeysRouter, keysRouter, usersRouter } from './api/team.ts';
import { requireCsrfHeader, requireUser } from './auth.ts';
import { bootstrap } from './bootstrap.ts';
import { config } from './config.ts';
import { migrate, pool, waitForDb } from './db.ts';
import { startListener } from './events.ts';
import { mcpRouter } from './mcp.ts';
import { startMetricsServer } from './metrics.ts';
import { upstreams } from './upstreams.ts';
import { HttpError } from './util.ts';

await waitForDb();
await migrate();
await bootstrap();
await startListener();
upstreams.start();
await upstreams.reload();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Traefik in front: req.ip is the real client

// Liveness: the process is up. Readiness: we can reach Postgres (otherwise take us out of the Service).
app.get('/healthz', (_req, res) => res.json({ ok: true }));
let draining = false;
app.get('/readyz', async (_req, res) => {
  if (draining) return void res.status(503).json({ ok: false, draining: true });
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, pod: config.podName });
  } catch {
    res.status(503).json({ ok: false });
  }
});

app.use('/mcp', mcpRouter);

const api = express.Router();
api.use(express.json({ limit: '1mb' }), cookieParser(), requireCsrfHeader, (_req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});
api.use('/auth', sessionRouter);
api.use(requireUser);
api.use('/info', infoRouter);
api.use('/servers', serversRouter);
api.use('/users', usersRouter);
api.use('/keys', keysRouter);
api.use('/admin/keys', adminKeysRouter);
api.use('/audit', auditRouter);
api.use('/stats', statsRouter);
api.use('/chat', chatRouter);
api.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'No such endpoint')));
app.use('/api', api);

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: { code: err.code, message: err.message } });
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const message = first ? `${first.path.join('.') || 'input'}: ${first.message}` : 'Invalid input';
    return void res.status(400).json({ error: { code: 'invalid_input', message } });
  }
  if ((err as { type?: string }).type === 'entity.parse.failed') return void res.status(400).json({ error: { code: 'invalid_json', message: 'Malformed JSON body' } });
  console.error('unhandled error', err);
  res.status(500).json({ error: { code: 'internal', message: 'Internal server error' } });
});

const server = app.listen(config.port, () => console.log(`gateway ${config.podName} listening on :${config.port}, public URL ${config.publicUrl}`));
startMetricsServer();

// Graceful shutdown. The preStop hook already gave the Service/Ingress time to stop routing
// here; we additionally report not-ready, let in-flight requests (tool calls, chat streams)
// finish, and only then close. Together these make rolling updates and rollbacks lossless.
for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig}: draining`);
    draining = true;
    upstreams.stop();
    server.close(() => void pool.end().finally(() => process.exit(0)));
    server.closeIdleConnections();
    setTimeout(() => process.exit(0), 20_000).unref();
  });
}
