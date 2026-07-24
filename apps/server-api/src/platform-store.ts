import type {
  ActionEnvelope,
  ActionInboxItem,
  ActivityEvent,
  DecisionRecord,
  OperationId,
  PrincipalId,
  PublicWorkProjection,
} from "@intero/domain";

import type { InMemoryPlatformStore } from "./store.js";

type Awaitable<T> = T | Promise<T>;
type StoreMethod<Name extends keyof InMemoryPlatformStore> =
  InMemoryPlatformStore[Name] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Awaitable<Result>
    : never;

export interface PlatformStore {
  createWorkstream: StoreMethod<"createWorkstream">;
  addClaim: StoreMethod<"addClaim">;
  ingestEvent: StoreMethod<"ingestEvent">;
  applyProjection: StoreMethod<"applyProjection">;
  putGrant: StoreMethod<"putGrant">;
  coordinate: StoreMethod<"coordinate">;
  createThread: StoreMethod<"createThread">;
  appendMessage: StoreMethod<"appendMessage">;
  addRepresentativeToThread: StoreMethod<"addRepresentativeToThread">;
  createSpec: StoreMethod<"createSpec">;
  addSpecRevision: StoreMethod<"addSpecRevision">;
  addReview: StoreMethod<"addReview">;
  createDecision: StoreMethod<"createDecision">;
  cursor: StoreMethod<"cursor">;
  listProjections(): Awaitable<PublicWorkProjection[]>;
  listInbox(principalId?: PrincipalId): Awaitable<ActionInboxItem[]>;
  listThreads: StoreMethod<"listThreads">;
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
  kind: "human" | "representative" | "service";
}
