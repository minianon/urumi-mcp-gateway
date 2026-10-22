import pg from 'pg';
import { config } from './config.ts';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
pool.on('error', (err) => console.error('pg pool error', err.message));

export async function q<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await pool.query<T>(text, params)).rows;
}
export async function q1<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await pool.query<T>(text, params)).rows[0];
}

/**
 * Forward-only migrations. Every replica runs this on start; a Postgres advisory lock makes it
 * safe when several gateway pods start at the same time.
 */
const migrations: string[] = [
  `
  CREATE TABLE users (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email             text NOT NULL UNIQUE,
    name              text NOT NULL,
    role              text NOT NULL CHECK (role IN ('admin', 'member')),
    status            text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'disabled')),
    password_hash     text,
    invite_token_hash text,
    invite_expires_at timestamptz,
    created_at        timestamptz NOT NULL DEFAULT now(),
    last_login_at     timestamptz
  );

  CREATE TABLE api_keys (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         text NOT NULL,
    prefix       text NOT NULL,
    key_hash     text NOT NULL UNIQUE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    revoked_at   timestamptz,
    revoked_by   uuid REFERENCES users(id) ON DELETE SET NULL
  );
  CREATE INDEX api_keys_user ON api_keys(user_id);

  CREATE TABLE servers (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug             text NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9-]{0,23}$'),
    name             text NOT NULL,
    url              text NOT NULL,
    enabled          boolean NOT NULL DEFAULT true,
    managed          boolean NOT NULL DEFAULT false,
    auth_type        text NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'bearer', 'header')),
    auth_header_name text,
    credential_enc   text,
    timeout_ms       integer NOT NULL DEFAULT 15000,
    status           text NOT NULL DEFAULT 'connecting',
    status_reason    text,
    last_checked_at  timestamptz,
    connected_at     timestamptz,
    first_synced_at  timestamptz,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
  );

  -- Tool definitions are pinned: approved_hash is what an admin (or first sync) approved.
  -- If the upstream later changes a description or schema, def_hash != approved_hash and the tool
  -- is hidden until re-approved (defence against "rug pull" tool poisoning).
  CREATE TABLE server_tools (
    server_id           uuid NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name                text NOT NULL,
    definition          jsonb NOT NULL,
    def_hash            text NOT NULL,
    approved_definition jsonb,
    approved_hash       text,
    enabled             boolean NOT NULL DEFAULT true,
    min_role            text NOT NULL DEFAULT 'member' CHECK (min_role IN ('member', 'admin')),
    present             boolean NOT NULL DEFAULT true,
    first_seen_at       timestamptz NOT NULL DEFAULT now(),
    last_seen_at        timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (server_id, name)
  );

  CREATE TABLE audit_log (
    id           bigserial PRIMARY KEY,
    ts           timestamptz NOT NULL DEFAULT now(),
    user_id      uuid,
    user_email   text,
    key_prefix   text,
    client       text NOT NULL,
    method       text NOT NULL,
    server_id    uuid,
    server_slug  text,
    tool         text,
    exposed_name text,
    duration_ms  integer NOT NULL DEFAULT 0,
    outcome      text NOT NULL,
    error        text,
    gateway_pod  text
  );
  CREATE INDEX audit_log_ts ON audit_log (ts DESC);
  CREATE INDEX audit_log_user ON audit_log (user_id, ts DESC);
  `,
];

/** On a fresh install Postgres may still be initialising; wait instead of crash-looping. */
export async function waitForDb(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      console.log(`waiting for database: ${(err as Error).message}`);
      await new Promise((r) => setTimeout(r, 2_000));
    }
  }
}

export async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727274)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version int PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const { rows } = await client.query<{ version: number }>('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (const [i, sql] of migrations.entries()) {
      const version = i + 1;
      if (applied.has(version)) continue;
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
      await client.query('COMMIT');
      console.log(`applied migration ${version}`);
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.query('SELECT pg_advisory_unlock(727274)').catch(() => {});
    client.release();
  }
}
