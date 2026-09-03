import type {
  ConversationThread,
  PilotProject,
  PrincipalId,
} from "@intero/domain";

import type { PilotTeamPayload } from "../../pilot/api.js";
import {
  personalStandInPrincipalId,
  type MentionedStandIn,
} from "./helpers.js";

export type { MentionedStandIn } from "./helpers.js";

export interface ConversationMentionCandidate {
  principalId: PrincipalId;
  displayName: string;
  kind: "human" | "stand_in" | "service";
  standInOwnerId?: PrincipalId;
}

export interface ConversationMention {
  start: number;
  end: number;
  query: string;
}

export function conversationMentionCandidates(input: {
  participantIds: string[];
  standInIds: string[];
  principalNames: Map<string, string>;
  principalKinds?: Map<string, "human" | "stand_in" | "service">;
  standInOwnerIds?: Map<PrincipalId, PrincipalId>;
  additionalStandIns?: PersonalStandInMentionCandidate[];
}): ConversationMentionCandidate[] {
  const standInIds = new Set(input.standInIds);
  const candidates = new Map<string, ConversationMentionCandidate>();
  for (const principalId of input.participantIds) {
    const standInOwnerId = input.standInOwnerIds?.get(
      principalId as PrincipalId,
    );
    candidates.set(principalId, {
      principalId: principalId as PrincipalId,
      displayName:
        input.principalNames.get(principalId) ?? principalId.slice(0, 8),
      kind: standInIds.has(principalId)
        ? "stand_in"
        : input.principalKinds?.get(principalId) === "service"
          ? "service"
          : "human",
      ...(standInOwnerId ? { standInOwnerId } : {}),
    });
  }
  for (const candidate of input.additionalStandIns ?? []) {
    const principalId = personalStandInPrincipalId(candidate.principalId);
    if (candidates.has(principalId)) continue;
    candidates.set(principalId, {
      principalId,
      displayName: `${candidate.displayName} 的替身`,
      kind: "stand_in",
      standInOwnerId: candidate.principalId,
    });
  }
  return [...candidates.values()].toSorted(
    (left, right) =>
      mentionKindOrder(left.kind) - mentionKindOrder(right.kind) ||
      left.displayName.localeCompare(right.displayName),
  );
}

function mentionKindOrder(kind: ConversationMentionCandidate["kind"]): number {
  return kind === "service" ? 0 : kind === "human" ? 1 : 2;
}

export function mentionedStandIns(
  body: string,
  candidates: ConversationMentionCandidate[],
): MentionedStandIn[] {
  const mentioned = new Map<PrincipalId, MentionedStandIn>();
  for (const part of splitConversationMentions(body, candidates)) {
    if (part.mention?.kind !== "stand_in" || !part.mention.standInOwnerId) {
      continue;
    }
    mentioned.set(part.mention.principalId, {
      principalId: part.mention.principalId,
      ownerId: part.mention.standInOwnerId,
    });
  }
  return [...mentioned.values()];
}

export function standInsAddressedByMessage(
  body: string,
  candidates: ConversationMentionCandidate[],
  threadKind: ConversationThread["kind"],
): MentionedStandIn[] {
  const explicit = mentionedStandIns(body, candidates);
  if (explicit.length > 0 || threadKind !== "stand_in") return explicit;
  const directStandIns = candidates.filter(
    (
      candidate,
    ): candidate is ConversationMentionCandidate & {
      standInOwnerId: PrincipalId;
    } => candidate.kind === "stand_in" && Boolean(candidate.standInOwnerId),
  );
  return directStandIns.length === 1
    ? [
        {
          principalId: directStandIns[0]!.principalId,
          ownerId: directStandIns[0]!.standInOwnerId,
        },
      ]
    : [];
}

export function conversationMentionQuery(
  draft: string,
  cursor: number,
): ConversationMention | undefined {
  const beforeCursor = draft.slice(0, cursor);
  const match = /@([^\s@]*)$/u.exec(beforeCursor);
  if (!match) return undefined;
  return {
    start: match.index,
    end: cursor,
    query: match[1] ?? "",
  };
}

export function filterConversationMentionCandidates(
  candidates: ConversationMentionCandidate[],
  query: string,
): ConversationMentionCandidate[] {
  const needle = query.replaceAll(/\s/gu, "").toLocaleLowerCase();
  return candidates.filter((candidate) =>
    candidate.displayName
      .replaceAll(/\s/gu, "")
      .toLocaleLowerCase()
      .includes(needle),
  );
}

export function moveMentionCandidateIndex(input: {
  currentIndex: number;
  direction: "next" | "previous";
  candidateCount: number;
}): number {
  if (input.candidateCount <= 0) return 0;
  const offset = input.direction === "next" ? 1 : -1;
  return (
    (input.currentIndex + offset + input.candidateCount) % input.candidateCount
  );
}

export function mentionOptionId(principalId: PrincipalId): string {
  return `communications-mention-option-${principalId}`;
}

export function applyConversationMention(
  draft: string,
  cursor: number,
  candidate: ConversationMentionCandidate,
  mention = conversationMentionQuery(draft, cursor),
): { draft: string; cursor: number } {
  const start = mention?.start ?? cursor;
  const end = mention?.end ?? cursor;
  const nextCharacter = draft[end];
  const separator =
    nextCharacter === undefined ||
    !/[\s，。！？、,.!?:;；：）)\]】]/u.test(nextCharacter)
      ? " "
      : "";
  const token = `@${candidate.displayName}${separator}`;
  return {
    draft: `${draft.slice(0, start)}${token}${draft.slice(end)}`,
    cursor: start + token.length,
  };
}

export interface ConversationMessagePart {
  text: string;
  mention?: ConversationMentionCandidate;
}

export function splitConversationMentions(
  body: string,
  candidates: ConversationMentionCandidate[],
): ConversationMessagePart[] {
  const candidateByName = new Map(
    candidates.map((candidate) => [candidate.displayName, candidate]),
  );
  const names = [...candidateByName.keys()]
    .filter(Boolean)
    .toSorted((left, right) => right.length - left.length);
  if (names.length === 0) return [{ text: body }];

  const alternatives = names.map(escapeRegularExpression).join("|");
  const matcher = new RegExp(
    `@(${alternatives})(?=$|[\\s，。！？、,.!?:;；：）)\\]】])`,
    "gu",
  );
  const parts: ConversationMessagePart[] = [];
  let offset = 0;
  for (const match of body.matchAll(matcher)) {
    const index = match.index;
    if (index > offset) parts.push({ text: body.slice(offset, index) });
    const candidate = candidateByName.get(match[1] ?? "");
    parts.push({
      text: match[0],
      ...(candidate ? { mention: candidate } : {}),
    });
    offset = index + match[0].length;
  }
  if (offset < body.length) parts.push({ text: body.slice(offset) });
  return parts.length > 0 ? parts : [{ text: body }];
}

export function extractConversationMentionPrincipalIds(
  body: string,
  candidates: ConversationMentionCandidate[],
  senderId?: string,
): string[] {
  return [
    ...new Set(
      splitConversationMentions(body, candidates)
        .map((part) => part.mention?.principalId)
        .filter(
          (principalId): principalId is PrincipalId =>
            principalId !== undefined && principalId !== senderId,
        ),
    ),
  ];
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export interface PersonalStandInMentionCandidate {
  principalId: PrincipalId;
  displayName: string;
  teamName: string;
}

export interface PersonalStandInMention {
  start: number;
  end: number;
  query: string;
}

export function personalStandInMentionCandidates(input: {
  project: PilotProject | undefined;
  teams: PilotTeamPayload[];
  currentPrincipalId: PrincipalId | undefined;
}): PersonalStandInMentionCandidate[] {
  if (!input.project) return [];
  const participatingTeamIds = new Set(input.project.participatingTeamIds);
  return [
    ...new Map(
      input.teams
        .filter((team) => participatingTeamIds.has(team.id))
        .flatMap((team) =>
          team.members
            .filter(
              (member) =>
                member.kind === "human" &&
                member.id !== input.currentPrincipalId,
            )
            .map(
              (member) =>
                [
                  member.id,
                  {
                    principalId: member.id,
                    displayName: member.displayName,
                    teamName: team.name,
                  },
                ] as const,
            ),
        ),
    ).values(),
  ].toSorted((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function personalStandInMentionQuery(
  draft: string,
): PersonalStandInMention | undefined {
  const match = /@([^\s@]*)$/u.exec(draft);
  if (!match) return undefined;
  return {
    start: match.index,
    end: draft.length,
    query: match[1] ?? "",
  };
}

export function applyPersonalStandInMention(
  draft: string,
  mention: PersonalStandInMention,
  candidate: PersonalStandInMentionCandidate,
): string {
  return `${draft.slice(0, mention.start)}@${candidate.displayName} 的替身 ${draft.slice(mention.end)}`;
}
