import type { PrincipalId } from "@intero/domain";

export function normalizeStandInQuestion(input: {
  question: string;
  standInOwnerDisplayName: string;
  preferredLanguage: "zh-CN" | "en-US";
}): string {
  const ownerName = input.standInOwnerDisplayName.trim();
  let question = input.question.trim();
  if (!ownerName) return question;

  const addressTokens = [
    `@${ownerName} 的替身`,
    `@${ownerName}的替身`,
    `@${ownerName}'s Stand-in`,
    `@${ownerName}’s Stand-in`,
  ].toSorted((left, right) => right.length - left.length);

  for (const token of addressTokens) {
    if (question.startsWith(token)) {
      question = question
        .slice(token.length)
        .replace(/^[\s,，:：;；、.!！?？。]+/u, "")
        .trim();
      break;
    }
  }

  const selfReference = input.preferredLanguage === "zh-CN" ? "你" : "you";
  for (const token of addressTokens) {
    question = question.split(token).join(selfReference);
  }

  return (
    question.trim() || (input.preferredLanguage === "zh-CN" ? "你好" : "Hello")
  );
}

export function isStandInOwnerAsking(
  standInOwnerId: PrincipalId,
  askedByPrincipalId: PrincipalId,
): boolean {
  return standInOwnerId === askedByPrincipalId;
}
