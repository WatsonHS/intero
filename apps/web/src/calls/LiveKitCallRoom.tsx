import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useMediaDeviceSelect,
  useParticipants,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track, type MediaDeviceFailure } from "livekit-client";
import { useEffect } from "react";

import { useI18n } from "../i18n/index.js";
import type { CallMode, CallTokenPayload } from "./types.js";

export const INITIAL_CALL_MEDIA = {
  audio: false,
  video: false,
} as const;

export function callControlBarControls(mode: CallMode) {
  return {
    microphone: true,
    camera: true,
    screenShare: mode === "video",
    chat: false,
    leave: true,
    // LiveKit's settings toggle requires a LayoutContextProvider and a
    // corresponding settings panel. This compact call surface has neither.
    settings: false,
  } as const;
}

export function LiveKitCallRoom({
  credentials,
  mode,
  onConnected,
  onDisconnected,
  onError,
  onMediaDeviceFailure,
  onParticipantCount,
}: {
  credentials: CallTokenPayload;
  mode: CallMode;
  onConnected: () => void;
  onDisconnected: () => void;
  onError: () => void;
  onMediaDeviceFailure: (
    failure?: MediaDeviceFailure,
    kind?: MediaDeviceKind,
  ) => void;
  onParticipantCount: (count: number) => void;
}) {
  return (
    <LiveKitRoom
      token={credentials.token}
      serverUrl={credentials.serverUrl}
      connect
      {...INITIAL_CALL_MEDIA}
      onConnected={onConnected}
      onDisconnected={onDisconnected}
      onError={onError}
      onMediaDeviceFailure={onMediaDeviceFailure}
      data-lk-theme="default"
      className="min-h-0 flex-1"
    >
      <CallStage
        mode={mode}
        onMediaDeviceFailure={onMediaDeviceFailure}
        onParticipantCount={onParticipantCount}
      />
    </LiveKitRoom>
  );
}

function CallStage({
  mode,
  onMediaDeviceFailure,
  onParticipantCount,
}: {
  mode: CallMode;
  onMediaDeviceFailure: (
    failure?: MediaDeviceFailure,
    kind?: MediaDeviceKind,
  ) => void;
  onParticipantCount: (count: number) => void;
}) {
  const participants = useParticipants();
  const tracks = useTracks([
    { source: Track.Source.Camera, withPlaceholder: true },
    { source: Track.Source.ScreenShare, withPlaceholder: false },
  ]);

  useEffect(() => {
    onParticipantCount(participants.length);
  }, [onParticipantCount, participants.length]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <GridLayout tracks={tracks} className="min-h-0 flex-1">
        <ParticipantTile />
      </GridLayout>
      <RoomAudioRenderer />
      <CallDeviceSelectors
        mode={mode}
        onDeviceError={(kind) => onMediaDeviceFailure(undefined, kind)}
      />
      <ControlBar variation="minimal" controls={callControlBarControls(mode)} />
    </div>
  );
}

function CallDeviceSelectors({
  mode,
  onDeviceError,
}: {
  mode: CallMode;
  onDeviceError: (kind: MediaDeviceKind) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-center gap-3 border-t border-white/10 bg-black/20 px-4 py-3">
      <CallDeviceSelect
        kind="audioinput"
        label={t("chat.microphone")}
        emptyLabel={t("chat.noMicrophoneAvailable")}
        onDeviceError={onDeviceError}
      />
      {mode === "video" ? (
        <CallDeviceSelect
          kind="videoinput"
          label={t("chat.camera")}
          emptyLabel={t("chat.noCameraAvailable")}
          onDeviceError={onDeviceError}
        />
      ) : null}
    </div>
  );
}

function CallDeviceSelect({
  kind,
  label,
  emptyLabel,
  onDeviceError,
}: {
  kind: "audioinput" | "videoinput";
  label: string;
  emptyLabel: string;
  onDeviceError: (kind: MediaDeviceKind) => void;
}) {
  const { devices, activeDeviceId, setActiveMediaDevice } =
    useMediaDeviceSelect({
      kind,
      onError: () => onDeviceError(kind),
    });
  const selectedDeviceId = devices.some(
    (device) => device.deviceId === activeDeviceId,
  )
    ? activeDeviceId
    : "";

  return (
    <label className="flex min-w-[220px] items-center gap-2 text-[11px] text-white/70">
      <span className="shrink-0">{label}</span>
      <select
        aria-label={label}
        value={selectedDeviceId}
        disabled={devices.length === 0}
        onChange={(event) => {
          void setActiveMediaDevice(event.currentTarget.value, {
            exact: true,
          }).catch(() => onDeviceError(kind));
        }}
        className="min-w-0 flex-1 rounded-btn border border-white/15 bg-[#27231f] px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-accent-strong disabled:cursor-not-allowed disabled:text-white/45"
      >
        {devices.length === 0 ? <option value="">{emptyLabel}</option> : null}
        {devices.map((device, index) => (
          <option key={device.deviceId} value={device.deviceId}>
            {device.label || `${label} ${index + 1}`}
          </option>
        ))}
      </select>
    </label>
  );
}
