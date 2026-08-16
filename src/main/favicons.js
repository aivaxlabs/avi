import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';
import { isIP } from 'node:net';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

const faviconRequests = new Map();
const maximumFaviconBytes = 256 * 1024;
const maximumRedirects = 3;

export function isPublicAddress(address) {
  const normalized = address.toLowerCase().split('%', 1)[0];
  if (normalized.includes(':')) {
    if (normalized.startsWith('::ffff:')) {
      const mapped = normalized.slice('::ffff:'.length);
      if (mapped.includes('.')) return isPublicAddress(mapped);
      const groups = mapped.split(':');
      if (groups.length !== 2 || groups.some((group) => !/^[\da-f]{1,4}$/.test(group))) return false;
      const high = Number.parseInt(groups[0], 16);
      const low = Number.parseInt(groups[1], 16);
      return isPublicAddress(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }

    const firstGroup = normalized.split(':', 1)[0];
    const firstValue = Number.parseInt(firstGroup, 16);
    return firstValue >= 0x2000
      && firstValue <= 0x3fff
      && !normalized.startsWith('2001:db8:');
  }

  const octets = normalized.split('.').map(Number);
  return octets.length === 4
    && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)
    && octets[0] !== 0
    && octets[0] !== 10
    && octets[0] !== 127
    && octets[0] < 224
    && !(octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127)
    && !(octets[0] === 169 && octets[1] === 254)
    && !(octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
    && !(octets[0] === 192 && octets[1] === 0 && octets[2] === 0)
    && !(octets[0] === 192 && octets[1] === 0 && octets[2] === 2)
    && !(octets[0] === 192 && octets[1] === 168)
    && !(octets[0] === 198 && octets[1] >= 18 && octets[1] <= 19)
    && !(octets[0] === 198 && octets[1] === 51 && octets[2] === 100)
    && !(octets[0] === 203 && octets[1] === 0 && octets[2] === 113);
}

async function requestFavicon(url, options, redirects = 0) {
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || redirects > maximumRedirects) {
    return null;
  }

  const hostname = url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname;
  const literalAddress = isIP(hostname) ? hostname : null;
  const addresses = literalAddress
    ? [{ address: literalAddress, family: isIP(literalAddress) }]
    : await (options.lookupImpl ?? lookup)(hostname, { all: true, verbatim: true });
  const publicAddresses = addresses.filter(({ address }) => isPublicAddress(address));
  if (publicAddresses.length !== addresses.length || publicAddresses.length === 0) return null;

  if (options.requestImpl) {
    const response = await options.requestImpl(url, publicAddresses);
    if (response?.redirect) {
      return requestFavicon(new URL(response.redirect, url), options, redirects + 1);
    }
    if (!response?.body || response.body.length === 0 || response.body.length > maximumFaviconBytes) {
      return null;
    }
    const contentType = response.contentType?.split(';', 1)[0].trim().toLowerCase();
    if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
      return null;
    }
    return {
      body: Buffer.from(response.body),
      contentType: contentType?.startsWith('image/') ? contentType : 'image/x-icon',
    };
  }

  const response = await new Promise((resolveRequest, rejectRequest) => {
    const get = url.protocol === 'https:' ? httpsGet : httpGet;
    const request = get(url, {
      headers: { Accept: 'image/*' },
      signal: options.signal,
      lookup: (_hostname, lookupOptions, callback) => {
        const family = typeof lookupOptions === 'number' ? lookupOptions : lookupOptions?.family;
        const matching = publicAddresses.filter((entry) => !family || entry.family === family);
        const selected = matching[0] ?? publicAddresses[0];
        if (typeof lookupOptions === 'object' && lookupOptions.all) {
          callback(null, matching.length > 0 ? matching : [selected]);
          return;
        }
        callback(null, selected.address, selected.family);
      },
    }, (incoming) => resolveRequest(incoming));
    request.on('error', rejectRequest);
  });

  if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
    response.resume();
    return requestFavicon(new URL(response.headers.location, url), options, redirects + 1);
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    response.resume();
    return null;
  }

  const contentType = response.headers['content-type']?.split(';', 1)[0].trim().toLowerCase();
  if (contentType && !contentType.startsWith('image/') && contentType !== 'application/octet-stream') {
    response.resume();
    return null;
  }
  const contentLength = Number(response.headers['content-length']);
  if (Number.isFinite(contentLength) && contentLength > maximumFaviconBytes) {
    response.resume();
    return null;
  }

  const chunks = [];
  let byteLength = 0;
  for await (const chunk of response) {
    byteLength += chunk.length;
    if (byteLength > maximumFaviconBytes) {
      response.destroy();
      return null;
    }
    chunks.push(chunk);
  }
  if (byteLength === 0) return null;
  return {
    body: Buffer.concat(chunks),
    contentType: contentType?.startsWith('image/') ? contentType : 'image/x-icon',
  };
}

export async function getFaviconDataUrl(url, options = {}) {
  const target = new URL(url);
  if (!['http:', 'https:'].includes(target.protocol) || !target.hostname) {
    throw new Error('Only HTTP and HTTPS links with a host can have favicons.');
  }

  const cacheKey = target.origin.toLowerCase();
  if (faviconRequests.has(cacheKey)) return faviconRequests.get(cacheKey);

  const request = (async () => {
    const cacheRoot = resolve(options.directory ?? resolve(tmpdir(), '.avi', 'favicons'));
    const directory = resolve(cacheRoot, createHash('sha256').update(cacheKey).digest('hex'));
    const faviconPath = resolve(directory, 'favicon.ico');

    try {
      const cached = await readFile(faviconPath);
      if (cached.length > 0 && cached.length <= maximumFaviconBytes) {
        return `data:image/x-icon;base64,${cached.toString('base64')}`;
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5_000);
    try {
      const favicon = await requestFavicon(
        new URL('/favicon.ico', target.origin),
        { ...options, signal: controller.signal },
      );
      if (!favicon) return null;
      await mkdir(directory, { recursive: true });
      await writeFile(faviconPath, favicon.body);
      return `data:${favicon.contentType};base64,${favicon.body.toString('base64')}`;
    } finally {
      clearTimeout(timeout);
    }
  })();

  faviconRequests.set(cacheKey, request);
  try {
    return await request;
  } catch {
    faviconRequests.delete(cacheKey);
    return null;
  }
}
