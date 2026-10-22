#!/usr/bin/env node
// End-to-end check of the gateway's definition-of-done flow, using the official MCP SDK client.
//
//   BASE_URL=http://app.127.0.0.1.nip.io ADMIN_EMAIL=admin@urumi.local ADMIN_PASSWORD=... node tests/e2e.mjs
//
// It creates a member ("user B"), API keys for both users, then verifies: aggregated tool list,
// routing, name-collision prefixes, role-based tool hiding, key revocation, disabling a server,
// and that every call shows up in the audit log under the right user. It cleans up after itself.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const BASE = (process.env.BASE_URL ?? 'http://localhost:8080').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@urumi.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
if (!ADMIN_PASSWORD) throw new Error('Set ADMIN_PASSWORD');

let failures = 0;
const ok = (cond, msg) => {
  console.log(`${cond ? '  PASS' : '  FAIL'}  ${msg}`);
  if (!cond) failures++;
};
const step = (s) => console.log(`\n== ${s}`);

/** Tiny cookie-jar API client for the dashboard API. */
function session() {
  let cookie = '';
  return async function api(method, path, body) {
    const res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Urumi-CSRF': '1', ...(cookie ? { Cookie: cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const data = await res.json().catch(() => null);
    if (!res.ok) throw Object.assign(new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(data)}`), { status: res.status });
    return data;
  };
}

async function mcp(key) {
  const client = new Client({ name: 'urumi-e2e', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
  return client;
}
const text = (r) => r.content?.map((c) => c.text ?? '').join('\n') ?? '';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const admin = session();
const member = session();
const stamp = Date.now().toString(36);
const memberEmail = `e2e-${stamp}@urumi.local`;
let memberId, supplier;

try {
  step('admin login + servers');
  await admin('POST', '/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
  const servers = await admin('GET', '/servers');
  for (const s of servers) console.log(`        ${s.slug.padEnd(14)} ${s.status.padEnd(12)} tools=${s.toolCount} ${s.statusReason ?? ''}`);
  supplier = servers.find((s) => s.slug === 'supplier');
  ok(servers.some((s) => s.slug === 'woocommerce' && s.managed), 'WooCommerce server is pre-registered (managed by Helm)');
  ok(servers.every((s) => !('credential' in s)), 'API never returns upstream credentials');

  step('invite member B, accept invite');
  const inv = await admin('POST', '/users/invite', { email: memberEmail, name: 'E2E Member', role: 'member' });
  memberId = inv.user.id;
  const token = inv.inviteUrl.split('/invite/')[1];
  await member('POST', '/auth/accept-invite', { token, password: 'e2e-password-123' });
  ok((await member('GET', '/auth/me')).user.role === 'member', 'member can log in after accepting the invite');

  step('API keys');
  const keyA = await admin('POST', '/keys', { name: 'e2e admin' });
  const keyB = await member('POST', '/keys', { name: 'e2e member' });
  ok(keyB.secret.startsWith('ugw_'), `member generated own key (${keyB.key.prefix}…)`);
  let denied = false;
  try {
    await member('GET', '/users');
  } catch (e) {
    denied = e.status === 403;
  }
  ok(denied, 'member cannot manage users (403)');

  step('external MCP client as member B');
  const b = await mcp(keyB.secret);
  const toolsB = (await b.listTools()).tools.map((t) => t.name);
  console.log(`        ${toolsB.length} tools: ${toolsB.join(', ')}`);
  ok(toolsB.includes('supplier__list_products'), 'tools are prefixed with their server slug');
  ok(!toolsB.includes('woocommerce__create_product'), 'admin-only tool hidden from member');
  const quote = await b.callTool({ name: 'supplier__get_quote', arguments: { sku: 'NW-MUG-001', quantity: 100, currency: 'INR' } });
  ok(!quote.isError && text(quote).includes('NW-MUG-001'), 'call routed to supplier server');
  let rejected = false;
  try {
    await b.callTool({ name: 'woocommerce__create_product', arguments: { name: 'x', regular_price: '1' } });
  } catch (e) {
    rejected = /requires the admin role/.test(e.message);
  }
  ok(rejected, 'direct call to admin-only tool is rejected');
  const orders = await b.callTool({ name: 'woocommerce__list_orders', arguments: { period: 'today' } });
  console.log(`        woocommerce__list_orders -> ${orders.isError ? 'ERROR ' : ''}${text(orders).slice(0, 160).replace(/\s+/g, ' ')}`);

  step('admin sees write tools');
  const a = await mcp(keyA.secret);
  ok((await a.listTools()).tools.some((t) => t.name === 'woocommerce__create_product'), 'admin sees woocommerce__create_product');

  step('disable supplier server');
  if (supplier) {
    await admin('PATCH', `/servers/${supplier.id}`, { enabled: false });
    await sleep(500);
    const after = (await a.listTools()).tools.map((t) => t.name);
    ok(!after.some((n) => n.startsWith('supplier__')), 'supplier tools disappear from tools/list');
    const r = await a.callTool({ name: 'supplier__list_products', arguments: {} }).catch((e) => ({ isError: true, content: [{ text: e.message }] }));
    ok(r.isError, `call to disabled server fails clearly: ${text(r).slice(0, 80)}`);
    await admin('PATCH', `/servers/${supplier.id}`, { enabled: true });
  }

  step('revoke member key');
  await admin('DELETE', `/keys/${keyB.key.id}`);
  let unauthorized = false;
  try {
    await b.listTools();
  } catch (e) {
    unauthorized = /401|Unauthorized/i.test(e.message);
  }
  ok(unauthorized, 'next call with revoked key is rejected (401)');
  await a.close();

  step('audit log');
  await sleep(300);
  const audit = await admin('GET', `/audit?userId=${memberId}&limit=50`);
  const kinds = audit.items.map((i) => `${i.method}:${i.exposedName ?? '-'}:${i.outcome}`);
  console.log(`        ${kinds.slice(0, 8).join('\n        ')}`);
  ok(audit.items.some((i) => i.exposedName === 'supplier__get_quote' && i.outcome === 'success'), 'successful call attributed to member');
  ok(audit.items.some((i) => i.exposedName === 'woocommerce__create_product' && i.outcome === 'denied'), 'denied call is audited');
  ok(audit.items.some((i) => i.outcome === 'unauthorized'), 'revoked-key attempt is audited');
  const own = await member('GET', '/audit?limit=50');
  ok(own.items.every((i) => i.userId === memberId), 'member only sees their own audit rows');
} catch (err) {
  failures++;
  console.error('\nUNEXPECTED ERROR:', err);
} finally {
  if (memberId) await admin('DELETE', `/users/${memberId}`).catch(() => {});
  if (supplier) await admin('PATCH', `/servers/${supplier.id}`, { enabled: true }).catch(() => {});
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
