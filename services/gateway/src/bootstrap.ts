import { sameCredential } from './api/servers.ts';
import { config } from './config.ts';
import { encryptSecret, hashPassword } from './crypto.ts';
import { q, q1 } from './db.ts';
import { allowHost } from './ssrf.ts';

/** Create the first admin from Helm values (password comes from a Secret). Never overwrites. */
async function ensureAdmin() {
  const { email, name, password } = config.bootstrapAdmin;
  const { count } = (await q1<{ count: number }>(`SELECT count(*)::int AS count FROM users WHERE role = 'admin'`))!;
  if (count > 0) return;
  if (!email || !password) {
    console.warn('No admin user exists and BOOTSTRAP_ADMIN_EMAIL/PASSWORD are not set');
    return;
  }
  await q(`INSERT INTO users (email, name, role, status, password_hash) VALUES ($1, $2, 'admin', 'active', $3) ON CONFLICT (email) DO NOTHING`, [
    email.toLowerCase(),
    name,
    await hashPassword(password),
  ]);
  console.log(`bootstrap admin ${email} created`);
}

/**
 * Register upstream servers declared in Helm values (managed = true). Helm is the source of
 * truth for their URL and credential, so a credential rotated in the Secret is picked up on the
 * next rollout; enable/disable and timeouts stay under the admin's control in the dashboard.
 */
async function ensureServers() {
  for (const b of config.bootstrapServers) {
    allowHost(new URL(b.url).hostname); // platform-deployed, cluster-internal: exempt from the SSRF guard
    const credential = b.credentialEnv ? (process.env[b.credentialEnv] ?? null) : null;
    if (b.credentialEnv && !credential) console.warn(`bootstrap server ${b.slug}: env ${b.credentialEnv} is empty`);

    const existing = await q1(`SELECT id, url, auth_type, auth_header_name, credential_enc FROM servers WHERE slug = $1`, [b.slug]);
    if (!existing) {
      await q(
        `INSERT INTO servers (slug, name, url, auth_type, auth_header_name, credential_enc, timeout_ms, managed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, true)`,
        [b.slug, b.name, b.url, b.authType, b.authHeaderName ?? null, credential ? encryptSecret(credential) : null, b.timeoutMs ?? config.upstream.defaultTimeoutMs],
      );
      console.log(`bootstrap server ${b.slug} registered`);
      continue;
    }
    const same =
      existing.url === b.url &&
      existing.auth_type === b.authType &&
      (existing.auth_header_name ?? null) === (b.authHeaderName ?? null) &&
      sameCredential(existing.credential_enc, credential);
    if (!same) {
      await q(`UPDATE servers SET url = $2, auth_type = $3, auth_header_name = $4, credential_enc = $5, managed = true, updated_at = now() WHERE id = $1`, [
        existing.id,
        b.url,
        b.authType,
        b.authHeaderName ?? null,
        credential ? encryptSecret(credential) : null,
      ]);
      console.log(`bootstrap server ${b.slug} updated from Helm values`);
    }
  }
}

export async function bootstrap() {
  await ensureAdmin();
  await ensureServers();
}
