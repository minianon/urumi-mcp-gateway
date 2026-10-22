import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport, StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ErrorCode, McpError, ToolListChangedNotificationSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { config } from './config.ts';
import { decryptSecret, sha256 } from './crypto.ts';
import { pool, q } from './db.ts';
import { events } from './events.ts';
import { metrics } from './metrics.ts';
import { safeFetch } from './ssrf.ts';
import { describeError, stableStringify } from './util.ts';

export type ServerStatus = 'connected' | 'unreachable' | 'disabled' | 'connecting';

export interface ServerRow {
  id: string;
  slug: string;
  name: string;
  url: string;
  enabled: boolean;
  managed: boolean;
  auth_type: 'none' | 'bearer' | 'header';
  auth_header_name: string | null;
  credential_enc: string | null;
  timeout_ms: number;
  status: ServerStatus;
  status_reason: string | null;
  last_checked_at: Date | null;
  connected_at: Date | null;
  first_synced_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface Conn {
  row: ServerRow;
  client?: Client;
  status: ServerStatus;
  reason?: string;
  connectedAt?: Date;
  failures: number;
  nextRetryAt: number;
  inflight?: Promise<void>;
  /** Hash of the last tools/list result, to detect definition drift cheaply. */
  listHash?: string;
}

export class UpstreamError extends Error {
  kind: 'unreachable' | 'timeout' | 'upstream_error';
  constructor(kind: UpstreamError['kind'], message: string) {
    super(message);
    this.kind = kind;
  }
}

const backoffMs = (failures: number) => Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));

export function headersFor(authType: string, headerName: string | null, credential: string | null): Record<string, string> {
  if (!credential || authType === 'none') return {};
  if (authType === 'bearer') return { Authorization: `Bearer ${credential}` };
  return { [headerName ?? 'X-API-Key']: credential };
}

async function listAllTools(client: Client, timeout: number): Promise<Tool[]> {
  const tools: Tool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 50; page++) {
    const res = await client.listTools(cursor ? { cursor } : undefined, { timeout });
    tools.push(...res.tools);
    cursor = res.nextCursor;
    if (!cursor) break;
  }
  return tools;
}

/**
 * One MCP client connection per upstream server, per gateway replica.
 *
 * Isolation: every upstream has its own Client, its own timeouts and its own failure state. A
 * dead or slow server only ever affects calls to *that* server; listing tools never waits on
 * the network (it reads the last good catalogue), so one bad upstream cannot stall tools/list.
 */
class UpstreamManager {
  private conns = new Map<string, Conn>();
  private timers: NodeJS.Timeout[] = [];

  start() {
    this.timers.push(setInterval(() => void this.pingAll(), config.upstream.healthIntervalMs));
    this.timers.push(setInterval(() => void this.retryDue(), 2_000));
    events.on('servers_changed', () => void this.reload().catch((e) => console.error('reload failed', e)));
  }

  stop() {
    this.timers.forEach(clearInterval);
    for (const c of this.conns.values()) void c.client?.close().catch(() => {});
  }

  /** Reconcile in-memory connections with the servers table. */
  async reload() {
    const rows = await q<ServerRow>('SELECT * FROM servers');
    const seen = new Set<string>();
    for (const row of rows) {
      seen.add(row.id);
      const conn = this.conns.get(row.id);
      if (!conn) {
        const c: Conn = { row, status: row.enabled ? 'connecting' : 'disabled', failures: 0, nextRetryAt: 0 };
        this.conns.set(row.id, c);
        if (row.enabled) void this.connect(c);
        else await this.persist(c);
        continue;
      }
      const reconnect =
        conn.row.url !== row.url ||
        conn.row.auth_type !== row.auth_type ||
        conn.row.auth_header_name !== row.auth_header_name ||
        conn.row.credential_enc !== row.credential_enc ||
        conn.row.enabled !== row.enabled;
      conn.row = row;
      if (!reconnect) continue;
      await this.disconnect(conn);
      if (row.enabled) {
        conn.status = 'connecting';
        conn.failures = 0;
        void this.connect(conn);
      } else {
        conn.status = 'disabled';
        conn.reason = undefined;
        await this.persist(conn);
      }
      events.emit('tools_changed', { type: 'tools_changed' });
    }
    for (const [id, conn] of this.conns) {
      if (!seen.has(id)) {
        await this.disconnect(conn);
        this.conns.delete(id);
        events.emit('tools_changed', { type: 'tools_changed' });
      }
    }
  }

  isConnected(serverId: string) {
    return this.conns.get(serverId)?.status === 'connected';
  }

  statusOf(serverId: string): { status: ServerStatus; reason?: string; connectedAt?: Date } | undefined {
    const c = this.conns.get(serverId);
    return c && { status: c.status, reason: c.reason, connectedAt: c.connectedAt };
  }

  /** Wait for an in-progress connection attempt (used right after creating a server). */
  async settle(serverId: string) {
    await this.conns.get(serverId)?.inflight;
  }

  /** Force a reconnect + relist and wait for it (dashboard "Refresh" button). */
  async refresh(serverId: string) {
    const conn = this.conns.get(serverId);
    if (!conn || !conn.row.enabled) return;
    await conn.inflight;
    await this.disconnect(conn);
    conn.failures = 0;
    await this.connect(conn);
  }

  private connect(conn: Conn): Promise<void> {
    if (conn.inflight) return conn.inflight;
    conn.inflight = this.doConnect(conn).finally(() => (conn.inflight = undefined));
    return conn.inflight;
  }

  private async doConnect(conn: Conn) {
    const row = conn.row;
    let client: Client | undefined;
    try {
      const credential = row.credential_enc ? decryptSecret(row.credential_enc) : null;
      client = new Client({ name: 'urumi-gateway', version: config.version }, { capabilities: {} });
      const transport = new StreamableHTTPClientTransport(new URL(row.url), {
        fetch: safeFetch,
        requestInit: { headers: headersFor(row.auth_type, row.auth_header_name, credential) },
      });
      await client.connect(transport, { timeout: config.upstream.connectTimeoutMs });
      const tools = await listAllTools(client, row.timeout_ms);

      client.setNotificationHandler(ToolListChangedNotificationSchema, () => void this.relist(conn));
      client.onclose = () => {
        if (conn.client === client && conn.status === 'connected') this.markUnreachable(conn, new Error('Connection closed by upstream'));
      };

      // Upstream could have been disabled/removed while we were connecting.
      if (!this.conns.has(row.id) || !conn.row.enabled) {
        await client.close();
        return;
      }
      // Persist the catalogue first: a server only counts as connected once its tools are known.
      await syncTools(row, tools);
      conn.listHash = sha256(stableStringify(tools));
      conn.client = client;
      conn.status = 'connected';
      conn.reason = undefined;
      conn.failures = 0;
      conn.connectedAt = new Date();
      await this.persist(conn);
      metrics.upstreamUp.set({ server: row.slug }, 1);
      metrics.upstreamTools.set({ server: row.slug }, tools.length);
      events.emit('tools_changed', { type: 'tools_changed' });
      console.log(`upstream ${row.slug} connected (${tools.length} tools)`);
    } catch (err) {
      await client?.close().catch(() => {});
      conn.client = undefined;
      conn.failures++;
      conn.nextRetryAt = Date.now() + backoffMs(conn.failures);
      const wasConnected = conn.status === 'connected';
      conn.status = 'unreachable';
      conn.reason = explain(err, row, 'connect');
      await this.persist(conn);
      metrics.upstreamUp.set({ server: row.slug }, 0);
      if (wasConnected) events.emit('tools_changed', { type: 'tools_changed' });
      if (conn.failures <= 3 || conn.failures % 20 === 0) console.warn(`upstream ${row.slug} unreachable: ${conn.reason}`);
    }
  }

  private async relist(conn: Conn) {
    if (!conn.client) return;
    try {
      const tools = await listAllTools(conn.client, conn.row.timeout_ms);
      await syncTools(conn.row, tools);
      conn.listHash = sha256(stableStringify(tools));
      metrics.upstreamTools.set({ server: conn.row.slug }, tools.length);
      events.emit('tools_changed', { type: 'tools_changed' });
    } catch (err) {
      this.markUnreachable(conn, err);
    }
  }

  private async disconnect(conn: Conn) {
    const c = conn.client;
    conn.client = undefined;
    await c?.close().catch(() => {});
  }

  private markUnreachable(conn: Conn, err: unknown) {
    if (conn.status !== 'connected') return;
    void this.disconnect(conn);
    conn.status = 'unreachable';
    conn.reason = explain(err, conn.row, 'health');
    conn.failures = 1;
    conn.nextRetryAt = Date.now() + backoffMs(1);
    metrics.upstreamUp.set({ server: conn.row.slug }, 0);
    events.emit('tools_changed', { type: 'tools_changed' });
    void this.persist(conn);
    console.warn(`upstream ${conn.row.slug} marked unreachable: ${conn.reason}`);
  }

  /**
   * Health check = tools/list (not ping). It proves the server is alive *and* notices when a
   * stateless upstream was redeployed with different tool definitions, which a ping would miss.
   * The catalogue is only re-synced when the list's hash actually changes.
   */
  private async pingAll() {
    await Promise.all(
      [...this.conns.values()].map(async (conn) => {
        if (conn.status !== 'connected' || !conn.client) return;
        try {
          const tools = await listAllTools(conn.client, config.upstream.pingTimeoutMs);
          const hash = sha256(stableStringify(tools));
          if (hash !== conn.listHash) {
            await syncTools(conn.row, tools);
            conn.listHash = hash;
            metrics.upstreamTools.set({ server: conn.row.slug }, tools.length);
            events.emit('tools_changed', { type: 'tools_changed' });
            console.log(`upstream ${conn.row.slug}: tool definitions changed, catalogue re-synced`);
          }
          await this.persist(conn);
        } catch (err) {
          this.markUnreachable(conn, err);
        }
      }),
    );
  }

  private async retryDue() {
    const now = Date.now();
    for (const conn of this.conns.values()) {
      if (conn.row.enabled && conn.status !== 'connected' && !conn.inflight && now >= conn.nextRetryAt) void this.connect(conn);
    }
  }

  private async persist(conn: Conn) {
    await pool
      .query('UPDATE servers SET status = $2, status_reason = $3, last_checked_at = now(), connected_at = $4 WHERE id = $1', [
        conn.row.id,
        conn.status,
        conn.reason ?? null,
        conn.status === 'connected' ? conn.connectedAt : null,
      ])
      .catch((e) => console.error('persist status failed', e.message));
  }

  /**
   * Route one tools/call to its upstream. Never throws for tool-level failures (those come back
   * as isError results from the upstream); throws UpstreamError for transport problems so the
   * gateway can turn them into a clear message and a precise audit outcome.
   */
  async callTool(serverId: string, name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<CallToolResult> {
    const conn = this.conns.get(serverId);
    if (!conn || !conn.row.enabled) throw new UpstreamError('unreachable', 'Server is disabled');
    if (conn.status !== 'connected' || !conn.client) {
      throw new UpstreamError('unreachable', `Upstream "${conn.row.slug}" is unreachable: ${conn.reason ?? 'not connected yet'}`);
    }
    const timeout = conn.row.timeout_ms;
    const attempt = (client: Client) =>
      client.callTool({ name, arguments: args }, undefined, { timeout, signal }) as Promise<CallToolResult>;
    try {
      return await attempt(conn.client);
    } catch (err) {
      if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
        // Slow is not dead: keep the connection, the health ping decides about reachability.
        throw new UpstreamError('timeout', `Upstream "${conn.row.slug}" did not respond within ${timeout} ms`);
      }
      if (err instanceof McpError) throw new UpstreamError('upstream_error', `Upstream "${conn.row.slug}" returned an error: ${err.message}`);
      // Stateful upstream restarted and forgot our session: reconnect and retry once. Safe because
      // a 404 on the session means the request was never executed.
      if (err instanceof StreamableHTTPError && err.code === 404) {
        await this.refresh(serverId);
        if (conn.client) return await attempt(conn.client);
      }
      this.markUnreachable(conn, err);
      throw new UpstreamError('unreachable', `Upstream "${conn.row.slug}" is unreachable: ${explain(err, conn.row, 'call')}`);
    }
  }
}

function explain(err: unknown, row: ServerRow, phase: 'connect' | 'health' | 'call'): string {
  if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) {
    return phase === 'health' ? `No response to health check (tools/list) within ${config.upstream.pingTimeoutMs} ms` : `Timed out after ${config.upstream.connectTimeoutMs} ms during ${phase}`;
  }
  if (err instanceof StreamableHTTPError) {
    if (err.code === 401 || err.code === 403) return `Upstream rejected the gateway's credentials (HTTP ${err.code})`;
    return `HTTP ${err.code ?? '?'} from ${new URL(row.url).host}: ${err.message}`;
  }
  return describeError(err);
}

// --- Tool catalogue sync + definition pinning ---------------------------------------------

export interface ToolDefinition {
  title?: string;
  description: string;
  inputSchema: Tool['inputSchema'];
  outputSchema?: Tool['outputSchema'];
  annotations?: Tool['annotations'];
}

export const definitionOf = (t: Tool): ToolDefinition => ({
  title: t.title ?? t.annotations?.title,
  description: t.description ?? '',
  inputSchema: t.inputSchema,
  outputSchema: t.outputSchema,
  annotations: t.annotations,
});

/**
 * Trust on first use: the first successful listing of a server is approved automatically (the
 * admin just added it and can see every tool). After that, a *new* tool lands as "pending" and
 * a *changed* description/schema lands as "changed"; both stay hidden from users until an admin
 * approves them in the dashboard.
 */
async function syncTools(row: ServerRow, tools: Tool[]) {
  const firstSync = !row.first_synced_at;
  const adminOnly = new Set(config.bootstrapServers.find((b) => b.slug === row.slug)?.adminOnlyTools ?? []);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of tools) {
      const def = definitionOf(t);
      const hash = sha256(stableStringify(def));
      await client.query(
        `INSERT INTO server_tools (server_id, name, definition, def_hash, approved_definition, approved_hash, min_role)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (server_id, name) DO UPDATE
           SET definition = EXCLUDED.definition, def_hash = EXCLUDED.def_hash, present = true, last_seen_at = now()`,
        [row.id, t.name, def, hash, firstSync ? def : null, firstSync ? hash : null, adminOnly.has(t.name) ? 'admin' : 'member'],
      );
    }
    await client.query('UPDATE server_tools SET present = false WHERE server_id = $1 AND NOT (name = ANY($2))', [row.id, tools.map((t) => t.name)]);
    if (firstSync) {
      await client.query('UPDATE servers SET first_synced_at = now() WHERE id = $1', [row.id]);
      row.first_synced_at = new Date();
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** One-off connection used by "Test connection" in the dashboard. Nothing is persisted. */
export async function testConnection(url: string, headers: Record<string, string>): Promise<{ ok: true; tools: string[] } | { ok: false; error: string }> {
  const client = new Client({ name: 'urumi-gateway-test', version: config.version }, { capabilities: {} });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(url), { fetch: safeFetch, requestInit: { headers } }), {
      timeout: config.upstream.connectTimeoutMs,
    });
    const tools = await listAllTools(client, config.upstream.connectTimeoutMs);
    return { ok: true, tools: tools.map((t) => t.name) };
  } catch (err) {
    if (err instanceof StreamableHTTPError && (err.code === 401 || err.code === 403)) return { ok: false, error: `Server rejected the credential (HTTP ${err.code})` };
    if (err instanceof McpError && err.code === ErrorCode.RequestTimeout) return { ok: false, error: `Timed out after ${config.upstream.connectTimeoutMs} ms` };
    return { ok: false, error: describeError(err) };
  } finally {
    await client.close().catch(() => {});
  }
}

export const upstreams = new UpstreamManager();
