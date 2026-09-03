import { useEffect } from "react";

import { useConversationRealtime } from "../../../realtime/context.js";

export function useThreadRealtime({
  threadId,
  currentIsPilot,
  currentIsPilotStandIn,
}: {
  threadId: string | undefined;
  currentIsPilot: boolean;
  currentIsPilotStandIn: boolean;
}) {
  const realtime = useConversationRealtime();

  useEffect(() => {
    if (
      realtime.status !== "live" ||
      !threadId ||
      currentIsPilot ||
      currentIsPilotStandIn
    ) {
      return;
    }
    let disposed = false;
    let release: (() => void) | undefined;
    void realtime
      .watchThread(threadId)
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else release = unsubscribe;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      release?.();
    };
  }, [
    threadId,
    currentIsPilot,
    currentIsPilotStandIn,
    realtime.status,
    realtime.watchThread,
  ]);

  return realtime;
}
