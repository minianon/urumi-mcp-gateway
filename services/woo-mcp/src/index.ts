import crypto from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { config } from './config.ts';
import { registerTools } from './tools.ts';

/**
 * Streamable HTTP in *stateless* mode: every POST /mcp builds a fresh McpServer + transport.
 * There is no session state to lose, so any replica can serve any request and a pod restart is
 * invisible to the gateway beyond the requests that were in flight.
 */
function buildServer(): McpServer {
  const server = new McpServer(
    { name: 'woocommerce-mcp', title: `WooCommerce – ${config.storeName}`, version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions: `Tools for the "${config.storeName}" WooCommerce store. Prices are decimal strings in the store currency. Dates are resolved in ${config.storeTimezone}.`,
    },
  );
  registerTools(server);
  return server;
}

/** Constant-time bearer check. Only the gateway knows this token (it lives in a Kubernetes Secret). */
const expected = Buffer.from(`Bearer ${config.authToken}`);
function requireGateway(req: Request, res: Response, next: NextFunction) {
  const got = Buffer.from(req.headers.authorization ?? '');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) {
    res.status(401).json({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null });
    return;
  }
  next();
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.get('/readyz', (_req, res) => res.json({ ok: true }));

app.post('/mcp', requireGateway, async (req, res) => {
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on('close', () => {
    void transport.close();
    void server.close();
  });
  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error('MCP request failed', err);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null });
  }
});

// Stateless server: no server-initiated stream and no sessions to delete.
const notAllowed = (_req: Request, res: Response) =>
  res.status(405).set('Allow', 'POST').json({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null });
app.get('/mcp', notAllowed);
app.delete('/mcp', notAllowed);

const httpServer = app.listen(config.port, () => {
  console.log(`woocommerce-mcp listening on :${config.port} (store: ${config.storeName}, upstream: ${config.wooBaseUrl})`);
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => {
    console.log(`${sig} received, draining`);
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 10_000).unref();
  });
}
