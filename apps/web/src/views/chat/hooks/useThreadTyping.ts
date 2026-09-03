import type { PrincipalId, TypingEvent } from "@intero/domain";
import { useCallback, useEffect, useRef, useState } from "react";

import { publishThreadTyping } from "../../../api.js";
import { useConversationRealtime } from "../../../realtime/context.js";

const TYPING_PUBLISH_INTERVAL_MS = 3_000;
const TYPING_EXPIRE_MS = 6_000;

export function useThreadTyping({
  threadId,
  currentPrincipalId,
  enabled,
}: {
  threadId: string | undefined;
  currentPrincipalId: PrincipalId | undefined;
  enabled: boolean;
}) {
  const realtime = useConversationRealtime();
  const [typists, setTypists] = useState<PrincipalId[]>([]);
  const lastPublishAt = useRef(0);
  const expiryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    if (!enabled || !threadId) {
      setTypists([]);
      return;
    }
    let disposed = false;
    let release: (() => void) | undefined;
    void realtime
      .watchTyping(threadId, (event: TypingEvent) => {
        if (event.principalId === currentPrincipalId) return;
        setTypists((current) =>
          current.includes(event.principalId)
            ? current
            : [...current, event.principalId],
        );
        const existing = expiryTimers.current.get(event.principalId);
        if (existing) clearTimeout(existing);
        expiryTimers.current.set(
          event.principalId,
          setTimeout(() => {
            expiryTimers.current.delete(event.principalId);
            setTypists((current) =>
              current.filter(
                (principalId) => principalId !== event.principalId,
              ),
            );
          }, TYPING_EXPIRE_MS),
        );
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else release = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      release?.();
      for (const timer of expiryTimers.current.values()) clearTimeout(timer);
      expiryTimers.current.clear();
      setTypists([]);
    };
  }, [currentPrincipalId, enabled, realtime.watchTyping, threadId]);

  const notifyTyping = useCallback(() => {
    if (!enabled || !threadId) return;
    const now = Date.now();
    if (now - lastPublishAt.current < TYPING_PUBLISH_INTERVAL_MS) return;
    lastPublishAt.current = now;
    void publishThreadTyping(threadId).catch(() => undefined);
  }, [enabled, threadId]);

  return { typists, notifyTyping };
}
