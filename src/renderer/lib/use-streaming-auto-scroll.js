import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { ScrollFollow } from './scroll-follow.js';

export function useStreamingAutoScroll({
  scrollKey,
  isRunning,
  resetKey,
  focusKey,
  focusReady = true,
  prependKey,
}) {
  const scrollRef = useRef(null);
  const followRef = useRef(null);
  const previousScrollKeyRef = useRef(scrollKey);
  const previousResetKeyRef = useRef();
  const focusPendingRef = useRef(false);
  const recenterFrameRef = useRef(null);
  const prependRestoreRef = useRef(null);
  const prependFrameRef = useRef(null);
  const prependResetKeyRef = useRef();
  const frameResetKeyRef = useRef(resetKey);
  const wasRunningRef = useRef(false);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;
    const follow = new ScrollFollow(scrollElement);
    followRef.current = follow;
    follow.jumpToBottom();
    return () => {
      if (recenterFrameRef.current !== null) cancelAnimationFrame(recenterFrameRef.current);
      if (prependFrameRef.current !== null) cancelAnimationFrame(prependFrameRef.current);
      recenterFrameRef.current = null;
      prependFrameRef.current = null;
      prependRestoreRef.current = null;
      prependResetKeyRef.current = undefined;
      followRef.current = null;
      follow.destroy();
    };
  }, []);

  useLayoutEffect(() => {
    if (frameResetKeyRef.current === resetKey) return;
    frameResetKeyRef.current = resetKey;
    if (recenterFrameRef.current !== null) cancelAnimationFrame(recenterFrameRef.current);
    if (prependFrameRef.current !== null) cancelAnimationFrame(prependFrameRef.current);
    recenterFrameRef.current = null;
    prependFrameRef.current = null;
    prependRestoreRef.current = null;
    prependResetKeyRef.current = undefined;
  }, [resetKey]);

  useEffect(() => {
    const follow = followRef.current;
    const scrollElement = scrollRef.current;
    if (!follow || !scrollElement) return;

    const resetChanged = resetKey !== previousResetKeyRef.current;
    if (resetChanged) {
      previousResetKeyRef.current = resetKey;
      previousScrollKeyRef.current = scrollKey;
      focusPendingRef.current = focusKey !== undefined;
      wasRunningRef.current = isRunning;
      follow.setFollowing(true);
    }

    if (focusPendingRef.current && focusReady) {
      focusPendingRef.current = false;
      const target = focusKey
        ? [...scrollElement.querySelectorAll('[data-message-id]')]
          .find((element) => element.dataset.messageId === focusKey)
        : null;
      if (target) {
        previousScrollKeyRef.current = scrollKey;
        follow.alignStart(target);
        follow.setFollowing(false);
        if (recenterFrameRef.current !== null) cancelAnimationFrame(recenterFrameRef.current);
        const targetResetKey = resetKey;
        recenterFrameRef.current = requestAnimationFrame(() => {
          recenterFrameRef.current = null;
          if (frameResetKeyRef.current !== targetResetKey) return;
          follow.alignStart(target);
          follow.setFollowing(false);
        });
        return;
      }
    }

    if (resetChanged) follow.jumpToBottom();
  }, [focusKey, focusReady, isRunning, resetKey, scrollKey]);

  const prepareForPrepend = useCallback(() => {
    const follow = followRef.current;
    const scrollElement = scrollRef.current;
    if (
      !follow
      || !scrollElement
      || prependRestoreRef.current
      || prependFrameRef.current !== null
    ) return false;
    const scrollRect = scrollElement.getBoundingClientRect();
    const target = [...scrollElement.querySelectorAll('[data-message-id]')]
      .find((element) => element.getBoundingClientRect().bottom > scrollRect.top);
    if (!target) return false;
    prependRestoreRef.current = follow.preserveAnchor(target);
    prependResetKeyRef.current = resetKey;
    return true;
  }, [resetKey]);

  useLayoutEffect(() => {
    const restore = prependRestoreRef.current;
    const restoreResetKey = prependResetKeyRef.current;
    if (!restore) return;
    prependRestoreRef.current = null;
    prependResetKeyRef.current = undefined;
    if (restoreResetKey !== resetKey) return;
    restore();
    if (prependFrameRef.current !== null) cancelAnimationFrame(prependFrameRef.current);
    prependFrameRef.current = requestAnimationFrame(() => {
      prependFrameRef.current = null;
      if (frameResetKeyRef.current !== restoreResetKey) return;
      restore();
    });
  }, [prependKey, resetKey]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) {
      followRef.current?.setFollowing(true);
      followRef.current?.jumpToBottom();
    }
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (scrollKey === previousScrollKeyRef.current) return;
    previousScrollKeyRef.current = scrollKey;
    followRef.current?.chase();
  }, [scrollKey]);

  return { scrollRef, prepareForPrepend };
}
