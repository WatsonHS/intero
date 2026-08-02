import {
  PilotInteroProse,
  PilotStandInAnswer,
  PilotStandInOutput,
  type PilotStandInAnswer as PilotStandInAnswerValue,
  type PilotStandInOutput as PilotStandInOutputValue,
} from "@intero/domain";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output, streamText } from "ai";

import type {
  InteroProseInput,
  ModelGateway,
  StandInModelInput,
  StandInQuestionInput,
} from "./pilot-ports.js";
import { ModelGatewayUnavailableError } from "./pilot-ports.js";
import type { PilotStoredProvider } from "./pilot-store.js";
import type { ProviderSecretCipher } from "./provider-secrets.js";

const BASE_SYSTEM_INSTRUCTIONS = [
  "You are Intero's bounded Digital Stand-in.",
  "Transform one already-structured semantic coding checkpoint into a concise, human-readable collaboration update.",
  "Use only facts present in the structured input. Do not infer secrets, raw prompts, file contents, diffs, terminal output, tool logs, or personal data.",
  "Keep concrete outcomes and evidence; remove implementation chatter and unsupported confidence or progress claims.",
  "The narrative must answer: current focus, completed outcome, concrete evidence, next step, and needed collaboration.",
  "Never make commitments, change priorities, act externally, or finalize a decision.",
  "For dependency, blocker, review, or coordination events, suggest at most three reversible candidate next steps that require responsible participant confirmation.",
  "For all other events, set coordination.shouldOpen to false, safeContext to an empty string, and candidateNextSteps to an empty array.",
  'Return exactly one JSON object with all fields at these exact paths: {"safeSummary":"one-sentence conclusion","narrative":{"currentFocus":"string","completedOutcome":"string or empty","evidence":["concrete safe evidence"],"nextStep":"string or empty","collaboration":{"needed":false,"request":"string or empty","requestedFrom":"person or role or empty"}},"coordination":{"shouldOpen":false,"safeContext":"string","candidateNextSteps":["string"]}}.',
  "All fields are required. If collaboration.needed is false, request and requestedFrom must be empty strings.",
].join(" ");

const BASE_QUESTION_SYSTEM_INSTRUCTIONS = [
  "You are Intero's bounded Digital Stand-in answering a conversation participant.",
  "The trusted standInOwner object identifies the human you represent. Their displayName is identity context, not a fact that must appear in Work State.",
  "Second-person references to you or UI address text such as @<displayName> 的替身 refer to this Stand-in; never treat them as requests to search Work State for a person with that name.",
  "Work State is optional retrieval context, not a prerequisite for conversation.",
  "In both project and unscoped conversations, respond naturally to greetings, social conversation, and requests that do not require unsupported claims about the represented human.",
  "When conversationScope.mode is project, answer project-fact questions only from the supplied safe structured summaries.",
  "Confirmed coordination decisions are separate human-approved shared context. You may use only entries in safeConfirmedCoordination and must not present proposals or unconfirmed conclusions as decisions.",
  "When conversationScope.mode is unscoped, converse naturally as the represented human's Stand-in, but never invent the represented human's facts, opinions, commitments, priorities, or work status. Ask for safe context when one of those is needed.",
  "Do not infer missing facts, secrets, raw prompts, file contents, diffs, terminal output, tool logs, personal data, priorities, or commitments.",
  "An empty safeStructuredSources array is valid. Continue the conversation without claiming unsupported facts. Explain that no relevant structured Work State is available only when the question requires project or represented-human facts, and return an empty sourceWorkStateIds array.",
  "If supplied summaries do not support the question, say that the current structured Work State does not contain enough information.",
  "Give a direct conclusion first, then a grounded current status, completed outcome, concrete evidence, next step, and needed collaboration.",
  "Do not repeat IDs, clients, timestamps, schema versions, or other provenance metadata in the prose answer.",
  "Return the workStateId of every summary that directly supports the answer and no unsupported source IDs.",
  "Keep every field concise and make uncertainty explicit.",
  'Return exactly one JSON object with all required fields at these exact paths: {"answer":"concise direct conclusion","currentStatus":"string","completedOutcome":"string or empty","evidence":["concrete safe evidence"],"nextStep":"string or empty","neededCollaboration":"string or empty","sourceWorkStateIds":["supplied-work-state-id"]}.',
].join(" ");

const BASE_INTERO_PROSE_SYSTEM_INSTRUCTIONS = [
  "You write bounded, plain-language prose for Intero coordination.",
  "The supplied scope, classification, boundary, evidence, and facts are already authorization-filtered and deterministic.",
  "Explain them without changing scope, adding Projects, reclassifying the result, inventing facts, or making commitments.",
  "Keep scope explanation separate from what changed, why it matters, and what a human needs to do.",
  "Do not repeat opaque IDs, timestamps, revisions, provider details, prompts, or provenance metadata in human-facing prose.",
  "If the evidence is insufficient, state that uncertainty directly. If it is compatible, do not imply that coordination work is required.",
  'Return exactly one JSON object with all required fields at these exact paths: {"headline":"string","scopeExplanation":"string","whatChanged":"string","whyItMatters":"string","needsFromYou":"string"}.',
].join(" ");

export function standInSystemInstructions(
  preferredLanguage: "zh-CN" | "en-US",
): string {
  const languageInstruction =
    preferredLanguage === "zh-CN"
      ? "Write every human-readable output field, including the summary, narrative, collaboration request, safe coordination context, evidence, and candidate next steps, in Simplified Chinese (zh-CN). Keep code identifiers and proper nouns unchanged when necessary."
      : "Write every human-readable output field, including the summary, narrative, collaboration request, safe coordination context, evidence, and candidate next steps, in English (en-US).";
  return `${BASE_SYSTEM_INSTRUCTIONS} ${languageInstruction}`;
}

export function standInQuestionSystemInstructions(
  preferredLanguage: "zh-CN" | "en-US",
): string {
  const languageInstruction =
    preferredLanguage === "zh-CN"
      ? "Answer every human-readable output field in Simplified Chinese (zh-CN), regardless of the language used in individual source records. Keep code identifiers and proper nouns unchanged when necessary."
      : "Answer every human-readable output field in English (en-US), regardless of the language used in individual source records.";
  return `${BASE_QUESTION_SYSTEM_INSTRUCTIONS} ${languageInstruction}`;
}

export function interoProseSystemInstructions(
  preferredLanguage: "zh-CN" | "en-US",
): string {
  const languageInstruction =
    preferredLanguage === "zh-CN"
      ? "Write every field in Simplified Chinese (zh-CN). Keep code identifiers and proper nouns unchanged when needed."
      : "Write every field in English (en-US).";
  return `${BASE_INTERO_PROSE_SYSTEM_INSTRUCTIONS} ${languageInstruction}`;
}

function usePortableJsonObjectMode(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const responseFormat = args.response_format;
  if (
    typeof responseFormat === "object" &&
    responseFormat !== null &&
    "type" in responseFormat &&
    responseFormat.type === "json_schema"
  ) {
    return {
      ...args,
      response_format: { type: "json_object" },
    };
  }
  return args;
}

export class VercelAiModelGateway implements ModelGateway {
  constructor(
    private readonly loadProvider: () => Promise<
      PilotStoredProvider | undefined
    >,
    private readonly secrets: ProviderSecretCipher,
  ) {}

  async generateStandInOutput(
    input: StandInModelInput,
  ): Promise<PilotStandInOutputValue> {
    const configuration = await this.loadProvider();
    if (!configuration) {
      throw new ModelGatewayUnavailableError(
        "The deployment administrator has not configured an AI provider.",
      );
    }

    let apiKey: string;
    try {
      apiKey = this.secrets.decrypt(configuration.encryptedApiKey);
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider credential could not be opened.",
      );
    }

    const provider = createOpenAICompatible({
      name: "intero-admin-provider",
      baseURL: configuration.endpoint,
      apiKey,
      // An administrator may supply any OpenAI-compatible service. JSON-object
      // mode plus explicit shape instructions is more portable than assuming
      // every compatible endpoint implements OpenAI's native json_schema mode.
      supportsStructuredOutputs: true,
      transformRequestBody: usePortableJsonObjectMode,
    });

    try {
      const result = await generateText({
        model: provider.chatModel(configuration.defaultModel),
        system: standInSystemInstructions(input.binding.preferredLanguage),
        prompt: JSON.stringify({
          project: input.project,
          ownerId: input.ownerId,
          source: {
            bindingId: input.binding.id,
            client: input.binding.client,
            connectionName: input.binding.name,
            preferredLanguage: input.binding.preferredLanguage,
          },
          checkpoint: input.checkpoint,
        }),
        output: Output.object({
          schema: PilotStandInOutput,
          name: "intero_stand_in_output",
          description:
            "A safe project collaboration summary and bounded coordination suggestion.",
        }),
        maxOutputTokens: 500,
        temperature: 0.1,
        maxRetries: 1,
        timeout: 6_000,
      });
      const output = PilotStandInOutput.parse(result.output);
      const targetPrincipalId =
        input.checkpoint.narrative.collaboration.targetPrincipalId;
      return targetPrincipalId
        ? {
            ...output,
            narrative: {
              ...output.narrative,
              collaboration: {
                ...output.narrative.collaboration,
                targetPrincipalId,
              },
            },
          }
        : output;
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider did not return a valid safe Stand-in output.",
      );
    }
  }

  async generateInteroProse(
    input: InteroProseInput,
  ): Promise<PilotInteroProse> {
    const configuration = await this.loadConfiguration();
    const provider = createOpenAICompatible({
      name: "intero-admin-provider",
      baseURL: configuration.endpoint,
      apiKey: configuration.apiKey,
      supportsStructuredOutputs: true,
      transformRequestBody: usePortableJsonObjectMode,
    });

    try {
      const result = await generateText({
        model: provider.chatModel(configuration.defaultModel),
        system: interoProseSystemInstructions(input.preferredLanguage),
        prompt: interoProsePrompt(input),
        output: Output.object({
          schema: PilotInteroProse,
          name: "intero_coordination_prose",
          description:
            "Authorization-bounded prose that explains one deterministic Intero evaluation.",
        }),
        maxOutputTokens: 500,
        temperature: 0.1,
        maxRetries: 1,
        timeout: 10_000,
      });
      return PilotInteroProse.parse(result.output);
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider did not return valid bounded Intero prose.",
      );
    }
  }

  async answerStandInQuestion(
    input: StandInQuestionInput,
  ): Promise<PilotStandInAnswerValue> {
    const conversationalAnswer = greetingAnswer(input);
    if (conversationalAnswer) return conversationalAnswer;
    const configuration = await this.loadConfiguration();
    const provider = createOpenAICompatible({
      name: "intero-admin-provider",
      baseURL: configuration.endpoint,
      apiKey: configuration.apiKey,
      supportsStructuredOutputs: true,
      transformRequestBody: usePortableJsonObjectMode,
    });

    try {
      const result = await generateText({
        model: provider.chatModel(configuration.defaultModel),
        system: standInQuestionSystemInstructions(input.preferredLanguage),
        prompt: standInQuestionPrompt(input),
        output: Output.object({
          schema: PilotStandInAnswer,
          name: "intero_stand_in_answer",
          description:
            "A grounded Stand-in answer with supporting Work State IDs.",
        }),
        maxOutputTokens: 700,
        temperature: 0.1,
        maxRetries: 1,
        timeout: 10_000,
      });
      return validateStandInAnswer(
        PilotStandInAnswer.parse(result.output),
        input,
      );
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider did not return a valid grounded Stand-in answer.",
      );
    }
  }

  async streamStandInQuestion(
    input: StandInQuestionInput,
    onPartialAnswer: (answer: string) => Promise<void>,
  ): Promise<PilotStandInAnswerValue> {
    const conversationalAnswer = greetingAnswer(input);
    if (conversationalAnswer) {
      await onPartialAnswer(conversationalAnswer.answer);
      return conversationalAnswer;
    }
    const configuration = await this.loadConfiguration();
    const provider = createOpenAICompatible({
      name: "intero-admin-provider",
      baseURL: configuration.endpoint,
      apiKey: configuration.apiKey,
      supportsStructuredOutputs: true,
      transformRequestBody: usePortableJsonObjectMode,
    });

    try {
      const result = streamText({
        model: provider.chatModel(configuration.defaultModel),
        system: standInQuestionSystemInstructions(input.preferredLanguage),
        prompt: standInQuestionPrompt(input),
        output: Output.object({
          schema: PilotStandInAnswer,
          name: "intero_stand_in_answer",
          description:
            "A grounded Stand-in answer with supporting Work State IDs.",
        }),
        maxOutputTokens: 700,
        temperature: 0.1,
        maxRetries: 1,
        timeout: 10_000,
      });
      let lastAnswer = "";
      for await (const partial of result.partialOutputStream) {
        if (
          typeof partial.answer === "string" &&
          partial.answer !== lastAnswer
        ) {
          lastAnswer = partial.answer;
          await onPartialAnswer(lastAnswer);
        }
      }
      return validateStandInAnswer(
        PilotStandInAnswer.parse(await result.output),
        input,
      );
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider did not return a valid grounded Stand-in answer.",
      );
    }
  }

  private async loadConfiguration(): Promise<{
    endpoint: string;
    defaultModel: string;
    apiKey: string;
  }> {
    const configuration = await this.loadProvider();
    if (!configuration) {
      throw new ModelGatewayUnavailableError(
        "The deployment administrator has not configured an AI provider.",
      );
    }
    try {
      return {
        endpoint: configuration.endpoint,
        defaultModel: configuration.defaultModel,
        apiKey: this.secrets.decrypt(configuration.encryptedApiKey),
      };
    } catch {
      throw new ModelGatewayUnavailableError(
        "The configured AI provider credential could not be opened.",
      );
    }
  }
}

function interoProsePrompt(input: InteroProseInput): string {
  return JSON.stringify({
    scope: {
      kind: input.scope.kind,
      projectNames: input.scope.projects.map((project) => project.name),
      evidence: input.scope.evidence.map((evidence) => ({
        kind: evidence.kind,
        detail: evidence.detail,
      })),
    },
    evaluation: {
      classification: input.evaluation.classification,
      boundaryKey: input.evaluation.boundaryKey,
      reason: input.evaluation.reason,
      facts: input.evaluation.facts.map((fact) => ({
        relation: fact.relation,
        assumption: fact.assumption,
        change: fact.change,
      })),
    },
  });
}

function greetingAnswer(
  input: StandInQuestionInput,
): PilotStandInAnswerValue | undefined {
  if (
    !/^(?:hi|hello|hey|你好|您好|嗨|哈喽|在吗)[\s!！,.，。?？~～]*$/iu.test(
      input.question,
    )
  ) {
    return undefined;
  }
  const ownerIsAsking = input.standInOwnerId === input.askedByPrincipalId;
  if (input.preferredLanguage === "zh-CN") {
    const representedPerson = ownerIsAsking
      ? "你"
      : input.standInOwnerDisplayName;
    return {
      answer: `你好，我是${ownerIsAsking ? "你的" : `${input.standInOwnerDisplayName}的`}替身。我可以在当前会话中和大家交流；涉及${representedPerson}的具体事实时，我会以可共享的上下文为准。`,
      currentStatus: input.project
        ? "我已准备好参与当前会话；可用的 Work State 只会作为补充上下文。"
        : "我已准备好参与当前会话。",
      completedOutcome: "",
      evidence: [],
      nextStep: "直接问一个具体的进展、结果、下一步或协作问题。",
      neededCollaboration: "",
      sourceWorkStateIds: [],
    };
  }
  const possessiveOwner = ownerIsAsking
    ? "your"
    : `${input.standInOwnerDisplayName}'s`;
  const representedPerson = ownerIsAsking
    ? "your"
    : `${input.standInOwnerDisplayName}'s`;
  return {
    answer: `Hello, I'm ${possessiveOwner} Stand-in. I can participate in this conversation, and I'll rely on shareable context for specific facts about ${representedPerson}.`,
    currentStatus: input.project
      ? "I'm ready to participate; available Work State is optional supporting context."
      : "I'm ready to participate in this conversation.",
    completedOutcome: "",
    evidence: [],
    nextStep:
      "Ask a specific question about progress, outcomes, next steps, or collaboration.",
    neededCollaboration: "",
    sourceWorkStateIds: [],
  };
}

function standInQuestionPrompt(input: StandInQuestionInput): string {
  return JSON.stringify({
    conversationScope: input.project
      ? { mode: "project", project: input.project }
      : { mode: "unscoped" },
    standInOwner: {
      id: input.standInOwnerId,
      displayName: input.standInOwnerDisplayName,
      relationshipToAssistant: "represented_human",
    },
    askedByPrincipalId: input.askedByPrincipalId,
    ownerIsAsking: input.standInOwnerId === input.askedByPrincipalId,
    preferredLanguage: input.preferredLanguage,
    question: input.question,
    safeStructuredSources: input.sources.map((source) => ({
      workStateId: source.workStateId,
      title: source.title,
      phase: source.phase,
      eventType: source.eventType,
      safeSummary: source.summary,
      narrative: source.narrative,
      freshnessAt: source.freshnessAt,
      provenance: source.provenance,
    })),
    safeConfirmedCoordination: input.confirmedCoordination ?? [],
  });
}

function validateStandInAnswer(
  answer: PilotStandInAnswerValue,
  input: StandInQuestionInput,
): PilotStandInAnswerValue {
  const allowedIds = new Set(input.sources.map((source) => source.workStateId));
  if (
    answer.sourceWorkStateIds.some(
      (workStateId) => !allowedIds.has(workStateId),
    )
  ) {
    throw new Error(
      "The provider cited a Work State outside the supplied context.",
    );
  }
  return answer;
}
