import { createReadStream, realpathSync, statSync } from 'node:fs';
import { once } from 'node:events';
import { request as requestHttp } from 'node:http';
import { request as requestHttps } from 'node:https';
import { isAbsolute } from 'node:path';
import { Readable } from 'node:stream';
import { logApiRequest } from './trace-log.js';

const fileBase64Values = new WeakSet();
const base64ChunkSize = 192 * 1024;

export function fileBase64JsonValue(path, mime) {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error('Base64 file JSON values require an absolute file path.');
  }
  if (typeof mime !== 'string' || !/^[\w.+-]+\/[\w.+-]+$/.test(mime)) {
    throw new Error('Base64 file JSON values require a valid MIME type.');
  }

  const resolvedPath = realpathSync.native(path);
  const file = statSync(resolvedPath);
  if (!file.isFile()) throw new Error('Base64 file JSON values require a regular file.');

  const value = { path: resolvedPath, mime, size: file.size };
  fileBase64Values.add(value);
  return value;
}

export function createJsonRequestBody(value, signal) {
  return {
    body: Readable.from(serializeJson(value, signal)),
    contentLength: jsonByteLength(value),
  };
}

function serializeRequestBody(value) {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, (key, item) => (
      item && typeof item === 'object' && fileBase64Values.has(item)
        ? '[base64 file attachment]'
        : item
    ), 2) ?? '';
  } catch {
    return String(value);
  }
}

export async function sendJsonRequest(url, { headers = {}, value, signal, logContext } = {}) {
  const serialized = createJsonRequestBody(value, signal);
  const target = new URL(url);
  const requestTransport = target.protocol === 'https:' ? requestHttps : requestHttp;
  let resolveResponse;
  let rejectResponse;
  const responsePromise = new Promise((resolve, reject) => {
    resolveResponse = resolve;
    rejectResponse = reject;
  });
  void responsePromise.catch(() => {});
  const requestHeaders = {
    ...headers,
    'Content-Length': String(serialized.contentLength),
  };
  const request = requestTransport(target, {
    method: 'POST',
    headers: requestHeaders,
    signal,
  }, async (response) => {
    const responseHeaders = new Headers();
    for (const [name, headerValue] of Object.entries(response.headers)) {
      for (const value of Array.isArray(headerValue) ? headerValue : [headerValue]) {
        if (value !== undefined) responseHeaders.append(name, String(value));
      }
    }
    const httpResponse = new Response(Readable.toWeb(response), {
      status: response.statusCode,
      statusText: response.statusMessage,
      headers: responseHeaders,
    });
    if (response.statusCode >= 400) {
      let bodyText = '';
      try {
        bodyText = await httpResponse.text();
      } catch {
        bodyText = '';
      }
      logApiRequest({
        ...logContext,
        method: 'POST',
        url: target.href,
        headers: Object.entries(requestHeaders),
        body: serializeRequestBody(value),
        response: {
          status: response.statusCode,
          statusText: response.statusMessage,
          headers: [...responseHeaders.entries()],
          body: bodyText,
        },
      });
      resolveResponse(new Response(bodyText, {
        status: response.statusCode,
        statusText: response.statusMessage,
        headers: responseHeaders,
      }));
      return;
    }
    resolveResponse(httpResponse);
  });
  request.once('error', (error) => {
    logApiRequest({
      ...logContext,
      method: 'POST',
      url: target.href,
      headers: Object.entries(requestHeaders),
      body: serializeRequestBody(value),
      error: error.message,
    });
    rejectResponse(new TypeError(error.message, { cause: error }));
  });

  try {
    for await (const chunk of serialized.body) {
      signal?.throwIfAborted();
      if (!request.write(chunk)) await once(request, 'drain', { signal });
    }
    request.end();
    return await responsePromise;
  } catch (error) {
    request.destroy();
    throw signal?.aborted && signal.reason instanceof Error ? signal.reason : error;
  }
}

async function* serializeJson(value, signal) {
  signal?.throwIfAborted();
  if (value && typeof value === 'object' && fileBase64Values.has(value)) {
    const current = statSync(value.path);
    if (!current.isFile() || current.size !== value.size) {
      throw new Error('The attachment changed before it could be uploaded.');
    }
    const prefix = JSON.stringify(`data:${value.mime};base64,`);
    yield Buffer.from(prefix.slice(0, -1));
    let remainder = Buffer.alloc(0);
    for await (const chunk of createReadStream(value.path, {
      highWaterMark: base64ChunkSize,
      signal,
    })) {
      signal?.throwIfAborted();
      const bytes = remainder.length > 0 ? Buffer.concat([remainder, chunk]) : chunk;
      const encodedLength = bytes.length - (bytes.length % 3);
      if (encodedLength > 0) {
        yield Buffer.from(bytes.subarray(0, encodedLength).toString('base64'), 'ascii');
      }
      remainder = bytes.subarray(encodedLength);
    }
    if (remainder.length > 0) yield Buffer.from(remainder.toString('base64'), 'ascii');
    yield Buffer.from('"');
    return;
  }

  if (Array.isArray(value)) {
    yield Buffer.from('[');
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) yield Buffer.from(',');
      const item = value[index];
      yield* serializeJson(
        item === undefined || typeof item === 'function' || typeof item === 'symbol' ? null : item,
        signal,
      );
    }
    yield Buffer.from(']');
    return;
  }

  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') {
      yield* serializeJson(value.toJSON(), signal);
      return;
    }
    yield Buffer.from('{');
    let written = false;
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
      if (written) yield Buffer.from(',');
      yield Buffer.from(`${JSON.stringify(key)}:`);
      yield* serializeJson(item, signal);
      written = true;
    }
    yield Buffer.from('}');
    return;
  }

  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  yield Buffer.from(serialized);
}

function jsonByteLength(value) {
  if (value && typeof value === 'object' && fileBase64Values.has(value)) {
    return Buffer.byteLength(JSON.stringify(`data:${value.mime};base64,`))
      + (4 * Math.ceil(value.size / 3));
  }
  if (Array.isArray(value)) {
    return 2 + Math.max(0, value.length - 1) + value.reduce((total, item) => (
      total + jsonByteLength(
        item === undefined || typeof item === 'function' || typeof item === 'symbol' ? null : item,
      )
    ), 0);
  }
  if (value && typeof value === 'object') {
    if (typeof value.toJSON === 'function') return jsonByteLength(value.toJSON());
    const entries = Object.keys(value).filter((key) => {
      const item = value[key];
      return item !== undefined && typeof item !== 'function' && typeof item !== 'symbol';
    });
    return 2 + Math.max(0, entries.length - 1) + entries.reduce((total, key) => (
      total + Buffer.byteLength(JSON.stringify(key)) + 1 + jsonByteLength(value[key])
    ), 0);
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError('Value is not JSON serializable.');
  return Buffer.byteLength(serialized);
}
