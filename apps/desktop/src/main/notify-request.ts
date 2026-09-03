export interface DesktopNotifyRequest {
  title: string;
  body?: string;
  tag?: string;
  threadId?: string;
  itemId?: string;
}

export function parseDesktopNotifyRequest(
  input: unknown,
): DesktopNotifyRequest {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("A notification payload is required.");
  }
  const value = input as Record<string, unknown>;
  if (typeof value.title !== "string" || value.title.trim().length === 0) {
    throw new Error("A notification title is required.");
  }
  if (value.title.length > 200) {
    throw new Error("The notification title is too long.");
  }
  if (value.body !== undefined && typeof value.body !== "string") {
    throw new Error("The notification body must be a string.");
  }
  if (value.body && value.body.length > 500) {
    throw new Error("The notification body is too long.");
  }
  if (value.tag !== undefined && typeof value.tag !== "string") {
    throw new Error("The notification tag must be a string.");
  }
  if (value.threadId !== undefined && typeof value.threadId !== "string") {
    throw new Error("The notification threadId must be a string.");
  }
  if (value.itemId !== undefined && typeof value.itemId !== "string") {
    throw new Error("The notification itemId must be a string.");
  }
  return {
    title: value.title,
    ...(value.body ? { body: value.body } : {}),
    ...(value.tag ? { tag: value.tag } : {}),
    ...(value.threadId ? { threadId: value.threadId } : {}),
    ...(value.itemId ? { itemId: value.itemId } : {}),
  };
}
