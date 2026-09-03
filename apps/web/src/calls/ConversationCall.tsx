import {
  ArrowsOutSimpleIcon,
  MinusIcon,
  PhoneDisconnectIcon,
  PhoneIcon,
  VideoCameraIcon,
} from "@phosphor-icons/react";
import {
  Component,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { requestCallToken, sendCallEvent } from "../api.js";
import { createClientUuid } from "../client-id.js";
import { useI18n } from "../i18n/index.js";
import { useConversationRealtime } from "../realtime/context.js";
import type {
  CallEventEnvelope,
  CallMode,
  CallTokenPayload,
  OutgoingCallEvent,
} from "./types.js";

type CallStatus = "idle" | "incoming" | "joining" | "calling" | "connected";

interface ActiveCall {
  id: string;
  mode: CallMode;
  inviterId: string;
  outgoing: boolean;
}

export function callStageClass(mode: CallMode, minimized: boolean): string {
  const size = minimized
    ? "h-[68px]"
    : mode === "video"
      ? "h-[min(520px,58vh)]"
      : "h-[320px]";
  return `relative flex w-full ${size} flex-col overflow-hidden rounded-[18px] bg-[#191714] shadow-[0_14px_40px_rgba(25,20,14,0.18)] transition-[height] duration-200`;
}

export function mediaDeviceFailureError(
  failure: string | undefined,
  kind: MediaDeviceKind | undefined,
):
  | "chat.microphoneMissing"
  | "chat.cameraMissing"
  | "chat.mediaDeviceInUse"
  | "chat.mediaPermissionDenied" {
  if (failure === "NotFound") {
    return kind === "videoinput"
      ? "chat.cameraMissing"
      : "chat.microphoneMissing";
  }
  if (failure === "DeviceInUse") return "chat.mediaDeviceInUse";
  return "chat.mediaPermissionDenied";
}

class CallMediaErrorBoundary extends Component<
  { children: ReactNode; onError: () => void },
  { failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: true } {
    return { failed: true };
  }

  override componentDidCatch(_error: unknown, _info: ErrorInfo) {
    this.props.onError();
  }

  override render() {
    return this.state.failed ? null : this.props.children;
  }
}

const LiveKitCallRoom = lazy(async () => {
  const module = await import("./LiveKitCallRoom.js");
  return { default: module.LiveKitCallRoom };
});

export function ConversationCall({
  enabled,
  stageContainerId,
  threadId,
  currentPrincipalId,
  title,
  principalNames,
  humanParticipantCount,
}: {
  enabled: boolean;
  stageContainerId: string;
  threadId: string;
  currentPrincipalId: string;
  title: string;
  principalNames: Map<string, string>;
  humanParticipantCount: number;
}) {
  const { t } = useI18n();
  const realtime = useConversationRealtime();
  const [status, setStatus] = useState<CallStatus>("idle");
  const statusRef = useRef<CallStatus>("idle");
  const [activeCall, setActiveCall] = useState<ActiveCall>();
  const activeCallRef = useRef<ActiveCall | undefined>(undefined);
  const [credentials, setCredentials] = useState<CallTokenPayload>();
  const [error, setError] = useState<string>();
  const [minimized, setMinimized] = useState(false);
  const [stageContainer, setStageContainer] = useState<HTMLElement | null>(
    null,
  );
  const inviteSentRef = useRef(false);
  const endingRef = useRef(false);
  const mediaFailureRef = useRef(false);

  const updateStatus = useCallback((next: CallStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const updateActiveCall = useCallback((next?: ActiveCall) => {
    activeCallRef.current = next;
    setActiveCall(next);
  }, []);

  const publish = useCallback(
    async (callId: string, event: OutgoingCallEvent) => {
      await sendCallEvent({
        eventId: createClientUuid(),
        threadId,
        callId,
        event,
      });
    },
    [threadId],
  );

  const reset = useCallback(() => {
    inviteSentRef.current = false;
    endingRef.current = false;
    setMinimized(false);
    setCredentials(undefined);
    updateActiveCall(undefined);
    updateStatus("idle");
  }, [updateActiveCall, updateStatus]);

  const endCall = useCallback(
    async (notify = true) => {
      if (endingRef.current) return;
      endingRef.current = true;
      const call = activeCallRef.current;
      if (notify && call) {
        await publish(call.id, { kind: "hangup" }).catch(() => undefined);
      }
      reset();
    },
    [publish, reset],
  );

  const handleEvent = useCallback(
    async (event: CallEventEnvelope) => {
      if (event.senderId === currentPrincipalId) return;
      const call = activeCallRef.current;
      if (event.event.kind === "invite") {
        if (statusRef.current !== "idle") return;
        updateActiveCall({
          id: event.callId,
          mode: event.event.mode,
          inviterId: event.senderId,
          outgoing: false,
        });
        updateStatus("incoming");
        setError(undefined);
        return;
      }
      if (!call || call.id !== event.callId) return;
      if (
        event.event.kind === "decline" &&
        call.outgoing &&
        humanParticipantCount <= 2
      ) {
        setError(t("chat.callDeclined"));
        await endCall(false);
        return;
      }
      if (
        event.event.kind === "hangup" &&
        (event.senderId === call.inviterId || humanParticipantCount <= 2)
      ) {
        await endCall(false);
      }
    },
    [
      currentPrincipalId,
      endCall,
      humanParticipantCount,
      t,
      updateActiveCall,
      updateStatus,
    ],
  );

  useEffect(() => {
    setStageContainer(document.getElementById(stageContainerId));
  }, [stageContainerId]);

  useEffect(() => {
    if (!enabled || realtime.status !== "live") return;
    let disposed = false;
    let release: (() => void) | undefined;
    void realtime
      .watchCallEvents(threadId, (event) => {
        void handleEvent(event).catch(() =>
          setError(t("chat.callSignalFailed")),
        );
      })
      .then((unsubscribe) => {
        if (disposed) unsubscribe();
        else release = unsubscribe;
      })
      .catch(() => setError(t("chat.callSignalFailed")));
    return () => {
      disposed = true;
      release?.();
    };
  }, [
    enabled,
    handleEvent,
    realtime.status,
    realtime.watchCallEvents,
    t,
    threadId,
  ]);

  useEffect(
    () => () => {
      const call = activeCallRef.current;
      if (call && !endingRef.current) {
        void publish(call.id, { kind: "hangup" }).catch(() => undefined);
      }
    },
    [publish],
  );

  useEffect(() => {
    if (!error) return;
    const timer = window.setTimeout(() => setError(undefined), 5_000);
    return () => window.clearTimeout(timer);
  }, [error]);

  async function join(call: ActiveCall) {
    updateStatus("joining");
    setError(undefined);
    try {
      const token = await requestCallToken({
        threadId,
        callId: call.id,
      });
      setCredentials(token);
    } catch {
      if (!call.outgoing) {
        await publish(call.id, { kind: "decline" }).catch(() => undefined);
      }
      reset();
      setError(t("chat.callStartFailed"));
    }
  }

  async function start(mode: CallMode) {
    if (
      !window.isSecureContext ||
      typeof navigator.mediaDevices?.getUserMedia !== "function"
    ) {
      setError(t("chat.mediaSecureContextRequired"));
      return;
    }
    mediaFailureRef.current = false;
    const call = {
      id: createClientUuid(),
      mode,
      inviterId: currentPrincipalId,
      outgoing: true,
    };
    updateActiveCall(call);
    await join(call);
  }

  async function accept() {
    const call = activeCallRef.current;
    if (call) await join(call);
  }

  async function decline() {
    const call = activeCallRef.current;
    if (call) {
      await publish(call.id, { kind: "decline" }).catch(() => undefined);
    }
    reset();
  }

  async function onConnected() {
    const call = activeCallRef.current;
    if (!call) return;
    if (call.outgoing && !inviteSentRef.current) {
      inviteSentRef.current = true;
      updateStatus("calling");
      try {
        await publish(call.id, { kind: "invite", mode: call.mode });
      } catch {
        setError(t("chat.callSignalFailed"));
        await endCall(false);
      }
      return;
    }
    updateStatus("connected");
  }

  const launcherDisabled =
    !enabled || realtime.status !== "live" || status !== "idle";
  const handleParticipantCount = useCallback(
    (count: number) => {
      if (count > 1) updateStatus("connected");
    },
    [updateStatus],
  );

  return (
    <>
      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          data-testid="start-audio-call"
          aria-label={t("chat.startAudioCall")}
          title={t("chat.startAudioCall")}
          disabled={launcherDisabled}
          onClick={() => void start("audio")}
          className="grid h-8 w-8 place-items-center rounded-btn border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PhoneIcon size={15} />
        </button>
        <button
          type="button"
          data-testid="start-video-call"
          aria-label={t("chat.startVideoCall")}
          title={t("chat.startVideoCall")}
          disabled={launcherDisabled}
          onClick={() => void start("video")}
          className="grid h-8 w-8 place-items-center rounded-btn border border-line2 bg-transparent text-ink-muted hover:border-accent-strong hover:text-accent-strong disabled:cursor-not-allowed disabled:opacity-40"
        >
          <VideoCameraIcon size={16} />
        </button>
      </div>

      {stageContainer
        ? createPortal(
            <>
              {status === "incoming" && activeCall ? (
                <section
                  role="dialog"
                  aria-label={t("chat.call")}
                  data-testid="conversation-call"
                  className="w-full overflow-hidden rounded-[18px] bg-panel2 shadow-[0_12px_34px_rgba(25,20,14,0.14)]"
                >
                  <CallHeader
                    mode={activeCall.mode}
                    title={title}
                    detail={t("chat.incomingCallFrom", {
                      name:
                        principalNames.get(activeCall.inviterId) ??
                        t("chat.someone"),
                    })}
                  />
                  <div className="flex items-center justify-center gap-3 px-5 py-7">
                    <button
                      type="button"
                      data-testid="reject-call"
                      onClick={() => void decline()}
                      className="inline-flex h-10 items-center gap-2 rounded-pill border border-line2 bg-transparent px-5 text-[12px] text-ink-muted hover:border-danger hover:text-danger"
                    >
                      <PhoneDisconnectIcon size={16} />
                      {t("chat.declineCall")}
                    </button>
                    <button
                      type="button"
                      data-testid="accept-call"
                      onClick={() => void accept()}
                      className="inline-flex h-10 items-center gap-2 rounded-pill border-0 bg-green px-5 text-[12px] font-[650] text-white"
                    >
                      {activeCall.mode === "video" ? (
                        <VideoCameraIcon size={17} />
                      ) : (
                        <PhoneIcon size={16} />
                      )}
                      {t("chat.acceptCall")}
                    </button>
                  </div>
                </section>
              ) : null}

              {activeCall && credentials ? (
                <section
                  role="dialog"
                  aria-label={t("chat.call")}
                  data-testid="conversation-call"
                  data-minimized={minimized || undefined}
                  className={callStageClass(activeCall.mode, minimized)}
                >
                  <CallHeader
                    mode={activeCall.mode}
                    title={title}
                    detail={
                      status === "calling"
                        ? t("chat.calling")
                        : status === "connected"
                          ? t("chat.callConnected")
                          : t("chat.connectingMedia")
                    }
                    minimized={minimized}
                    onToggleMinimized={() => setMinimized((value) => !value)}
                    onEnd={() => void endCall()}
                  />
                  <div
                    aria-hidden={minimized || undefined}
                    className={`min-h-0 flex-1 ${minimized ? "hidden" : "flex"}`}
                  >
                    <Suspense
                      fallback={
                        <div className="grid min-h-0 flex-1 place-items-center text-[12px] text-white/70">
                          {t("chat.connectingMedia")}
                        </div>
                      }
                    >
                      <CallMediaErrorBoundary
                        key={activeCall.id}
                        onError={() => {
                          setError(t("chat.callStartFailed"));
                          void endCall();
                        }}
                      >
                        <LiveKitCallRoom
                          credentials={credentials}
                          mode={activeCall.mode}
                          onConnected={() => void onConnected()}
                          onDisconnected={() => void endCall()}
                          onError={() => {
                            if (!mediaFailureRef.current) {
                              setError(t("chat.callStartFailed"));
                            }
                            void endCall();
                          }}
                          onMediaDeviceFailure={(failure, kind) => {
                            mediaFailureRef.current = true;
                            setError(t(mediaDeviceFailureError(failure, kind)));
                          }}
                          onParticipantCount={handleParticipantCount}
                        />
                      </CallMediaErrorBoundary>
                    </Suspense>
                  </div>
                </section>
              ) : null}
            </>,
            stageContainer,
          )
        : null}

      {status === "joining" && !credentials ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-pill border border-line2 bg-panel px-4 py-2 text-[11px] text-ink-muted shadow-lg">
          {t("chat.connectingMedia")}
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="fixed bottom-5 left-1/2 z-[60] -translate-x-1/2 rounded-pill border border-danger-soft bg-panel px-4 py-2 text-[11px] text-danger shadow-lg"
        >
          {error}
        </div>
      ) : null}
    </>
  );
}

function CallHeader({
  mode,
  title,
  detail,
  minimized,
  onToggleMinimized,
  onEnd,
}: {
  mode: CallMode;
  title: string;
  detail: string;
  minimized?: boolean;
  onToggleMinimized?: () => void;
  onEnd?: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex items-center gap-3 border-b border-white/10 bg-panel px-4 py-3 text-ink">
      <span className="grid h-9 w-9 place-items-center rounded-full bg-accent-soft text-accent-strong">
        {mode === "video" ? (
          <VideoCameraIcon size={18} />
        ) : (
          <PhoneIcon size={17} />
        )}
      </span>
      <span className="grid min-w-0">
        <strong className="truncate text-[13px] font-[650]">{title}</strong>
        <small className="text-[11px] text-ink-muted">{detail}</small>
      </span>
      <span className="ml-auto hidden rounded-pill bg-green-soft px-2.5 py-1 text-[10px] text-green sm:inline-flex">
        {t("chat.callPrivate")}
      </span>
      {onToggleMinimized ? (
        <button
          type="button"
          data-testid="toggle-call-size"
          aria-label={
            minimized ? t("chat.restoreCall") : t("chat.minimizeCall")
          }
          title={minimized ? t("chat.restoreCall") : t("chat.minimizeCall")}
          onClick={onToggleMinimized}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-0 bg-transparent text-ink-muted hover:bg-ink/5 hover:text-ink"
        >
          {minimized ? (
            <ArrowsOutSimpleIcon size={15} />
          ) : (
            <MinusIcon size={15} />
          )}
        </button>
      ) : null}
      {onEnd ? (
        <button
          type="button"
          data-testid="header-end-call"
          aria-label={t("chat.hangUp")}
          title={t("chat.hangUp")}
          onClick={onEnd}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-0 bg-danger text-white hover:brightness-110"
        >
          <PhoneDisconnectIcon size={15} weight="fill" />
        </button>
      ) : null}
    </div>
  );
}
