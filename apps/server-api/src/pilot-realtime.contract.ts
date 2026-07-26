import type { RealtimePort } from "./ports.js";

export const realtimeContractEvent = {
  kind: "stand_in_projection_updated",
  projectId: "019b5ac0-7600-7000-8000-000000000011",
  workStateId: "019b5ac0-7600-7000-8000-000000000022",
} as const;

export async function exerciseRealtimeContract(
  realtime: RealtimePort,
  channel = "intero:project:019b5ac0-7600-7000-8000-000000000011",
): Promise<void> {
  await realtime.publish(channel, realtimeContractEvent);
}
