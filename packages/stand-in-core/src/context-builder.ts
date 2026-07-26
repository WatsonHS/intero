import type {
  Claim,
  DecisionRecord,
  PublicWorkProjection,
  SpecRevision,
  ThreadMessage,
  Workstream,
} from "@intero/domain";

export interface ContextPackage {
  policy: string[];
  standIn: {
    runtime: "local" | "public";
    modelEnabled: boolean;
    capabilities: string[];
  };
  trigger: string;
  messages: ThreadMessage[];
  workstream: Workstream;
  unresolvedClaims: Claim[];
  decisions: DecisionRecord[];
  specRevision?: SpecRevision;
  relatedProjections: PublicWorkProjection[];
  priorSummary?: string;
  tools: string[];
  freshnessAt: string;
}

const MAX_MESSAGES = 24;
const MAX_CLAIMS = 50;
const MAX_DECISIONS = 20;
const MAX_PROJECTIONS = 20;

export function buildContextPackage(input: ContextPackage): ContextPackage {
  return {
    ...input,
    messages: input.messages.slice(-MAX_MESSAGES),
    unresolvedClaims: input.unresolvedClaims.slice(-MAX_CLAIMS),
    decisions: input.decisions.slice(-MAX_DECISIONS),
    relatedProjections: input.relatedProjections.slice(-MAX_PROJECTIONS),
    tools: [...new Set(input.tools)].toSorted(),
  };
}

export interface PromptLayers {
  productPolicy: string;
  organizationPolicy?: string;
  standInIdentity: string;
  userPreferences?: string;
  runtimeCapabilities: string;
  currentContext: string;
}

export function compilePrompt(layers: PromptLayers): string {
  return [
    ["Product policy", layers.productPolicy],
    ["Organization policy", layers.organizationPolicy],
    ["Stand-in identity", layers.standInIdentity],
    ["User preferences", layers.userPreferences],
    ["Runtime capabilities", layers.runtimeCapabilities],
    ["Current context", layers.currentContext],
  ]
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([title, body]) => `## ${title}\n${body}`)
    .join("\n\n");
}
