const SERVER_TYPES = new Set(['stdio', 'streamable-http', 'sse']);
const AUTH_TYPES = new Set(['auto', 'none', 'bearer', 'oauth2']);
const STDIO_FIELDS = new Set(['type', 'enabled', 'command', 'args', 'cwd', 'env']);
const REMOTE_FIELDS = new Set(['type', 'enabled', 'url', 'headers', 'auth']);
const AUTH_FIELDS = new Set(['type', 'token', 'clientId', 'clientSecret']);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function normalizeMcpServer(value) {
  const server = value && typeof value === 'object' ? value : {};
  const rawType = String(server.type ?? '').trim().toLowerCase();
  const type = rawType === 'http' ? 'streamable-http' : rawType;
  if (!SERVER_TYPES.has(type)) {
    throw new Error('Choose stdio, streamable-http, or sse as the MCP transport.');
  }

  if (type === 'stdio') {
    const unsupported = Object.keys(server).filter((key) => !STDIO_FIELDS.has(key));
    if (unsupported.length) {
      throw new Error(`Stdio MCP server does not support field "${unsupported[0]}".`);
    }
    const command = String(server.command ?? '').trim();
    if (!command) throw new Error('Stdio MCP servers require an executable.');
    if (server.args != null && !Array.isArray(server.args)) {
      throw new Error('Stdio MCP server args must be an array.');
    }
    if (server.env != null && !isPlainObject(server.env)) {
      throw new Error('Stdio MCP server env must be an object.');
    }
    return {
      type,
      enabled: server.enabled !== false,
      command,
      args: (server.args ?? []).map(String),
      cwd: String(server.cwd ?? '').trim(),
      env: Object.fromEntries(
        Object.entries(server.env ?? {}).map(([key, entry]) => [key, String(entry)]),
      ),
    };
  }

  const unsupported = Object.keys(server).filter((key) => !REMOTE_FIELDS.has(key));
  if (unsupported.length) {
    throw new Error(`Remote MCP server does not support field "${unsupported[0]}".`);
  }
  const url = String(server.url ?? '').trim();
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error();
  } catch {
    throw new Error('Remote MCP servers require a valid HTTP or HTTPS URL.');
  }
  if (server.headers != null && !isPlainObject(server.headers)) {
    throw new Error('Remote MCP server headers must be an object.');
  }
  if (server.auth != null && typeof server.auth === 'object' && !isPlainObject(server.auth)) {
    throw new Error('Remote MCP server auth must be an object or authentication mode.');
  }
  const authValue = isPlainObject(server.auth)
    ? server.auth
    : { type: server.auth ?? 'auto' };
  const unsupportedAuth = Object.keys(authValue).filter((key) => !AUTH_FIELDS.has(key));
  if (unsupportedAuth.length) {
    throw new Error(`Remote MCP server auth does not support field "${unsupportedAuth[0]}".`);
  }
  const authType = String(authValue.type ?? 'auto').trim().toLowerCase();
  if (!AUTH_TYPES.has(authType)) throw new Error('Choose a supported authentication mode.');

  return {
    type,
    enabled: server.enabled !== false,
    url,
    headers: Object.fromEntries(
      Object.entries(server.headers ?? {}).map(([key, entry]) => [key, String(entry)]),
    ),
    auth: {
      type: authType,
      token: String(authValue.token ?? '').trim(),
      clientId: String(authValue.clientId ?? '').trim(),
      clientSecret: String(authValue.clientSecret ?? '').trim(),
    },
  };
}
