import { EventEmitter } from 'node:events';
import pg from 'pg';
import { config } from './config.ts';
import { pool } from './db.ts';

/**
 * Cross-replica change notifications over Postgres LISTEN/NOTIFY.
 *
 * When an admin disables a server on replica A, replica B must drop that server's tools too and
 * push `notifications/tools/list_changed` to the MCP clients whose SSE streams it holds. No extra
 * infrastructure (Redis, NATS) needed: Postgres is already the source of truth.
 */
export type GatewayEvent = 'servers_changed' | 'tools_changed' | 'users_changed';

const CHANNEL = 'urumi_events';
export const events = new EventEmitter();
events.setMaxListeners(1000);

export async function publish(type: GatewayEvent, payload: Record<string, unknown> = {}) {
  await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ type, ...payload, from: config.podName })]);
}

export async function startListener() {
  const connect = async () => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on('notification', (msg) => {
      try {
        const evt = JSON.parse(msg.payload ?? '{}') as { type: GatewayEvent };
        events.emit(evt.type, evt);
      } catch {
        /* ignore malformed */
      }
    });
    client.on('error', (err) => {
      console.error('LISTEN connection lost, reconnecting', err.message);
      client.end().catch(() => {});
      setTimeout(() => void connect().catch((e) => console.error(e)), 2_000);
      // Anything could have changed while we were deaf.
      events.emit('servers_changed', { type: 'servers_changed' });
    });
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
  };
  await connect();
}
