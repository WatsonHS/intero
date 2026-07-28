import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import {
  createRealtimeSession,
  createRealtimeSubscription,
  getBootstrap,
} from "../api.js";
import { usePilotOptional } from "../pilot/context.js";
import {
  ConversationRealtimeCoordinator,
  type ConversationRealtimeStatus,
} from "./coordinator.js";
import { repairConversationChange } from "./sync.js";

interface ConversationRealtimeContextValue {
  status: ConversationRealtimeStatus;
  watchThread: (threadId: string) => Promise<() => void>;
}

const ConversationRealtimeContext =
  createContext<ConversationRealtimeContextValue>({
    status: "disabled",
    watchThread: async () => () => undefined,
  });

export function ConversationRealtimeProvider({
  children,
}: {
  children: ReactNode;
}) {
  const pilot = usePilotOptional();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<ConversationRealtimeStatus>("disabled");
  const coordinatorRef = useRef<ConversationRealtimeCoordinator | undefined>(
    undefined,
  );
  const bootstrap = useQuery({
    queryKey: ["bootstrap"],
    queryFn: ({ signal }) => getBootstrap(signal),
    enabled: !pilot?.enabled,
  });
  const enabled = pilot?.enabled
    ? Boolean(
        pilot.identityId &&
        pilot.bootstrap.data?.adapters.realtime === "centrifugo",
      )
    : Boolean(
        bootstrap.data?.currentPrincipal &&
        bootstrap.data.adapters?.realtime === "centrifugo",
      );
  const identityId = pilot?.enabled
    ? pilot.identityId
    : bootstrap.data?.currentPrincipal?.id;

  useEffect(() => {
    if (!enabled || !identityId) {
      coordinatorRef.current?.stop();
      coordinatorRef.current = undefined;
      setStatus("disabled");
      return;
    }
    const coordinator = new ConversationRealtimeCoordinator({
      createSession: createRealtimeSession,
      createSubscription: createRealtimeSubscription,
      onStatus: setStatus,
      onChange: (event) => {
        void queryClient.invalidateQueries({
          queryKey: ["pilot", "stand_in"],
        });
        void repairConversationChange(queryClient, event, identityId).catch(
          () => {
            setStatus(
              typeof navigator !== "undefined" && !navigator.onLine
                ? "offline"
                : "degraded",
            );
          },
        );
      },
      onRecoveryGap: () => {
        void queryClient.invalidateQueries({ queryKey: ["threads"] });
      },
      isOnline: () =>
        typeof navigator === "undefined" ? true : navigator.onLine,
    });
    coordinatorRef.current = coordinator;
    const online = () => coordinator.networkChanged(true);
    const offline = () => coordinator.networkChanged(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    coordinator.start();
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      coordinator.stop();
      if (coordinatorRef.current === coordinator) {
        coordinatorRef.current = undefined;
      }
    };
  }, [enabled, identityId, queryClient]);

  const watchThread = useCallback(async (threadId: string) => {
    const coordinator = coordinatorRef.current;
    if (!coordinator) return () => undefined;
    return coordinator.subscribeThread(threadId);
  }, []);

  const value = useMemo(() => ({ status, watchThread }), [status, watchThread]);
  return (
    <ConversationRealtimeContext.Provider value={value}>
      {children}
    </ConversationRealtimeContext.Provider>
  );
}

export function useConversationRealtime(): ConversationRealtimeContextValue {
  return useContext(ConversationRealtimeContext);
}
