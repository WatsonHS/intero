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
  "/v1/events": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["ingestCanonicalWorkEvent"];
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
  "/v1/coordination": {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    get?: never;
    put?: never;
    post: operations["requestCoordination"];
    delete?: never;
    options?: never;
    head?: never;
    patch?: never;
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
        kind: "human" | "representative" | "service";
      };
      representativePrincipal: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "representative" | "service";
      };
    };
    CoordinateRequest: {
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
        | "representative_inference";
      sourceRef: string;
      /** Format: date-time */
      observedAt: string;
      /** Format: date-time */
      validUntil?: string;
      confidence: number;
      /** @enum {string} */
      privacy:
        | "P0_LOCAL_ONLY"
        | "P1_REPRESENTATIVE_PRIVATE"
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
    CreateSpecRequest: {
      /** Format: uuid */
      id: string;
      title: string;
      /** Format: uuid */
      reviewThreadId?: string;
      relatedWorkstreamIds: string[];
      /** @enum {string} */
      status:
        "draft" | "in_review" | "approved" | "changes_requested" | "superseded";
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
    IngestEventRequest: {
      event: {
        /** Format: uuid */
        id: string;
        /** Format: uuid */
        operationId: string;
        /** @enum {number} */
        schemaVersion: 1;
        /** @enum {string} */
        source: "codex" | "claude-code" | "opencode" | "desktop" | "system";
        /** @enum {string} */
        type:
          | "SessionStarted"
          | "SessionPaused"
          | "SessionStopped"
          | "WorkspaceChanged"
          | "ResourceTouched"
          | "GitStateChanged"
          | "PlanChanged"
          | "ValidationChanged"
          | "ArtifactDetected"
          | "CoordinationRequested"
          | "CheckpointReported";
        /** Format: date-time */
        occurredAt: string;
        /** Format: date-time */
        receivedAt: string;
        /** Format: uuid */
        workspaceId: string;
        /** Format: uuid */
        workstreamId?: string;
        /** @enum {string} */
        privacy:
          | "P0_LOCAL_ONLY"
          | "P1_REPRESENTATIVE_PRIVATE"
          | "P2_COORDINATION"
          | "P3_PROJECT"
          | "P4_ORGANIZATION";
        payload: {
          phase?: string;
          summary?: string;
          /** @enum {string} */
          resourceKind?:
            "file" | "symbol" | "api" | "schema" | "config" | "artifact";
          resourceRef?: string;
          gitBranch?: string;
          gitHead?: string;
          validationName?: string;
          /** @enum {string} */
          validationStatus?: "pending" | "passed" | "failed" | "skipped";
          /** @enum {string} */
          checkpointKind?:
            | "intent"
            | "decision"
            | "blocker"
            | "dependency"
            | "scope"
            | "artifact"
            | "validation"
            | "pause"
            | "completion";
        };
        idempotencyKey: string;
      };
    };
    SpecListResponse: {
      items: {
        spec: {
          /** Format: uuid */
          id: string;
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
        }[];
        reviews: {
          /** Format: uuid */
          revisionId: string;
          /** Format: uuid */
          reviewerId: string;
          /** @enum {string} */
          kind:
            | "representative_impact_analysis"
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
          kind: "human" | "representative" | "service";
        }[];
      }[];
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
        kind: "human" | "representative" | "service";
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
          | "representative"
          | "room"
          | "coordination"
          | "spec_review"
          | "decision"
          | "task";
        title: string;
        participantIds: string[];
        representativeIds: string[];
        /** @enum {string} */
        accessMode: "human_only_e2ee" | "agent_readable";
        accessChangedAtSequence?: number;
        priorHistoryGranted: boolean;
        sequence: number;
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
        kind: "message" | "system_access_change" | "coordination_action";
        body: string;
        /** Format: date-time */
        createdAt: string;
        serverReadable: boolean;
        encryptedBody?: string;
        /** Format: uuid */
        operationId?: string;
      }[];
      principals: {
        /** Format: uuid */
        id: string;
        displayName: string;
        /** @enum {string} */
        kind: "human" | "representative" | "service";
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
  ingestCanonicalWorkEvent: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["IngestEventRequest"];
      };
    };
    responses: {
      /** @description Accepted */
      202: {
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
  requestCoordination: {
    parameters: {
      query?: never;
      header?: never;
      path?: never;
      cookie?: never;
    };
    requestBody: {
      content: {
        "application/json": components["schemas"]["CoordinateRequest"];
      };
    };
    responses: {
      /** @description Structured coordination result */
      200: {
        headers: {
          [name: string]: unknown;
        };
        content?: never;
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
}
