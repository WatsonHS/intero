import type { OrganizationId, PrincipalId, ProjectId } from "@intero/domain";
import { describe, expect, it, vi } from "vitest";

import { AesGcmProviderSecretCipher } from "./provider-secrets.js";
import { VercelAiModelGateway } from "./vercel-model-gateway.js";

const ORGANIZATION_ID =
  "019b5ac0-7600-7000-8000-000000000001" as OrganizationId;
const PROJECT_ID = "019b5ac0-7600-7000-8000-000000000011" as ProjectId;
const OWNER_ID = "019b5ac0-7600-7000-8000-000000000021" as PrincipalId;
const ASKER_ID = "019b5ac0-7600-7000-8000-000000000022" as PrincipalId;

describe("VercelAiModelGateway empty Work State", () => {
  it("returns a bounded localized answer without requiring a model provider", async () => {
    const loadProvider = vi.fn(async () => {
      throw new Error("A provider must not be loaded for an empty Work State.");
    });
    const gateway = new VercelAiModelGateway(
      loadProvider,
      new AesGcmProviderSecretCipher("test-provider-secret"),
    );
    const input = {
      organizationId: ORGANIZATION_ID,
      project: {
        id: PROJECT_ID,
        name: "Intero",
        posture: "collaborative" as const,
      },
      standInOwnerId: OWNER_ID,
      askedByPrincipalId: ASKER_ID,
      preferredLanguage: "zh-CN" as const,
      question: "现在进展如何？",
      sources: [],
    };

    const answer = await gateway.answerStandInQuestion(input);
    const partials: string[] = [];
    const streamed = await gateway.streamStandInQuestion(
      input,
      async (partial) => {
        partials.push(partial);
      },
    );

    expect(answer).toEqual({
      answer: "对方尚未在当前项目发布可共享的结构化工作状态。",
      currentStatus: "暂无已发布的结构化工作状态。",
      completedOutcome: "",
      evidence: [],
      nextStep: "可以请对方发布一次项目工作状态后再询问。",
      neededCollaboration: "",
      sourceWorkStateIds: [],
    });
    expect(streamed).toEqual(answer);
    expect(partials).toEqual([answer.answer]);
    expect(loadProvider).not.toHaveBeenCalled();
  });
});
