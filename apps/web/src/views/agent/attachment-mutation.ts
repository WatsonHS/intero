/**
 * A client mutation id represents one request to create (or repair) an agent
 * attachment.  It is deliberately short-lived: keeping it after a completed
 * request would make a later "connect another" action resolve to an already
 * consumed ticket through the server idempotency record.
 */
export function attachmentAttemptContextKey(
  projectId: string,
  client: string,
  bindingId?: string,
) {
  return `${projectId}:${client}:${bindingId ?? "new"}`;
}

export function attachmentMutationIdForAttempt(
  pending: ReadonlyMap<string, string>,
  contextKey: string,
  createId: () => string,
) {
  return pending.get(contextKey) ?? createId();
}

/**
 * Only an indeterminate transport failure may be retried with the same id.
 * The server can then safely return the result if it created the attachment
 * after the browser lost the response. Every terminal outcome releases it.
 */
export function settleAttachmentMutation(
  pending: Map<string, string>,
  contextKey: string,
  outcome: "completed" | "cancelled" | "terminal_error" | "unresolved_error",
) {
  if (outcome !== "unresolved_error") pending.delete(contextKey);
}
