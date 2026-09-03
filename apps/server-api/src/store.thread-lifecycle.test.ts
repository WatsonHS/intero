import type { PrincipalId, ThreadId, ThreadMessage } from "@intero/domain";
import { MUTED_INDEFINITELY_UNTIL, uuidv7 } from "@intero/domain";
import { describe, expect, it } from "vitest";

import { PilotStoreError } from "./pilot-store.js";
import { InMemoryPlatformStore } from "./store.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;
const TEAM_ID = "019b5ac0-7600-7000-8000-000000000031";

function createRoom(
  store: InMemoryPlatformStore,
  input: {
    visibility?: "private" | "team";
    kind?: "room" | "human_group";
  } = {},
) {
  const threadId = uuidv7() as ThreadId;
  store.upsertPrincipal({
    id: ALEX,
    displayName: "Alex Rivera",
    kind: "human",
  });
  store.upsertPrincipal({
    id: PRIYA,
    displayName: "Priya Shah",
    kind: "human",
  });
  const thread = store.createThread(
    {
      id: threadId,
      kind: input.kind ?? "room",
      title: "Lifecycle room",
      participantIds: [ALEX],
      standInIds: [],
      accessMode: "agent_readable",
      priorHistoryGranted: false,
      sequence: 0,
      teamId: TEAM_ID,
      visibility: input.visibility ?? "private",
      createdAt: new Date().toISOString(),
    },
    ALEX,
  );
  return { threadId, thread };
}

describe("thread mute, join, and archive", () => {
  it("stores a per-principal mute that does not change unread counts", () => {
    const store = new InMemoryPlatformStore();
    const { threadId } = createRoom(store);
    store.updateThread(threadId, { addParticipantIds: [PRIYA] }, ALEX);
    store.appendMessage(threadId, {
      id: uuidv7() as ThreadMessage["id"],
      senderId: ALEX,
      body: "hello",
      createdAt: new Date().toISOString(),
    });
    store.setThreadNotificationPreference(threadId, PRIYA, {
      mutedUntil: MUTED_INDEFINITELY_UNTIL,
    });
    const listed = store.listThreads("room", PRIYA);
    expect(listed[0]?.unreadCount).toBeGreaterThan(0);
    expect(listed[0]?.notificationPreference?.mutedUntil).toBe(
      MUTED_INDEFINITELY_UNTIL,
    );
  });

  it("lets a team-visible Room be joined and left", () => {
    const store = new InMemoryPlatformStore();
    const { threadId } = createRoom(store, { visibility: "team" });
    const joined = store.joinThread(threadId, PRIYA);
    expect(joined.participantIds).toContain(PRIYA);
    expect(
      store.listTeamRooms(TEAM_ID, PRIYA, { includeJoined: false }),
    ).toHaveLength(0);
    expect(
      store.listTeamRooms(TEAM_ID, PRIYA, { includeJoined: true }),
    ).toHaveLength(1);
    store.leaveThread(threadId, PRIYA);
    expect(store.hasThreadAccess(threadId, PRIYA)).toBe(false);
  });

  it("rejects joining a private Room", () => {
    const store = new InMemoryPlatformStore();
    const { threadId } = createRoom(store);
    expect(() => store.joinThread(threadId, PRIYA)).toThrow("not found");
  });

  it("rejects team visibility on a DM", () => {
    const store = new InMemoryPlatformStore();
    expect(() =>
      store.createThread(
        {
          id: uuidv7() as ThreadId,
          kind: "human_direct",
          title: "Alex / Priya",
          participantIds: [ALEX, PRIYA],
          standInIds: [],
          accessMode: "agent_readable",
          priorHistoryGranted: false,
          sequence: 0,
          teamId: TEAM_ID,
          visibility: "team",
          createdAt: new Date().toISOString(),
        },
        ALEX,
      ),
    ).toThrow(PilotStoreError);
  });

  it("archives Rooms for everyone and DMs per viewer", () => {
    const store = new InMemoryPlatformStore();
    const { threadId } = createRoom(store);
    const archived = store.archiveThread(threadId, ALEX);
    expect(archived.archivedAt).toBeTruthy();
    expect(store.listThreads("room", ALEX)).toHaveLength(0);
    expect(store.listThreads("room", ALEX, { archived: true })).toHaveLength(1);
    expect(() =>
      store.appendMessage(threadId, {
        id: uuidv7() as ThreadMessage["id"],
        senderId: ALEX,
        body: "nope",
        createdAt: new Date().toISOString(),
      }),
    ).toThrow(PilotStoreError);

    const dmId = uuidv7() as ThreadId;
    store.createThread(
      {
        id: dmId,
        kind: "human_direct",
        title: "Alex / Priya",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
      ALEX,
    );
    store.archiveThread(dmId, PRIYA);
    expect(store.listThreads("human_direct", PRIYA)).toHaveLength(0);
    expect(store.listThreads("human_direct", ALEX)).toHaveLength(1);
    store.appendMessage(dmId, {
      id: uuidv7() as ThreadMessage["id"],
      senderId: ALEX,
      body: "still writable",
      createdAt: new Date().toISOString(),
    });
  });
});
