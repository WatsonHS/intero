import {
  type OrganizationId,
  type PilotAgentBinding,
  type PilotAgentTicket,
  type PilotCheckpointInput,
  type PilotBoundaryMatch,
  type PilotCollaborationPosture,
  type PilotCoordinationThread,
  type PilotCoordinationRelevance,
  type PilotCoordinationSource,
  type PilotDirectMessage,
  type PilotDirectMessageThread,
  type PilotJoinLink,
  type PilotOrganization,
  type PilotOrganizationMembership,
  type PilotOrganizationRole,
  type PilotPrivateClaim,
  type PilotPrivateWorkState,
  type PilotProject,
  type PilotPulseEntry,
  type PilotSharedBoundaryClaim,
  type PilotStandInAnswerDetail,
  type PilotStandInExchange,
  type PilotStandInSource,
  type PilotStandInOutput,
  type PilotStandInProcessingState,
  type PilotTeam,
  type PilotTeamInvitation,
  type PilotTeamMembership,
  type PilotTeamRole,
  type PilotWorkNarrative,
  type PrincipalId,
  type ProjectAutomationSignal,
  type ProjectId,
  uuidv7,
} from "@intero/domain";
import {
  evaluateSharedBoundaryClaims,
  normalizeSharedBoundaryKey,
} from "@intero/stand-in-core";
import { createHash } from "node:crypto";

export class PilotStoreError extends Error {
  constructor(
    readonly code: string,
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export interface PilotStoredProvider {
  endpoint: string;
  defaultModel: string;
  encryptedApiKey: string;
}

interface StoredJoinLink extends PilotJoinLink {
  codeHash: string;
}

export interface PilotSnapshot {
  organization?: PilotOrganization;
  administratorId?: PrincipalId;
  provider?: PilotStoredProvider;
  teams: PilotTeam[];
  organizationMemberships: PilotOrganizationMembership[];
  memberships: PilotTeamMembership[];
  invitations: PilotTeamInvitation[];
  joinLinks: StoredJoinLink[];
  projects: PilotProject[];
  dmThreads: PilotDirectMessageThread[];
  dmMessages: PilotDirectMessage[];
  agentTickets: PilotAgentTicket[];
  agentBindings: PilotAgentBinding[];
  workStates: PilotPrivateWorkState[];
  sharedBoundaryClaims: PilotSharedBoundaryClaim[];
  pulseEntries: PilotPulseEntry[];
  coordinationThreads: PilotCoordinationThread[];
  coordinationSources: PilotCoordinationSource[];
  coordinationRelevance: PilotCoordinationRelevance[];
  coordinationSignals: PilotWorkStateConflictSignal[];
  standInExchanges: PilotStandInExchange[];
  standInJobs: PilotStoredStandInJob[];
  idempotency: Record<string, string>;
}

export interface PilotWorkStateConflictSignal extends ProjectAutomationSignal {
  fingerprint: string;
}

export interface PilotBoundaryReconciliation {
  claims: PilotSharedBoundaryClaim[];
  matches: PilotBoundaryMatch[];
  coordinationThreads: PilotCoordinationThread[];
}

export interface PilotStoredStandInJob {
  id: string;
  jobKey: string;
  projectId: ProjectId;
  workStateId: string;
  binding: PilotAgentBinding;
  checkpoint: PilotCheckpointInput;
  receivedAt: string;
  status: PilotStandInProcessingState["status"];
  attempts: number;
  maxAttempts: number;
  queuedAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  nextAttemptAt?: string;
  lastErrorCode?: string;
  deadLetteredAt?: string;
  workerId?: string;
}

export interface PilotIngestResult {
  accepted: true;
  duplicate: boolean;
  published: boolean;
  workState: PilotPrivateWorkState;
  standInJob: PilotStoredStandInJob;
  pulseEntry?: PilotPulseEntry;
  coordinationThread?: PilotCoordinationThread;
}

export interface PilotMutationContext {
  eventType: string;
  actorId: PrincipalId;
  aggregateType: string;
  aggregateId: string;
  visibility: "private" | "project" | "organization";
  projectId?: ProjectId;
  /** Who the change was made to, when that differs from the aggregate. */
  subjectId?: PrincipalId;
  /**
   * Structured facts about the change — role names, invitation addresses, and
   * nothing else. Never prompts, model output or file contents: this metadata
   * is what the audit log renders, so it must stay safe to show.
   */
  detail?: Record<string, string>;
}

/**
 * Everything an organization administrator governs, in one read.
 *
 * `listTeams` is deliberately scoped to the caller's own memberships, so the
 * organization surface cannot be built from it: an admin has to see the teams
 * and projects they are not a member of in order to govern them.
 */
export interface PilotOrganizationDirectory {
  teams: PilotTeam[];
  teamMemberships: PilotTeamMembership[];
  organizationMemberships: PilotOrganizationMembership[];
  projects: PilotProject[];
}

export interface PilotStore {
  getOrganization(): Promise<PilotOrganization | undefined>;
  getAdministratorId(): Promise<PrincipalId | undefined>;
  getOrganizationRole(
    principalId: PrincipalId,
  ): Promise<PilotOrganizationRole | undefined>;
  getProviderConfiguration(): Promise<PilotStoredProvider | undefined>;
  setupOrganization(input: {
    organization: PilotOrganization;
    administratorId: PrincipalId;
    initialTeam: PilotTeam;
  }): Promise<PilotOrganization>;
  updateDeploymentEndpoint(input: {
    administratorId: PrincipalId;
    deploymentBaseUrl: string;
    deploymentValidatedAt: string;
  }): Promise<PilotOrganization>;
  configureProvider(input: {
    administratorId: PrincipalId;
    endpoint: string;
    defaultModel: string;
    encryptedApiKey: string;
  }): Promise<PilotOrganization>;
  renameOrganization(input: {
    name: string;
    principalId: PrincipalId;
  }): Promise<PilotOrganization>;
  getOrganizationDirectory(
    principalId: PrincipalId,
  ): Promise<PilotOrganizationDirectory>;
  getTeam(teamId: string): Promise<PilotTeam | undefined>;
  getTeamRole(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamRole | undefined>;
  listTeams(principalId: PrincipalId): Promise<PilotTeam[]>;
  listTeamMembers(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamMembership[]>;
  createTeam(input: {
    team: PilotTeam;
    principalId: PrincipalId;
  }): Promise<PilotTeam>;
  renameTeam(input: {
    teamId: string;
    name: string;
    principalId: PrincipalId;
  }): Promise<PilotTeam>;
  deleteTeam(input: {
    teamId: string;
    principalId: PrincipalId;
  }): Promise<void>;
  addTeamMember(input: {
    teamId: string;
    memberId: PrincipalId;
    role: PilotTeamRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamMembership>;
  createInvitation(
    invitation: PilotTeamInvitation,
    principalId: PrincipalId,
  ): Promise<PilotTeamInvitation>;
  listInvitations(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamInvitation[]>;
  findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<PilotTeamInvitation | undefined>;
  regenerateInvitation(input: {
    invitationId: string;
    tokenHash: string;
    expiresAt: string;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamInvitation>;
  revokeInvitation(
    invitationId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotTeamInvitation>;
  acceptInvitation(input: {
    tokenHash: string;
    email: string;
    principalId: PrincipalId;
    now: string;
  }): Promise<{ invitation: PilotTeamInvitation; team: PilotTeam }>;
  updateTeamMemberRole(input: {
    teamId: string;
    memberId: PrincipalId;
    role: PilotTeamRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamMembership>;
  removeTeamMember(input: {
    teamId: string;
    memberId: PrincipalId;
    principalId: PrincipalId;
  }): Promise<void>;
  updateOrganizationRole(input: {
    memberId: PrincipalId;
    role: PilotOrganizationRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotOrganizationMembership>;
  createJoinLink(
    link: PilotJoinLink,
    codeHash: string,
    principalId: PrincipalId,
  ): Promise<PilotJoinLink>;
  redeemJoinLink(
    codeHash: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotTeam>;
  revokeJoinLink(
    linkId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotJoinLink>;
  listProjects(principalId: PrincipalId): Promise<PilotProject[]>;
  createProject(project: PilotProject): Promise<PilotProject>;
  updateProjectPosture(
    projectId: ProjectId,
    principalId: PrincipalId,
    posture: PilotCollaborationPosture,
    now: string,
  ): Promise<PilotProject>;
  updateProject(input: {
    projectId: ProjectId;
    principalId: PrincipalId;
    now: string;
    name?: string;
    ownerId?: PrincipalId;
    primaryTeamId?: string;
    participatingTeamIds?: string[];
    posture?: PilotCollaborationPosture;
  }): Promise<PilotProject>;
  listDirectMessageThreads(
    principalId: PrincipalId,
  ): Promise<
    Array<{ thread: PilotDirectMessageThread; messages: PilotDirectMessage[] }>
  >;
  getOrCreateDirectMessage(input: {
    id: string;
    teamId: string;
    principalId: PrincipalId;
    peerId: PrincipalId;
    now: string;
  }): Promise<PilotDirectMessageThread>;
  sendDirectMessage(message: PilotDirectMessage): Promise<PilotDirectMessage>;
  addStandInToDirectMessage(input: {
    threadId: string;
    principalId: PrincipalId;
    standInId: PrincipalId;
  }): Promise<PilotDirectMessageThread>;
  createAgentTicket(ticket: PilotAgentTicket): Promise<PilotAgentTicket>;
  resolveAgentTicket(
    ticketHash: string,
    now: string,
  ): Promise<PilotAgentTicket>;
  exchangeAgentTicket(
    ticketHash: string,
    binding: PilotAgentBinding,
    now: string,
  ): Promise<PilotAgentBinding>;
  createAgentBinding(binding: PilotAgentBinding): Promise<PilotAgentBinding>;
  listAgentBindings(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotAgentBinding[]>;
  initializeAgentBinding(
    bindingId: string,
    ownerId: PrincipalId,
    client: {
      name?: string;
      version?: string;
      protocolVersion?: string;
    },
    now: string,
  ): Promise<PilotAgentBinding>;
  validateAgentBinding(
    bindingId: string,
    ownerId: PrincipalId,
    verificationCode: string | undefined,
    now: string,
    configurationVersion?: number,
  ): Promise<PilotAgentBinding>;
  recordAgentLifecycle(
    bindingId: string,
    ownerId: PrincipalId,
    input: {
      lifecycle: "session_started" | "session_ended";
      occurredAt: string;
      receivedAt: string;
    },
  ): Promise<PilotAgentBinding>;
  disconnectAgentBinding(
    bindingId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotAgentBinding>;
  findBindingByCredentialHash(
    credentialHash: string,
  ): Promise<PilotAgentBinding | undefined>;
  findAgentBindingById(
    bindingId: string,
  ): Promise<PilotAgentBinding | undefined>;
  ingestCheckpoint(
    binding: PilotAgentBinding,
    input: PilotCheckpointInput,
    receivedAt: string,
  ): Promise<PilotIngestResult>;
  getIngestResult(workStateId: string): Promise<PilotIngestResult>;
  claimStandInJob(input: {
    jobKey: string;
    workerId: string;
    attempt: number;
    maxAttempts: number;
    now: string;
  }): Promise<
    | { status: "claimed"; job: PilotStoredStandInJob }
    | { status: "completed"; job: PilotStoredStandInJob }
  >;
  completeStandInJob(input: {
    jobKey: string;
    workerId: string;
    actorId: PrincipalId;
    projectId: ProjectId;
    workStateId: string;
    output: PilotStandInOutput;
    coordination?: {
      safeContext: string;
      candidateNextSteps: string[];
    };
    now: string;
  }): Promise<{
    applied: boolean;
    pulseEntry?: PilotPulseEntry;
    coordinationThread?: PilotCoordinationThread;
  }>;
  reconcileSharedBoundaries(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    now: string;
  }): Promise<PilotBoundaryReconciliation>;
  getCoordination(
    threadId: string,
  ): Promise<PilotCoordinationThread | undefined>;
  linkCoordinationArtifacts(input: {
    coordinationThreadId: string;
    conversationThreadId: string;
    sourceRoomThreadId: string;
    summaryMessageId: string;
    now: string;
  }): Promise<PilotCoordinationThread>;
  listCoordinationRelevance(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationRelevance[]>;
  updateCoordinationRelevance(input: {
    coordinationThreadId: string;
    principalId: PrincipalId;
    action: "dismiss" | "mute" | "revisit";
    now: string;
  }): Promise<PilotCoordinationRelevance>;
  failStandInJob(input: {
    jobKey: string;
    workerId: string;
    actorId: PrincipalId;
    projectId: ProjectId;
    workStateId: string;
    errorCode: string;
    terminal: boolean;
    nextAttemptAt?: string;
    now: string;
  }): Promise<PilotStoredStandInJob>;
  listPendingStandInJobs(
    olderThan: string,
    limit: number,
  ): Promise<PilotStoredStandInJob[]>;
  publishStandInSummary(input: {
    binding: PilotAgentBinding;
    checkpoint: PilotCheckpointInput;
    workStateId: string;
    safeSummary: string;
    narrative: PilotWorkNarrative;
    now: string;
  }): Promise<PilotPulseEntry | undefined>;
  upsertCoordinationSuggestion(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    safeContext: string;
    candidateNextSteps: string[];
    now: string;
  }): Promise<PilotCoordinationThread>;
  listPrivateWorkState(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotPrivateWorkState[]>;
  listTeamPulse(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotPulseEntry[]>;
  listStandInExchanges(
    projectId: ProjectId,
    viewerPrincipalId: PrincipalId,
    standInOwnerId: PrincipalId,
  ): Promise<PilotStandInExchange[]>;
  recordStandInExchange(input: {
    id?: string;
    questionMessageId?: string;
    answerMessageId?: string;
    projectId: ProjectId;
    standInOwnerId: PrincipalId;
    askedByPrincipalId: PrincipalId;
    question: string;
    answer: string;
    structuredAnswer: PilotStandInAnswerDetail;
    sources: PilotStandInSource[];
    now: string;
  }): Promise<PilotStandInExchange>;
  withdrawPulseEntry(
    projectId: ProjectId,
    workStateId: string,
    principalId: PrincipalId,
    clientMutationId: string,
    now: string,
  ): Promise<{ entry: PilotPulseEntry; duplicate: boolean }>;
  listCoordination(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationThread[]>;
  findCoordinationByConversationThread(
    threadId: string,
  ): Promise<PilotCoordinationThread | undefined>;
  proposeCoordinationConclusion(input: {
    threadId: string;
    principalId: PrincipalId;
    conclusion: string;
    responsibleParticipantId: PrincipalId;
    now: string;
  }): Promise<PilotCoordinationThread>;
  confirmCoordination(
    threadId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotCoordinationThread>;
}

export abstract class SnapshotPilotStore implements PilotStore {
  protected abstract readSnapshot(): Promise<PilotSnapshot>;
  protected abstract updateSnapshot<T>(
    operation: (snapshot: PilotSnapshot) => T,
    context?: PilotMutationContext,
  ): Promise<T>;

  async getOrganization(): Promise<PilotOrganization | undefined> {
    return (await this.readSnapshot()).organization;
  }

  async getAdministratorId(): Promise<PrincipalId | undefined> {
    const snapshot = await this.readSnapshot();
    return (
      snapshot.organizationMemberships.find((item) => item.role === "admin")
        ?.principalId ?? snapshot.administratorId
    );
  }

  async getOrganizationRole(
    principalId: PrincipalId,
  ): Promise<PilotOrganizationRole | undefined> {
    return (await this.readSnapshot()).organizationMemberships.find(
      (item) => item.principalId === principalId,
    )?.role;
  }

  async getProviderConfiguration(): Promise<PilotStoredProvider | undefined> {
    return (await this.readSnapshot()).provider;
  }

  async setupOrganization(input: {
    organization: PilotOrganization;
    administratorId: PrincipalId;
    initialTeam: PilotTeam;
  }): Promise<PilotOrganization> {
    return this.updateSnapshot(
      (snapshot) => {
        if (snapshot.organization) {
          throw new PilotStoreError(
            "ORGANIZATION_ALREADY_CONFIGURED",
            409,
            "This Intero deployment is already configured.",
          );
        }
        snapshot.organization = input.organization;
        snapshot.administratorId = input.administratorId;
        snapshot.teams.push(input.initialTeam);
        snapshot.organizationMemberships.push({
          principalId: input.administratorId,
          role: "admin",
          joinedAt: input.initialTeam.createdAt,
        });
        snapshot.memberships.push({
          teamId: input.initialTeam.id,
          principalId: input.administratorId,
          role: "member",
          joinedAt: input.initialTeam.createdAt,
        });
        return input.organization;
      },
      {
        eventType: "pilot.organization.configured",
        actorId: input.administratorId,
        aggregateType: "pilot_organization",
        aggregateId: input.organization.id,
        visibility: "organization",
      },
    );
  }

  async configureProvider(input: {
    administratorId: PrincipalId;
    endpoint: string;
    defaultModel: string;
    encryptedApiKey: string;
  }): Promise<PilotOrganization> {
    return this.updateSnapshot(
      (snapshot) => {
        const organization = requireOrganization(snapshot);
        requireOrganizationAdministrator(snapshot, input.administratorId);
        snapshot.provider = {
          endpoint: input.endpoint,
          defaultModel: input.defaultModel,
          encryptedApiKey: input.encryptedApiKey,
        };
        snapshot.organization = {
          ...organization,
          provider: {
            configured: true,
            endpoint: input.endpoint,
            defaultModel: input.defaultModel,
          },
        };
        return snapshot.organization;
      },
      {
        eventType: "pilot.provider.configured",
        actorId: input.administratorId,
        aggregateType: "pilot_organization",
        aggregateId: input.administratorId,
        visibility: "private",
      },
    );
  }

  async renameOrganization(input: {
    name: string;
    principalId: PrincipalId;
  }): Promise<PilotOrganization> {
    let previousName: string | undefined;
    return this.updateSnapshot(
      (snapshot) => {
        const organization = requireOrganization(snapshot);
        requireOrganizationAdministrator(snapshot, input.principalId);
        previousName = organization.name;
        snapshot.organization = { ...organization, name: input.name };
        return snapshot.organization;
      },
      {
        eventType: "pilot.organization.renamed",
        actorId: input.principalId,
        aggregateType: "pilot_organization",
        aggregateId: input.principalId,
        visibility: "organization",
        get detail() {
          return { from: previousName ?? "", to: input.name };
        },
      },
    );
  }

  /**
   * The organization-wide view an administrator governs from. Unlike
   * `listTeams`, it is not filtered by the caller's own memberships — an admin
   * has to reach the teams and projects they do not belong to.
   */
  async getOrganizationDirectory(
    principalId: PrincipalId,
  ): Promise<PilotOrganizationDirectory> {
    const snapshot = await this.readSnapshot();
    requireOrganizationAdministrator(snapshot, principalId);
    return {
      teams: snapshot.teams.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
      teamMemberships: snapshot.memberships,
      organizationMemberships: snapshot.organizationMemberships,
      projects: snapshot.projects.toSorted((left, right) =>
        left.name.localeCompare(right.name),
      ),
    };
  }

  async updateDeploymentEndpoint(input: {
    administratorId: PrincipalId;
    deploymentBaseUrl: string;
    deploymentValidatedAt: string;
  }): Promise<PilotOrganization> {
    return this.updateSnapshot(
      (snapshot) => {
        const organization = requireOrganization(snapshot);
        requireOrganizationAdministrator(snapshot, input.administratorId);
        snapshot.organization = {
          ...organization,
          deploymentBaseUrl: input.deploymentBaseUrl,
          deploymentValidatedAt: input.deploymentValidatedAt,
        };
        return snapshot.organization;
      },
      {
        eventType: "pilot.deployment_endpoint.updated",
        actorId: input.administratorId,
        aggregateType: "pilot_organization",
        aggregateId: input.administratorId,
        visibility: "organization",
      },
    );
  }

  async getTeam(teamId: string): Promise<PilotTeam | undefined> {
    return (await this.readSnapshot()).teams.find((team) => team.id === teamId);
  }

  async getTeamRole(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamRole | undefined> {
    return (await this.readSnapshot()).memberships.find(
      (membership) =>
        membership.teamId === teamId && membership.principalId === principalId,
    )?.role;
  }

  async listTeams(principalId: PrincipalId): Promise<PilotTeam[]> {
    const snapshot = await this.readSnapshot();
    const teamIds = new Set(
      snapshot.memberships
        .filter((item) => item.principalId === principalId)
        .map((item) => item.teamId),
    );
    return snapshot.teams.filter((team) => teamIds.has(team.id));
  }

  async listTeamMembers(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamMembership[]> {
    const snapshot = await this.readSnapshot();
    requireTeamMember(snapshot, teamId, principalId);
    return snapshot.memberships
      .filter((membership) => membership.teamId === teamId)
      .toSorted((left, right) =>
        left.joinedAt === right.joinedAt
          ? left.principalId.localeCompare(right.principalId)
          : left.joinedAt.localeCompare(right.joinedAt),
      );
  }

  /**
   * Creating a team also puts the administrator in it as its leader.
   *
   * `listTeams` only returns teams you belong to, so a team created into thin
   * air would be invisible to the person who just created it — and a team with
   * no leader has nobody able to manage it.
   */
  async createTeam(input: {
    team: PilotTeam;
    principalId: PrincipalId;
  }): Promise<PilotTeam> {
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganization(snapshot);
        requireOrganizationAdministrator(snapshot, input.principalId);
        requireUnusedTeamName(snapshot, input.team.name);
        snapshot.teams.push(input.team);
        snapshot.memberships.push({
          teamId: input.team.id,
          principalId: input.principalId,
          role: "leader",
          joinedAt: input.team.createdAt,
        });
        if (
          !snapshot.organizationMemberships.some(
            (membership) => membership.principalId === input.principalId,
          )
        ) {
          snapshot.organizationMemberships.push({
            principalId: input.principalId,
            role: "admin",
            joinedAt: input.team.createdAt,
          });
        }
        return input.team;
      },
      {
        eventType: "pilot.team.created",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.team.id,
        visibility: "organization",
        detail: { name: input.team.name },
      },
    );
  }

  async renameTeam(input: {
    teamId: string;
    name: string;
    principalId: PrincipalId;
  }): Promise<PilotTeam> {
    let previousName: string | undefined;
    return this.updateSnapshot(
      (snapshot) => {
        requireTeamManager(snapshot, input.teamId, input.principalId);
        const team = requireTeam(snapshot, input.teamId);
        requireUnusedTeamName(snapshot, input.name, input.teamId);
        previousName = team.name;
        team.name = input.name;
        return team;
      },
      {
        eventType: "pilot.team.renamed",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.teamId,
        visibility: "organization",
        get detail() {
          return { from: previousName ?? "", to: input.name };
        },
      },
    );
  }

  async deleteTeam(input: {
    teamId: string;
    principalId: PrincipalId;
  }): Promise<void> {
    let deletedName = "";
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, input.principalId);
        const team = requireTeam(snapshot, input.teamId);
        if (
          snapshot.projects.some((project) =>
            project.participatingTeamIds.includes(input.teamId),
          )
        ) {
          throw new PilotStoreError(
            "TEAM_HAS_PROJECTS",
            409,
            "Move or delete the team's projects before deleting the team.",
          );
        }

        deletedName = team.name;
        const threadIds = new Set(
          snapshot.dmThreads
            .filter((thread) => thread.teamId === input.teamId)
            .map((thread) => thread.id),
        );
        snapshot.memberships = snapshot.memberships.filter(
          (membership) => membership.teamId !== input.teamId,
        );
        snapshot.invitations = snapshot.invitations.filter(
          (invitation) => invitation.teamId !== input.teamId,
        );
        snapshot.joinLinks = snapshot.joinLinks.filter(
          (link) => link.teamId !== input.teamId,
        );
        snapshot.dmMessages = snapshot.dmMessages.filter(
          (message) => !threadIds.has(message.threadId),
        );
        snapshot.dmThreads = snapshot.dmThreads.filter(
          (thread) => thread.teamId !== input.teamId,
        );
        snapshot.teams = snapshot.teams.filter(
          (candidate) => candidate.id !== input.teamId,
        );
      },
      {
        eventType: "pilot.team.deleted",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.teamId,
        visibility: "organization",
        get detail() {
          return { name: deletedName };
        },
      },
    );
  }

  /**
   * Puts an existing colleague into a team directly. Only people the
   * organization already holds a membership for can be added this way; anyone
   * else has to come through an invitation, which is what establishes their
   * account in the first place.
   */
  async addTeamMember(input: {
    teamId: string;
    memberId: PrincipalId;
    role: PilotTeamRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamMembership> {
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, input.principalId);
        requireTeam(snapshot, input.teamId);
        if (
          !snapshot.organizationMemberships.some(
            (membership) => membership.principalId === input.memberId,
          )
        ) {
          throw notFound("Organization membership");
        }
        if (
          snapshot.memberships.some(
            (membership) =>
              membership.teamId === input.teamId &&
              membership.principalId === input.memberId,
          )
        ) {
          throw new PilotStoreError(
            "TEAM_MEMBERSHIP_EXISTS",
            409,
            "This person is already a member of the team.",
          );
        }
        const membership: PilotTeamMembership = {
          teamId: input.teamId,
          principalId: input.memberId,
          role: input.role,
          joinedAt: input.now,
        };
        snapshot.memberships.push(membership);
        return membership;
      },
      {
        eventType: "pilot.team_member.added",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.teamId,
        visibility: "organization",
        subjectId: input.memberId,
        detail: { to: input.role },
      },
    );
  }

  async createInvitation(
    invitation: PilotTeamInvitation,
    principalId: PrincipalId,
  ): Promise<PilotTeamInvitation> {
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, principalId);
        requireTeam(snapshot, invitation.teamId);
        const activeDuplicate = snapshot.invitations.find(
          (item) =>
            item.teamId === invitation.teamId &&
            item.email === invitation.email &&
            !item.acceptedAt &&
            !item.revokedAt &&
            item.expiresAt > invitation.createdAt,
        );
        if (activeDuplicate) {
          throw new PilotStoreError(
            "INVITATION_ALREADY_PENDING",
            409,
            "A pending invitation already exists for this email and team.",
          );
        }
        snapshot.invitations.push(invitation);
        return invitation;
      },
      {
        eventType: "pilot.team_invitation.created",
        actorId: principalId,
        aggregateType: "pilot_team_invitation",
        aggregateId: invitation.id,
        visibility: "organization",
        detail: { email: invitation.email, teamId: invitation.teamId },
      },
    );
  }

  async listInvitations(
    teamId: string,
    principalId: PrincipalId,
  ): Promise<PilotTeamInvitation[]> {
    const snapshot = await this.readSnapshot();
    requireOrganizationAdministrator(snapshot, principalId);
    requireTeam(snapshot, teamId);
    return snapshot.invitations
      .filter((invitation) => invitation.teamId === teamId)
      .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<PilotTeamInvitation | undefined> {
    return (await this.readSnapshot()).invitations.find(
      (invitation) => invitation.tokenHash === tokenHash,
    );
  }

  async regenerateInvitation(input: {
    invitationId: string;
    tokenHash: string;
    expiresAt: string;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamInvitation> {
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, input.principalId);
        const invitation = snapshot.invitations.find(
          (item) => item.id === input.invitationId,
        );
        if (!invitation) throw notFound("Team invitation");
        if (invitation.acceptedAt) {
          throw new PilotStoreError(
            "INVITATION_ALREADY_ACCEPTED",
            409,
            "An accepted invitation cannot be regenerated.",
          );
        }
        invitation.tokenHash = input.tokenHash;
        invitation.expiresAt = input.expiresAt;
        invitation.revokedAt = undefined;
        invitation.updatedAt = input.now;
        return invitation;
      },
      {
        eventType: "pilot.team_invitation.regenerated",
        actorId: input.principalId,
        aggregateType: "pilot_team_invitation",
        aggregateId: input.invitationId,
        visibility: "organization",
      },
    );
  }

  async revokeInvitation(
    invitationId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotTeamInvitation> {
    let revokedEmail: string | undefined;
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, principalId);
        const invitation = snapshot.invitations.find(
          (item) => item.id === invitationId,
        );
        if (!invitation) throw notFound("Team invitation");
        if (invitation.acceptedAt) {
          throw new PilotStoreError(
            "INVITATION_ALREADY_ACCEPTED",
            409,
            "An accepted invitation cannot be revoked.",
          );
        }
        revokedEmail = invitation.email;
        invitation.revokedAt = now;
        invitation.updatedAt = now;
        return invitation;
      },
      {
        eventType: "pilot.team_invitation.revoked",
        actorId: principalId,
        aggregateType: "pilot_team_invitation",
        aggregateId: invitationId,
        visibility: "organization",
        get detail() {
          return { email: revokedEmail ?? "" };
        },
      },
    );
  }

  async acceptInvitation(input: {
    tokenHash: string;
    email: string;
    principalId: PrincipalId;
    now: string;
  }): Promise<{ invitation: PilotTeamInvitation; team: PilotTeam }> {
    return this.updateSnapshot(
      (snapshot) => {
        const invitation = snapshot.invitations.find(
          (item) => item.tokenHash === input.tokenHash,
        );
        if (!invitation) throw invalidInvitation();
        if (invitation.email !== normalizeEmail(input.email)) {
          throw new PilotStoreError(
            "INVITATION_EMAIL_MISMATCH",
            403,
            "Sign in with the exact email address named on this invitation.",
          );
        }
        if (invitation.revokedAt) {
          throw new PilotStoreError(
            "INVITATION_REVOKED",
            410,
            "This invitation has been revoked.",
          );
        }
        if (invitation.expiresAt <= input.now) {
          throw new PilotStoreError(
            "INVITATION_EXPIRED",
            410,
            "This invitation has expired.",
          );
        }
        if (
          invitation.acceptedAt &&
          invitation.acceptedBy !== input.principalId
        ) {
          throw new PilotStoreError(
            "INVITATION_ALREADY_ACCEPTED",
            409,
            "This invitation has already been accepted.",
          );
        }
        const team = requireTeam(snapshot, invitation.teamId);
        if (!invitation.acceptedAt) {
          invitation.acceptedAt = input.now;
          invitation.acceptedBy = input.principalId;
          invitation.updatedAt = input.now;
          if (
            !snapshot.organizationMemberships.some(
              (item) => item.principalId === input.principalId,
            )
          ) {
            snapshot.organizationMemberships.push({
              principalId: input.principalId,
              role: "member",
              joinedAt: input.now,
            });
          }
          if (
            !snapshot.memberships.some(
              (item) =>
                item.teamId === team.id &&
                item.principalId === input.principalId,
            )
          ) {
            snapshot.memberships.push({
              teamId: team.id,
              principalId: input.principalId,
              role: "member",
              joinedAt: input.now,
            });
          }
        }
        return { invitation, team };
      },
      {
        eventType: "pilot.team_invitation.accepted",
        actorId: input.principalId,
        aggregateType: "pilot_organization",
        aggregateId: input.principalId,
        visibility: "organization",
      },
    );
  }

  async updateTeamMemberRole(input: {
    teamId: string;
    memberId: PrincipalId;
    role: PilotTeamRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotTeamMembership> {
    // The previous role is captured for the audit trail before it is replaced.
    let previousRole: PilotTeamRole | undefined;
    return this.updateSnapshot(
      (snapshot) => {
        requireTeamManager(snapshot, input.teamId, input.principalId);
        const membership = snapshot.memberships.find(
          (item) =>
            item.teamId === input.teamId && item.principalId === input.memberId,
        );
        if (!membership) throw notFound("Team membership");
        previousRole = membership.role;
        membership.role = input.role;
        return membership;
      },
      {
        eventType: "pilot.team_member.role_changed",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.teamId,
        visibility: "organization",
        subjectId: input.memberId,
        get detail() {
          return {
            ...(previousRole ? { from: previousRole } : {}),
            to: input.role,
          };
        },
      },
    );
  }

  async removeTeamMember(input: {
    teamId: string;
    memberId: PrincipalId;
    principalId: PrincipalId;
  }): Promise<void> {
    return this.updateSnapshot(
      (snapshot) => {
        requireTeamManager(snapshot, input.teamId, input.principalId);
        const index = snapshot.memberships.findIndex(
          (item) =>
            item.teamId === input.teamId && item.principalId === input.memberId,
        );
        if (index === -1) throw notFound("Team membership");
        snapshot.memberships.splice(index, 1);
      },
      {
        eventType: "pilot.team_member.removed",
        actorId: input.principalId,
        aggregateType: "pilot_team",
        aggregateId: input.teamId,
        visibility: "organization",
        subjectId: input.memberId,
      },
    );
  }

  async updateOrganizationRole(input: {
    memberId: PrincipalId;
    role: PilotOrganizationRole;
    principalId: PrincipalId;
    now: string;
  }): Promise<PilotOrganizationMembership> {
    let previousRole: PilotOrganizationRole | undefined;
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganizationAdministrator(snapshot, input.principalId);
        const membership = snapshot.organizationMemberships.find(
          (item) => item.principalId === input.memberId,
        );
        if (!membership) throw notFound("Organization membership");
        previousRole = membership.role;
        if (
          membership.role === "admin" &&
          input.role === "member" &&
          snapshot.organizationMemberships.filter(
            (item) => item.role === "admin",
          ).length === 1
        ) {
          throw new PilotStoreError(
            "LAST_ORGANIZATION_ADMIN",
            409,
            "The last organization administrator cannot be demoted.",
          );
        }
        membership.role = input.role;
        if (
          snapshot.administratorId === input.memberId &&
          input.role === "member"
        ) {
          snapshot.administratorId = snapshot.organizationMemberships.find(
            (item) => item.role === "admin",
          )!.principalId;
        }
        return membership;
      },
      {
        eventType: "pilot.organization_member.role_changed",
        actorId: input.principalId,
        aggregateType: "pilot_organization",
        aggregateId: input.memberId,
        visibility: "organization",
        subjectId: input.memberId,
        get detail() {
          return {
            ...(previousRole ? { from: previousRole } : {}),
            to: input.role,
          };
        },
      },
    );
  }

  async createJoinLink(
    link: PilotJoinLink,
    codeHash: string,
    principalId: PrincipalId,
  ): Promise<PilotJoinLink> {
    return this.updateSnapshot(
      (snapshot) => {
        requireTeamMember(snapshot, link.teamId, principalId);
        snapshot.joinLinks.push({ ...link, codeHash });
        return link;
      },
      {
        eventType: "pilot.team_join_link.created",
        actorId: principalId,
        aggregateType: "pilot_join_link",
        aggregateId: link.id,
        visibility: "organization",
      },
    );
  }

  async redeemJoinLink(
    codeHash: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotTeam> {
    return this.updateSnapshot(
      (snapshot) => {
        const link = snapshot.joinLinks.find(
          (item) => item.codeHash === codeHash,
        );
        if (
          !link ||
          link.revokedAt ||
          (link.expiresAt && link.expiresAt <= now) ||
          (link.maxUses !== undefined && link.useCount >= link.maxUses)
        ) {
          throw new PilotStoreError(
            "JOIN_LINK_INVALID",
            404,
            "This team join link is invalid, expired, or exhausted.",
          );
        }
        if (
          !snapshot.memberships.some(
            (membership) =>
              membership.teamId === link.teamId &&
              membership.principalId === principalId,
          )
        ) {
          snapshot.memberships.push({
            teamId: link.teamId,
            principalId,
            role: "member",
            joinedAt: now,
          });
          if (
            !snapshot.organizationMemberships.some(
              (membership) => membership.principalId === principalId,
            )
          ) {
            snapshot.organizationMemberships.push({
              principalId,
              role: "member",
              joinedAt: now,
            });
          }
          link.useCount += 1;
        }
        return requireTeam(snapshot, link.teamId);
      },
      {
        eventType: "pilot.team_join_link.redeemed",
        actorId: principalId,
        aggregateType: "pilot_organization",
        aggregateId: principalId,
        visibility: "organization",
      },
    );
  }

  async revokeJoinLink(
    linkId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotJoinLink> {
    return this.updateSnapshot(
      (snapshot) => {
        const link = snapshot.joinLinks.find((item) => item.id === linkId);
        if (!link) throw notFound("Team join link");
        requireTeamMember(snapshot, link.teamId, principalId);
        link.revokedAt = now;
        return link;
      },
      {
        eventType: "pilot.team_join_link.revoked",
        actorId: principalId,
        aggregateType: "pilot_join_link",
        aggregateId: linkId,
        visibility: "organization",
      },
    );
  }

  async listProjects(principalId: PrincipalId): Promise<PilotProject[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.projects
      .filter((project) => canParticipate(snapshot, project, principalId))
      .toSorted((left, right) => left.name.localeCompare(right.name));
  }

  async createProject(project: PilotProject): Promise<PilotProject> {
    return this.updateSnapshot(
      (snapshot) => {
        requireOrganization(snapshot);
        for (const teamId of project.participatingTeamIds) {
          requireTeam(snapshot, teamId);
        }
        if (!project.participatingTeamIds.includes(project.primaryTeamId)) {
          throw new PilotStoreError(
            "PRIMARY_TEAM_NOT_ASSOCIATED",
            400,
            "The primary team must participate in the project.",
          );
        }
        requireTeamMember(snapshot, project.primaryTeamId, project.ownerId);
        snapshot.projects.push(project);
        return project;
      },
      {
        eventType: "pilot.project.created",
        actorId: project.ownerId,
        aggregateType: "pilot_project",
        aggregateId: project.id,
        visibility: "project",
        projectId: project.id,
        detail: { name: project.name },
      },
    );
  }

  async updateProjectPosture(
    projectId: ProjectId,
    principalId: PrincipalId,
    posture: PilotCollaborationPosture,
    now: string,
  ): Promise<PilotProject> {
    return this.updateSnapshot(
      (snapshot) => {
        const project = requireProject(snapshot, projectId);
        if (project.ownerId !== principalId) {
          throw new PilotStoreError(
            "PROJECT_OWNER_REQUIRED",
            403,
            "Only the project owner can change collaboration posture.",
          );
        }
        project.posture = posture;
        project.updatedAt = now;
        return project;
      },
      {
        eventType: "pilot.project.posture_changed",
        actorId: principalId,
        aggregateType: "pilot_project",
        aggregateId: projectId,
        visibility: "project",
        projectId,
      },
    );
  }

  /**
   * Renames a project, transfers ownership and re-scopes participating teams.
   *
   * Posture is accepted here too so an administrator can pause a project they
   * do not own; `updateProjectPosture` stays owner-only and is what the
   * project's own surface uses.
   */
  async updateProject(input: {
    projectId: ProjectId;
    principalId: PrincipalId;
    now: string;
    name?: string;
    ownerId?: PrincipalId;
    primaryTeamId?: string;
    participatingTeamIds?: string[];
    posture?: PilotCollaborationPosture;
  }): Promise<PilotProject> {
    const changed: Record<string, string> = {};
    return this.updateSnapshot(
      (snapshot) => {
        const project = requireProject(snapshot, input.projectId);
        requireProjectManager(snapshot, project, input.principalId);
        const ownerId = input.ownerId ?? project.ownerId;
        const primaryTeamId = input.primaryTeamId ?? project.primaryTeamId;
        const participatingTeamIds = [
          ...new Set(
            input.participatingTeamIds ?? project.participatingTeamIds,
          ),
        ];
        for (const teamId of participatingTeamIds) {
          requireTeam(snapshot, teamId);
        }
        if (!participatingTeamIds.includes(primaryTeamId)) {
          throw new PilotStoreError(
            "PRIMARY_TEAM_NOT_ASSOCIATED",
            400,
            "The primary team must participate in the project.",
          );
        }
        if (
          (primaryTeamId !== project.primaryTeamId ||
            ownerId !== project.ownerId) &&
          !snapshot.memberships.some(
            (membership) =>
              membership.teamId === primaryTeamId &&
              membership.principalId === ownerId,
          )
        ) {
          throw new PilotStoreError(
            "PROJECT_OWNER_NOT_IN_TEAM",
            409,
            "The project owner must be a member of the primary team.",
          );
        }
        if (input.name !== undefined && input.name !== project.name) {
          changed.from = project.name;
          changed.to = input.name;
          project.name = input.name;
        }
        if (ownerId !== project.ownerId) {
          changed.ownerId = ownerId;
          project.ownerId = ownerId;
        }
        if (primaryTeamId !== project.primaryTeamId) {
          changed.primaryTeamId = primaryTeamId;
          project.primaryTeamId = primaryTeamId;
        }
        if (
          participatingTeamIds.join(",") !==
          project.participatingTeamIds.join(",")
        ) {
          changed.teams = String(participatingTeamIds.length);
          project.participatingTeamIds = participatingTeamIds;
        }
        if (input.posture !== undefined && input.posture !== project.posture) {
          changed.posture = input.posture;
          project.posture = input.posture;
        }
        project.updatedAt = input.now;
        return project;
      },
      {
        eventType: "pilot.project.updated",
        actorId: input.principalId,
        aggregateType: "pilot_project",
        aggregateId: input.projectId,
        visibility: "project",
        projectId: input.projectId,
        detail: changed,
      },
    );
  }

  async listDirectMessageThreads(principalId: PrincipalId): Promise<
    Array<{
      thread: PilotDirectMessageThread;
      messages: PilotDirectMessage[];
    }>
  > {
    const snapshot = await this.readSnapshot();
    return snapshot.dmThreads
      .filter((thread) => thread.participantIds.includes(principalId))
      .map((thread) => ({
        thread,
        messages: snapshot.dmMessages
          .filter((message) => message.threadId === thread.id)
          .toSorted((left, right) => left.sequence - right.sequence),
      }));
  }

  async getOrCreateDirectMessage(input: {
    id: string;
    teamId: string;
    principalId: PrincipalId;
    peerId: PrincipalId;
    now: string;
  }): Promise<PilotDirectMessageThread> {
    return this.updateSnapshot(
      (snapshot) => {
        requireTeamMember(snapshot, input.teamId, input.principalId);
        requireTeamMember(snapshot, input.teamId, input.peerId);
        if (input.principalId === input.peerId) {
          throw new PilotStoreError(
            "DM_SELF_NOT_ALLOWED",
            400,
            "A direct message needs two distinct participants.",
          );
        }
        const participants = [input.principalId, input.peerId].toSorted() as [
          PrincipalId,
          PrincipalId,
        ];
        const existing = snapshot.dmThreads.find(
          (thread) =>
            thread.teamId === input.teamId &&
            thread.participantIds[0] === participants[0] &&
            thread.participantIds[1] === participants[1],
        );
        if (existing) return existing;
        const thread: PilotDirectMessageThread = {
          id: input.id,
          teamId: input.teamId,
          participantIds: participants,
          sequence: 0,
          createdAt: input.now,
        };
        snapshot.dmThreads.push(thread);
        return thread;
      },
      {
        eventType: "pilot.dm.opened",
        actorId: input.principalId,
        aggregateType: "pilot_dm_thread",
        aggregateId: input.id,
        visibility: "private",
      },
    );
  }

  async sendDirectMessage(
    message: PilotDirectMessage,
  ): Promise<PilotDirectMessage> {
    return this.updateSnapshot(
      (snapshot) => {
        const thread = snapshot.dmThreads.find(
          (item) => item.id === message.threadId,
        );
        if (!thread) throw notFound("Direct message");
        if (!thread.participantIds.includes(message.senderId)) {
          throw new PilotStoreError(
            "DM_PARTICIPANT_REQUIRED",
            403,
            "Only DM participants can send messages.",
          );
        }
        thread.sequence += 1;
        const stored = { ...message, sequence: thread.sequence };
        snapshot.dmMessages.push(stored);
        return stored;
      },
      {
        eventType: "pilot.dm.message_sent",
        actorId: message.senderId,
        aggregateType: "pilot_dm_thread",
        aggregateId: message.threadId,
        visibility: "private",
      },
    );
  }

  async addStandInToDirectMessage(input: {
    threadId: string;
    principalId: PrincipalId;
    standInId: PrincipalId;
  }): Promise<PilotDirectMessageThread> {
    return this.updateSnapshot(
      (snapshot) => {
        const thread = snapshot.dmThreads.find(
          (item) => item.id === input.threadId,
        );
        if (!thread) throw notFound("Direct message");
        if (!thread.participantIds.includes(input.principalId)) {
          throw new PilotStoreError(
            "DM_PARTICIPANT_REQUIRED",
            403,
            "Only DM participants can add a Stand-in.",
          );
        }
        if (!thread.standInId) {
          thread.standInId = input.standInId;
          thread.standInAddedAfterSequence = thread.sequence;
        }
        return thread;
      },
      {
        eventType: "pilot.dm.stand_in_added",
        actorId: input.principalId,
        aggregateType: "pilot_dm_thread",
        aggregateId: input.threadId,
        visibility: "private",
      },
    );
  }

  async createAgentTicket(ticket: PilotAgentTicket): Promise<PilotAgentTicket> {
    return this.updateSnapshot(
      (snapshot) => {
        requireProvider(snapshot);
        const project = requireProject(snapshot, ticket.projectId);
        requireParticipant(snapshot, project, ticket.ownerId);
        snapshot.agentTickets.push(ticket);
        return ticket;
      },
      {
        eventType: "pilot.agent_ticket.created",
        actorId: ticket.ownerId,
        aggregateType: "pilot_agent_ticket",
        aggregateId: ticket.id,
        visibility: "private",
        projectId: ticket.projectId,
      },
    );
  }

  async resolveAgentTicket(
    ticketHash: string,
    now: string,
  ): Promise<PilotAgentTicket> {
    const snapshot = await this.readSnapshot();
    const ticket = snapshot.agentTickets.find(
      (item) => item.ticketHash === ticketHash,
    );
    if (!ticket || ticket.usedAt || ticket.expiresAt <= now) {
      throw new PilotStoreError(
        "AGENT_TICKET_INVALID",
        401,
        "Agent connection ticket is invalid, expired, or already used.",
      );
    }
    return ticket;
  }

  async exchangeAgentTicket(
    ticketHash: string,
    binding: PilotAgentBinding,
    now: string,
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        requireProvider(snapshot);
        const ticket = snapshot.agentTickets.find(
          (item) => item.ticketHash === ticketHash,
        );
        if (
          !ticket ||
          ticket.usedAt ||
          ticket.expiresAt <= now ||
          ticket.id !== binding.id ||
          ticket.projectId !== binding.projectId ||
          ticket.ownerId !== binding.ownerId ||
          ticket.client !== binding.client
        ) {
          throw new PilotStoreError(
            "AGENT_TICKET_INVALID",
            401,
            "Agent connection ticket is invalid, expired, or already used.",
          );
        }
        const existingIndex = snapshot.agentBindings.findIndex(
          (item) => item.id === ticket.id,
        );
        if (existingIndex >= 0) {
          const existing = snapshot.agentBindings[existingIndex]!;
          if (existing.validatedAt || existing.disconnectedAt) {
            throw new PilotStoreError(
              "AGENT_TICKET_INVALID",
              401,
              "Agent connection ticket is invalid, expired, or already used.",
            );
          }
          const replacement: PilotAgentBinding = {
            ...binding,
            createdAt: existing.createdAt,
          };
          snapshot.agentBindings[existingIndex] = replacement;
          return replacement;
        }
        snapshot.agentBindings.push(binding);
        return binding;
      },
      {
        eventType: "pilot.agent.credentials_issued",
        actorId: binding.ownerId,
        aggregateType: "pilot_agent_binding",
        aggregateId: binding.id,
        visibility: "private",
        projectId: binding.projectId,
      },
    );
  }

  async createAgentBinding(
    binding: PilotAgentBinding,
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        requireProvider(snapshot);
        const project = requireProject(snapshot, binding.projectId);
        requireParticipant(snapshot, project, binding.ownerId);
        if (snapshot.agentBindings.some((item) => item.id === binding.id)) {
          throw new PilotStoreError(
            "AGENT_CONNECTION_EXISTS",
            409,
            "Agent connection already exists.",
          );
        }
        snapshot.agentBindings.push(binding);
        return binding;
      },
      {
        eventType: "pilot.agent.connection_created",
        actorId: binding.ownerId,
        aggregateType: "pilot_agent_binding",
        aggregateId: binding.id,
        visibility: "private",
        projectId: binding.projectId,
      },
    );
  }

  async listAgentBindings(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotAgentBinding[]> {
    const snapshot = await this.readSnapshot();
    requireParticipant(
      snapshot,
      requireProject(snapshot, projectId),
      principalId,
    );
    return snapshot.agentBindings.filter(
      (binding) => binding.projectId === projectId,
    );
  }

  async initializeAgentBinding(
    bindingId: string,
    ownerId: PrincipalId,
    client: {
      name?: string;
      version?: string;
      protocolVersion?: string;
    },
    now: string,
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        const binding = snapshot.agentBindings.find(
          (item) => item.id === bindingId && !item.disconnectedAt,
        );
        if (!binding || binding.ownerId !== ownerId) {
          throw new PilotStoreError(
            "AGENT_CONNECTION_INACTIVE",
            401,
            "Agent connection is not active.",
          );
        }
        binding.mcpInitializedAt ??= now;
        binding.lastSeenAt = now;
        if (client.name) binding.mcpClientName = client.name;
        if (client.version) binding.mcpClientVersion = client.version;
        if (client.protocolVersion) {
          binding.mcpProtocolVersion = client.protocolVersion;
        }
        return binding;
      },
      {
        eventType: "pilot.agent.mcp_initialized",
        actorId: ownerId,
        aggregateType: "pilot_agent_binding",
        aggregateId: bindingId,
        visibility: "private",
      },
    );
  }

  async validateAgentBinding(
    bindingId: string,
    ownerId: PrincipalId,
    verificationCode: string | undefined,
    now: string,
    configurationVersion?: number,
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        const binding = snapshot.agentBindings.find(
          (item) => item.id === bindingId && !item.disconnectedAt,
        );
        if (!binding || binding.ownerId !== ownerId) {
          throw new PilotStoreError(
            "AGENT_CONNECTION_INACTIVE",
            401,
            "Agent connection is not active.",
          );
        }
        if (!binding.mcpInitializedAt) {
          throw new PilotStoreError(
            "AGENT_MCP_INITIALIZATION_REQUIRED",
            409,
            "Complete the native MCP initialization before validation.",
          );
        }
        if (!binding.validatedAt) {
          if (
            !verificationCode ||
            !binding.verificationCodeHash ||
            !binding.verificationExpiresAt ||
            createHash("sha256").update(verificationCode).digest("hex") !==
              binding.verificationCodeHash ||
            (!binding.verificationUsedAt &&
              binding.verificationExpiresAt <= now)
          ) {
            throw new PilotStoreError(
              "AGENT_VERIFICATION_INVALID",
              401,
              "Agent verification is invalid or expired.",
            );
          }
          binding.verificationUsedAt ??= now;
          binding.validatedAt = now;
          const ticket = snapshot.agentTickets.find(
            (item) => item.id === binding.id,
          );
          if (ticket) ticket.usedAt ??= now;
        }
        for (const existing of snapshot.agentBindings) {
          if (
            existing.id !== binding.id &&
            !existing.disconnectedAt &&
            existing.projectId === binding.projectId &&
            existing.ownerId === binding.ownerId &&
            existing.client === binding.client
          ) {
            existing.disconnectedAt = now;
          }
        }
        if (configurationVersion !== undefined) {
          binding.configurationVersion = configurationVersion;
          binding.configurationUpdatedAt = now;
        }
        binding.lastSeenAt = now;
        return binding;
      },
      {
        eventType: "pilot.agent.connected",
        actorId: ownerId,
        aggregateType: "pilot_agent_binding",
        aggregateId: bindingId,
        visibility: "private",
      },
    );
  }

  async disconnectAgentBinding(
    bindingId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        const binding = snapshot.agentBindings.find(
          (item) => item.id === bindingId,
        );
        if (!binding) throw notFound("Agent connection");
        if (binding.ownerId !== principalId) {
          throw new PilotStoreError(
            "AGENT_OWNER_REQUIRED",
            403,
            "Only the connection owner can disconnect it.",
          );
        }
        binding.disconnectedAt = now;
        return binding;
      },
      {
        eventType: "pilot.agent.disconnected",
        actorId: principalId,
        aggregateType: "pilot_agent_binding",
        aggregateId: bindingId,
        visibility: "private",
      },
    );
  }

  async recordAgentLifecycle(
    bindingId: string,
    ownerId: PrincipalId,
    input: {
      lifecycle: "session_started" | "session_ended";
      occurredAt: string;
      receivedAt: string;
    },
  ): Promise<PilotAgentBinding> {
    return this.updateSnapshot(
      (snapshot) => {
        const binding = snapshot.agentBindings.find(
          (item) => item.id === bindingId && !item.disconnectedAt,
        );
        if (!binding || binding.ownerId !== ownerId || !binding.validatedAt) {
          throw new PilotStoreError(
            "AGENT_CONNECTION_INACTIVE",
            401,
            "Agent connection is not active.",
          );
        }
        binding.lastSeenAt = input.receivedAt;
        if (
          !binding.activityUpdatedAt ||
          input.occurredAt >= binding.activityUpdatedAt
        ) {
          binding.activityStatus =
            input.lifecycle === "session_started" ? "active" : "idle";
          binding.activityUpdatedAt = input.occurredAt;
        }
        return binding;
      },
      {
        eventType: `pilot.agent.${input.lifecycle}`,
        actorId: ownerId,
        aggregateType: "pilot_agent_binding",
        aggregateId: bindingId,
        visibility: "private",
      },
    );
  }

  async findBindingByCredentialHash(
    credentialHash: string,
  ): Promise<PilotAgentBinding | undefined> {
    return (await this.readSnapshot()).agentBindings.find(
      (binding) =>
        binding.credentialHash === credentialHash && !binding.disconnectedAt,
    );
  }

  async findAgentBindingById(
    bindingId: string,
  ): Promise<PilotAgentBinding | undefined> {
    return (await this.readSnapshot()).agentBindings.find(
      (binding) => binding.id === bindingId && !binding.disconnectedAt,
    );
  }

  async ingestCheckpoint(
    binding: PilotAgentBinding,
    input: PilotCheckpointInput,
    receivedAt: string,
  ): Promise<PilotIngestResult> {
    return this.updateSnapshot(
      (snapshot) => {
        requireProvider(snapshot);
        if (binding.projectId !== input.projectId) {
          throw new PilotStoreError(
            "CROSS_PROJECT_WRITE",
            403,
            "The Agent connection is not bound to this project.",
          );
        }
        const activeBinding = snapshot.agentBindings.find(
          (item) => item.id === binding.id && !item.disconnectedAt,
        );
        if (!activeBinding) {
          throw new PilotStoreError(
            "AGENT_CONNECTION_INACTIVE",
            401,
            "Agent connection is not active.",
          );
        }
        const duplicateStateId = snapshot.idempotency[input.clientEventId];
        if (duplicateStateId) {
          const workState = snapshot.workStates.find(
            (state) => state.id === duplicateStateId,
          )!;
          const standInJob = snapshot.standInJobs.find(
            (job) => job.jobKey === input.clientEventId,
          );
          if (!standInJob) {
            throw new PilotStoreError(
              "STAND_IN_JOB_NOT_FOUND",
              500,
              "The idempotent checkpoint is missing its Stand-in job.",
            );
          }
          const pulseEntry = snapshot.pulseEntries.find(
            (entry) => entry.workStateId === workState.id,
          );
          const coordinationThread = snapshot.coordinationThreads.find(
            (thread) =>
              thread.workStateId === workState.id ||
              thread.sourceWorkStateIds?.includes(workState.id),
          );
          return {
            accepted: true,
            duplicate: true,
            published: Boolean(pulseEntry && !pulseEntry.withdrawnAt),
            workState,
            standInJob,
            ...(pulseEntry ? { pulseEntry } : {}),
            ...(coordinationThread ? { coordinationThread } : {}),
          };
        }

        const project = requireProject(snapshot, input.projectId);
        const targetPrincipalId =
          input.narrative.collaboration.targetPrincipalId;
        if (targetPrincipalId && !input.narrative.collaboration.needed) {
          throw new PilotStoreError(
            "COLLABORATION_TARGET_WITHOUT_REQUEST",
            400,
            "A structured collaboration target requires collaboration.needed.",
          );
        }
        if (
          targetPrincipalId &&
          !canParticipate(snapshot, project, targetPrincipalId)
        ) {
          throw new PilotStoreError(
            "COLLABORATION_TARGET_NOT_AUTHORIZED",
            403,
            "The requested collaboration target does not participate in this project.",
          );
        }
        const existing = snapshot.workStates.find(
          (state) =>
            state.bindingId === binding.id &&
            state.workstreamKey === input.workstream.key,
        );
        const claim = buildClaim(binding, input, receivedAt);
        const jobId = uuidv7();
        const standIn = {
          jobId,
          jobKey: input.clientEventId,
          status: "pending" as const,
          attempts: 0,
          queuedAt: receivedAt,
          updatedAt: receivedAt,
        };
        const workState: PilotPrivateWorkState = {
          id: existing?.id ?? uuidv7(),
          projectId: input.projectId,
          ownerId: binding.ownerId,
          bindingId: binding.id,
          workstreamKey: input.workstream.key,
          title: input.workstream.title,
          phase: input.workstream.phase,
          narrative: input.narrative,
          claims: [...(existing?.claims ?? []), claim].slice(-200),
          standIn,
          freshnessAt: input.occurredAt,
          expiresAt: retentionDeadline(receivedAt),
          createdAt: existing?.createdAt ?? receivedAt,
          updatedAt: receivedAt,
        };
        if (existing) Object.assign(existing, workState);
        else snapshot.workStates.push(workState);
        snapshot.idempotency[input.clientEventId] = workState.id;
        const standInJob: PilotStoredStandInJob = {
          id: jobId,
          jobKey: input.clientEventId,
          projectId: input.projectId,
          workStateId: workState.id,
          binding: structuredClone(binding),
          checkpoint: structuredClone(input),
          receivedAt,
          status: "pending",
          attempts: 0,
          maxAttempts: 8,
          queuedAt: receivedAt,
          updatedAt: receivedAt,
        };
        snapshot.standInJobs.push(standInJob);
        activeBinding.lastSeenAt = receivedAt;
        return {
          accepted: true,
          duplicate: false,
          published: false,
          workState,
          standInJob,
        };
      },
      {
        eventType: `pilot.checkpoint.${input.eventType}`,
        actorId: binding.ownerId,
        aggregateType: "pilot_project",
        aggregateId: input.projectId,
        visibility: "private",
        projectId: input.projectId,
      },
    );
  }

  async getIngestResult(workStateId: string): Promise<PilotIngestResult> {
    const snapshot = await this.readSnapshot();
    const workState = snapshot.workStates.find(
      (state) => state.id === workStateId,
    );
    if (!workState) throw notFound("Private Work State");
    const pulseEntry = snapshot.pulseEntries.find(
      (entry) => entry.workStateId === workState.id,
    );
    const coordinationThread = snapshot.coordinationThreads.find(
      (thread) =>
        (thread.workStateId === workState.id ||
          thread.sourceWorkStateIds?.includes(workState.id)) &&
        thread.status !== "resolved",
    );
    const standInJob = snapshot.standInJobs.find(
      (job) => job.id === workState.standIn.jobId,
    );
    if (!standInJob) {
      throw new PilotStoreError(
        "STAND_IN_JOB_NOT_FOUND",
        500,
        "Private Work State is missing its Stand-in job.",
      );
    }
    return {
      accepted: true,
      duplicate: false,
      published: Boolean(pulseEntry && !pulseEntry.withdrawnAt),
      workState,
      standInJob,
      ...(pulseEntry ? { pulseEntry } : {}),
      ...(coordinationThread ? { coordinationThread } : {}),
    };
  }

  async claimStandInJob(input: {
    jobKey: string;
    workerId: string;
    attempt: number;
    maxAttempts: number;
    now: string;
  }): Promise<
    | { status: "claimed"; job: PilotStoredStandInJob }
    | { status: "completed"; job: PilotStoredStandInJob }
  > {
    return this.updateSnapshot((snapshot) => {
      const job = requireStandInJob(snapshot, input.jobKey);
      if (job.status === "published" || job.status === "private") {
        return { status: "completed" as const, job };
      }
      if (job.status === "failed") {
        throw new PilotStoreError(
          "STAND_IN_JOB_DEAD_LETTERED",
          409,
          "The Stand-in job reached terminal failure.",
        );
      }
      job.status = "processing";
      job.attempts = Math.max(job.attempts, input.attempt);
      job.maxAttempts = input.maxAttempts;
      job.workerId = input.workerId;
      job.startedAt ??= input.now;
      job.updatedAt = input.now;
      delete job.nextAttemptAt;
      const workState = requireWorkState(snapshot, job.workStateId);
      if (workState.standIn.jobId === job.id) {
        workState.standIn = processingState(job);
      }
      return { status: "claimed" as const, job };
    });
  }

  async completeStandInJob(input: {
    jobKey: string;
    workerId: string;
    actorId: PrincipalId;
    projectId: ProjectId;
    workStateId: string;
    output: PilotStandInOutput;
    coordination?: {
      safeContext: string;
      candidateNextSteps: string[];
    };
    now: string;
  }): Promise<{
    applied: boolean;
    pulseEntry?: PilotPulseEntry;
    coordinationThread?: PilotCoordinationThread;
  }> {
    return this.updateSnapshot(
      (snapshot) => {
        const job = requireStandInJob(snapshot, input.jobKey);
        if (job.status === "published" || job.status === "private") {
          const pulseEntry = snapshot.pulseEntries.find(
            (entry) => entry.workStateId === job.workStateId,
          );
          const coordinationThread = snapshot.coordinationThreads.find(
            (thread) =>
              thread.workStateId === job.workStateId &&
              thread.status !== "resolved",
          );
          return {
            applied: false,
            ...(pulseEntry ? { pulseEntry } : {}),
            ...(coordinationThread ? { coordinationThread } : {}),
          };
        }
        if (
          job.status !== "processing" ||
          job.workerId !== input.workerId ||
          job.projectId !== input.projectId ||
          job.workStateId !== input.workStateId
        ) {
          throw new PilotStoreError(
            "STAND_IN_JOB_CAS_FAILED",
            409,
            "The Stand-in job lease is no longer current.",
          );
        }
        const project = requireProject(snapshot, job.projectId);
        const workState = requireWorkState(snapshot, job.workStateId);
        let pulseEntry: PilotPulseEntry | undefined;
        let coordinationThread: PilotCoordinationThread | undefined;
        if (project.posture === "collaborative") {
          const currentPulse = snapshot.pulseEntries.find(
            (entry) => entry.workStateId === workState.id,
          );
          pulseEntry = buildPulseEntry(
            currentPulse,
            job.binding,
            job.checkpoint,
            job.workStateId,
            input.output.safeSummary,
            input.output.narrative,
            job.receivedAt,
          );
          if (currentPulse) Object.assign(currentPulse, pulseEntry);
          else snapshot.pulseEntries.push(pulseEntry);

          if (input.coordination && isCoordinationTrigger(job.checkpoint)) {
            const currentThread = snapshot.coordinationThreads.find(
              (thread) =>
                thread.workStateId === workState.id &&
                thread.status !== "resolved",
            );
            if (currentThread) {
              currentThread.sourceBindingId ??= job.binding.id;
              currentThread.participantIds = [
                ...new Set([
                  ...currentThread.participantIds,
                  ...coordinationParticipantIds(
                    project,
                    job.binding,
                    job.checkpoint,
                  ),
                ]),
              ];
              currentThread.safeContext = input.coordination.safeContext;
              currentThread.candidateNextSteps =
                input.coordination.candidateNextSteps;
              currentThread.updatedAt = input.now;
              coordinationThread = currentThread;
            } else {
              coordinationThread = buildCoordinationThread(
                project,
                job.binding,
                job.workStateId,
                job.checkpoint,
                {
                  ...input.output,
                  coordination: {
                    shouldOpen: true,
                    ...input.coordination,
                  },
                },
                input.now,
              );
              snapshot.coordinationThreads.push(coordinationThread);
            }
          }
        }
        job.status = pulseEntry ? "published" : "private";
        job.completedAt = input.now;
        job.updatedAt = input.now;
        delete job.lastErrorCode;
        delete job.nextAttemptAt;
        if (workState.standIn.jobId === job.id) {
          workState.standIn = processingState(job);
        }
        return {
          applied: true,
          ...(pulseEntry ? { pulseEntry } : {}),
          ...(coordinationThread ? { coordinationThread } : {}),
        };
      },
      {
        eventType: "pilot.stand_in.completed",
        actorId: input.actorId,
        aggregateType: "pilot_work_state",
        aggregateId: input.workStateId,
        visibility: "project",
        projectId: input.projectId,
      },
    );
  }

  async reconcileSharedBoundaries(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    now: string;
  }): Promise<PilotBoundaryReconciliation> {
    return this.updateSnapshot(
      (snapshot) => {
        const boundaries = input.checkpoint.sharedBoundaries ?? [];
        if (boundaries.length === 0) {
          return { claims: [], matches: [], coordinationThreads: [] };
        }
        const workState = requireWorkState(snapshot, input.workStateId);
        if (
          workState.projectId !== input.project.id ||
          workState.ownerId !== input.binding.ownerId ||
          workState.bindingId !== input.binding.id
        ) {
          throw new PilotStoreError(
            "SHARED_BOUNDARY_SOURCE_INVALID",
            403,
            "The shared boundary source does not match this Work State.",
          );
        }

        const changedClaims: PilotSharedBoundaryClaim[] = [];
        for (const boundary of boundaries) {
          const key = normalizeSharedBoundaryKey(boundary.key);
          const duplicate = snapshot.sharedBoundaryClaims.find(
            (claim) =>
              claim.workStateId === workState.id &&
              claim.checkpointClientEventId ===
                input.checkpoint.clientEventId &&
              claim.key === key,
          );
          if (duplicate) {
            changedClaims.push(duplicate);
            continue;
          }
          const previous = snapshot.sharedBoundaryClaims
            .filter(
              (claim) =>
                claim.workStateId === workState.id &&
                claim.key === key &&
                !claim.supersededAt &&
                !claim.withdrawnAt,
            )
            .toSorted((left, right) => right.revision - left.revision)[0];
          if (previous) previous.supersededAt = input.now;
          const claim: PilotSharedBoundaryClaim = {
            id: uuidv7(),
            projectId: input.project.id,
            workStateId: workState.id,
            ownerId: input.binding.ownerId,
            bindingId: input.binding.id,
            checkpointClientEventId: input.checkpoint.clientEventId,
            key,
            kind: boundary.kind,
            relation: boundary.relation,
            assumption: boundary.assumption.trim(),
            change: boundary.change,
            preserves: [
              ...new Set(boundary.preserves.map((item) => item.trim())),
            ],
            revision: (previous?.revision ?? 0) + 1,
            observedAt: input.checkpoint.occurredAt,
            createdAt: input.now,
          };
          snapshot.sharedBoundaryClaims.push(claim);
          changedClaims.push(claim);
        }

        const changedIds = new Set(changedClaims.map((claim) => claim.id));
        const matches = evaluateSharedBoundaryClaims(
          snapshot.sharedBoundaryClaims.filter(
            (claim) => claim.projectId === input.project.id,
          ),
          input.now,
        ).filter(
          (match) =>
            changedIds.has(match.producerClaimId) ||
            changedIds.has(match.consumerClaimId),
        );
        const coordinationThreads: PilotCoordinationThread[] = [];
        for (const match of matches) {
          if (match.classification !== "potential_conflict") continue;
          const producer = snapshot.sharedBoundaryClaims.find(
            (claim) => claim.id === match.producerClaimId,
          )!;
          const consumer = snapshot.sharedBoundaryClaims.find(
            (claim) => claim.id === match.consumerClaimId,
          )!;
          const sources = [producer, consumer].toSorted((left, right) =>
            left.workStateId.localeCompare(right.workStateId),
          );
          const dedupeKey = sharedBoundaryConflictFingerprint(
            input.project.id,
            match.boundaryKey,
            sources,
          );
          let thread = snapshot.coordinationThreads.find(
            (candidate) =>
              candidate.dedupeKey === dedupeKey &&
              candidate.status !== "resolved",
          );
          let signal = snapshot.coordinationSignals.find(
            (candidate) => candidate.fingerprint === dedupeKey,
          );
          const participantIds = [
            ...new Set(sources.map((claim) => claim.ownerId)),
          ];
          const safeContext = `Shared boundary ${match.boundaryKey}: ${match.reason}`;
          if (!thread) {
            const threadId = uuidv7();
            const signalId = signal?.id ?? uuidv7();
            thread = {
              id: threadId,
              projectId: input.project.id,
              trigger: "work_state_conflict",
              automationSignalId: signalId,
              automationKind: "work_state_conflict",
              boundaryKey: match.boundaryKey,
              dedupeKey,
              sourceWorkStateIds: sources.map((claim) => claim.workStateId),
              sourceClaimIds: sources.map((claim) => claim.id),
              participantIds,
              safeContext,
              candidateNextSteps: [
                "Confirm the compatibility window",
                "Choose the shared boundary contract",
              ],
              status: "open",
              createdAt: input.now,
              updatedAt: input.now,
            };
            snapshot.coordinationThreads.push(thread);
            signal ??= {
              id: signalId,
              projectId: input.project.id,
              kind: "work_state_conflict",
              status: "opened",
              fingerprint: dedupeKey,
              sourceRef: `shared-boundary:${match.boundaryKey}`,
              safeContext,
              candidateNextSteps: thread.candidateNextSteps,
              participantIds,
              coordinationThreadId: thread.id,
              detectedAt: input.now,
              processedAt: input.now,
              updatedAt: input.now,
            };
            snapshot.coordinationSignals.push(signal);
          }
          for (const source of sources) {
            if (
              !snapshot.coordinationSources.some(
                (item) =>
                  item.coordinationThreadId === thread!.id &&
                  item.claimId === source.id,
              )
            ) {
              snapshot.coordinationSources.push({
                coordinationThreadId: thread.id,
                workStateId: source.workStateId,
                claimId: source.id,
                ownerId: source.ownerId,
                claimRevision: source.revision,
                observedAt: source.observedAt,
              });
            }
            if (
              !snapshot.coordinationRelevance.some(
                (item) =>
                  item.coordinationThreadId === thread!.id &&
                  item.principalId === source.ownerId,
              )
            ) {
              snapshot.coordinationRelevance.push({
                coordinationThreadId: thread.id,
                projectId: input.project.id,
                principalId: source.ownerId,
                reason: `${match.boundaryKey} is affected by another active Work State.`,
                createdAt: input.now,
                updatedAt: input.now,
              });
            }
          }
          coordinationThreads.push(thread);
        }
        return { claims: changedClaims, matches, coordinationThreads };
      },
      {
        eventType: "work_state.shared_boundaries_changed",
        actorId: input.binding.ownerId,
        aggregateType: "pilot_work_state",
        aggregateId: input.workStateId,
        visibility: "project",
        projectId: input.project.id,
      },
    );
  }

  async getCoordination(
    threadId: string,
  ): Promise<PilotCoordinationThread | undefined> {
    return (await this.readSnapshot()).coordinationThreads.find(
      (thread) => thread.id === threadId,
    );
  }

  async linkCoordinationArtifacts(input: {
    coordinationThreadId: string;
    conversationThreadId: string;
    sourceRoomThreadId: string;
    summaryMessageId: string;
    now: string;
  }): Promise<PilotCoordinationThread> {
    return this.updateSnapshot((snapshot) => {
      const thread = snapshot.coordinationThreads.find(
        (item) => item.id === input.coordinationThreadId,
      );
      if (!thread) throw notFound("Coordination thread");
      thread.conversationThreadId = input.conversationThreadId;
      thread.sourceRoomThreadId = input.sourceRoomThreadId;
      thread.summaryMessageId = input.summaryMessageId;
      thread.updatedAt = input.now;
      for (const relevance of snapshot.coordinationRelevance) {
        if (relevance.coordinationThreadId !== thread.id) continue;
        relevance.sourceRoomThreadId = input.sourceRoomThreadId;
        relevance.updatedAt = input.now;
      }
      return thread;
    });
  }

  async listCoordinationRelevance(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationRelevance[]> {
    const snapshot = await this.readSnapshot();
    requireParticipant(
      snapshot,
      requireProject(snapshot, projectId),
      principalId,
    );
    return snapshot.coordinationRelevance.filter(
      (item) =>
        item.projectId === projectId && item.principalId === principalId,
    );
  }

  async updateCoordinationRelevance(input: {
    coordinationThreadId: string;
    principalId: PrincipalId;
    action: "dismiss" | "mute" | "revisit";
    now: string;
  }): Promise<PilotCoordinationRelevance> {
    return this.updateSnapshot((snapshot) => {
      const relevance = snapshot.coordinationRelevance.find(
        (item) =>
          item.coordinationThreadId === input.coordinationThreadId &&
          item.principalId === input.principalId,
      );
      if (!relevance) throw notFound("Coordination relevance");
      requireParticipant(
        snapshot,
        requireProject(snapshot, relevance.projectId),
        input.principalId,
      );
      if (input.action === "dismiss") relevance.dismissedAt = input.now;
      if (input.action === "mute") relevance.mutedAt = input.now;
      if (input.action === "revisit") {
        delete relevance.dismissedAt;
        delete relevance.mutedAt;
      }
      relevance.updatedAt = input.now;
      return relevance;
    });
  }

  async failStandInJob(input: {
    jobKey: string;
    workerId: string;
    actorId: PrincipalId;
    projectId: ProjectId;
    workStateId: string;
    errorCode: string;
    terminal: boolean;
    nextAttemptAt?: string;
    now: string;
  }): Promise<PilotStoredStandInJob> {
    return this.updateSnapshot(
      (snapshot) => {
        const job = requireStandInJob(snapshot, input.jobKey);
        if (job.status === "published" || job.status === "private") return job;
        if (job.workerId && job.workerId !== input.workerId) {
          throw new PilotStoreError(
            "STAND_IN_JOB_CAS_FAILED",
            409,
            "The Stand-in job lease is no longer current.",
          );
        }
        job.status = input.terminal ? "failed" : "retrying";
        job.lastErrorCode = input.errorCode.slice(0, 120);
        job.updatedAt = input.now;
        if (input.terminal) {
          job.deadLetteredAt = input.now;
          job.completedAt = input.now;
          delete job.nextAttemptAt;
        } else if (input.nextAttemptAt) {
          job.nextAttemptAt = input.nextAttemptAt;
        }
        const workState = requireWorkState(snapshot, job.workStateId);
        if (workState.standIn.jobId === job.id) {
          workState.standIn = processingState(job);
        }
        return job;
      },
      input.terminal
        ? {
            eventType: "pilot.stand_in.dead_lettered",
            actorId: input.actorId,
            aggregateType: "pilot_work_state",
            aggregateId: input.workStateId,
            visibility: "private",
            projectId: input.projectId,
          }
        : undefined,
    );
  }

  async listPendingStandInJobs(
    olderThan: string,
    limit: number,
  ): Promise<PilotStoredStandInJob[]> {
    const snapshot = await this.readSnapshot();
    return snapshot.standInJobs
      .filter(
        (job) =>
          ["pending", "retrying", "processing"].includes(job.status) &&
          job.updatedAt <= olderThan,
      )
      .toSorted((left, right) => left.queuedAt.localeCompare(right.queuedAt))
      .slice(0, Math.max(1, Math.min(limit, 500)));
  }

  async publishStandInSummary(input: {
    binding: PilotAgentBinding;
    checkpoint: PilotCheckpointInput;
    workStateId: string;
    safeSummary: string;
    narrative: PilotWorkNarrative;
    now: string;
  }): Promise<PilotPulseEntry | undefined> {
    return this.updateSnapshot(
      (snapshot) => {
        const project = requireProject(snapshot, input.checkpoint.projectId);
        if (project.posture !== "collaborative") return undefined;
        const workState = snapshot.workStates.find(
          (state) =>
            state.id === input.workStateId &&
            state.projectId === input.checkpoint.projectId,
        );
        if (!workState) throw notFound("Private Work State");
        const current = snapshot.pulseEntries.find(
          (entry) => entry.workStateId === workState.id,
        );
        const entry = buildPulseEntry(
          current,
          input.binding,
          input.checkpoint,
          input.workStateId,
          input.safeSummary,
          input.narrative,
          input.now,
        );
        if (current) Object.assign(current, entry);
        else snapshot.pulseEntries.push(entry);
        return entry;
      },
      {
        eventType: "pilot.pulse.published",
        actorId: input.binding.ownerId,
        aggregateType: "pilot_work_state",
        aggregateId: input.workStateId,
        visibility: "project",
        projectId: input.checkpoint.projectId,
      },
    );
  }

  async upsertCoordinationSuggestion(input: {
    project: PilotProject;
    binding: PilotAgentBinding;
    workStateId: string;
    checkpoint: PilotCheckpointInput;
    safeContext: string;
    candidateNextSteps: string[];
    now: string;
  }): Promise<PilotCoordinationThread> {
    return this.updateSnapshot(
      (snapshot) => {
        const project = requireProject(snapshot, input.project.id);
        requireParticipant(snapshot, project, input.binding.ownerId);
        const workState = snapshot.workStates.find(
          (state) =>
            state.id === input.workStateId && state.projectId === project.id,
        );
        if (!workState) throw notFound("Private Work State");
        const current = snapshot.coordinationThreads.find(
          (thread) =>
            thread.workStateId === workState.id && thread.status !== "resolved",
        );
        if (current) {
          current.safeContext = input.safeContext;
          current.candidateNextSteps = input.candidateNextSteps;
          current.updatedAt = input.now;
          return current;
        }
        const thread = buildCoordinationThread(
          project,
          input.binding,
          input.workStateId,
          input.checkpoint,
          {
            safeSummary: input.safeContext,
            narrative: input.checkpoint.narrative,
            coordination: {
              shouldOpen: true,
              safeContext: input.safeContext,
              candidateNextSteps: input.candidateNextSteps,
            },
          },
          input.now,
        );
        snapshot.coordinationThreads.push(thread);
        return thread;
      },
      {
        eventType: "pilot.coordination.opened_or_refreshed",
        actorId: input.binding.ownerId,
        aggregateType: "pilot_work_state",
        aggregateId: input.workStateId,
        visibility: "project",
        projectId: input.project.id,
      },
    );
  }

  async listPrivateWorkState(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotPrivateWorkState[]> {
    const snapshot = await this.readSnapshot();
    requireParticipant(
      snapshot,
      requireProject(snapshot, projectId),
      principalId,
    );
    return snapshot.workStates
      .filter(
        (state) =>
          state.projectId === projectId && state.ownerId === principalId,
      )
      .toSorted((left, right) =>
        right.freshnessAt.localeCompare(left.freshnessAt),
      );
  }

  async listTeamPulse(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotPulseEntry[]> {
    const snapshot = await this.readSnapshot();
    const project = requireProject(snapshot, projectId);
    requireParticipant(snapshot, project, principalId);
    if (project.posture !== "collaborative") return [];
    return snapshot.pulseEntries
      .filter((entry) => entry.projectId === projectId && !entry.withdrawnAt)
      .toSorted((left, right) =>
        right.freshnessAt.localeCompare(left.freshnessAt),
      );
  }

  async listStandInExchanges(
    projectId: ProjectId,
    viewerPrincipalId: PrincipalId,
    standInOwnerId: PrincipalId,
  ): Promise<PilotStandInExchange[]> {
    const snapshot = await this.readSnapshot();
    const project = requireProject(snapshot, projectId);
    requireParticipant(snapshot, project, viewerPrincipalId);
    requireParticipant(snapshot, project, standInOwnerId);
    return (snapshot.standInExchanges ?? [])
      .filter(
        (exchange) =>
          exchange.projectId === projectId &&
          exchange.principalId === standInOwnerId &&
          (exchange.askedByPrincipalId ?? exchange.principalId) ===
            viewerPrincipalId,
      )
      .toSorted((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async recordStandInExchange(input: {
    id?: string;
    questionMessageId?: string;
    answerMessageId?: string;
    projectId: ProjectId;
    standInOwnerId: PrincipalId;
    askedByPrincipalId: PrincipalId;
    question: string;
    answer: string;
    structuredAnswer: PilotStandInAnswerDetail;
    sources: PilotStandInSource[];
    now: string;
  }): Promise<PilotStandInExchange> {
    return this.updateSnapshot(
      (snapshot) => {
        const project = requireProject(snapshot, input.projectId);
        requireParticipant(snapshot, project, input.askedByPrincipalId);
        requireParticipant(snapshot, project, input.standInOwnerId);
        const existing = input.id
          ? (snapshot.standInExchanges ?? []).find(
              (exchange) => exchange.id === input.id,
            )
          : undefined;
        if (existing) return existing;
        const exchange: PilotStandInExchange = {
          id: input.id ?? uuidv7(),
          questionMessageId: input.questionMessageId ?? uuidv7(),
          answerMessageId: input.answerMessageId ?? uuidv7(),
          projectId: input.projectId,
          principalId: input.standInOwnerId,
          askedByPrincipalId: input.askedByPrincipalId,
          question: input.question,
          answer: input.answer,
          structuredAnswer: input.structuredAnswer,
          sources: input.sources,
          createdAt: input.now,
        };
        (snapshot.standInExchanges ??= []).push(exchange);
        return exchange;
      },
      {
        eventType: "pilot.stand_in.exchange_recorded",
        actorId: input.askedByPrincipalId,
        aggregateType: "pilot_personal_stand_in",
        aggregateId: input.standInOwnerId,
        visibility: "private",
        projectId: input.projectId,
      },
    );
  }

  async withdrawPulseEntry(
    projectId: ProjectId,
    workStateId: string,
    principalId: PrincipalId,
    _clientMutationId: string,
    now: string,
  ): Promise<{ entry: PilotPulseEntry; duplicate: boolean }> {
    return this.updateSnapshot(
      (snapshot) => {
        requireParticipant(
          snapshot,
          requireProject(snapshot, projectId),
          principalId,
        );
        const state = snapshot.workStates.find(
          (item) => item.id === workStateId && item.projectId === projectId,
        );
        const entry = snapshot.pulseEntries.find(
          (item) => item.workStateId === workStateId,
        );
        if (!state || !entry) throw notFound("Team Pulse entry");
        if (state.ownerId !== principalId) {
          throw new PilotStoreError(
            "PULSE_ORIGINATOR_REQUIRED",
            403,
            "Only the originator can withdraw this summary.",
          );
        }
        if (entry.withdrawnAt) {
          return { entry, duplicate: true };
        }
        entry.withdrawnAt = now;
        for (const claim of snapshot.sharedBoundaryClaims) {
          if (claim.workStateId === workStateId && !claim.withdrawnAt) {
            claim.withdrawnAt = now;
          }
        }
        return { entry, duplicate: false };
      },
      {
        eventType: "pilot.pulse.withdrawn",
        actorId: principalId,
        aggregateType: "pilot_work_state",
        aggregateId: workStateId,
        visibility: "project",
        projectId,
      },
    );
  }

  async listCoordination(
    projectId: ProjectId,
    principalId: PrincipalId,
  ): Promise<PilotCoordinationThread[]> {
    const snapshot = await this.readSnapshot();
    requireParticipant(
      snapshot,
      requireProject(snapshot, projectId),
      principalId,
    );
    return snapshot.coordinationThreads
      .filter(
        (thread) =>
          thread.projectId === projectId &&
          (thread.trigger !== "work_state_conflict" ||
            thread.participantIds.includes(principalId)),
      )
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async findCoordinationByConversationThread(
    threadId: string,
  ): Promise<PilotCoordinationThread | undefined> {
    return (await this.readSnapshot()).coordinationThreads.find(
      (item) => item.conversationThreadId === threadId,
    );
  }

  async proposeCoordinationConclusion(input: {
    threadId: string;
    principalId: PrincipalId;
    conclusion: string;
    responsibleParticipantId: PrincipalId;
    now: string;
  }): Promise<PilotCoordinationThread> {
    return this.updateSnapshot(
      (snapshot) => {
        const thread = snapshot.coordinationThreads.find(
          (item) => item.id === input.threadId,
        );
        if (!thread) throw notFound("Coordination thread");
        requireParticipant(
          snapshot,
          requireProject(snapshot, thread.projectId),
          input.principalId,
        );
        if (!thread.participantIds.includes(input.principalId)) {
          throw new PilotStoreError(
            "COORDINATION_PARTICIPANT_REQUIRED",
            403,
            "Only an affected coordination participant can propose a conclusion.",
          );
        }
        if (!thread.participantIds.includes(input.responsibleParticipantId)) {
          throw new PilotStoreError(
            "RESPONSIBLE_PARTICIPANT_REQUIRED",
            400,
            "The responsible person must participate in this coordination.",
          );
        }
        thread.conclusion = input.conclusion;
        thread.responsibleParticipantId = input.responsibleParticipantId;
        thread.status = "needs_confirmation";
        thread.updatedAt = input.now;
        return thread;
      },
      {
        eventType: "pilot.coordination.conclusion_proposed",
        actorId: input.principalId,
        aggregateType: "pilot_coordination_thread",
        aggregateId: input.threadId,
        visibility: "project",
      },
    );
  }

  async confirmCoordination(
    threadId: string,
    principalId: PrincipalId,
    now: string,
  ): Promise<PilotCoordinationThread> {
    return this.updateSnapshot(
      (snapshot) => {
        const thread = snapshot.coordinationThreads.find(
          (item) => item.id === threadId,
        );
        if (!thread) throw notFound("Coordination thread");
        if (
          thread.status === "resolved" &&
          thread.responsibleParticipantId === principalId
        ) {
          return thread;
        }
        if (
          thread.status !== "needs_confirmation" ||
          thread.responsibleParticipantId !== principalId
        ) {
          throw new PilotStoreError(
            "COORDINATION_CONFIRMATION_REQUIRED",
            403,
            "Only the responsible participant can confirm this conclusion.",
          );
        }
        thread.status = "resolved";
        thread.confirmedAt = now;
        thread.updatedAt = now;
        return thread;
      },
      {
        eventType: "pilot.coordination.confirmed",
        actorId: principalId,
        aggregateType: "pilot_coordination_thread",
        aggregateId: threadId,
        visibility: "project",
      },
    );
  }
}

export class InMemoryPilotStore extends SnapshotPilotStore {
  private snapshot = emptyPilotSnapshot();

  protected async readSnapshot(): Promise<PilotSnapshot> {
    return structuredClone(this.snapshot);
  }

  protected async updateSnapshot<T>(
    operation: (snapshot: PilotSnapshot) => T,
    _context?: PilotMutationContext,
  ): Promise<T> {
    const next = structuredClone(this.snapshot);
    const value = operation(next);
    this.snapshot = next;
    return structuredClone(value);
  }
}

export function emptyPilotSnapshot(): PilotSnapshot {
  return {
    teams: [],
    organizationMemberships: [],
    memberships: [],
    invitations: [],
    joinLinks: [],
    projects: [],
    dmThreads: [],
    dmMessages: [],
    agentTickets: [],
    agentBindings: [],
    workStates: [],
    sharedBoundaryClaims: [],
    pulseEntries: [],
    coordinationThreads: [],
    coordinationSources: [],
    coordinationRelevance: [],
    coordinationSignals: [],
    standInExchanges: [],
    standInJobs: [],
    idempotency: {},
  };
}

function sharedBoundaryConflictFingerprint(
  projectId: ProjectId,
  boundaryKey: string,
  sources: readonly PilotSharedBoundaryClaim[],
): string {
  const sourceRevisions = sources
    .map((claim) => `${claim.workStateId}:${claim.revision}`)
    .toSorted()
    .join("|");
  return createHash("sha256")
    .update(`${projectId}|${boundaryKey}|${sourceRevisions}`)
    .digest("hex");
}

function processingState(
  job: PilotStoredStandInJob,
): PilotStandInProcessingState {
  return {
    jobId: job.id,
    jobKey: job.jobKey,
    status: job.status,
    attempts: job.attempts,
    queuedAt: job.queuedAt,
    updatedAt: job.updatedAt,
    ...(job.startedAt ? { startedAt: job.startedAt } : {}),
    ...(job.completedAt ? { completedAt: job.completedAt } : {}),
    ...(job.nextAttemptAt ? { nextAttemptAt: job.nextAttemptAt } : {}),
    ...(job.lastErrorCode ? { lastErrorCode: job.lastErrorCode } : {}),
    ...(job.deadLetteredAt ? { deadLetteredAt: job.deadLetteredAt } : {}),
    ...(job.workerId ? { workerId: job.workerId } : {}),
  };
}

export function buildClaim(
  binding: PilotAgentBinding,
  input: PilotCheckpointInput,
  receivedAt: string,
): PilotPrivateClaim {
  return {
    id: uuidv7(),
    clientEventId: input.clientEventId,
    eventType: input.eventType,
    value: input.narrative.completedOutcome || input.narrative.currentFocus,
    narrative: input.narrative,
    evidenceRefs: input.evidenceRefs,
    source: "direct_cloud_mcp",
    sourceBindingId: binding.id,
    sourceClient: binding.client,
    observedAt: input.occurredAt,
    receivedAt,
  };
}

export function buildPulseEntry(
  existing: PilotPulseEntry | undefined,
  binding: PilotAgentBinding,
  input: PilotCheckpointInput,
  workStateId: string,
  safeSummary: string,
  narrative: PilotWorkNarrative,
  receivedAt: string,
): PilotPulseEntry {
  return {
    id: existing?.id ?? uuidv7(),
    projectId: input.projectId,
    workStateId,
    ownerId: binding.ownerId,
    title: input.workstream.title,
    phase: input.workstream.phase,
    eventType: input.eventType,
    summary: safeSummary,
    narrative,
    freshnessAt: input.occurredAt,
    provenance: {
      source: "direct_cloud_mcp",
      client: binding.client,
      connectionName: binding.name,
      clientEventId: input.clientEventId,
      occurredAt: input.occurredAt,
      receivedAt,
    },
    publishedAt: receivedAt,
  };
}

function buildCoordinationThread(
  project: PilotProject,
  binding: PilotAgentBinding,
  workStateId: string,
  input: PilotCheckpointInput,
  output: PilotStandInOutput,
  now: string,
): PilotCoordinationThread {
  return {
    id: uuidv7(),
    projectId: project.id,
    workStateId,
    trigger: input.eventType as PilotCoordinationThread["trigger"],
    sourceBindingId: binding.id,
    participantIds: coordinationParticipantIds(project, binding, input),
    safeContext: output.coordination.safeContext,
    candidateNextSteps: output.coordination.candidateNextSteps,
    status: "open",
    createdAt: now,
    updatedAt: now,
  };
}

function coordinationParticipantIds(
  project: PilotProject,
  binding: PilotAgentBinding,
  input: PilotCheckpointInput,
): PrincipalId[] {
  return [
    ...new Set([
      binding.ownerId,
      input.narrative.collaboration.targetPrincipalId ?? project.ownerId,
    ]),
  ];
}

function isCoordinationTrigger(input: PilotCheckpointInput): boolean {
  return [
    "dependency_declared",
    "blocker_raised",
    "review_requested",
    "coordination_requested",
  ].includes(input.eventType);
}

export function retentionDeadline(receivedAt: string): string {
  const deadline = new Date(receivedAt);
  deadline.setUTCDate(deadline.getUTCDate() + 180);
  return deadline.toISOString();
}

function requireOrganization(snapshot: PilotSnapshot): PilotOrganization {
  if (!snapshot.organization) {
    throw new PilotStoreError(
      "SETUP_REQUIRED",
      409,
      "Intero setup must be completed first.",
    );
  }
  return snapshot.organization;
}

function requireProvider(snapshot: PilotSnapshot): PilotStoredProvider {
  if (!snapshot.provider) {
    throw new PilotStoreError(
      "AI_PROVIDER_REQUIRED",
      409,
      "Configure the cloud AI provider before connecting an Agent.",
    );
  }
  return snapshot.provider;
}

function requireOrganizationAdministrator(
  snapshot: PilotSnapshot,
  principalId: PrincipalId,
): void {
  if (!isOrganizationAdministrator(snapshot, principalId)) {
    throw new PilotStoreError(
      "ADMINISTRATOR_REQUIRED",
      403,
      "An organization administrator is required for this action.",
    );
  }
}

function isOrganizationAdministrator(
  snapshot: PilotSnapshot,
  principalId: PrincipalId,
): boolean {
  return (
    snapshot.administratorId === principalId ||
    snapshot.organizationMemberships.some(
      (membership) =>
        membership.principalId === principalId && membership.role === "admin",
    )
  );
}

function requireTeam(snapshot: PilotSnapshot, teamId: string): PilotTeam {
  const team = snapshot.teams.find((item) => item.id === teamId);
  if (!team) throw notFound("Team");
  return team;
}

function requireTeamMember(
  snapshot: PilotSnapshot,
  teamId: string,
  principalId: PrincipalId,
): void {
  requireTeam(snapshot, teamId);
  if (
    !snapshot.memberships.some(
      (item) => item.teamId === teamId && item.principalId === principalId,
    )
  ) {
    throw new PilotStoreError(
      "TEAM_MEMBERSHIP_REQUIRED",
      403,
      "This identity is not a member of the team.",
    );
  }
}

function requireTeamManager(
  snapshot: PilotSnapshot,
  teamId: string,
  principalId: PrincipalId,
): void {
  requireTeam(snapshot, teamId);
  if (
    snapshot.organizationMemberships.some(
      (membership) =>
        membership.principalId === principalId && membership.role === "admin",
    ) ||
    snapshot.administratorId === principalId ||
    snapshot.memberships.some(
      (membership) =>
        membership.teamId === teamId &&
        membership.principalId === principalId &&
        membership.role === "leader",
    )
  ) {
    return;
  }
  throw new PilotStoreError(
    "TEAM_MANAGER_REQUIRED",
    403,
    "An organization administrator or Team Leader is required.",
  );
}

/**
 * Team names are how people pick a scope in the shell, so two teams sharing one
 * name would make the picker ambiguous. Compared case-insensitively.
 */
function requireUnusedTeamName(
  snapshot: PilotSnapshot,
  name: string,
  exceptTeamId?: string,
): void {
  const taken = snapshot.teams.some(
    (team) =>
      team.id !== exceptTeamId &&
      team.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );
  if (taken) {
    throw new PilotStoreError(
      "TEAM_NAME_TAKEN",
      409,
      "Another team already uses this name.",
    );
  }
}

function requireProjectManager(
  snapshot: PilotSnapshot,
  project: PilotProject,
  principalId: PrincipalId,
): void {
  if (project.ownerId === principalId) return;
  requireOrganizationAdministrator(snapshot, principalId);
}

function requireProject(
  snapshot: PilotSnapshot,
  projectId: ProjectId,
): PilotProject {
  const project = snapshot.projects.find((item) => item.id === projectId);
  if (!project) throw notFound("Project");
  return project;
}

function requireWorkState(
  snapshot: PilotSnapshot,
  workStateId: string,
): PilotPrivateWorkState {
  const state = snapshot.workStates.find((item) => item.id === workStateId);
  if (!state) throw notFound("Private Work State");
  return state;
}

function requireStandInJob(
  snapshot: PilotSnapshot,
  jobKey: string,
): PilotStoredStandInJob {
  const job = snapshot.standInJobs.find((item) => item.jobKey === jobKey);
  if (!job) throw notFound("Stand-in job");
  return job;
}

function canParticipate(
  snapshot: PilotSnapshot,
  project: PilotProject,
  principalId: PrincipalId,
): boolean {
  return snapshot.memberships.some(
    (membership) =>
      membership.principalId === principalId &&
      project.participatingTeamIds.includes(membership.teamId),
  );
}

function requireParticipant(
  snapshot: PilotSnapshot,
  project: PilotProject,
  principalId: PrincipalId,
): void {
  if (!canParticipate(snapshot, project, principalId)) {
    throw new PilotStoreError(
      "PROJECT_PARTICIPATION_REQUIRED",
      403,
      "Membership in an associated team is required for this project.",
    );
  }
}

function notFound(resource: string): PilotStoreError {
  return new PilotStoreError("NOT_FOUND", 404, `${resource} was not found.`);
}

function invalidInvitation(): PilotStoreError {
  return new PilotStoreError(
    "INVITATION_INVALID",
    404,
    "This invitation is invalid.",
  );
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
