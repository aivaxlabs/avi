import assert from 'node:assert/strict';
import { localToGlobal } from '../built-in-plugins/computer-use/runtime/computerRuntime.js';

const primary150 = { monitor_id: 'primary', x: 0, y: 0, width: 1504, height: 1003, input_bounds: { x: 0, y: 0, width: 2256, height: 1505 } };
assert.deepEqual(
  localToGlobal(primary150, [929, 126], { width: 1344, height: 896 }),
  { x: 1559, y: 212, local_x: 1040, local_y: 141 },
  'a 150% monitor maps screenshot pixels to physical input pixels and logical overlay pixels',
);

const leftAt100 = { monitor_id: 'left', x: -1920, y: 0, width: 1920, height: 1080, input_bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
assert.deepEqual(localToGlobal(leftAt100, [960, 540], { width: 1920, height: 1080 }), { x: -960, y: 540, local_x: 960, local_y: 540 });

const rightAt200 = { monitor_id: 'right', x: 1504, y: 0, width: 1280, height: 720, input_bounds: { x: 2256, y: 0, width: 2560, height: 1440 } };
assert.deepEqual(
  localToGlobal(rightAt200, [640, 360], { width: 1280, height: 720 }),
  { x: 3536, y: 720, local_x: 640, local_y: 360 },
  'a 200% monitor beside a 150% monitor uses its own physical origin and scale',
);

assert.throws(() => localToGlobal(primary150, [1344, 0], { width: 1344, height: 896 }), /outside monitor/);
console.log('Computer Use coordinate mapping checks passed.');
process.exit(0);
