import crypto from 'node:crypto';

/**
 * OAuth 1.0a one-legged signing, exactly as WooCommerce verifies it.
 *
 * Why OAuth 1.0a and not Basic auth: WooCommerce only accepts Basic auth over HTTPS (is_ssl()).
 * Inside the cluster we talk plain HTTP to the WordPress Service, so WooCommerce falls back to
 * OAuth 1.0a. That is actually the better property: the consumer secret never crosses the network,
 * each request is HMAC-signed with a timestamp + nonce, so a sniffed request cannot be replayed or
 * altered.
 *
 * WooCommerce's verifier (WC_REST_Authentication::check_oauth_signature) differs slightly from
 * RFC 5849, so we mirror it:
 *  - params = query string params + oauth_* params (JSON bodies are not signed)
 *  - keys sorted with strcmp on the raw keys, then key and value rawurlencode()d once
 *  - joined with "%3D" and "%26" (i.e. not double-encoded like the RFC)
 *  - base URI = rawurlencode(get_home_url(path)) with the scheme forced to http when the request
 *    itself is not over TLS. That is why we sign against the public host with an http:// scheme
 *    even though we connect to the in-cluster Service address.
 */

/** PHP rawurlencode(): RFC 3986 unreserved chars only. */
export function rawurlencode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

export function signRequest(opts: {
  method: string;
  signingBaseUrl: string; // e.g. http://store.example.com (no trailing slash)
  path: string; // e.g. /wp-json/wc/v3/products
  query: Record<string, string>;
  consumerKey: string;
  consumerSecret: string;
}): Record<string, string> {
  const params: Record<string, string> = {
    ...opts.query,
    oauth_consumer_key: opts.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
  };

  const normalized = Object.keys(params)
    .sort() // ASCII keys: JS code-unit order == PHP strcmp
    .map((k) => `${rawurlencode(k)}%3D${rawurlencode(params[k]!)}`)
    .join('%26');

  const base = [opts.method.toUpperCase(), rawurlencode(opts.signingBaseUrl + opts.path), normalized].join('&');
  const signature = crypto.createHmac('sha256', `${opts.consumerSecret}&`).update(base).digest('base64');

  return { ...params, oauth_signature: signature };
}

export function toQueryString(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${rawurlencode(k)}=${rawurlencode(v)}`)
    .join('&');
}
