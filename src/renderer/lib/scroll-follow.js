const BOTTOM_MARGIN = 40;
const CHASE_FACTOR = 0.32;

export class ScrollFollow {
  #element;
  #frame = null;
  #following = true;
  #previousScrollTop = 0;
  #programmaticScrollTop = null;
  #touchY = null;
  #focusPaddingBottom = null;
  #handlers;

  constructor(element, { margin = BOTTOM_MARGIN, chaseFactor = CHASE_FACTOR } = {}) {
    this.#element = element;
    this.margin = margin;
    this.chaseFactor = chaseFactor;
    this.#previousScrollTop = element.scrollTop;
    this.#handlers = {
      wheel: (event) => {
        this.stop();
        if (event.deltaY < 0) this.#following = false;
      },
      pointerdown: () => this.stop(),
      touchstart: (event) => {
        this.stop();
        this.#touchY = event.touches[0]?.clientY ?? null;
      },
      touchmove: (event) => {
        this.stop();
        const currentY = event.touches[0]?.clientY ?? null;
        // Dragging the finger down scrolls the content up.
        if (this.#touchY !== null && currentY !== null && currentY > this.#touchY + 2) {
          this.#following = false;
        }
        this.#touchY = currentY;
      },
      touchend: () => {
        this.#touchY = null;
      },
      scroll: () => {
        const { scrollTop } = this.#element;
        if (
          this.#programmaticScrollTop !== null
          && Math.abs(scrollTop - this.#programmaticScrollTop) <= 1
        ) {
          this.#programmaticScrollTop = null;
          this.#previousScrollTop = scrollTop;
          return;
        }
        this.#programmaticScrollTop = null;
        const distanceFromBottom = this.#element.scrollHeight - scrollTop - this.#element.clientHeight;
        // Auto-scroll only moves down, so an upward move is a user gesture,
        // even if it happens in the middle of the chase animation.
        if (scrollTop < this.#previousScrollTop - 1) {
          this.stop();
          this.#following = false;
        }
        if (distanceFromBottom <= this.margin) this.#following = true;
        this.#previousScrollTop = scrollTop;
      },
    };
    for (const [type, handler] of Object.entries(this.#handlers)) {
      element.addEventListener(type, handler, { passive: true });
    }
  }

  get following() {
    return this.#following;
  }

  setFollowing(value) {
    this.#following = value;
  }

  stop() {
    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }
  }

  #clearFocusPadding() {
    if (this.#focusPaddingBottom === null) return;
    this.#element.style.paddingBottom = this.#focusPaddingBottom;
    this.#focusPaddingBottom = null;
    this.#previousScrollTop = this.#element.scrollTop;
  }

  jumpToBottom() {
    this.stop();
    this.#clearFocusPadding();
    this.#element.scrollTop = Math.max(0, this.#element.scrollHeight - this.#element.clientHeight);
    this.#programmaticScrollTop = this.#element.scrollTop;
    this.#previousScrollTop = this.#element.scrollTop;
  }

  preserveAnchor(target) {
    this.stop();
    this.#following = false;
    const initialOffset = target.getBoundingClientRect().top
      - this.#element.getBoundingClientRect().top;
    return () => {
      const nextOffset = target.getBoundingClientRect().top
        - this.#element.getBoundingClientRect().top;
      const adjustment = nextOffset - initialOffset;
      if (Math.abs(adjustment) <= 0.5) return;
      this.#element.scrollTop += adjustment;
      this.#programmaticScrollTop = this.#element.scrollTop;
      this.#previousScrollTop = this.#element.scrollTop;
    };
  }

  alignStart(target, { force = true } = {}) {
    if (!force && !this.#following) return;
    this.stop();
    const scrollRect = this.#element.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const targetTop = targetRect.top - scrollRect.top + this.#element.scrollTop;
    const computedStyle = window.getComputedStyle(this.#element);
    const paddingTop = Number.parseFloat(computedStyle.paddingTop) || 0;
    const alignedScrollTop = Math.max(0, targetTop - paddingTop);
    this.#clearFocusPadding();
    const maximumScrollTop = Math.max(0, this.#element.scrollHeight - this.#element.clientHeight);
    if (alignedScrollTop > maximumScrollTop) {
      this.#focusPaddingBottom = this.#element.style.paddingBottom;
      const paddingBottom = Number.parseFloat(computedStyle.paddingBottom) || 0;
      this.#element.style.paddingBottom = `${paddingBottom + alignedScrollTop - maximumScrollTop}px`;
    }
    this.#element.scrollTop = alignedScrollTop;
    this.#programmaticScrollTop = this.#element.scrollTop;
    this.#previousScrollTop = this.#element.scrollTop;
  }

  // Chase the bottom with a per-frame eased step instead of restarting a timed
  // animation per token: the target keeps moving while content streams, and a
  // fixed-duration animation either lags or jumps when retargeted constantly.
  chase() {
    if (this.#frame !== null || !this.#following) return;
    this.#clearFocusPadding();
    const reduceMotion = typeof window !== 'undefined' && window.matchMedia
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false;
    const step = () => {
      const target = Math.max(0, this.#element.scrollHeight - this.#element.clientHeight);
      const distance = target - this.#element.scrollTop;
      if (!this.#following || distance <= 0.5) {
        this.#frame = null;
        return;
      }
      this.#element.scrollTop = reduceMotion || distance <= 8
        ? target
        : this.#element.scrollTop + (distance * this.chaseFactor);
      this.#programmaticScrollTop = this.#element.scrollTop;
      this.#frame = requestAnimationFrame(step);
    };
    this.#frame = requestAnimationFrame(step);
  }

  destroy() {
    this.stop();
    this.#clearFocusPadding();
    for (const [type, handler] of Object.entries(this.#handlers)) {
      this.#element.removeEventListener(type, handler);
    }
  }
}
