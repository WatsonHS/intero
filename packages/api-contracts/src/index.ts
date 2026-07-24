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
      kind: z.enum(["human", "representative", "service"]),
    }),
  ),
  staleAfterSeconds: z.number().int().positive(),
});

export const PrincipalSummary = z.object({
  id: z.string().uuid(),
  displayName: z.string().min(1).max(200),
  kind: z.enum(["human", "representative", "service"]),
});

export const BootstrapResponse = z.object({
  organization: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
  }),
  currentPrincipal: PrincipalSummary,
  representativePrincipal: PrincipalSummary,
});

export const CoordinateRequest = z.object({ envelope: ActionEnvelope });
export const CoordinateResponse = z.object({ result: CoordinationResult });
export const CreateCapabilityGrantRequest = CapabilityGrant;

export const CreateThreadRequest = ConversationThread.omit({ sequence: true });
export const SendThreadMessageRequest = z
  .object({
    id: z.string().uuid(),
    senderId: z.string().uuid(),
    body: z.string().max(16_000).optional(),
    encryptedBody: z.string().max(100_000).optional(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export const AddRepresentativeRequest = z.object({
  representativeId: z.string().uuid(),
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

export const RepresentativeToolName = z.enum([
  "representative.lookup_team_context",
  "representative.request_coordination",
  "representative.request_spec_review",
  "representative.lookup_decision",
  "representative.check_scope",
  "representative.report_checkpoint",
]);
