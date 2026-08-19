import { useEffect, useRef } from 'react';
import { ScrollFollow } from './scroll-follow.js';

export function useStreamingAutoScroll({ scrollKey, isRunning, resetKey }) {
  const scrollRef = useRef(null);
  const followRef = useRef(null);
  const previousScrollKeyRef = useRef(scrollKey);
  const previousResetKeyRef = useRef();
  const wasRunningRef = useRef(false);

  useEffect(() => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) return undefined;
    const follow = new ScrollFollow(scrollElement);
    followRef.current = follow;
    follow.jumpToBottom();
    return () => {
      followRef.current = null;
      follow.destroy();
    };
  }, []);

  useEffect(() => {
    if (resetKey === previousResetKeyRef.current) return;
    previousResetKeyRef.current = resetKey;
    previousScrollKeyRef.current = scrollKey;
    const follow = followRef.current;
    if (!follow) return;
    follow.setFollowing(true);
    follow.jumpToBottom();
  }, [resetKey, scrollKey]);

  useEffect(() => {
    if (isRunning && !wasRunningRef.current) followRef.current?.setFollowing(true);
    wasRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    if (scrollKey === previousScrollKeyRef.current) return;
    previousScrollKeyRef.current = scrollKey;
    followRef.current?.chase();
  }, [scrollKey]);

  return { scrollRef };
}
