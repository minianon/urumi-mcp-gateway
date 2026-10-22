import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { config } from './config.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;

// --- Upstream credentials: AES-256-GCM at rest ----------------------------------------------
// Format: v1:<base64(iv | tag | ciphertext)>. The version prefix leaves room for key rotation.

export function encryptSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', config.encryptionKey, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return 'v1:' + Buffer.concat([iv, cipher.getAuthTag(), ct]).toString('base64');
}

export function decryptSecret(blob: string): string {
  const [version, data] = blob.split(':', 2);
  if (version !== 'v1' || !data) throw new Error('Unsupported credential encryption version');
  const raw = Buffer.from(data, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', config.encryptionKey, raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

// --- API keys -------------------------------------------------------------------------------
// Keys are 190 bits of randomness, so a fast keyed hash is the right tool (bcrypt/scrypt exist
// to protect low-entropy passwords). HMAC with a server-side pepper means a leaked database is
// not enough to verify keys offline.

const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
function randomBase62(len: number): string {
  let out = '';
  while (out.length < len) {
    for (const b of crypto.randomBytes(len)) if (b < 248 && out.length < len) out += BASE62[b % 62];
  }
  return out;
}

export const API_KEY_PREFIX = 'ugw_';
export function generateApiKey(): { secret: string; prefix: string; hash: string } {
  const secret = API_KEY_PREFIX + randomBase62(32);
  return { secret, prefix: secret.slice(0, 12), hash: hashApiKey(secret) };
}
export function hashApiKey(secret: string): string {
  return crypto.createHmac('sha256', config.apiKeyPepper).update(secret).digest('hex');
}

// --- Passwords: scrypt ----------------------------------------------------------------------

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
export async function hashPassword(pw: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(pw, salt, 32, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export async function verifyPassword(pw: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [alg, N, r, p, salt, hash] = stored.split('$');
  if (alg !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const got = await scrypt(pw, Buffer.from(salt, 'base64'), expected.length, { N: +N!, r: +r!, p: +p!, maxmem: SCRYPT.maxmem });
  return crypto.timingSafeEqual(got, expected);
}

// --- Signed tokens (sessions, chat-agent tokens, MCP session ids) ----------------------------
// payload.base64url + "." + HMAC-SHA256. Purpose-bound via `typ` so one kind cannot be replayed
// as another.

export function signToken(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.sessionSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}
export function verifyToken<T extends { typ: string; exp?: number }>(token: string, typ: T['typ']): T | undefined {
  const [body, sig] = token.split('.');
  if (!body || !sig) return undefined;
  const expected = crypto.createHmac('sha256', config.sessionSecret).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return undefined;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as T;
    if (payload.typ !== typ) return undefined;
    if (payload.exp !== undefined && payload.exp < Date.now() / 1000) return undefined;
    return payload;
  } catch {
    return undefined;
  }
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
