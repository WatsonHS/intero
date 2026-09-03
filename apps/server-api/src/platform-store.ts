import type {
  ActionEnvelope,
  ActionInboxItem,
  ActivityEvent,
  DecisionRecord,
  KanbanCard,
  KanbanCardId,
  OperationId,
  PrincipalId,
  Project,
  ProjectId,
  PublicWorkProjection,
  PreferredLanguage,
} from "@intero/domain";

import type { InMemoryPlatformStore, KanbanCardUpdate } from "./store.js";
import type { StandInQuestionInput } from "./store.js";

type Awaitable<T> = T | Promise<T>;
type StoreMethod<Name extends keyof InMemoryPlatformStore> =
  InMemoryPlatformStore[Name] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Awaitable<Result>
    : never;

export interface PlatformStore {
  ensureProject(project: Project): Awaitable<Project>;
  listProjects(): Awaitable<Project[]>;
  listKanbanCards(projectId?: ProjectId): Awaitable<KanbanCard[]>;
  createKanbanCard: StoreMethod<"createKanbanCard">;
  updateKanbanCard(
    cardId: KanbanCardId,
    update: KanbanCardUpdate,
  ): Awaitable<KanbanCard>;
  createWorkstream: StoreMethod<"createWorkstream">;
  addClaim: StoreMethod<"addClaim">;
  ingestEvent: StoreMethod<"ingestEvent">;
  applyProjection: StoreMethod<"applyProjection">;
  putGrant: StoreMethod<"putGrant">;
  coordinate: StoreMethod<"coordinate">;
  createThread: StoreMethod<"createThread">;
  ensureRoomServicePrincipal: StoreMethod<"ensureRoomServicePrincipal">;
  updateThread: StoreMethod<"updateThread">;
  appendMessage: StoreMethod<"appendMessage">;
  enqueueStandInQuestion(
    input: StandInQuestionInput,
  ): Awaitable<import("@intero/domain").ThreadMessage>;
  updateMessageStream: StoreMethod<"updateMessageStream">;
  upsertCoordinationSummary: StoreMethod<"upsertCoordinationSummary">;
  setMessageReaction: StoreMethod<"setMessageReaction">;
  editThreadMessage: StoreMethod<"editThreadMessage">;
  deleteThreadMessage: StoreMethod<"deleteThreadMessage">;
  addStandInToThread: StoreMethod<"addStandInToThread">;
  markThreadRead: StoreMethod<"markThreadRead">;
  listThreadReads: StoreMethod<"listThreadReads">;
  listThreadMessages: StoreMethod<"listThreadMessages">;
  getThreadMessage: StoreMethod<"getThreadMessage">;
  searchMessages: StoreMethod<"searchMessages">;
  getStoredThreadMessage: StoreMethod<"getStoredThreadMessage">;
  hideMessagePreviews: StoreMethod<"hideMessagePreviews">;
  attachMessagePreviewUrls: StoreMethod<"attachMessagePreviewUrls">;
  getLinkPreviews: StoreMethod<"getLinkPreviews">;
  putLinkPreview: StoreMethod<"putLinkPreview">;
  concludeThreadIntoParent: StoreMethod<"concludeThreadIntoParent">;
  concludeCoordinationThread: StoreMethod<"concludeCoordinationThread">;
  createSpec: StoreMethod<"createSpec">;
  addSpecRevision: StoreMethod<"addSpecRevision">;
  addReview: StoreMethod<"addReview">;
  createDecision: StoreMethod<"createDecision">;
  createDecisionOnce: StoreMethod<"createDecisionOnce">;
  cursor: StoreMethod<"cursor">;
  listProjections(): Awaitable<PublicWorkProjection[]>;
  listInbox(principalId?: PrincipalId): Awaitable<ActionInboxItem[]>;
  listThreads: StoreMethod<"listThreads">;
  hasThreadAccess: StoreMethod<"hasThreadAccess">;
  listVisiblePeerPrincipalIds: StoreMethod<"listVisiblePeerPrincipalIds">;
  getThreadAccessVersion: StoreMethod<"getThreadAccessVersion">;
  getMessageAtSequence: StoreMethod<"getMessageAtSequence">;
  upsertWebPushSubscription: StoreMethod<"upsertWebPushSubscription">;
  deleteWebPushSubscription: StoreMethod<"deleteWebPushSubscription">;
  deleteWebPushSubscriptionByEndpoint: StoreMethod<"deleteWebPushSubscriptionByEndpoint">;
  listWebPushSubscriptions: StoreMethod<"listWebPushSubscriptions">;
  listWebPushSubscriptionsForPrincipals: StoreMethod<"listWebPushSubscriptionsForPrincipals">;
  getThread: StoreMethod<"getThread">;
  getSpec: StoreMethod<"getSpec">;
  listSpecs: StoreMethod<"listSpecs">;
  upsertPrincipal: StoreMethod<"upsertPrincipal">;
  listPrincipals(ids: PrincipalId[]): Awaitable<PrincipalSummary[]>;
  listActionEnvelopes(ids: OperationId[]): Awaitable<ActionEnvelope[]>;
  listDecisions(): Awaitable<DecisionRecord[]>;
  latestProjectionFreshness(): Awaitable<string | undefined>;
  listActivity(): Awaitable<ActivityEvent[]>;
}

export interface PrincipalSummary {
  id: PrincipalId;
  displayName: string;
  kind: "human" | "stand_in" | "service";
  preferredLanguage?: PreferredLanguage;
}
