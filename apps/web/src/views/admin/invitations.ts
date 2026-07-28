interface InvitationListItem {
  email: string;
  createdAt: string;
}

/**
 * The API keeps invitation history for audit purposes. The member-management
 * surface shows current state, so repeated invitations for one address collapse
 * to the newest record while the older revoked or expired records stay in the
 * governance audit.
 */
export function latestInvitationsByEmail<T extends InvitationListItem>(
  invitations: readonly T[],
): T[] {
  const newestByEmail = new Map<string, T>();

  for (const invitation of invitations) {
    const key = invitation.email.trim().toLowerCase();
    const current = newestByEmail.get(key);
    if (!current || invitation.createdAt > current.createdAt) {
      newestByEmail.set(key, invitation);
    }
  }

  return Array.from(newestByEmail.values()).toSorted((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );
}
