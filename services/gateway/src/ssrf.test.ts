import assert from 'node:assert/strict';
import { test } from 'node:test';

process.env.PUBLIC_URL ??= 'http://test';
process.env.DATABASE_URL ??= 'postgres://test';
process.env.SESSION_SECRET ??= 'test';
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32).toString('base64');
process.env.API_KEY_PEPPER ??= 'test';
const { isBlockedAddress } = await import('./ssrf.ts');

test('blocks private, loopback, link-local and metadata addresses in every spelling', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.16.3.4', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00:ec2::254', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:a9fe:a9fe']) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('allows public addresses (regression: a ::ffff:0:0/96 rule once blocked all of IPv4)', () => {
  for (const ip of ['35.83.233.137', '8.8.8.8', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});
