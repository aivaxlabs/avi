import {
  appendFileSync,
  createReadStream,
  createWriteStream,
  mkdirSync,
  rmSync,
  statSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';

const traceDirectory = join(homedir(), '.aivax');
const tracePath = join(traceDirectory, 'trace.log');
const maxTraceSize = 64 * 1024 * 1024;
const allowedDetails = new Set([
  'abort_duration_ms',
  'attempt',
  'cache_ratio',
  'cached_input_tokens',
  'code',
  'compaction_ratio',
  'concurrent_runs',
  'consumed_credits',
  'cpu_system_ms',
  'cpu_user_ms',
  'context_limit',
  'context_tokens',
  'document_count',
  'documents_indexed',
  'documents_removed',
  'documents_skipped',
  'documents_updated',
  'duration_ms',
  'error',
  'external_mb',
  'fd_count',
  'folder_count',
  'heap_used_mb',
  'http_status',
  'input_tokens',
  'instruction_count',
  'interface',
  'item_count',
  'latency_ms',
  'log_level',
  'message_count',
  'message_id',
  'model',
  'model_level',
  'model_role',
  'mcp_server',
  'operation',
  'output_tokens',
  'parent_thread_id',
  'phase',
  'plugin',
  'provider',
  'provider_id',
  'provider_latency_ms',
  'queue_depth',
  'reasoning_tokens',
  'requested_model',
  'fallback_model',
  'retry_after_ms',
  'retry_count',
  'round',
  'rss_mb',
  'scope',
  'server_count',
  'side_chat',
  'skill_count',
  'status',
  'stream_chunk_count',
  'subagent',
  'thread_id',
  'time_to_first_response_ms',
  'tokens_per_second',
  'tool',
  'tool_count',
  'tool_history_count',
  'tool_type',
  'total_tokens',
  'workflow_count',
]);
let traceLevel = 'minimal';

export async function rotateTraceLog() {
  try {
    if (statSync(tracePath).size < maxTraceSize) return;

    const timestamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
    const archiveDirectory = join(tmpdir(), '.avi', 'rotated-logs', timestamp);
    const archivePath = join(archiveDirectory, 'trace.log');
    mkdirSync(archiveDirectory, { recursive: true });
    await pipeline(
      createReadStream(tracePath),
      createGzip(),
      createWriteStream(archivePath),
    );
    rmSync(tracePath);
    appendFileSync(
      tracePath,
      `avi - [${new Date().toISOString()}] -- INFO -- trace_log_rotated: archive_path="${archivePath}" compressed=true\n`,
      'utf8',
    );
  } catch {
    // Logging must never interrupt application execution.
  }
}

export function setTraceLevel(level) {
  traceLevel = ['verbose', 'minimal', 'disabled'].includes(level) ? level : 'minimal';
  return traceLevel;
}

export function traceError(event, details = {}) {
  if (traceLevel === 'disabled') return;
  writeTrace('ERROR', event, details);
}

export function traceInfo(event, details = {}) {
  if (traceLevel === 'disabled') return;
  writeTrace('INFO', event, details);
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
