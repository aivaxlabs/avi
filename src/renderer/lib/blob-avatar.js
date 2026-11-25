// Geometry and motion adapted from bloub (MIT): https://github.com/jeremy-prt/bloub
const SAMPLES = 64;
const TAU = Math.PI * 2;
const RADIUS = 100;
const ANGLES = Array.from({ length: SAMPLES }, (_, index) => (index / SAMPLES) * TAU);
const COS = ANGLES.map(Math.cos);
const SIN = ANGLES.map(Math.sin);
const BLINK_LOOP = 600;
const BLINK_DURATION = 0.18;
const SETTLE_DURATION = 0.6;

const clamp = (value, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (from, to, amount) => from + (to - from) * amount;
const easeOut = (amount) => 1 - (1 - amount) ** 4;
const round = (value) => Math.round(value * 100) / 100;

function normalize(radii, max = 1) {
  const peak = Math.max(...radii);
  return radii.map((radius) => (radius * max) / peak);
}

function profileFromPolygon(polygon) {
  return ANGLES.map((_, sample) => {
    let best = 0;
    for (let index = 0; index < polygon.length; index++) {
      const start = polygon[index];
      const end = polygon[(index + 1) % polygon.length];
      const edgeX = end.x - start.x;
      const edgeY = end.y - start.y;
      const denominator = COS[sample] * edgeY - SIN[sample] * edgeX;
      if (Math.abs(denominator) < 1e-9) continue;
      const distance = (start.x * edgeY - start.y * edgeX) / denominator;
      const position = (start.x * SIN[sample] - start.y * COS[sample]) / denominator;
      if (distance > best && position >= 0 && position <= 1) best = distance;
    }
    return best;
  });
}

function hullOfCircles(x1, y1, r1, x2, y2, r2, steps = 96) {
  const base = Math.atan2(y2 - y1, x2 - x1);
  const spread = Math.acos(clamp((r1 - r2) / (Math.hypot(x2 - x1, y2 - y1) || 1e-6), -1, 1));
  const half = steps / 2;
  return [
    ...Array.from({ length: half + 1 }, (_, index) => {
      const angle = base + spread + ((TAU - 2 * spread) * index) / half;
      return { x: x1 + Math.cos(angle) * r1, y: y1 + Math.sin(angle) * r1 };
    }),
    ...Array.from({ length: half + 1 }, (_, index) => {
      const angle = base - spread + (2 * spread * index) / half;
      return { x: x2 + Math.cos(angle) * r2, y: y2 + Math.sin(angle) * r2 };
    }),
  ];
}

function roundedPolygonProfile(sides, radius, corner, rotation) {
  const vertices = Array.from({ length: sides }, (_, index) => {
    const angle = (rotation * Math.PI) / 180 + (index / sides) * TAU;
    return { x: Math.cos(angle) * (radius - corner), y: Math.sin(angle) * (radius - corner) };
  });
  const normal = (from, to) => Math.atan2(-(to.x - from.x), to.y - from.y);
  const outline = vertices.flatMap((vertex, index) => {
    const start = normal(vertices[(index - 1 + sides) % sides], vertex);
    let turn = normal(vertex, vertices[(index + 1) % sides]) - start;
    while (turn > Math.PI) turn -= TAU;
    while (turn < -Math.PI) turn += TAU;
    return Array.from({ length: 11 }, (_, step) => ({
      x: vertex.x + Math.cos(start + (turn * step) / 10) * corner,
      y: vertex.y + Math.sin(start + (turn * step) / 10) * corner,
    }));
  });
  return profileFromPolygon(outline);
}

const cloudCircles = [
  { x: -0.44, y: 0.2, r: 0.54 },
  { x: 0.46, y: 0.2, r: 0.5 },
  { x: 0.02, y: 0.3, r: 0.6 },
  { x: -0.24, y: -0.3, r: 0.48 },
  { x: 0.3, y: -0.24, r: 0.44 },
];

export const BLOB_SHAPES = [
  { id: 'circle', name: 'Circle', radii: new Array(SAMPLES).fill(1) },
  {
    id: 'pebble',
    name: 'Pebble',
    radii: normalize(ANGLES.map((angle) => 1 + 0.075 * Math.cos(2 * angle + 0.5) + 0.035 * Math.cos(3 * angle + 2.1)), 1.02),
  },
  {
    id: 'squircle',
    name: 'Squircle',
    radii: normalize(ANGLES.map((_, index) => (Math.abs(COS[index]) ** 4.2 + Math.abs(SIN[index]) ** 4.2) ** (-1 / 4.2)), 1.12),
  },
  { id: 'capsule', name: 'Capsule', radii: profileFromPolygon(hullOfCircles(-0.42, 0, 0.62, 0.42, 0, 0.62)) },
  { id: 'triangle', name: 'Triangle', radii: roundedPolygonProfile(3, 1.1, 0.34, -90) },
  { id: 'hexagon', name: 'Hexagon', radii: roundedPolygonProfile(6, 1.04, 0.26, 0) },
  {
    id: 'cloud',
    name: 'Cloud',
    radii: normalize(ANGLES.map((_, index) => Math.max(...cloudCircles.map((circle) => {
      const along = COS[index] * circle.x + SIN[index] * circle.y;
      const discriminant = along * along - (circle.x ** 2 + circle.y ** 2 - circle.r ** 2);
      return discriminant < 0 ? 0 : along + Math.sqrt(discriminant);
    }))), 1.02),
  },
  { id: 'drop', name: 'Drop', radii: normalize(profileFromPolygon(hullOfCircles(0, 0.28, 0.66, 0, -0.96, 0.05)), 1.04) },
].map((shape) => {
  const points = shape.radii.map((radius, index) => ({
    x: radius * COS[index] * RADIUS,
    y: radius * SIN[index] * RADIUS,
  }));
  const segments = points.map((point, index) => {
    const previous = points[(index - 1 + SAMPLES) % SAMPLES];
    const next = points[(index + 1) % SAMPLES];
    const after = points[(index + 2) % SAMPLES];
    return `C${round(point.x + (next.x - previous.x) / 6)} ${round(point.y + (next.y - previous.y) / 6)} `
      + `${round(next.x - (after.x - point.x) / 6)} ${round(next.y - (after.y - point.y) / 6)} ${round(next.x)} ${round(next.y)}`;
  });
  return { ...shape, path: `M${round(points[0].x)} ${round(points[0].y)}${segments.join('')}Z` };
});

export const BLOB_COLORS = [
  { id: 'ink', name: 'Ink', value: 'var(--text-1)' },
  { id: 'brown', name: 'Brown', value: '#8b5e3c' },
  { id: 'red', name: 'Red', value: '#e8483f' },
  { id: 'orange', name: 'Orange', value: '#f08a24' },
  { id: 'amber', name: 'Amber', value: '#f0b429' },
  { id: 'green', name: 'Green', value: '#3ecf8e' },
  { id: 'teal', name: 'Teal', value: '#2fbfa0' },
  { id: 'blue', name: 'Blue', value: '#3b93f0' },
  { id: 'violet', name: 'Violet', value: '#8b5cf6' },
  { id: 'pink', name: 'Pink', value: '#e152b0' },
  { id: 'gray', name: 'Gray', value: '#a3a3a3' },
];

const automaticColors = BLOB_COLORS.filter((color) => !['ink', 'gray'].includes(color.id));

export function blobLook(name, shapeId, colorId) {
  let hash = 0x811c9dc5;
  for (const character of String(name ?? '')) {
    hash = Math.imul(hash ^ character.codePointAt(0), 0x01000193);
  }
  hash >>>= 0;
  return {
    hash,
    offset: (hash % 9973) / 9973 * BLINK_LOOP,
    shape: BLOB_SHAPES.find((shape) => shape.id === shapeId) ?? BLOB_SHAPES[hash % BLOB_SHAPES.length],
    color: BLOB_COLORS.find((color) => color.id === colorId) ?? automaticColors[(hash >>> 8) % automaticColors.length],
  };
}

export function botAvatarState(bot) {
  if (bot?.running || bot?.scheduleState === 'working') return 'working';
  if (bot?.scheduleState === 'queued') return 'waiting';
  return ['sleep', 'outside-window', 'disabled'].includes(bot?.scheduleState) ? 'sleeping' : 'idle';
}

const eye = (w, h, tilt = 0) => ({ w, h, tilt });
const pair = (w, h, tilt = 0) => [eye(w, h, tilt), eye(w, h, -tilt)];
const expression = (yaw, pitch, roll, split, eyes, scan = 0) => ({ gaze: { yaw, pitch, roll }, split, eyes, scan });

const BLOB_STATES = {
  idle: {
    hold: 6,
    wander: 1,
    blink: true,
    follow: 0.85,
    variants: [
      expression(22, 20, -12, 15.5, pair(0.186, 0.412)),
      expression(-16, 2, 12, 16.5, [eye(0.24, 0.46, -8), eye(0.2, 0.38, -8)]),
      expression(6, 10, 0, 17, pair(0.27, 0.17, 14)),
    ],
    motion: (time) => ({ y: 0, breath: 1 + Math.sin((time / 3.4) * TAU) * 0.006 }),
  },
  working: {
    hold: 3.6,
    wander: 0.4,
    blink: true,
    follow: 0.45,
    variants: [
      expression(0, -14, 0, 16, pair(0.24, 0.27), 11),
      expression(-18, 18, 7, 16, [eye(0.2, 0.42, -10), eye(0.25, 0.2, 12)]),
    ],
    motion: (time) => ({ y: -2 * Math.abs(Math.sin((time * Math.PI) / 0.7)), breath: 1 }),
  },
  sleeping: {
    hold: 8,
    wander: 0.15,
    blink: false,
    follow: 0,
    variants: [
      expression(4, -14, -9, 16, pair(0.27, 0.05, 4)),
      expression(-8, -18, 10, 15.5, pair(0.25, 0.045)),
    ],
    motion: (time) => ({ y: 0, breath: 1 + Math.sin((time / 4.2) * TAU) * 0.03 }),
  },
  waiting: {
    hold: 2.8,
    wander: 0.6,
    blink: true,
    follow: 0.65,
    variants: [
      expression(-6, 24, -5, 15.5, pair(0.2, 0.44)),
      expression(30, 4, 6, 16, [eye(0.2, 0.4, -6), eye(0.18, 0.34, -6)]),
    ],
    motion: (time) => {
      const phase = (time % 2.6) / 2.6;
      return { y: phase < 0.16 ? -5 * Math.sin((phase / 0.16) * Math.PI) : 0, breath: 1 };
    },
  },
};

function blendExpressions(from, to, amount) {
  return {
    gaze: {
      yaw: lerp(from.gaze.yaw, to.gaze.yaw, amount),
      pitch: lerp(from.gaze.pitch, to.gaze.pitch, amount),
      roll: lerp(from.gaze.roll, to.gaze.roll, amount),
    },
    split: lerp(from.split, to.split, amount),
    scan: lerp(from.scan, to.scan, amount),
    eyes: from.eyes.map((fromEye, index) => ({
      w: lerp(fromEye.w, to.eyes[index].w, amount),
      h: lerp(fromEye.h, to.eyes[index].h, amount),
      tilt: lerp(fromEye.tilt, to.eyes[index].tilt, amount),
    })),
  };
}

function loopNoise(time, period, seed) {
  const phase = (time / period) * TAU;
  return 0.55 * Math.sin(phase + seed)
    + 0.3 * Math.sin(2 * phase + seed * 1.7 + 1.1)
    + 0.15 * Math.sin(3 * phase + seed * 2.3 + 2.4);
}

const BLINKS = (() => {
  let seed = 0x5eed;
  const random = () => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  const blinks = [];
  for (let time = 1.4; time < BLINK_LOOP - 1; time += 1.9 + random() * 2.7) {
    blinks.push(time);
    if (random() < 0.18) {
      time += 0.24;
      blinks.push(time);
    }
  }
  return blinks;
})();

function eyelid(time) {
  const looped = time % BLINK_LOOP;
  for (const start of BLINKS) {
    if (looped < start) break;
    const progress = (looped - start) / BLINK_DURATION;
    if (progress <= 1) return progress < 0.45 ? 1 - progress / 0.45 : (progress - 0.45) / 0.55;
  }
  return 1;
}

function capsulePath(width, height) {
  const halfWidth = Math.max(width, 0.01) / 2;
  const halfHeight = Math.max(height, 0.01) / 2;
  const corner = round(Math.min(halfWidth, halfHeight));
  const [left, right, top, bottom] = [-halfWidth, halfWidth, -halfHeight, halfHeight].map(round);
  return `M${left} ${round(top + corner)}A${corner} ${corner} 0 0 1 ${round(left + corner)} ${top}`
    + `L${round(right - corner)} ${top}A${corner} ${corner} 0 0 1 ${right} ${round(top + corner)}`
    + `L${right} ${round(bottom - corner)}A${corner} ${corner} 0 0 1 ${round(right - corner)} ${bottom}`
    + `L${round(left + corner)} ${bottom}A${corner} ${corner} 0 0 1 ${left} ${round(bottom - corner)}Z`;
}

function spin(first, second, degrees) {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return [
    first.map((value, index) => value * cos + second[index] * sin),
    second.map((value, index) => value * cos - first[index] * sin),
  ];
}

// motion keeps per-avatar continuity: { state, from, changeAt, expression, followYaw, followPitch, followMix, lastTime }
export function blobFrame(look, motion, time, follow = null, size = 56) {
  const config = BLOB_STATES[motion.state] ?? BLOB_STATES.idle;
  const local = time + look.offset;
  const segment = Math.floor(local / config.hold);
  const variantAt = (index) => config.variants[index % 2 === 0
    ? 0
    : 1 + ((Math.imul(index, 2654435761) ^ look.hash) >>> 0) % (config.variants.length - 1)];
  const entering = (local - segment * config.hold) / SETTLE_DURATION;
  let target = entering < 1 && segment > 0
    ? blendExpressions(variantAt(segment - 1), variantAt(segment), easeOut(entering))
    : variantAt(segment);
  const settle = (time - motion.changeAt) / SETTLE_DURATION;
  if (motion.from && settle < 1) target = blendExpressions(motion.from, target, easeOut(clamp(settle)));
  motion.expression = target;

  const delta = clamp(time - (motion.lastTime ?? time), 0, 0.1);
  const smoothing = 1 - Math.exp(-delta * 6);
  motion.lastTime = time;
  motion.followYaw = lerp(motion.followYaw ?? 0, follow?.yaw ?? motion.followYaw ?? 0, smoothing);
  motion.followPitch = lerp(motion.followPitch ?? 0, follow?.pitch ?? motion.followPitch ?? 0, smoothing);
  motion.followMix = lerp(motion.followMix ?? 0, follow ? config.follow : 0, smoothing);

  const small = clamp((48 - size) / 26);
  const centered = 1 - 0.45 * small;
  const eyeScale = 1 + 0.4 * small;
  const unitsPerPixel = 232 / size;
  const wander = config.wander * (1 - motion.followMix * 0.6);
  const gaze = {
    yaw: (lerp(target.gaze.yaw, motion.followYaw, motion.followMix)
      + (loopNoise(local, 11.3, 0.4) * 5.5 + loopNoise(local, 3.7, 2.1) * 1.6) * wander
      + target.scan * Math.sin((local * TAU) / 1.6) * (1 - motion.followMix)) * centered,
    pitch: (lerp(target.gaze.pitch, motion.followPitch, motion.followMix)
      + (loopNoise(local, 9.1, 1.3) * 4.2 + loopNoise(local, 4.3, 0.7) * 1.3) * wander) * centered,
    roll: target.gaze.roll + loopNoise(local, 13.7, 3.2) * 2.2 * wander,
  };
  const forcedBlink = clamp(settle / 0.35);
  const lid = Math.min(config.blink ? eyelid(local) : 1, forcedBlink < 1 ? Math.abs(forcedBlink * 2 - 1) : 1);
  const squash = 0.06 + 0.94 * lid;

  let forward = [0, 0, 1];
  let right = [1, 0, 0];
  let down = [0, 1, 0];
  [forward, right] = spin(forward, right, gaze.yaw);
  [down, forward] = spin(down, forward, gaze.pitch);
  [right, down] = spin(right, down, gaze.roll);

  const radii = look.shape.radii;
  const eyes = [-1, 1].map((side, index) => {
    const [eyeForward, eyeRight] = spin(forward, right, target.split * side);
    const settings = target.eyes[index];
    const x = eyeForward[0] * RADIUS;
    const y = eyeForward[1] * RADIUS;
    const sample = ((((Math.atan2(y, x) / TAU) % 1) + 1) % 1) * SAMPLES;
    const floor = Math.floor(sample);
    const fit = lerp(radii[floor % SAMPLES], radii[(floor + 1) % SAMPLES], sample - floor);
    const tilt = (settings.tilt * Math.PI) / 180;
    const cos = Math.cos(tilt);
    const sin = Math.sin(tilt);
    return {
      d: capsulePath(
        Math.max(settings.w * RADIUS * eyeScale, 2.6 * unitsPerPixel),
        Math.max(settings.h * RADIUS * eyeScale, 1.6 * unitsPerPixel),
      ),
      transform: `matrix(${round(eyeRight[0] * cos + down[0] * sin)},${round((eyeRight[1] * cos + down[1] * sin) * squash)},`
        + `${round(-eyeRight[0] * sin + down[0] * cos)},${round((-eyeRight[1] * sin + down[1] * cos) * squash)},`
        + `${round(x * fit)},${round(y * fit)})`,
      opacity: eyeForward[2] <= 0.02 ? 0 : round(clamp(eyeForward[2] / 0.12)),
    };
  });

  const body = config.motion(local);
  const sleepy = motion.state === 'sleeping' ? clamp(settle) : 0;
  return {
    transform: `translate(0 ${round(body.y)}) scale(1 ${round(body.breath)})`,
    eyes,
    snores: [0, 0.5].map((shift) => {
      const phase = ((local / 3 + shift) % 1 + 1) % 1;
      return {
        x: round(58 + 22 * phase),
        y: round(-60 - 56 * phase),
        opacity: round(Math.sin(phase * Math.PI) * sleepy),
      };
    }),
  };
}
