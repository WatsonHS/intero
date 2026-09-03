export interface paths {
  "/health": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["health"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/bootstrap": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getBootstrap"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/team-pulse": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getTeamPulse"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/kanban": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getKanbanBoard"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/kanban/cards": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["createKanbanCard"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/kanban/cards/{cardId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations["updateKanbanCard"];
    trace?: never;
  };
  "/v1/threads": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listThreads"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch: operations["updateThread"];
    trace?: never;
  };
  "/v1/threads/{threadId}/notification-preference": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getThreadNotificationPreference"];
    put: operations["setThreadNotificationPreference"];
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/join": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["joinThread"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/leave": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["leaveThread"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/archive": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["archiveThread"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/unarchive": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["unarchiveThread"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/teams/{teamId}/rooms": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listTeamRooms"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/messages/{messageId}": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations["deleteThreadMessage"];
    options?: never;
    head?: never;
    patch: operations["editThreadMessage"];
    trace?: never;
  };
  "/v1/threads/{threadId}/typing": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["publishTyping"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/presence/heartbeat": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["presenceHeartbeat"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/presence": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listPresence"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/link-previews": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listLinkPreviews"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/threads/{threadId}/messages/{messageId}/preview": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post?: never;
    delete: operations["hideThreadMessagePreview"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/config/web-push": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["getWebPushConfig"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/me/push-subscriptions": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["upsertPushSubscription"];
    delete: operations["deletePushSubscription"];
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/specs": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["listSpecs"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
  "/v1/search": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get: operations["search"];
    put?: never;
    post?: never;
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
    trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    BootstrapResponse: {
      organization: {
        /** Format: uuid */
        id: string;
        name: string;
      };
      currentPrincipal: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "stand_in" | "service";
      };
      standInPrincipal: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "stand_in" | "service";
      };
    };
    CreateCapabilityGrantRequest: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      principalId: string;
      actions: (
        | "read_public_state"
        | "answer_status"
        | "declare_ownership"
        | "register_blocker"
        | "register_dependency"
        | "request_coordination"
        | "arrange_review"
        | "publish_state"
        | "expand_scope"
        | "promise_deadline"
        | "approve_architecture"
        | "irreversible_action"
      )[];
      /** Format: uuid */
      organizationId: string;
      projectIds: string[];
      workstreamIds: string[];
      resourceScopes: string[];
      requiresConfirmation: (
        | "read_public_state"
        | "answer_status"
        | "declare_ownership"
        | "register_blocker"
        | "register_dependency"
        | "request_coordination"
        | "arrange_review"
        | "publish_state"
        | "expand_scope"
        | "promise_deadline"
        | "approve_architecture"
        | "irreversible_action"
      )[];
      /** Format: date-time */
      expiresAt: string;
      policyVersion: string;
      /** Format: date-time */
      revokedAt?: string;
    };
    CreateClaimRequest: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      workstreamId: string;
      /** @enum {string} */
      predicate:
        | "intent"
        | "phase"
        | "scope"
        | "ownership"
        | "blocker"
        | "dependency"
        | "decision"
        | "artifact"
        | "validation"
        | "paused"
        | "completed";
      value: string;
      /** @enum {string} */
      sourceType:
        | "human_statement"
        | "human_correction"
        | "direct_observation"
        | "coding_agent_report"
        | "project_system"
        | "stand_in_inference";
      sourceRef: string;
      /** Format: date-time */
      observedAt: string;
      /** Format: date-time */
      validUntil?: string;
      confidence: number;
      /** @enum {string} */
      privacy:
        | "P0_LOCAL_ONLY"
        | "P1_STAND_IN_PRIVATE"
        | "P2_COORDINATION"
        | "P3_PROJECT"
        | "P4_ORGANIZATION";
      /** @default [] */
      evidenceRefs: string[];
      /** Format: uuid */
      supersedes?: string;
      /** Format: date-time */
      withdrawnAt?: string;
    };
    CreateDecisionRequest: {
      title: string;
      outcome: string;
      /** Format: uuid */
      sourceSpecRevisionId?: string;
      /** Format: uuid */
      sourceThreadId?: string;
      affectedScopes: string[];
      decidedBy: string[];
      /** Format: uuid */
      supersedes?: string;
    };
    CreateKanbanCardRequest: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      projectId: string;
      title: string;
      description: string;
      /** @enum {string} */
      column: "backlog" | "planned" | "in_progress" | "review" | "done";
      position: number;
      /** Format: uuid */
      ownerId?: string;
      estimatePoints?: number;
      relatedWorkstreamIds: string[];
    };
    CreateSpecRequest: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      projectId?: string;
      title: string;
      /** Format: uuid */
      reviewThreadId?: string;
      relatedWorkstreamIds: string[];
      /** @enum {string} */
      status:
        "draft" | "in_review" | "approved" | "changes_requested" | "superseded";
      /** Format: date-time */
      reviewRequestedAt?: string;
      /** Format: uuid */
      confirmedRevisionId?: string;
      markdown: string;
      changeSummary: string;
      affectedScopes: string[];
      /** Format: uuid */
      createdBy: string;
    };
    CreateWorkstreamRequest: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      workspaceId: string;
      /** Format: uuid */
      projectId?: string;
      /** Format: uuid */
      ownerId: string;
      title: string;
      /** @enum {string} */
      phase:
        | "exploring"
        | "planning"
        | "implementing"
        | "validating"
        | "reviewing"
        | "blocked"
        | "paused"
        | "completed";
      scope: string[];
      blockers: string[];
      dependencies: string[];
      decisions: string[];
      artifactIds: string[];
      /** Format: date-time */
      freshnessAt: string;
      confidence: number;
    };
    KanbanBoardResponse: {
      projects: {
        /** Format: uuid */
        id: string;
        name: string;
        projectManagementEnabled: boolean;
      }[];
      /** Format: uuid */
      selectedProjectId?: string;
      cards: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        projectId: string;
        title: string;
        description: string;
        /** @enum {string} */
        column: "backlog" | "planned" | "in_progress" | "review" | "done";
        position: number;
        /** Format: uuid */
        ownerId?: string;
        estimatePoints?: number;
        relatedWorkstreamIds: string[];
        /** Format: date-time */
        createdAt: string;
        /** Format: date-time */
        updatedAt: string;
      }[];
      workstreams: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        projectId?: string;
        /** Format: uuid */
        ownerId: string;
        title: string;
        /** @enum {string} */
        phase:
          | "exploring"
          | "planning"
          | "implementing"
          | "validating"
          | "reviewing"
          | "blocked"
          | "paused"
          | "completed";
        blockers: string[];
        dependencies: string[];
        decisions: string[];
        artifactIds: string[];
        /** Format: date-time */
        freshnessAt: string;
        confidence: number;
        contradictionClaimIds: string[];
        version: number;
        changedFields: (
          | "intent"
          | "phase"
          | "blockers"
          | "dependencies"
          | "ownership"
          | "decisions"
          | "artifacts"
          | "paused"
          | "completed"
        )[];
        /** Format: date-time */
        projectedAt: string;
      }[];
      principals: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "stand_in" | "service";
      }[];
    };
    KanbanCardResponse: {
      /** Format: uuid */
      id: string;
      /** Format: uuid */
      projectId: string;
      title: string;
      description: string;
      /** @enum {string} */
      column: "backlog" | "planned" | "in_progress" | "review" | "done";
      position: number;
      /** Format: uuid */
      ownerId?: string;
      estimatePoints?: number;
      relatedWorkstreamIds: string[];
      /** Format: date-time */
      createdAt: string;
      /** Format: date-time */
      updatedAt: string;
    };
    LinkPreviewsResponse: {
      items: {
        /** Format: uri */
        url: string;
        /** @enum {string} */
        status: "ok" | "failed" | "blocked";
        title?: string;
        description?: string;
        siteName?: string;
        /** Format: uri */
        image?: string;
        /** Format: date-time */
        fetchedAt: string;
        /** Format: date-time */
        expiresAt: string;
      }[];
    };
    SpecListResponse: {
      items: {
        spec: {
          /** Format: uuid */
          id: string;
          /** Format: uuid */
          projectId?: string;
          title: string;
          /** Format: uuid */
          currentRevisionId: string;
          /** Format: uuid */
          reviewThreadId?: string;
          relatedWorkstreamIds: string[];
          /** @enum {string} */
          status:
            | "draft"
            | "in_review"
            | "approved"
            | "changes_requested"
            | "superseded";
          /** Format: date-time */
          createdAt: string;
          /** Format: date-time */
          reviewRequestedAt?: string;
          /** Format: uuid */
          confirmedRevisionId?: string;
        };
        revisions: {
          /** Format: uuid */
          id: string;
          /** Format: uuid */
          specId: string;
          revision: number;
          markdown: string;
          blocks: {
            id: string;
            /** @enum {string} */
            kind: "heading" | "paragraph" | "list" | "code" | "quote" | "table";
            ordinal: number;
            fingerprint: string;
          }[];
          changeSummary: string;
          affectedScopes: string[];
          /** Format: uuid */
          createdBy: string;
          /** Format: date-time */
          createdAt: string;
          /** Format: date-time */
          revokedAt?: string;
        }[];
        reviews: {
          /** Format: uuid */
          revisionId: string;
          /** Format: uuid */
          reviewerId: string;
          /** @enum {string} */
          kind:
            | "stand_in_impact_analysis"
            | "human_acknowledgement"
            | "human_approval"
            | "human_conditional_approval"
            | "human_changes_requested";
          affectedScopes: string[];
          body: string;
          /** Format: date-time */
          createdAt: string;
          /** Format: date-time */
          invalidatedAt?: string;
        }[];
        principals: {
          /** Format: uuid */
          id: string;
          displayName: string;
          /** @enum {string} */
          kind: "human" | "stand_in" | "service";
        }[];
      }[];
    };
    SearchQuery: {
      /** @default  */
      q: string;
      /** Format: uuid */
      projectId?: string;
      types?: string;
      in?: string;
      from?: string;
      before?: string;
      after?: string;
      /** @enum {string} */
      has?: "attachment";
      cursor?: string;
      /** @default 20 */
      limit: number;
    };
    SearchResponse: {
      items: {
        id: string;
        /** Format: uuid */
        projectId?: string;
        projectName?: string;
        /** @enum {string} */
        type:
          | "work_item"
          | "spec"
          | "spec_version"
          | "comment"
          | "code_reference"
          | "coordination"
          | "stand_in_activity"
          | "message";
        title: string;
        snippet: string;
        sourceRef: string;
        /** Format: date-time */
        updatedAt: string;
        /** Format: uuid */
        threadId?: string;
        /** Format: uuid */
        messageId?: string;
        sequence?: number;
        /** Format: uuid */
        senderId?: string;
        /** Format: date-time */
        createdAt?: string;
      }[];
      nextCursor?: string;
    };
    TeamPulseResponse: {
      /** Format: date-time */
      generatedAt: string;
      projections: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        projectId?: string;
        /** Format: uuid */
        ownerId: string;
        title: string;
        /** @enum {string} */
        phase:
          | "exploring"
          | "planning"
          | "implementing"
          | "validating"
          | "reviewing"
          | "blocked"
          | "paused"
          | "completed";
        blockers: string[];
        dependencies: string[];
        decisions: string[];
        artifactIds: string[];
        /** Format: date-time */
        freshnessAt: string;
        confidence: number;
        contradictionClaimIds: string[];
        version: number;
        changedFields: (
          | "intent"
          | "phase"
          | "blockers"
          | "dependencies"
          | "ownership"
          | "decisions"
          | "artifacts"
          | "paused"
          | "completed"
        )[];
        /** Format: date-time */
        projectedAt: string;
      }[];
      principals: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "stand_in" | "service";
      }[];
      staleAfterSeconds: number;
    };
    ThreadResponse: {
      thread: {
        /** Format: uuid */
        id: string;
        /** @enum {string} */
        kind:
          | "human_direct"
          | "human_group"
          | "stand_in"
          | "room"
          | "coordination"
          | "spec_review"
          | "decision"
          | "task";
        title: string;
        participantIds: string[];
        standInIds: string[];
        /** @enum {string} */
        accessMode: "human_only_e2ee" | "agent_readable";
        accessChangedAtSequence?: number;
        priorHistoryGranted: boolean;
        sequence: number;
        accessVersion?: number;
        /** Format: date-time */
        latestMessageAt?: string;
        /** Format: uuid */
        projectId?: string;
        /** Format: uuid */
        teamId?: string;
        /** Format: uuid */
        parentThreadId?: string;
        /** Format: date-time */
        concludedAt?: string;
        /** Format: uuid */
        concludedBy?: string;
        /** Format: uuid */
        createdBy?: string;
        /** @enum {string} */
        visibility?: "private" | "team";
        /** Format: date-time */
        archivedAt?: string;
        /** Format: uuid */
        archivedBy?: string;
        /** Format: date-time */
        createdAt: string;
      };
      messages: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        threadId: string;
        /** Format: uuid */
        senderId: string;
        sequence: number;
        /** @enum {string} */
        kind:
          | "message"
          | "system_access_change"
          | "coordination_action"
          | "coordination_summary";
        body: string;
        /** Format: date-time */
        createdAt: string;
        serverReadable: boolean;
        encryptedBody?: string;
        /** Format: uuid */
        operationId?: string;
        coordinationSummary?: {
          /** Format: uuid */
          coordinationThreadId: string;
          /** Format: uuid */
          interoRequestId?: string;
          /** @enum {string} */
          status: "open" | "waiting" | "needs_action" | "resolved";
          situation: string;
          boundaryKey: string;
          affectedPrincipalIds: string[];
          conclusion: string;
          unresolvedQuestion: string;
          actionRequired: boolean;
          /** Format: date-time */
          freshnessAt: string;
          sourceCount: number;
          scope?:
            | {
                /** @enum {string} */
                kind: "single_project" | "cross_project" | "team";
                projectIds: string[];
              }
            | {
                /** @enum {string} */
                kind: "ambiguous";
                candidates: {
                  /** Format: uuid */
                  projectId: string;
                  name: string;
                }[];
              };
          brief?: {
            headline: string;
            whatChanged: string;
            whyItMatters: string;
            needsFromYou: string;
            scope: {
              /** @enum {string} */
              kind: "single_project" | "cross_project" | "team";
              projectIds: string[];
            };
            facts: {
              label: string;
              value: string;
              sourceRef: string;
            }[];
            interpretations: {
              statement: string;
              /** @enum {string} */
              confidence: "low" | "medium" | "high";
            }[];
            /** @enum {string} */
            proseSource?: "provider" | "deterministic_fallback";
            options: {
              id: string;
              label: string;
              tradeoff: string;
            }[];
            humanDecision?: {
              outcome: string;
              decidedBy: string[];
              /** Format: date-time */
              confirmedAt: string;
            };
            /** Format: date-time */
            freshnessAt: string;
          };
        };
        mentionedPrincipalIds?: string[];
        /** Format: uuid */
        replyToMessageId?: string;
        attachments?: {
          /** Format: uuid */
          id: string;
          fileName: string;
          contentType: string;
          byteSize: number;
        }[];
        /** @enum {string} */
        streamState?: "pending" | "streaming" | "complete" | "failed";
        revision?: number;
        reactions?: {
          emoji: string;
          principalIds: string[];
        }[];
        /** Format: date-time */
        editedAt?: string;
        /** Format: date-time */
        deletedAt?: string;
        previewUrls?: string[];
        previewsHidden?: boolean;
      }[];
      /** @default 0 */
      unreadCount: number;
      /** @default 0 */
      mentionCount: number;
      /** @default 0 */
      lastReadSequence: number;
      notificationPreference?: {
        /** Format: uuid */
        threadId: string;
        /** Format: uuid */
        principalId: string;
        /** Format: date-time */
        mutedUntil?: string;
        muteIncludingMentions: boolean;
        /** Format: date-time */
        updatedAt: string;
      };
      /** Format: date-time */
      viewerArchivedAt?: string;
      principals: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "stand_in" | "service";
      }[];
      actions: {
        envelope: {
          /** @enum {number} */
          schemaVersion: 1;
          /** Format: uuid */
          operationId: string;
          /** @enum {string} */
          action:
            | "status_query"
            | "status_response"
            | "ownership_declaration"
            | "dependency_request"
            | "conflict_notice"
            | "coordination_request"
            | "correction"
            | "withdrawal"
            | "human_escalation";
          /** Format: uuid */
          actorId: string;
          /** Format: uuid */
          authorityGrantId: string;
          policyVersion: string;
          /** Format: uuid */
          threadId: string;
          /** Format: uuid */
          workstreamId?: string;
          humanMessage: string;
          resourceScope: string[];
          relatedClaimIds: string[];
          evidenceRefs: string[];
          requestedActions: (
            | "read_public_state"
            | "answer_status"
            | "declare_ownership"
            | "register_blocker"
            | "register_dependency"
            | "request_coordination"
            | "arrange_review"
            | "publish_state"
            | "expand_scope"
            | "promise_deadline"
            | "approve_architecture"
            | "irreversible_action"
          )[];
          /** Format: date-time */
          createdAt: string;
          /** Format: uuid */
          correctionOf?: string;
          /** Format: uuid */
          withdrawalOf?: string;
        };
        /** @enum {string} */
        status: "resolved";
      }[];
    };
    TeamRoomsResponse: {
      items: {
        thread: {
          /** Format: uuid */
          id: string;
          /** @enum {string} */
          kind:
            | "human_direct"
            | "human_group"
            | "stand_in"
            | "room"
            | "coordination"
            | "spec_review"
            | "decision"
            | "task";
          title: string;
          participantIds: string[];
          standInIds: string[];
          /** @enum {string} */
          accessMode: "human_only_e2ee" | "agent_readable";
          accessChangedAtSequence?: number;
          priorHistoryGranted: boolean;
          sequence: number;
          accessVersion?: number;
          /** Format: date-time */
          latestMessageAt?: string;
          /** Format: uuid */
          projectId?: string;
          /** Format: uuid */
          teamId?: string;
          /** Format: uuid */
          parentThreadId?: string;
          /** Format: date-time */
          concludedAt?: string;
          /** Format: uuid */
          concludedBy?: string;
          /** Format: uuid */
          createdBy?: string;
          /** @enum {string} */
          visibility?: "private" | "team";
          /** Format: date-time */
          archivedAt?: string;
          /** Format: uuid */
          archivedBy?: string;
          /** Format: date-time */
          createdAt: string;
        };
        memberCount: number;
        /** Format: date-time */
        latestMessageAt?: string;
        joined: boolean;
      }[];
    };
    ThreadNotificationPreferenceResponse: {
      preference: {
        /** Format: uuid */
        threadId: string;
        /** Format: uuid */
        principalId: string;
        /** Format: date-time */
        mutedUntil?: string;
        muteIncludingMentions: boolean;
        /** Format: date-time */
        updatedAt: string;
      };
    };
    ThreadNotificationPreferenceUpdate: {
      mutedUntil?: string | null;
      muteIncludingMentions?: boolean;
    };
    UpdateKanbanCardRequest: {
      title?: string;
      description?: string;
      /** @enum {string} */
      column?: "backlog" | "planned" | "in_progress" | "review" | "done";
      position?: number;
      /** Format: uuid */
      ownerId?: string;
      estimatePoints?: number;
      relatedWorkstreamIds?: string[];
    };
    UpdateThreadRequest: {
      title?: string;
      /** @enum {string} */
      visibility?: "private" | "team";
      /** @default [] */
      addParticipantIds: string[];
      /** @default [] */
      removeParticipantIds: string[];
    };
    EditThreadMessageRequest: {
      body: string;
    };
    PresenceHeartbeatRequest: {
      active?: boolean;
    };
    PresenceResponse: {
      items: {
        /** Format: uuid */
        principalId: string;
        /** @enum {string} */
        state: "online" | "away" | "offline";
        /** Format: date-time */
        lastSeenAt?: string;
      }[];
    };
    UpsertWebPushSubscriptionRequest: {
      /** Format: uri */
      endpoint: string;
      keys: {
        p256dh: string;
        auth: string;
      };
      userAgent?: string;
    };
    DeleteWebPushSubscriptionRequest: {
      /** Format: uri */
      endpoint: string;
    };
    WebPushConfigResponse: {
      enabled: boolean;
      publicKey?: string;
    };
    WebPushSubscriptionResponse: {
      subscription: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        principalId: string;
        /** Format: uri */
        endpoint: string;
        keys: {
          p256dh: string;
          auth: string;
        };
        userAgent?: string;
        /** Format: date-time */
        createdAt: string;
        /** Format: date-time */
        lastSeenAt: string;
      };
    };
  };
  responses: never;
  parameters: never;
  requestBodies: never;
  headers: never;
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  health: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Healthy */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  getBootstrap: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current organization and principal */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["BootstrapResponse"];
        };
      };
    };
  };
  getTeamPulse: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Current public Work Projections */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["TeamPulseResponse"];
        };
      };
    };
  };
  getKanbanBoard: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Project Kanban cards with optional Workstream links */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["KanbanBoardResponse"];
        };
      };
    };
  };
  createKanbanCard: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CreateKanbanCardRequest"];
      };
    };
    responses: {
      /** @description Created Kanban card */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["KanbanCardResponse"];
        };
      };
    };
  };
  updateKanbanCard: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        cardId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpdateKanbanCardRequest"];
      };
    };
    responses: {
      /** @description Updated Kanban card */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["KanbanCardResponse"];
        };
      };
    };
  };
  listThreads: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Durable conversation threads */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": {
            items: components["schemas"]["ThreadResponse"][];
          };
        };
      };
    };
  };
  updateThread: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpdateThreadRequest"];
      };
    };
    responses: {
      /** @description Updated group conversation */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Thread not found or inaccessible */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  getThreadNotificationPreference: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Per-thread notification preference */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ThreadNotificationPreferenceResponse"];
        };
      };
    };
  };
  setThreadNotificationPreference: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["ThreadNotificationPreferenceUpdate"];
      };
    };
    responses: {
      /** @description Updated per-thread notification preference */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["ThreadNotificationPreferenceResponse"];
        };
      };
    };
  };
  joinThread: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Already a participant */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Joined the team-visible Room */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not a team member */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  leaveThread: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Left the Room */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not a participant */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  archiveThread: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Archived */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Not allowed to archive this Room */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  unarchiveThread: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Unarchived */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  listTeamRooms: {
    parameters: {
      query?: {
        includeJoined?: boolean;
      };
      header?: never;
      path: {
        teamId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Team-visible Rooms */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["TeamRoomsResponse"];
        };
      };
      /** @description Not a team member */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  deleteThreadMessage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
        messageId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Message deleted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Caller is not the sender */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Message cannot be deleted */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  editThreadMessage: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
        messageId: string;
      };
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["EditThreadMessageRequest"];
      };
    };
    responses: {
      /** @description Edited message */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Caller is not the sender */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Message cannot be edited */
      409: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  publishTyping: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Typing hint accepted */
      204: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  presenceHeartbeat: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: {
      content: {
        "application/json": components["schemas"]["PresenceHeartbeatRequest"];
      };
    };
    responses: {
      /** @description Current presence for the caller */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  listPresence: {
    parameters: {
      query: {
        principalIds: string[];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Presence visible to the caller */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["PresenceResponse"];
        };
      };
    };
  };
  listLinkPreviews: {
    parameters: {
      query: {
        url: string | string[];
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Cached public link preview metadata */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["LinkPreviewsResponse"];
        };
      };
    };
  };
  hideThreadMessagePreview: {
    parameters: {
      query?: never;
      header?: never;
      path: {
        threadId: string;
        messageId: string;
      };
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Message with link previews hidden */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Only the sender can hide previews */
      403: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Message not found or inaccessible */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  getWebPushConfig: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Whether Web Push is enabled and the VAPID public key */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["WebPushConfigResponse"];
        };
      };
    };
  };
  upsertPushSubscription: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["UpsertWebPushSubscriptionRequest"];
      };
    };
    responses: {
      /** @description Stored Web Push subscription */
      201: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["WebPushSubscriptionResponse"];
        };
      };
    };
  };
  deletePushSubscription: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["DeleteWebPushSubscriptionRequest"];
      };
    };
    responses: {
      /** @description Subscription removed */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
      /** @description Subscription not found */
      404: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
      };
    };
  };
  listSpecs: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Versioned Specs and review state */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["SpecListResponse"];
        };
      };
    };
  };
  search: {
    parameters: {
      query?: {
        q?: string;
      };
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody?: never;
    responses: {
      /** @description Authorized search results, including messages */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content: {
          "application/json": components["schemas"]["SearchResponse"];
        };
      };
    };
  };
}
