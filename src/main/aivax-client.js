import WebSocket from 'ws';
import { getAivaxAccessToken } from './database.js';
import { diagnosticFetch as fetch, withRequestDiagnostics } from './request-diagnostics.js';

const AIVAX_API_BASE_URL = 'https://inference.aivax.net';
export const AIVAX_LONG_INFERENCE_BASE_URL = 'https://direct.inference.aivax.net';

export async function loginToAivax(loginKey, { signal } = {}) {
  const key = String(loginKey ?? '').trim();
  if (!key) throw new Error('Enter your AIVAX login key.');
  return requestAivax('/api/v1/auth/login', {
    body: { loginKey: key },
    accessToken: null,
    responseType: 'object',
    signal,
  });
}

export async function requestAivax(path, {
  accessToken = getAivaxAccessToken(),
  baseUrl = AIVAX_API_BASE_URL,
  body,
  headers = {},
  includeResponseEnvelope = false,
  includeResponseMetadata = false,
  method = body === undefined ? 'GET' : 'POST',
  responseType,
  signal,
} = {}) {
  return withRequestDiagnostics({ method, url: new URL(path, baseUrl).href }, async () => {
  if (accessToken === undefined || accessToken === '') {
    throw new Error('Connect an AIVAX account in Settings first.');
  }

  const rawBody = body instanceof FormData || body instanceof Blob;
  const response = await fetch(new URL(path, baseUrl), {
    method,
    headers: {
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...(body === undefined || rawBody ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: rawBody ? body : JSON.stringify(body) }),
    signal,
  });
  const text = await response.text();
  let value = null;
  try {
    value = text ? JSON.parse(text) : null;
  } catch {
    value = text;
  }
  if (!response.ok) {
    const message = typeof value === 'object' && value
      ? value.error?.message ?? value.error ?? value.message
      : value;
    const error = new Error(message || `AIVAX returned ${response.status} ${response.statusText}.`);
    error.status = response.status;
    throw error;
  }
  const result = value && typeof value === 'object' && !Array.isArray(value) && 'data' in value
    ? value.data
    : value;
  if (responseType === 'array' && !Array.isArray(result)) {
    throw new Error('AIVAX returned an invalid response: expected an array.');
  }
  if (responseType === 'object' && (!result || typeof result !== 'object' || Array.isArray(result))) {
    throw new Error('AIVAX returned an invalid response: expected an object.');
  }
  if (includeResponseMetadata) {
    return {
      data: result,
      consumedCredits: Number(response.headers.get('Consumed-Credits')) || 0,
      status: response.status,
    };
  }
  if (includeResponseEnvelope) return value;
  return result;
  });
}

export async function summarizeWithAivax(text, instructions, options = {}) {
  const [summary] = await requestAivax('/api/v1/generations/summarize', {
    baseUrl: AIVAX_LONG_INFERENCE_BASE_URL,
    ...options,
    body: { instructions, documents: [{ type: 'text', text }] },
    responseType: 'array',
  });
  if (typeof summary !== 'string' || !summary.trim()) {
    throw new Error('AIVAX returned an empty summary.');
  }
  return summary.trim();
}

const IMPORT_FLUSH_BYTES = 256 * 1024;
const IMPORT_FLUSH_MS = 1_000;
const IMPORT_KEEPALIVE_MS = 15_000;
const IMPORT_MAX_BUFFERED_BYTES = 8 * 1024 * 1024;

export function aivaxImportUrl(collectionId, { sync = true, baseUrl = AIVAX_API_BASE_URL } = {}) {
  const url = new URL(
    `/api/v2/collections/${encodeURIComponent(collectionId)}/documents/index-jsonl`,
    baseUrl,
  );
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  if (sync) url.searchParams.set('insert-mode', 'sync');
  return url;
}

export function toImportLine(document) {
  const docId = document?.docId ?? document?.docid;
  if (typeof docId !== 'string' || !docId.trim() || document?.text == null) {
    throw new Error('Each JSONL line must contain docId and text.');
  }
  return {
    docId: docId.trim(),
    text: String(document.text),
    ...(document.__ref == null ? {} : { __ref: document.__ref }),
    ...(document.__tags == null ? {} : { __tags: document.__tags }),
    ...(document.__meta == null ? {} : { __meta: document.__meta }),
  };
}

export async function importAivaxDocuments(collectionId, documents, {
  accessToken = getAivaxAccessToken(),
  baseUrl,
  onProgress,
  signal,
  sync = true,
  WebSocket: Socket = WebSocket,
} = {}) {
  if (accessToken === undefined || accessToken === '') {
    throw new Error('Connect an AIVAX account in Settings first.');
  }

  const socket = new Socket(aivaxImportUrl(collectionId, { sync, baseUrl }), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  let buffer = '';
  let lastSentAt = Date.now();
  let failure = null;
  let settled = false;
  let resultResolve;
  let resultReject;
  const result = new Promise((resolve, reject) => {
    resultResolve = resolve;
    resultReject = reject;
  });
  result.catch(() => {});

  const fail = (error) => {
    if (settled) return;
    settled = true;
    failure = error;
    resultReject(error);
  };
  const succeed = (value) => {
    if (settled) return;
    settled = true;
    resultResolve(value);
  };

  socket.on('message', (data) => {
    let message;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      fail(error instanceof Error ? error : new Error('AIVAX sent an invalid import message.'));
      return;
    }
    if (message.type === 'progress') onProgress?.(message);
    else if (message.type === 'completed') succeed(message);
    else if (message.type === 'error') {
      fail(Object.assign(
        new Error(`${message.message} (line ${message.line}, ${message.committed} committed)`),
        { status: 0, committed: message.committed },
      ));
    }
  });
  socket.on('error', (error) => {
    fail(failure ?? (error instanceof Error ? error : new Error('Could not open the import WebSocket.')));
  });
  socket.on('unexpected-response', (_request, response) => {
    fail(Object.assign(
      new Error(`AIVAX refused the import connection (${response?.statusCode ?? 'unknown'}).`),
      { status: response?.statusCode },
    ));
    socket.terminate?.();
  });
  socket.on('close', (code, reason) => {
    if (settled) return;
    const text = Buffer.isBuffer(reason) ? reason.toString() : String(reason ?? '');
    fail(Object.assign(
      new Error(`Import connection closed (${code}${text ? `: ${text}` : ''}).`),
      { status: code },
    ));
  });

  const abort = () => {
    fail(new Error('The import was interrupted.'));
    socket.terminate?.() ?? socket.close?.();
  };
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });

  const flush = (force = false) => {
    if (failure) throw failure;
    if (!force && buffer.length === 0 && Date.now() - lastSentAt < IMPORT_KEEPALIVE_MS) return;
    socket.send(buffer || '\n');
    buffer = '';
    lastSentAt = Date.now();
  };
  const timer = setInterval(() => {
    if (failure || Date.now() - lastSentAt < IMPORT_FLUSH_MS) return;
    try {
      flush();
    } catch {
      // The result promise already rejected.
    }
  }, IMPORT_FLUSH_MS);
  timer.unref?.();

  try {
    if (socket.readyState !== 1) {
      await new Promise((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', () => reject(failure ?? new Error('Could not open the import WebSocket.')));
        socket.once('unexpected-response', () => reject(failure ?? new Error('Could not open the import WebSocket.')));
      });
    }
    for await (const document of documents) {
      buffer += `${JSON.stringify(toImportLine(document))}\n`;
      if (buffer.length >= IMPORT_FLUSH_BYTES) flush(true);
      while ((socket.bufferedAmount ?? 0) > IMPORT_MAX_BUFFERED_BYTES && !failure) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (failure) throw failure;
    }
    buffer += 'END\n';
    flush(true);
    const completed = await result;
    socket.close();
    return {
      received: completed.received ?? 0,
      updated: completed.updated ?? 0,
      skipped: completed.skipped ?? 0,
      removed: completed.removed ?? 0,
    };
  } catch (error) {
    socket.terminate?.() ?? socket.close?.();
    throw error;
  } finally {
    clearInterval(timer);
    signal?.removeEventListener('abort', abort);
  }
}

export function getDocumentEmbeddingUsage(timeStart, timeEnd, options = {}) {
  const search = new URLSearchParams({
    timeStart: timeStart.toISOString(),
    timeEnd: timeEnd.toISOString(),
  });
  return requestAivax(`/api/v1/information/usage?${search}`, {
    ...options,
    responseType: 'object',
  }).then((usage) => (usage?.usageDetails?.modelUsageDiscriminations ?? [])
    .filter((item) => item.category === 'embedding.tokenization.document')
    .reduce((total, item) => ({
      tokens: total.tokens + (Number(item.tokenCount) || 0),
      cost: total.cost + (Number(item.totalUsage) || 0),
    }), { tokens: 0, cost: 0 }));
}
