import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const testProfile = mkdtempSync(join(tmpdir(), 'avi-trace-fatal-test-'));
const resolvedProfile = resolve(testProfile);
assert.ok(resolvedProfile.startsWith(resolve(tmpdir())));
process.env.HOME = resolvedProfile;
process.env.USERPROFILE = resolvedProfile;

try {
  const {
    setTraceLevel,
    traceError,
    traceFatal,
  } = await import(`../src/main/trace-log.js?test=${Date.now()}`);
  setTraceLevel('disabled');
  traceError('test.disabled-error', { error: 'must-not-be-written' });
  traceFatal('test.disabled-fatal', { error: 'must-be-written' });

  const trace = readFileSync(join(resolvedProfile, '.aivax', 'trace.log'), 'utf8');
  assert.doesNotMatch(trace, /test\.disabled-error/);
  assert.match(trace, /-- FATAL -- test\.disabled-fatal: error="must-be-written"/);
  console.log('Fatal trace level tests passed.');
} finally {
  rmSync(resolvedProfile, { recursive: true, force: true });
}
