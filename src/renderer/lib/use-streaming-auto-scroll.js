import { useCallback, useEffect, useRef, useState } from 'react';

const BOTTOM_EPSILON = 0;

export function useStreamingAutoScroll({ isRunning, resetKey, streamKey }) {
  const scrollRef = useRef(null);
  const autoScrollTimerRef = useRef(null);
  const autoScrollFrameRef = useRef(null);
  const autoScrollTargetRef = useRef(null);
  const followingBottomRef = useRef(true);
  const wasRunningRef = useRef(false);
  const [messagesColumn, setMessagesColumn] = useState(null);

  const messagesColumnRef = useCallback((element) => {
    setMessagesColumn((current) => (current === element ? current : element));
  }, []);

  const cancelScheduledScroll = useCallback(() => {
    if (autoScrollTimerRef.current !== null) {
      window.clearTimeout(autoScrollTimerRef.current);
      autoScrollTimerRef.current = null;
    }
    if (autoScrollFrameRef.current !== null) {
      cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    }
    autoScrollTargetRef.current = null;
  }, []);

  const scrollToBottom = useCallback(() => {
    if (!followingBottomRef.current) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    const target = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
    if (Math.abs(scrollElement.scrollTop - target) <= BOTTOM_EPSILON) return;

    autoScrollTargetRef.current = target;
    scrollElement.scrollTop = target;
  }, []);

  const scheduleScrollToBottom = useCallback((delay = 50) => {
    if (
      !followingBottomRef.current
      || autoScrollTimerRef.current !== null
      || autoScrollFrameRef.current !== null
    ) return;

    autoScrollTimerRef.current = window.setTimeout(() => {
      autoScrollTimerRef.current = null;
      if (!followingBottomRef.current) return;

      autoScrollFrameRef.current = requestAnimationFrame(() => {
        autoScrollFrameRef.current = null;
        scrollToBottom();
      });
    }, delay);
  }, [scrollToBottom]);

  const handleScroll = useCallback((event) => {
    const scrollElement = event.currentTarget;
    const autoScrollTarget = autoScrollTargetRef.current;
    if (
      autoScrollTarget !== null
      && Math.abs(scrollElement.scrollTop - autoScrollTarget) <= BOTTOM_EPSILON
    ) {
      autoScrollTargetRef.current = null;
      return;
    }

    autoScrollTargetRef.current = null;
    const distanceFromBottom = scrollElement.scrollHeight
      - scrollElement.scrollTop
      - scrollElement.clientHeight;
    if (distanceFromBottom <= BOTTOM_EPSILON) {
      followingBottomRef.current = true;
      if (isRunning) scheduleScrollToBottom(0);
      return;
    }

    followingBottomRef.current = false;
    cancelScheduledScroll();
  }, [cancelScheduledScroll, isRunning, scheduleScrollToBottom]);

  useEffect(() => {
    cancelScheduledScroll();
    followingBottomRef.current = true;
    scheduleScrollToBottom(0);
  }, [cancelScheduledScroll, resetKey, scheduleScrollToBottom]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      followingBottomRef.current = true;
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    scheduleScrollToBottom(isRunning ? 50 : 0);
  }, [isRunning, scheduleScrollToBottom, streamKey]);

  useEffect(() => {
    if (!isRunning || !messagesColumn) return undefined;

    const observer = new ResizeObserver(() => scheduleScrollToBottom(16));
    observer.observe(messagesColumn);
    return () => observer.disconnect();
  }, [isRunning, messagesColumn, scheduleScrollToBottom]);

  useEffect(() => cancelScheduledScroll, [cancelScheduledScroll]);

  return {
    scrollRef,
    messagesColumnRef,
    handleScroll,
    scheduleScrollToBottom,
  };
}
