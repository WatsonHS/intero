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
  it("treats an empty Work State as valid optional context and continues through the conversation model", async () => {
    const loadProvider = vi.fn(async () => undefined);
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
      standInOwnerDisplayName: "盛",
      askedByPrincipalId: ASKER_ID,
      preferredLanguage: "zh-CN" as const,
      question: "现在进展如何？",
      sources: [],
    };

    await expect(gateway.answerStandInQuestion(input)).rejects.toThrow(
      "has not configured an AI provider",
    );
    expect(loadProvider).toHaveBeenCalledOnce();
  });

  it("answers an owner's greeting as that owner's Stand-in without searching Work State for their name", async () => {
    const loadProvider = vi.fn(async () => {
      throw new Error("A greeting must not require a model provider.");
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
      standInOwnerDisplayName: "盛",
      askedByPrincipalId: OWNER_ID,
      preferredLanguage: "zh-CN" as const,
      question: "hi",
      sources: [{} as never],
    };

    await expect(gateway.answerStandInQuestion(input)).resolves.toMatchObject({
      answer:
        "你好，我是你的替身。我可以在当前会话中和大家交流；涉及你的具体事实时，我会以可共享的上下文为准。",
      currentStatus:
        "我已准备好参与当前会话；可用的 Work State 只会作为补充上下文。",
      sourceWorkStateIds: [],
    });
    expect(loadProvider).not.toHaveBeenCalled();
  });

  it("converses as the owner's Stand-in when no Project or Work State exists", async () => {
    const loadProvider = vi.fn(async () => {
      throw new Error("A greeting must not require a model provider.");
    });
    const gateway = new VercelAiModelGateway(
      loadProvider,
      new AesGcmProviderSecretCipher("test-provider-secret"),
    );

    await expect(
      gateway.answerStandInQuestion({
        organizationId: ORGANIZATION_ID,
        standInOwnerId: OWNER_ID,
        standInOwnerDisplayName: "盛",
        askedByPrincipalId: OWNER_ID,
        preferredLanguage: "zh-CN",
        question: "hi",
        sources: [],
      }),
    ).resolves.toMatchObject({
      answer:
        "你好，我是你的替身。我可以在当前会话中和大家交流；涉及你的具体事实时，我会以可共享的上下文为准。",
      currentStatus: "我已准备好参与当前会话。",
      sourceWorkStateIds: [],
    });
    expect(loadProvider).not.toHaveBeenCalled();
  });
});
