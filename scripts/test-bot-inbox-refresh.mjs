import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/renderer/App.jsx', import.meta.url), 'utf8');
const start = source.indexOf('  const botsRefreshPromiseRef =');
const end = source.indexOf('\n  useEffect(', start);
assert.ok(start >= 0 && end > start);
const requests = [];
const snapshots = [];
assert.match(source, /const \[botsLoading, setBotsLoading\] = useState\(true\)/);
const loading = [true];
const errors = [];
const refresh = new Function('api', 'useRef', 'useCallback', 'setBotsLoading', 'setBots', 'setBotDataByBot', 'setBotsError', 'setBotSchedulerSnooze', 'setError', `${source.slice(start, end)}\nreturn refreshBots;`)(
  { bots: { list: () => new Promise((resolve, reject) => requests.push({ resolve, reject })) } },
  (value) => ({ current: value }), (callback) => callback,
  (value) => loading.push(value), (value) => snapshots.push(value), () => {},
  (value) => errors.push(value), () => {}, () => {},
);
const first = refresh();
const second = refresh();
const third = refresh();
assert.equal(first, second);
assert.equal(second, third);
assert.equal(requests.length, 1);
requests[0].resolve({ bots: ['first'] });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(snapshots, [['first']]);
assert.equal(requests.length, 2);
let finished = false;
second.then(() => { finished = true; });
await Promise.resolve();
assert.equal(finished, false);
requests[1].resolve({ bots: ['latest'] });
await first;
assert.deepEqual(snapshots, [['first'], ['latest']]);
assert.deepEqual(loading, [true, false]);
const failed = refresh();
assert.deepEqual(loading, [true, false]);
requests[2].reject(new Error('fixture failure'));
await failed;
assert.equal(errors.at(-1), 'Could not load bot inbox.');
const retry = refresh();
assert.deepEqual(loading, [true, false, false]);
requests[3].resolve({ bots: ['retry'] });
await retry;
assert.deepEqual(snapshots.at(-1), ['retry']);
assert.deepEqual(loading, [true, false, false, false]);
console.log('Inbox refresh coalescing, await semantics, and background loading stability passed.');
