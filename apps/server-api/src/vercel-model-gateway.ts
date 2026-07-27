import {
  PilotStandInAnswer,
  PilotStandInOutput,
  type PilotStandInAnswer as PilotStandInAnswerValue,
  type PilotStandInOutput as PilotStandInOutputValue,
} from "@intero/domain";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { generateText, Output } from "ai";

import type {
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
  "You are Intero's bounded Digital Stand-in answering a project participant.",
  "Answer only from the supplied safe structured project summaries.",
  "Do not infer missing facts, secrets, raw prompts, file contents, diffs, terminal output, tool logs, personal data, priorities, or commitments.",
  "If the supplied summaries do not support the question, say that the current structured Work State does not contain enough information.",
  "Give a direct conclusion first, then a grounded current status, completed outcome, concrete evidence, next step, and needed collaboration.",
  "Do not repeat IDs, clients, timestamps, schema versions, or other provenance metadata in the prose answer.",
  "Return the workStateId of every summary that directly supports the answer and no unsupported source IDs.",
  "Keep every field concise and make uncertainty explicit.",
  'Return exactly one JSON object with all required fields at these exact paths: {"answer":"concise direct conclusion","currentStatus":"string","completedOutcome":"string or empty","evidence":["concrete safe evidence"],"nextStep":"string or empty","neededCollaboration":"string or empty","sourceWorkStateIds":["supplied-work-state-id"]}.',
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

  async answerStandInQuestion(
    input: StandInQuestionInput,
  ): Promise<PilotStandInAnswerValue> {
    if (input.sources.length === 0) {
      throw new ModelGatewayUnavailableError(
        "No published structured Work State is available to ground an answer.",
      );
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
      const result = await generateText({
        model: provider.chatModel(configuration.defaultModel),
        system: standInQuestionSystemInstructions(input.preferredLanguage),
        prompt: JSON.stringify({
          project: input.project,
          standInOwnerId: input.standInOwnerId,
          askedByPrincipalId: input.askedByPrincipalId,
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
        }),
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
      const answer = PilotStandInAnswer.parse(result.output);
      const allowedIds = new Set(
        input.sources.map((source) => source.workStateId),
      );
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
