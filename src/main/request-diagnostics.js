import { AsyncLocalStorage } from 'node:async_hooks';
import { isRequestLoggingEnabled, logApiRequest } from './trace-log.js';

const operations = new AsyncLocalStorage();
const captures = new WeakMap();
const reportedErrors = new WeakSet();
const maximumCaptureBytes = 8 * 1024 * 1024;

export async function withRequestDiagnostics(details, action) {
  if (!isRequestLoggingEnabled()) return action();
  const operation = { details, requests: [] };
  return operations.run(operation, async () => {
    try {
      return await action();
    } catch (error) {
      reportRequestFailure(error);
      throw error;
    } finally {
      for (const capture of operation.requests) capture.chunks.length = 0;
      operation.requests.length = 0;
    }
  });
}

export function reportRequestFailure(error, response, request) {
  if (!isRequestLoggingEnabled()) return;
  if (error && typeof error === 'object') {
    if (reportedErrors.has(error)) return;
    reportedErrors.add(error);
  }
  const operation = operations.getStore();
  const capture = response ? captures.get(response) : request ? null : operation?.requests.at(-1);
  if (capture?.logged) return;
  if (capture) capture.logged = true;
  logApiRequest({
    ...operation?.details,
    ...capture?.request,
    ...request,
    response: capture && {
      status: capture.status,
      statusText: capture.statusText,
      headers: capture.headers,
      body: Buffer.concat(capture.chunks).toString('utf8')
        + (capture.truncated ? '\n[Capture truncated at 8 MiB]' : ''),
    },
    error: error instanceof Error ? error.stack ?? error.message : String(error?.message ?? error),
  });
}

export function captureResponse(response, request, source) {
  if (!isRequestLoggingEnabled() || captures.has(response)) return response;
  if (source && captures.has(source)) {
    captures.set(response, captures.get(source));
    return response;
  }
  const capture = {
    request,
    status: response.status,
    statusText: response.statusText,
    headers: [...response.headers.entries()],
    chunks: [],
    bytes: 0,
    truncated: false,
    logged: false,
  };
  const operation = operations.getStore();
  if (operation) {
    operation.requests.push(capture);
    if (operation.requests.length > 4) operation.requests.shift();
  }
  const reader = response.body?.getReader();
  const body = reader && new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        const remaining = maximumCaptureBytes - capture.bytes;
        if (remaining > 0) {
          const bytes = Buffer.from(value.subarray(0, remaining));
          capture.chunks.push(bytes);
          capture.bytes += bytes.length;
        }
        if (value.byteLength > remaining) capture.truncated = true;
        controller.enqueue(value);
      } catch (error) {
        reportRequestFailure(error, wrapped);
        controller.error(error);
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  }, { highWaterMark: 0 });
  const wrapped = new Response(body ?? null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
  captures.set(wrapped, capture);
  Object.defineProperties(wrapped, {
    url: { value: response.url },
    redirected: { value: response.redirected },
    type: { value: response.type },
  });
  for (const method of ['json', 'text', 'arrayBuffer', 'blob', 'formData']) {
    const consume = wrapped[method].bind(wrapped);
    wrapped[method] = async (...args) => {
      try {
        return await consume(...args);
      } catch (error) {
        reportRequestFailure(error, wrapped);
        throw error;
      }
    };
  }
  return wrapped;
}

export async function diagnosticFetch(url, init = {}) {
  if (!isRequestLoggingEnabled()) return globalThis.fetch(url, init);
  const request = {
    method: init.method ?? (url instanceof Request ? url.method : 'GET'),
    url: url instanceof Request ? url.url : String(url),
    headers: [...new Headers(init.headers ?? (url instanceof Request ? url.headers : undefined)).entries()],
    body: typeof init.body === 'string' ? init.body : init.body ? '[Non-text request body omitted]' : '',
  };
  let response;
  try {
    response = captureResponse(await globalThis.fetch(url, init), request);
    if (!response.ok) {
      const bytes = await response.arrayBuffer();
      reportRequestFailure(new Error(`HTTP ${response.status} ${response.statusText}`), response);
      const replay = new Response(bytes.byteLength ? bytes : null, { status: response.status, statusText: response.statusText, headers: response.headers });
      Object.defineProperties(replay, {
        url: { value: response.url },
        redirected: { value: response.redirected },
        type: { value: response.type },
      });
      return captureResponse(replay, request, response);
    }
    return response;
  } catch (error) {
    if (response) reportRequestFailure(error, response);
    else reportRequestFailure(error, undefined, request);
    throw error;
  }
}
