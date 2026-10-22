import { config } from './config.ts';
import { signRequest, toQueryString } from './oauth.ts';

export class WooError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

/** Signing always uses http:// + the public host; see oauth.ts for why. */
const signingBase = (() => {
  const u = new URL(config.wooPublicUrl);
  return `http://${u.host}${u.pathname.replace(/\/$/, '')}`;
})();

async function send(method: 'GET' | 'POST' | 'PUT', endpoint: string, query: Query, body?: unknown) {
  const path = `/wp-json/wc/v3${endpoint}`;
  const cleanQuery: Record<string, string> = {};
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') cleanQuery[k] = String(v);

  const signed = signRequest({
    method,
    signingBaseUrl: signingBase,
    path,
    query: cleanQuery,
    consumerKey: config.consumerKey,
    consumerSecret: config.consumerSecret,
  });

  let res: Response;
  try {
    res = await fetch(`${config.wooBaseUrl}${path}?${toQueryString(signed)}`, {
      method,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    });
  } catch (err) {
    const e = err as Error;
    if (e.name === 'TimeoutError') throw new WooError(504, 'store_timeout', `Store did not respond within ${config.requestTimeoutMs}ms`);
    throw new WooError(502, 'store_unreachable', `Could not reach the store: ${(e.cause as Error)?.message ?? e.message}`);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new WooError(res.status, 'bad_response', `Store returned a non-JSON response (HTTP ${res.status})`);
  }
  if (!res.ok) {
    const d = data as { code?: string; message?: string } | null;
    throw new WooError(res.status, d?.code ?? 'store_error', d?.message ?? `HTTP ${res.status}`);
  }
  return { data, headers: res.headers };
}

export async function wooRequest<T>(method: 'GET' | 'POST' | 'PUT', endpoint: string, query: Query = {}, body?: unknown): Promise<T> {
  return (await send(method, endpoint, query, body)).data as T;
}

/** GET a collection, including WooCommerce's pagination totals (sent as headers). */
export async function wooList<T>(endpoint: string, query: Query): Promise<{ items: T[]; total?: number; totalPages?: number }> {
  const { data, headers } = await send('GET', endpoint, query);
  const total = headers.get('x-wp-total');
  const totalPages = headers.get('x-wp-totalpages');
  return {
    items: data as T[],
    total: total ? Number(total) : undefined,
    totalPages: totalPages ? Number(totalPages) : undefined,
  };
}
