export type CallMode = "audio" | "video";

export type OutgoingCallEvent =
  { kind: "invite"; mode: CallMode } | { kind: "decline" } | { kind: "hangup" };

export interface CallEventEnvelope {
  schemaVersion: 1;
  type: "conversation.call.event";
  eventId: string;
  threadId: string;
  callId: string;
  senderId: string;
  event: OutgoingCallEvent;
  occurredAt: string;
}

export interface CallTokenPayload {
  serverUrl: string;
  roomName: string;
  token: string;
}
