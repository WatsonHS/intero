import {
  Attachment,
  CreateAttachmentUpload,
  ActionEnvelope,
  CapabilityGrant,
  CanonicalWorkEvent,
  Claim,
  ConversationThread,
  CoordinationResult,
  TeamRoomDirectoryItem,
  ThreadNotificationPreference,
  DecisionRecord,
  KanbanCard,
  KanbanColumn,
  KanbanWorkstreamLinks,
  MessageSearchPage,
  PilotInteroRequest,
  Project,
  PublicWorkProjection,
  ReactionEmoji,
  Spec,
  SpecRevision,
  SpecReviewResponse,
  PresenceSnapshot,
  ThreadKind,
  ThreadMessage,
  LinkPreview,
  UpsertWebPushSubscriptionRequest as UpsertWebPushSubscriptionRequestSchema,
  DeleteWebPushSubscriptionRequest as DeleteWebPushSubscriptionRequestSchema,
  NotificationPreferences,
  WebPushSubscription,
  Workstream,
} from "@intero/domain";
import { z } from "zod";

export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  requestId: z.string(),
});

export const HealthResponse = z.object({
  status: z.literal("ok"),
  service: z.literal("intero-api"),
  version: z.string(),
});

export const IngestEventRequest = z.object({ event: CanonicalWorkEvent });
export const IngestEventResponse = z.object({
  accepted: z.boolean(),
  duplicate: z.boolean(),
  projection: PublicWorkProjection.optional(),
});
export const ApplyPublicProjectionRequest = z.object({
  projection: PublicWorkProjection,
});

export const CreateAttachmentUploadRequest = CreateAttachmentUpload;
export const AttachmentView = Attachment.omit({ objectKey: true });
export const AttachmentUploadResponse = z.object({
  attachment: AttachmentView,
  uploadUrl: z.url(),
  requiredHeaders: z.record(z.string(), z.string()),
});

export const CreateWorkstreamRequest = Workstream.omit({
  evidenceClaimIds: true,
  contradictionClaimIds: true,
  version: true,
});
export const CreateClaimRequest = Claim;

export const TeamPulseResponse = z.object({
  generatedAt: z.iso.datetime(),
  projections: z.array(PublicWorkProjection),
  principals: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string().min(1).max(200),
      kind: z.enum(["human", "stand_in", "service"]),
    }),
  ),
  staleAfterSeconds: z.number().int().positive(),
});

export const PrincipalSummary = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  kind: z.enum(["human", "stand_in", "service"]),
});

export const BootstrapResponse = z.object({
  organization: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
  }),
  currentPrincipal: PrincipalSummary,
  standInPrincipal: PrincipalSummary,
});

export const CreateKanbanCardRequest = KanbanCard.omit({
  createdAt: true,
  updatedAt: true,
});
export const UpdateKanbanCardRequest = z
  .object({
    title: z.string().min(1).max(240).optional(),
    description: z.string().max(4_000).optional(),
    column: KanbanColumn.optional(),
    position: z.number().int().nonnegative().optional(),
    ownerId: z.string().uuid().optional(),
    estimatePoints: z.number().int().min(0).max(100).optional(),
    relatedWorkstreamIds: KanbanWorkstreamLinks.optional(),
  })
  .strict();
export const KanbanBoardResponse = z.object({
  projects: z.array(Project),
  selectedProjectId: z.string().uuid().optional(),
  cards: z.array(KanbanCard),
  workstreams: z.array(PublicWorkProjection),
  principals: z.array(PrincipalSummary),
});
export const KanbanCardResponse = KanbanCard;

export const CoordinateRequest = z.object({ envelope: ActionEnvelope });
export const CoordinateResponse = z.object({ result: CoordinationResult });
export const CreateCapabilityGrantRequest = CapabilityGrant;

// Conclusion, archive, and creator are set by server commands, never by create.
export const CreateThreadRequest = ConversationThread.omit({
  sequence: true,
  accessVersion: true,
  latestMessageAt: true,
  concludedAt: true,
  concludedBy: true,
  archivedAt: true,
  archivedBy: true,
  createdBy: true,
});
export const ConcludeThreadRequest = z
  .object({
    clientMessageId: z.string().uuid(),
    conclusion: z.string().min(1).max(16_000),
  })
  .strict();
export const MarkThreadReadRequest = z
  .object({
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export const SendThreadMessageRequest = z
  .object({
    clientMessageId: z.string().uuid(),
    body: z.string().max(16_000).optional(),
    encryptedBody: z.string().max(100_000).optional(),
    mentionedPrincipalIds: z.array(z.string().uuid()).max(20).default([]),
    attachmentIds: z.array(z.string().uuid()).max(8).default([]),
    replyToMessageId: z.string().uuid().optional(),
  })
  .strict()
  .refine((input) => {
    if (input.encryptedBody !== undefined) {
      return input.body === undefined && input.attachmentIds.length === 0;
    }
    return (
      input.body !== undefined &&
      (input.body.trim().length > 0 || input.attachmentIds.length > 0)
    );
  }, "Send ciphertext alone, or a server-readable body and/or attachments.");
export const SetMessageReactionRequest = z
  .object({
    emoji: ReactionEmoji,
    reacted: z.boolean(),
  })
  .strict();
export const EditThreadMessageRequest = z
  .object({
    body: z.string().max(16_000),
  })
  .strict()
  .refine(
    (input) => input.body.trim().length > 0,
    "Edited messages require a non-empty body.",
  );
export const PresenceHeartbeatRequest = z
  .object({
    active: z.boolean().optional(),
  })
  .strict();
export const PresenceResponse = z
  .object({
    items: z.array(PresenceSnapshot),
  })
  .strict();
export const AddStandInRequest = z.object({}).strict();
/**
 * Keep the original Project-list request valid while allowing a Room
 * participant to explicitly retain a Team-level scope. A Team correction is
 * resolved server-side from the intersection of the requester's and
 * corrector's authorized Projects; clients never submit that Project list.
 */
export const CorrectInteroScopeRequest = z.union([
  z.object({ projectIds: z.array(z.string().uuid()).min(1).max(20) }).strict(),
  z.object({ scopeKind: z.literal("team") }).strict(),
]);
export const CorrectInteroScopeResponse = z
  .object({ request: PilotInteroRequest })
  .strict();
export const UpdateThreadRequest = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    visibility: z.enum(["private", "team"]).optional(),
    addParticipantIds: z.array(z.string().uuid()).max(20).default([]),
    removeParticipantIds: z.array(z.string().uuid()).max(20).default([]),
  })
  .strict()
  .refine(
    (input) =>
      input.title !== undefined ||
      input.visibility !== undefined ||
      input.addParticipantIds.length > 0 ||
      input.removeParticipantIds.length > 0,
    "Update the title, visibility, add a participant, and/or remove a participant.",
  );
export const ThreadNotificationPreferenceUpdate = z
  .object({
    mutedUntil: z.iso.datetime().nullable().optional(),
    muteIncludingMentions: z.boolean().optional(),
  })
  .strict();
export const ThreadNotificationPreferenceResponse = z
  .object({
    preference: ThreadNotificationPreference,
  })
  .strict();
export const TeamRoomsQuery = z
  .object({
    includeJoined: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();
export const TeamRoomsResponse = z
  .object({
    items: z.array(TeamRoomDirectoryItem),
  })
  .strict();
export const ListThreadsQuery = z
  .object({
    kind: ThreadKind.optional(),
    archived: z
      .enum(["true", "false"])
      .optional()
      .transform((value) => value === "true"),
  })
  .strict();
export const ThreadMessagesQuery = z
  .object({
    afterSequence: z.coerce.number().int().nonnegative().optional(),
    beforeSequence: z.coerce.number().int().positive().optional(),
    aroundSequence: z.coerce.number().int().positive().optional(),
    tail: z.coerce.number().int().min(1).max(200).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
  .refine(
    (input) =>
      [
        input.afterSequence,
        input.beforeSequence,
        input.aroundSequence,
        input.tail,
      ].filter((value) => value !== undefined).length <= 1,
    "Use only one of afterSequence, beforeSequence, aroundSequence, or tail.",
  );
export const SearchQuery = z
  .object({
    q: z.string().trim().max(200).default(""),
    projectId: z.string().uuid().optional(),
    types: z.string().max(300).optional(),
    in: z.string().trim().min(1).max(200).optional(),
    from: z.string().trim().min(1).max(120).optional(),
    before: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    after: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    has: z.enum(["attachment"]).optional(),
    cursor: z.string().max(800).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .refine(
    (input) =>
      input.q.trim().length >= 2 ||
      Boolean(input.in) ||
      Boolean(input.from) ||
      Boolean(input.before) ||
      Boolean(input.after) ||
      Boolean(input.has) ||
      Boolean(input.cursor),
    "Provide a search query, a filter, or a cursor.",
  );
export const SearchResponse = MessageSearchPage;
export const ThreadMessagesResponse = z
  .object({
    items: z.array(ThreadMessage),
    headSequence: z.number().int().nonnegative(),
    accessVersion: z.number().int().positive(),
    hasMore: z.boolean(),
  })
  .strict();
export const ThreadResponse = z.object({
  thread: ConversationThread,
  messages: z.array(ThreadMessage),
  unreadCount: z.number().int().nonnegative().default(0),
  mentionCount: z.number().int().nonnegative().default(0),
  lastReadSequence: z.number().int().nonnegative().default(0),
  notificationPreference: ThreadNotificationPreference.optional(),
  viewerArchivedAt: z.iso.datetime().optional(),
  principals: z.array(PrincipalSummary),
  actions: z.array(
    z.object({
      envelope: ActionEnvelope,
      status: z.literal("resolved"),
    }),
  ),
});
export const LinkPreviewsQuery = z
  .object({
    url: z.union([
      z.string().max(2_048),
      z.array(z.string().max(2_048)).min(1).max(20),
    ]),
  })
  .strict();
export const LinkPreviewsResponse = z
  .object({
    items: z.array(LinkPreview).max(20),
  })
  .strict();

export const CreateSpecRevisionRequest = SpecRevision.omit({
  id: true,
  blocks: true,
  createdAt: true,
});
export const CreateSpecRequest = Spec.omit({
  currentRevisionId: true,
  createdAt: true,
}).extend({
  markdown: z.string().max(500_000),
  changeSummary: z.string().max(2_000),
  affectedScopes: z.array(z.string().max(300)),
  createdBy: z.string().uuid(),
});
export const AddReviewResponseRequest = SpecReviewResponse;
export const SpecDetailResponse = z.object({
  spec: Spec,
  revisions: z.array(SpecRevision),
  reviews: z.array(SpecReviewResponse),
  principals: z.array(PrincipalSummary),
});
export const SpecListResponse = z.object({
  items: z.array(SpecDetailResponse),
});
export const CreateDecisionRequest = DecisionRecord.omit({
  id: true,
  createdAt: true,
});

export const CursorQuery = z.object({
  after: z.coerce.number().int().nonnegative().default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export const CursorPage = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.number().int().nonnegative(),
    hasMore: z.boolean(),
  });

export const WebPushConfigResponse = z
  .object({
    enabled: z.boolean(),
    publicKey: z.string().min(16).optional(),
  })
  .strict();
export const UpsertWebPushSubscriptionRequest =
  UpsertWebPushSubscriptionRequestSchema;
export const DeleteWebPushSubscriptionRequest =
  DeleteWebPushSubscriptionRequestSchema;
export const WebPushSubscriptionResponse = z
  .object({
    subscription: WebPushSubscription,
  })
  .strict();
export const NotificationPreferencesResponse = z
  .object({
    preferences: NotificationPreferences,
  })
  .strict();

export const StandInToolName = z.enum([
  "stand_in.lookup_team_context",
  "stand_in.request_coordination",
  "stand_in.request_spec_review",
  "stand_in.lookup_decision",
  "stand_in.check_scope",
  "stand_in.report_checkpoint",
]);
