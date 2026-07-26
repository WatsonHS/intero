import {
  Attachment,
  CreateAttachmentUpload,
  ActionEnvelope,
  CapabilityGrant,
  CanonicalWorkEvent,
  Claim,
  ConversationThread,
  CoordinationResult,
  DecisionRecord,
  KanbanCard,
  KanbanColumn,
  KanbanWorkstreamLinks,
  Project,
  PublicWorkProjection,
  Spec,
  SpecRevision,
  SpecReviewResponse,
  ThreadMessage,
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
export const AttachmentUploadResponse = z.object({
  attachment: Attachment,
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

// Conclusion state is set by concluding, never by the creator.
export const CreateThreadRequest = ConversationThread.omit({
  sequence: true,
  concludedAt: true,
  concludedBy: true,
});
export const ConcludeThreadRequest = z
  .object({
    messageId: z.string().uuid(),
    actorId: z.string().uuid(),
    conclusion: z.string().min(1).max(16_000),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const MarkThreadReadRequest = z
  .object({
    principalId: z.string().uuid(),
    sequence: z.number().int().nonnegative(),
  })
  .strict();
export const SendThreadMessageRequest = z
  .object({
    id: z.string().uuid(),
    senderId: z.string().uuid(),
    body: z.string().max(16_000).optional(),
    encryptedBody: z.string().max(100_000).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const AddStandInRequest = z.object({
  standInId: z.string().uuid(),
  actorId: z.string().uuid(),
});
export const ThreadResponse = z.object({
  thread: ConversationThread,
  messages: z.array(ThreadMessage),
  principals: z.array(PrincipalSummary),
  actions: z.array(
    z.object({
      envelope: ActionEnvelope,
      status: z.literal("resolved"),
    }),
  ),
});

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

export const StandInToolName = z.enum([
  "stand_in.lookup_team_context",
  "stand_in.request_coordination",
  "stand_in.request_spec_review",
  "stand_in.lookup_decision",
  "stand_in.check_scope",
  "stand_in.report_checkpoint",
]);
