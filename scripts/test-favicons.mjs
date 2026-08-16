import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getFaviconDataUrl, isPublicAddress } from '../src/main/favicons.js';

const directory = await mkdtemp(join(tmpdir(), 'avi-favicons-test-'));
const icon = Buffer.from([0, 0, 1, 0, 1, 0]);
const publicLookup = async () => [{ address: '93.184.216.34', family: 4 }];

try {
  let requests = 0;
  const requestImpl = async (url) => {
    requests += 1;
    assert.equal(url.href, 'https://example.com/favicon.ico');
    return { body: icon, contentType: 'image/x-icon' };
  };
  const [first, duplicate] = await Promise.all([
    getFaviconDataUrl('https://example.com/one', { directory, lookupImpl: publicLookup, requestImpl }),
    getFaviconDataUrl('https://example.com/two', { directory, lookupImpl: publicLookup, requestImpl }),
  ]);
  assert.equal(first, `data:image/x-icon;base64,${icon.toString('base64')}`);
  assert.equal(duplicate, first);
  assert.equal(requests, 1);
  assert.equal((await readdir(directory)).length, 1);

  let insecureRequests = 0;
  await getFaviconDataUrl('http://example.com/page', {
    directory,
    lookupImpl: publicLookup,
    requestImpl: async () => {
      insecureRequests += 1;
      return { body: Buffer.from('http'), contentType: 'image/png' };
    },
  });
  assert.equal(insecureRequests, 1);
  assert.equal((await readdir(directory)).length, 2);

  let privateRequestReached = false;
  const privateResult = await getFaviconDataUrl('http://127.0.0.1/private', {
    directory,
    requestImpl: async () => {
      privateRequestReached = true;
      return { body: icon, contentType: 'image/x-icon' };
    },
  });
  assert.equal(privateResult, null);
  assert.equal(privateRequestReached, false);

  let redirectRequests = 0;
  const redirectResult = await getFaviconDataUrl('https://redirect.example/page', {
    directory,
    lookupImpl: async (hostname) => hostname === 'redirect.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '10.0.0.1', family: 4 }],
    requestImpl: async () => {
      redirectRequests += 1;
      return { redirect: 'http://internal.example/favicon.ico' };
    },
  });
  assert.equal(redirectResult, null);
  assert.equal(redirectRequests, 1);

  let traversalRequestReached = false;
  const traversalResult = await getFaviconDataUrl('http://../page', {
    directory,
    lookupImpl: async () => [{ address: '127.0.0.1', family: 4 }],
    requestImpl: async () => {
      traversalRequestReached = true;
      return { body: icon, contentType: 'image/x-icon' };
    },
  });
  assert.equal(traversalResult, null);
  assert.equal(traversalRequestReached, false);
  assert.equal((await readdir(join(directory, '..'))).includes('favicon.ico'), false);

  const oversized = await getFaviconDataUrl('https://oversized.example/page', {
    directory,
    lookupImpl: publicLookup,
    requestImpl: async () => ({
      body: Buffer.alloc(256 * 1024 + 1),
      contentType: 'image/png',
    }),
  });
  assert.equal(oversized, null);

  for (const address of [
    '127.0.0.1',
    '10.0.0.1',
    '169.254.1.1',
    '192.168.1.1',
    '::1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '::127.0.0.1',
    '::7f00:1',
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('::ffff:5db8:d822'), true);
  assert.equal(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);

  let publicIpv6Addresses;
  const publicIpv6Result = await getFaviconDataUrl('https://[2606:2800:220:1:248:1893:25c8:1946]/', {
    directory,
    requestImpl: async (_url, addresses) => {
      publicIpv6Addresses = addresses;
      return { body: icon, contentType: 'image/x-icon' };
    },
  });
  assert.ok(publicIpv6Result);
  assert.deepEqual(publicIpv6Addresses, [{
    address: '2606:2800:220:1:248:1893:25c8:1946',
    family: 6,
  }]);

  console.log('favicon cache tests passed');
} finally {
  await rm(directory, { recursive: true, force: true });
}
