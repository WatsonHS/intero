import type { QueryClient } from "@tanstack/react-query";

/**
 * A membership change is represented in both the viewer's team list and the
 * organization-wide directory. Refresh both views so an administrator does not
 * keep seeing the directory's stale role until the page is reloaded.
 */
export async function refreshGovernanceMembers(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ["pilot", "bootstrap"] }),
    queryClient.invalidateQueries({ queryKey: ["pilot", "teams"] }),
    queryClient.invalidateQueries({
      queryKey: ["pilot", "organization-directory"],
    }),
    queryClient.invalidateQueries({ queryKey: ["governance-audit"] }),
  ]);
}
