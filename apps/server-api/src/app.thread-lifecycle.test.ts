import { createHash } from "node:crypto";

import type { PrincipalId } from "@intero/domain";
import { OrganizationId, ProjectId, uuidv7 } from "@intero/domain";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { InMemoryPilotStore } from "./pilot-store.js";
import { InMemoryPlatformStore } from "./store.js";
import { buildTestApp } from "./test-app.js";

const ALEX = "019b5ac0-7600-7000-8000-000000000002" as PrincipalId;
const PRIYA = "019b5ac0-7600-7000-8000-000000000004" as PrincipalId;
const MORGAN = "019b5ac0-7600-7000-8000-000000000005" as PrincipalId;

function auth(principalId: PrincipalId) {
  return { "x-intero-dev-principal-id": principalId };
}

async function inviteMember(
  store: InMemoryPilotStore,
  input: {
    organizationId: string;
    teamId: string;
    adminId: PrincipalId;
    memberId: PrincipalId;
    email: string;
  },
) {
  const tokenHash = createHash("sha256").update(input.memberId).digest("hex");
  const now = new Date().toISOString();
  await store.createInvitation(
    {
      id: uuidv7(),
      organizationId: input.organizationId as ReturnType<
        typeof OrganizationId.parse
      >,
      teamId: input.teamId,
      email: input.email,
      tokenHash,
      createdBy: input.adminId,
      expiresAt: "2099-01-01T00:00:00.000Z",
      createdAt: now,
      updatedAt: now,
    },
    input.adminId,
  );
  await store.acceptInvitation({
    tokenHash,
    email: input.email,
    principalId: input.memberId,
    now,
  });
}

describe("thread mute, directory, and archive routes", () => {
  let store: InMemoryPlatformStore;
  let pilotStore: InMemoryPilotStore;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let teamId: string;
  let organizationId: ReturnType<typeof OrganizationId.parse>;

  beforeEach(async () => {
    store = new InMemoryPlatformStore();
    pilotStore = new InMemoryPilotStore();
    organizationId = OrganizationId.parse(uuidv7());
    teamId = uuidv7();
    const now = new Date().toISOString();
    await pilotStore.setupOrganization({
      organization: {
        id: organizationId,
        name: "Intero Lab",
        deploymentBaseUrl: "http://127.0.0.1:4310",
        deploymentValidatedAt: now,
        provider: { configured: false },
      },
      administratorId: ALEX,
      initialTeam: {
        id: teamId,
        organizationId,
        name: "Engineering",
        createdAt: now,
      },
    });
    await inviteMember(pilotStore, {
      organizationId,
      teamId,
      adminId: ALEX,
      memberId: PRIYA,
      email: "priya.shah@intero.test",
    });
    await pilotStore.createProject({
      id: ProjectId.parse(uuidv7()),
      organizationId,
      name: "Auth Platform",
      ownerId: ALEX,
      primaryTeamId: teamId,
      participatingTeamIds: [teamId],
      posture: "collaborative",
      createdAt: now,
      updatedAt: now,
    });
    app = await buildTestApp({
      store,
      pilotStore,
      logger: false,
      pilotIdentities: [
        { id: ALEX, displayName: "Alex Rivera", kind: "human" },
        { id: PRIYA, displayName: "Priya Shah", kind: "human" },
        { id: MORGAN, displayName: "Morgan Chen", kind: "human" },
      ],
    });
  });

  afterEach(async () => {
    await app.close();
  });

  async function createTeamRoom() {
    const created = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: uuidv7(),
        kind: "room",
        title: "#engineering",
        participantIds: [ALEX],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        teamId,
        visibility: "team",
        createdAt: new Date().toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    return created.json() as { id: string; participantIds: string[] };
  }

  it("mutes a thread for the current principal", async () => {
    const room = await createTeamRoom();
    const mutedUntil = "2099-01-01T00:00:00.000Z";
    const updated = await app.inject({
      method: "PUT",
      url: `/v1/threads/${room.id}/notification-preference`,
      headers: auth(ALEX),
      payload: { mutedUntil, muteIncludingMentions: true },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().preference).toMatchObject({
      mutedUntil,
      muteIncludingMentions: true,
    });
    const listed = await app.inject({
      method: "GET",
      url: "/v1/threads",
      headers: auth(ALEX),
    });
    expect(
      listed
        .json()
        .items.find(
          (item: { thread: { id: string } }) => item.thread.id === room.id,
        )?.notificationPreference,
    ).toMatchObject({ mutedUntil, muteIncludingMentions: true });
  });

  it("lets a team member join and leave a team-visible Room", async () => {
    const room = await createTeamRoom();
    const forbidden = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/join`,
      headers: auth(MORGAN),
    });
    expect(forbidden.statusCode).toBe(403);

    const roomsHidden = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/rooms`,
      headers: auth(MORGAN),
    });
    expect(roomsHidden.statusCode).toBe(403);

    const directory = await app.inject({
      method: "GET",
      url: `/v1/teams/${teamId}/rooms`,
      headers: auth(PRIYA),
    });
    expect(directory.statusCode).toBe(200);
    expect(directory.json().items).toHaveLength(1);

    const joined = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/join`,
      headers: auth(PRIYA),
    });
    expect(joined.statusCode).toBe(201);
    expect(joined.json().thread.participantIds).toContain(PRIYA);

    const again = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/join`,
      headers: auth(PRIYA),
    });
    expect(again.statusCode).toBe(200);

    const left = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/leave`,
      headers: auth(PRIYA),
    });
    expect(left.statusCode).toBe(204);

    const strangerLeave = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/leave`,
      headers: auth(MORGAN),
    });
    expect(strangerLeave.statusCode).toBe(404);
  });

  it("restricts visibility changes to the creator or an admin/leader", async () => {
    const room = await createTeamRoom();
    await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/join`,
      headers: auth(PRIYA),
    });
    const memberDenied = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${room.id}`,
      headers: auth(PRIYA),
      payload: { visibility: "private" },
    });
    expect(memberDenied.statusCode).toBe(403);

    const stranger = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${room.id}`,
      headers: auth(MORGAN),
      payload: { visibility: "private" },
    });
    expect(stranger.statusCode).toBe(404);

    const creator = await app.inject({
      method: "PATCH",
      url: `/v1/threads/${room.id}`,
      headers: auth(ALEX),
      payload: { visibility: "private" },
    });
    expect(creator.statusCode).toBe(200);
    expect(creator.json().thread.visibility).toBe("private");
  });

  it("lets a team leader archive a Room and rejects writes afterwards", async () => {
    const room = await createTeamRoom();
    await pilotStore.updateTeamMemberRole({
      teamId,
      memberId: PRIYA,
      role: "leader",
      principalId: ALEX,
      now: new Date().toISOString(),
    });
    const memberDenied = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/archive`,
      headers: auth(MORGAN),
    });
    expect(memberDenied.statusCode).toBe(404);

    const archived = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/archive`,
      headers: auth(PRIYA),
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().thread.archivedAt).toBeTruthy();

    const send = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/messages`,
      headers: auth(ALEX),
      payload: { clientMessageId: uuidv7(), body: "too late" },
    });
    expect(send.statusCode).toBe(409);

    const typing = await app.inject({
      method: "POST",
      url: `/v1/threads/${room.id}/typing`,
      headers: auth(ALEX),
    });
    expect(typing.statusCode).toBe(409);

    const listed = await app.inject({
      method: "GET",
      url: "/v1/threads",
      headers: auth(ALEX),
    });
    expect(
      listed
        .json()
        .items.some(
          (item: { thread: { id: string } }) => item.thread.id === room.id,
        ),
    ).toBe(false);
    const archivedList = await app.inject({
      method: "GET",
      url: "/v1/threads?archived=true",
      headers: auth(ALEX),
    });
    expect(
      archivedList
        .json()
        .items.some(
          (item: { thread: { id: string } }) => item.thread.id === room.id,
        ),
    ).toBe(true);
  });

  it("archives DMs per participant without making them read-only", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/v1/threads",
      headers: auth(ALEX),
      payload: {
        id: uuidv7(),
        kind: "human_direct",
        title: "Alex / Priya",
        participantIds: [ALEX, PRIYA],
        standInIds: [],
        accessMode: "agent_readable",
        priorHistoryGranted: false,
        createdAt: new Date().toISOString(),
      },
    });
    expect(created.statusCode).toBe(201);
    const threadId = created.json().id as string;
    const archived = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/archive`,
      headers: auth(PRIYA),
    });
    expect(archived.statusCode).toBe(200);
    const priyaList = await app.inject({
      method: "GET",
      url: "/v1/threads",
      headers: auth(PRIYA),
    });
    expect(
      priyaList
        .json()
        .items.some(
          (item: { thread: { id: string } }) => item.thread.id === threadId,
        ),
    ).toBe(false);
    const alexList = await app.inject({
      method: "GET",
      url: "/v1/threads",
      headers: auth(ALEX),
    });
    expect(
      alexList
        .json()
        .items.some(
          (item: { thread: { id: string } }) => item.thread.id === threadId,
        ),
    ).toBe(true);
    const send = await app.inject({
      method: "POST",
      url: `/v1/threads/${threadId}/messages`,
      headers: auth(ALEX),
      payload: { clientMessageId: uuidv7(), body: "still open" },
    });
    expect(send.statusCode).toBe(201);
  });
});
