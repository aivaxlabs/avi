import assert from 'node:assert/strict';
import { ScrollFollow } from '../src/renderer/lib/scroll-follow.js';

class FakeFrameScheduler {
  constructor() {
    this.queue = [];
    this.now = 0;
  }

  request(callback) {
    const id = this.queue.length + 1;
    this.queue.push({ id, callback });
    return id;
  }

  cancel(id) {
    this.queue = this.queue.filter((item) => item.id !== id);
  }

  flush(maxFrames = 1000) {
    let frames = 0;
    while (this.queue.length > 0 && frames < maxFrames) {
      const item = this.queue.shift();
      this.now += 16;
      item.callback(this.now);
      frames += 1;
    }
    assert.ok(frames < maxFrames, 'animation did not settle');
  }
}

class FakeScrollElement {
  constructor({ scrollHeight, clientHeight }) {
    this.scrollHeight = scrollHeight;
    this.clientHeight = clientHeight;
    this.scrollTop = 0;
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(handler);
  }

  removeEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    this.listeners.set(type, handlers.filter((item) => item !== handler));
  }

  emit(type, event = {}) {
    for (const handler of this.listeners.get(type) ?? []) handler(event);
  }
}

function createScenario({ contentHeight, clientHeight = 600, scrollTop = 0 }) {
  const scheduler = new FakeFrameScheduler();
  globalThis.requestAnimationFrame = (callback) => scheduler.request(callback);
  globalThis.cancelAnimationFrame = (id) => scheduler.cancel(id);
  globalThis.window = { matchMedia: () => ({ matches: false }) };

  const element = new FakeScrollElement({
    scrollHeight: contentHeight,
    clientHeight,
  });
  element.scrollTop = Math.min(scrollTop, contentHeight - clientHeight);
  const follow = new ScrollFollow(element);
  return {
    element,
    follow,
    scheduler,
    emit: (type, event) => element.emit(type, event),
    grow: (by) => {
      element.scrollHeight += by;
    },
  };
}

const atBottom = (element) => element.scrollHeight - element.scrollTop - element.clientHeight;

// At the bottom, a tall block grows and the chat keeps following it.
{
  const scenario = createScenario({ contentHeight: 800, scrollTop: 200 });
  assert.equal(atBottom(scenario.element), 0);
  assert.equal(scenario.follow.following, true);

  scenario.grow(500);
  scenario.follow.chase();
  scenario.emit('scroll');
  scenario.scheduler.flush();
  assert.ok(atBottom(scenario.element) <= 1, 'follows the bottom while a tall block grows');
  assert.equal(scenario.follow.following, true);
}

// Sitting inside the content (40% of a tall block) keeps following until user scrolls up.
{
  const scenario = createScenario({ contentHeight: 2000, scrollTop: 700 });
  scenario.follow.chase();
  scenario.emit('scroll');
  scenario.scheduler.flush();
  assert.ok(atBottom(scenario.element) <= 1, 'chases from the middle of a tall block');
  assert.equal(scenario.follow.following, true);
}

// Manual upward wheel cancels follow; content growth does not scroll.
{
  const scenario = createScenario({ contentHeight: 2000, scrollTop: 200 });
  scenario.emit('wheel', { deltaY: -120 });
  assert.equal(scenario.follow.following, false);

  scenario.grow(300);
  scenario.follow.chase();
  scenario.scheduler.flush();
  assert.equal(scenario.element.scrollTop, 200, 'does not auto-scroll after the user scrolled up');
}

// Wheeling back near the bottom re-enables follow.
{
  const scenario = createScenario({ contentHeight: 900, scrollTop: 900 });
  scenario.emit('wheel', { deltaY: -120 });
  assert.equal(scenario.follow.following, false);
  scenario.element.scrollTop = scenario.element.scrollHeight - scenario.element.clientHeight - 20;
  scenario.emit('scroll');
  assert.equal(scenario.follow.following, true);
}

// A wheel during chase stops the animation, but follow stays on until an upward move.
{
  const scenario = createScenario({ contentHeight: 3000, scrollTop: 0 });
  scenario.follow.chase();
  scenario.emit('wheel', { deltaY: 40 });
  scenario.scheduler.flush();
  assert.equal(scenario.follow.following, true, 'downward wheel does not disable follow');

  scenario.element.scrollTop -= 50;
  scenario.emit('scroll');
  assert.equal(scenario.follow.following, false, 'upward manual move disables follow');
}

// Touch drag upward disables follow; downward drag keeps it.
{
  const scenario = createScenario({ contentHeight: 3000, scrollTop: 500 });
  scenario.emit('touchstart', { touches: [{ clientY: 100 }] });
  scenario.emit('touchmove', { touches: [{ clientY: 160 }] });
  assert.equal(scenario.follow.following, false);

  const scenario2 = createScenario({ contentHeight: 3000, scrollTop: 500 });
  scenario2.emit('touchstart', { touches: [{ clientY: 160 }] });
  scenario2.emit('touchmove', { touches: [{ clientY: 100 }] });
  assert.equal(scenario2.follow.following, true);
}

// resetKey-style re-enable then jump.
{
  const scenario = createScenario({ contentHeight: 3000, scrollTop: 100 });
  scenario.follow.setFollowing(false);
  scenario.follow.setFollowing(true);
  scenario.follow.jumpToBottom();
  assert.equal(atBottom(scenario.element), 0);
}

console.log('Scroll follow tests passed.');
