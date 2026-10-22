import { config } from './config.ts';
import { pool } from './db.ts';
import { metrics } from './metrics.ts';

export type Outcome = 'success' | 'error' | 'timeout' | 'denied' | 'unauthorized';
export type ClientKind = 'mcp' | 'chat';

export interface AuditEntry {
  userId?: string;
  userEmail?: string;
  keyPrefix?: string;
  client: ClientKind;
  method: 'tools/call' | 'tools/list' | 'auth';
  serverId?: string;
  serverSlug?: string;
  tool?: string;
  exposedName?: string;
  durationMs: number;
  outcome: Outcome;
  error?: string;
}

/**
 * Written for every tool call (and every rejected request). Arguments and results are
 * deliberately NOT stored: they can contain customer PII, and the log is readable by admins.
 */
export async function audit(e: AuditEntry) {
  if (e.method === 'tools/call') {
    metrics.toolCalls.inc({ server: e.serverSlug ?? 'unknown', outcome: e.outcome, client: e.client });
    if (e.serverSlug && (e.outcome === 'success' || e.outcome === 'error' || e.outcome === 'timeout')) {
      metrics.toolLatency.observe({ server: e.serverSlug }, e.durationMs / 1000);
    }
  }
  try {
    await pool.query(
      `INSERT INTO audit_log (user_id, user_email, key_prefix, client, method, server_id, server_slug, tool, exposed_name, duration_ms, outcome, error, gateway_pod)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        e.userId ?? null,
        e.userEmail ?? null,
        e.keyPrefix ?? null,
        e.client,
        e.method,
        e.serverId ?? null,
        e.serverSlug ?? null,
        e.tool ?? null,
        e.exposedName ?? null,
        Math.round(e.durationMs),
        e.outcome,
        e.error?.slice(0, 1000) ?? null,
        config.podName,
      ],
    );
  } catch (err) {
    // Never fail a user's request because the audit insert failed, but make it loud.
    console.error('AUDIT WRITE FAILED', (err as Error).message, JSON.stringify(e));
  }
}
