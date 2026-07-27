export function codexConnectionDeepLink(
  prompt: string,
  repositoryPath?: string,
): string {
  const query = new URLSearchParams({ prompt });
  if (repositoryPath) query.set("path", repositoryPath);
  return `codex://threads/new?${query.toString()}`;
}
