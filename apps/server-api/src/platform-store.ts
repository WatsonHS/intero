import type {
  ActionInboxItem,
  ActivityEvent,
  DecisionRecord,
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
  listInbox(): Awaitable<ActionInboxItem[]>;
  listThreads: StoreMethod<"listThreads">;
  getThread: StoreMethod<"getThread">;
  getSpec: StoreMethod<"getSpec">;
  listDecisions(): Awaitable<DecisionRecord[]>;
  latestProjectionFreshness(): Awaitable<string | undefined>;
  listActivity(): Awaitable<ActivityEvent[]>;
}
