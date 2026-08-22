let fatalReporter = writeEarlyFatal;

process.on('uncaughtExceptionMonitor', (error) => fatalReporter('app.uncaught-exception', error));
process.on('unhandledRejection', (reason) => fatalReporter('app.unhandled-rejection', reason));

import('./bootstrap.js')
  .then((bootstrap) => {
    fatalReporter = bootstrap.reportFatal;
  })
  .catch((error) => fatalReporter('app.failed-to-start', error, { operation: 'startup' }));

function writeEarlyFatal(event, error, details = {}) {
  console.error(`${event}:`, error);
  try {
    const { appendFileSync, mkdirSync } = process.getBuiltinModule('node:fs');
    const { homedir } = process.getBuiltinModule('node:os');
    const { join } = process.getBuiltinModule('node:path');
    const traceDirectory = join(homedir(), '.aivax');
    const errorText = (error instanceof Error ? (error.stack || error.message) : String(error))
      .slice(0, 4_000)
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
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"');
    const operation = typeof details.operation === 'string'
      ? `operation="${details.operation.slice(0, 300).replaceAll('"', '\\"')}" `
      : '';
    mkdirSync(traceDirectory, { recursive: true });
    appendFileSync(
      join(traceDirectory, 'trace.log'),
      `avi - [${new Date().toISOString()}] -- FATAL -- ${String(event).slice(0, 120)}: ${operation}error="${errorText}"\n`,
      'utf8',
    );
  } catch {
    // Fatal reporting must not interrupt process termination or startup.
  }
}
