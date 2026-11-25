import { useId, useLayoutEffect, useMemo, useRef } from 'react';
import { blobFrame, blobLook } from '../lib/blob-avatar.js';
import { classNames } from '../lib/format.js';

const subscribers = new Set();
let animationFrame = 0;
let pointer = null;
let pointerTracked = false;

function tick(now) {
  animationFrame = subscribers.size ? requestAnimationFrame(tick) : 0;
  for (const subscriber of subscribers) {
    if (!subscriber.visible || now - subscriber.last < subscriber.interval - 2) continue;
    subscriber.last = now;
    subscriber.draw(now / 1000);
  }
}

function trackPointer() {
  if (pointerTracked) return;
  pointerTracked = true;
  window.addEventListener('pointermove', (event) => { pointer = { x: event.clientX, y: event.clientY }; }, { passive: true });
  document.documentElement.addEventListener('mouseleave', () => { pointer = null; });
  window.addEventListener('blur', () => { pointer = null; });
}

function pointerGaze(element) {
  if (!pointer || !element) return null;
  const box = element.getBoundingClientRect();
  return {
    yaw: 38 * Math.tanh((pointer.x - box.left - box.width / 2) / 320),
    pitch: -32 * Math.tanh((pointer.y - box.top - box.height / 2) / 260),
  };
}

export function BlobAvatar({
  name,
  shape = null,
  color = null,
  state = 'idle',
  size = 24,
  fps = 8,
  followPointer = false,
  className,
}) {
  const look = useMemo(() => blobLook(name, shape, color), [name, shape, color]);
  const maskId = useId();
  const svgRef = useRef(null);
  const bodyRef = useRef(null);
  const eyeRefs = useRef([]);
  const snoreRefs = useRef([]);
  const motionRef = useRef({ state, from: null, changeAt: -Infinity });
  const snoring = size >= 40;
  const half = snoring ? 132 : 116;

  useLayoutEffect(() => {
    const motion = motionRef.current;
    if (motion.state !== state) {
      motion.from = motion.expression;
      motion.state = state;
      motion.changeAt = performance.now() / 1000;
    }

    const draw = (time) => {
      const frame = blobFrame(look, motion, time, followPointer ? pointerGaze(svgRef.current) : null, size);
      bodyRef.current?.setAttribute('transform', frame.transform);
      frame.eyes.forEach((eye, index) => {
        const element = eyeRefs.current[index];
        element?.setAttribute('d', eye.d);
        element?.setAttribute('transform', eye.transform);
        element?.setAttribute('opacity', eye.opacity);
      });
      frame.snores.forEach((snore, index) => {
        const element = snoreRefs.current[index];
        element?.setAttribute('x', snore.x);
        element?.setAttribute('y', snore.y);
        element?.setAttribute('opacity', snore.opacity);
      });
    };

    draw(performance.now() / 1000);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !svgRef.current) return undefined;
    if (followPointer) trackPointer();

    const subscriber = { interval: 1000 / fps, last: 0, visible: true, draw };
    const observer = new IntersectionObserver(([entry]) => { subscriber.visible = entry.isIntersecting; });
    observer.observe(svgRef.current);
    subscribers.add(subscriber);
    animationFrame ||= requestAnimationFrame(tick);
    return () => {
      observer.disconnect();
      subscribers.delete(subscriber);
    };
  }, [look, state, fps, followPointer, size]);

  return (
    <svg
      ref={svgRef}
      className={classNames('blob-avatar', className)}
      width={size}
      height={size}
      viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
      style={{ color: look.color.value }}
      aria-hidden="true"
      focusable="false"
    >
      <mask id={maskId} maskUnits="userSpaceOnUse" x={-half} y={-half} width={half * 2} height={half * 2}>
        <path d={look.shape.path} fill="#fff" />
        {[0, 1].map((index) => (
          <path key={index} ref={(element) => { eyeRefs.current[index] = element; }} fill="#000" />
        ))}
      </mask>
      <g ref={bodyRef}>
        <path d={look.shape.path} fill="currentColor" mask={`url(#${maskId})`} />
      </g>
      {snoring && [0, 1].map((index) => (
        <text
          key={index}
          ref={(element) => { snoreRefs.current[index] = element; }}
          fill="currentColor"
          fontSize={index ? 22 : 30}
          fontWeight="700"
          opacity="0"
        >
          z
        </text>
      ))}
    </svg>
  );
}
