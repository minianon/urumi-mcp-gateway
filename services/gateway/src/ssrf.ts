import dns from 'node:dns';
import net from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import { config } from './config.ts';

/**
 * SSRF protection for admin-supplied upstream URLs.
 *
 * Two layers:
 *  1. validateUpstreamUrl() at create/edit time gives the admin a clear error.
 *  2. safeFetch() re-checks the *resolved IP at connect time* (undici `connect.lookup`). That
 *     closes the DNS-rebinding gap where a hostname resolves to a public IP during validation and
 *     to 169.254.169.254 or a cluster IP a second later, and it also covers redirects.
 *
 * Cluster-internal MCP servers that the platform itself deploys are allowed by exact hostname
 * (SSRF_ALLOWED_HOSTS, plus every Helm bootstrap server). NetworkPolicy egress rules on the
 * gateway pod are the third, independent layer.
 */

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, incl. cloud metadata 169.254.169.254
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
] as const)
  blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['fc00::', 7], // unique local (incl. fd00:ec2::254 AWS metadata)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
  ['64:ff9b::', 96], // NAT64
  // No ::ffff:0:0/96 rule: BlockList treats IPv4-mapped IPv6 and IPv4 as the same address, so
  // that rule would block every IPv4 address. Mapped addresses are matched by the IPv4 rules.
] as const)
  blocked.addSubnet(addr, prefix, 'ipv6');

export function isBlockedAddress(ip: string): boolean {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); // IPv4-mapped IPv6
  if (mapped) return blocked.check(mapped[1]!, 'ipv4');
  return blocked.check(ip, net.isIPv6(ip) ? 'ipv6' : 'ipv4');
}

const extraAllowed = new Set<string>();
/** Called at startup with the hostnames of Helm-managed upstream servers. */
export function allowHost(hostname: string) {
  extraAllowed.add(hostname.toLowerCase());
}
const isAllowedHost = (hostname: string) => {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  return config.ssrf.allowedHosts.includes(h) || extraAllowed.has(h);
};

export class SsrfError extends Error {}

export async function validateUpstreamUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new SsrfError('Not a valid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new SsrfError('Only http(s) URLs are allowed');
  if (url.username || url.password) throw new SsrfError('Put credentials in the credential field, not in the URL');
  if (!config.ssrf.enabled || isAllowedHost(url.hostname)) return url;

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.promises.lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new SsrfError(`Cannot resolve ${host}`);
  const bad = addrs.find((a) => isBlockedAddress(a.address));
  if (bad) throw new SsrfError(`${host} resolves to ${bad.address}, a private/internal address. Internal servers must be allow-listed by the platform operator.`);
  return url;
}

type LookupCb = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function guardedLookup(hostname: string, options: dns.LookupOptions, cb: LookupCb) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return cb(err, []);
    if (config.ssrf.enabled && !isAllowedHost(hostname)) {
      const bad = addresses.find((a) => isBlockedAddress(a.address));
      if (bad) {
        const e: NodeJS.ErrnoException = new Error(`SSRF guard: ${hostname} resolved to internal address ${bad.address}`);
        e.code = 'ESSRF';
        return cb(e, []);
      }
    }
    if (options.all) cb(null, addresses);
    else cb(null, addresses[0]!.address, addresses[0]!.family);
  });
}

const agent = new Agent({
  connect: { lookup: guardedLookup as never, timeout: config.upstream.connectTimeoutMs },
  keepAliveTimeout: 30_000,
});

/** fetch() for all upstream traffic. Same signature as global fetch (the MCP SDK's FetchLike). */
export const safeFetch = ((url: string | URL, init?: RequestInit) =>
  undiciFetch(url, { ...(init as object), dispatcher: agent } as never)) as unknown as typeof fetch;
