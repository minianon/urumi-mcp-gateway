function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const config = {
  port: Number(process.env.PORT ?? 3000),
  /** In-cluster address of WordPress, e.g. http://wordpress.store-main.svc.cluster.local */
  wooBaseUrl: required('WOO_BASE_URL').replace(/\/$/, ''),
  /**
   * The store's public home URL (WP_HOME). WooCommerce builds the OAuth 1.0a signature base string
   * from get_home_url(), not from the Host we actually connect to, so we must sign with it.
   */
  wooPublicUrl: required('WOO_PUBLIC_URL').replace(/\/$/, ''),
  consumerKey: required('WOO_CONSUMER_KEY'),
  consumerSecret: required('WOO_CONSUMER_SECRET'),
  /** Bearer token the gateway must present. Only the gateway holds it. */
  authToken: required('MCP_AUTH_TOKEN'),
  storeName: process.env.STORE_NAME ?? 'WooCommerce store',
  storeTimezone: process.env.STORE_TIMEZONE ?? 'UTC',
  requestTimeoutMs: Number(process.env.REQUEST_TIMEOUT_MS ?? 8000),
};
