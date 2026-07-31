import {
  appendFileSync,
  mkdirSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const traceDirectory = join(homedir(), '.aivax');
const tracePath = join(traceDirectory, 'trace.log');
const allowedDetails = new Set([
  'attempt',
  'code',
  'duration_ms',
  'error',
  'input_tokens',
  'interface',
  'latency_ms',
  'log_level',
  'message_id',
  'model',
  'mcp_server',
  'operation',
  'output_tokens',
  'parent_thread_id',
  'phase',
  'provider',
  'provider_id',
  'retry_after_ms',
  'round',
  'side_chat',
  'status',
  'subagent',
  'thread_id',
  'time_to_first_response_ms',
  'tokens_per_second',
  'tool',
  'tool_type',
  'total_tokens',
]);
let traceLevel = 'minimal';

export function setTraceLevel(level) {
  traceLevel = ['verbose', 'minimal', 'disabled'].includes(level) ? level : 'minimal';
  return traceLevel;
}

export function traceError(event, details = {}) {
  if (traceLevel === 'disabled') return;
  writeTrace('ERROR', event, details);
}

export function traceVerbose(event, details = {}) {
  if (traceLevel !== 'verbose') return;
  writeTrace('INFO', event, details);
}

function writeTrace(level, event, details) {
  const safeDetails = {};
  for (const [key, rawValue] of Object.entries(details)) {
    if (!allowedDetails.has(key) || rawValue === undefined || rawValue === null) continue;
    if (!['string', 'number', 'boolean'].includes(typeof rawValue)) continue;

    safeDetails[key] = typeof rawValue === 'string'
      ? rawValue
          .slice(0, key === 'error' ? 4_000 : 300)
          .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 [REDACTED]')
          .replace(
            /((?:api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|client[_-]?secret|password)["']?\s*[:=]\s*["']?)[^\s,"'}]+/gi,
            '$1[REDACTED]',
          )
          .replace(
            /([?&](?:api[_-]?key|key|token|access[_-]?token|refresh[_-]?token|client[_-]?secret)=)[^&\s]+/gi,
            '$1[REDACTED]',
          )
          .replace(/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{8,}\b/gi, '[REDACTED]')
          .replace(/\b(?:gh[pousr]|github_pat)_[A-Za-z0-9_]{20,}\b/gi, '[REDACTED]')
          .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, '[REDACTED]')
          .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED]')
          .replace(/\b[A-Za-z]:\\[^\r\n"']+/g, '[REDACTED_PATH]')
          .replace(/(?:file:\/\/\/|\/Users\/|\/home\/)[^\r\n"']+/g, '[REDACTED_PATH]')
          .replace(/[\r\n\t]+/g, ' ')
      : rawValue;
  }

  try {
    mkdirSync(traceDirectory, { recursive: true });
    const message = Object.entries(safeDetails)
      .map(([key, value]) => (
        typeof value === 'string'
          ? `${key}="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
          : `${key}=${value}`
      ))
      .join(' ');
    appendFileSync(
      tracePath,
      `avi - [${new Date().toISOString()}] -- ${level} -- ${String(event).slice(0, 120)}: ${message || '-'}\n`,
      'utf8',
    );
  } catch {
    // Logging must never interrupt application execution.
  }
}
