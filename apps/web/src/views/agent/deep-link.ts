export function codexConnectionDeepLink(
  prompt: string,
  repositoryPath?: string,
): string {
  const query = new URLSearchParams({ prompt });
  if (repositoryPath) query.set("path", repositoryPath);
  return `codex://threads/new?${query.toString()}`;
}

export function openCodexConnection(
  prompt: string,
  repositoryPath?: string,
): void {
  const url = codexConnectionDeepLink(prompt, repositoryPath);
  if (window.interoDesktop) {
    // Electron delegates new windows to shell.openExternal.
    window.open(url, "_blank", "noopener,noreferrer");
  } else {
    // An external protocol opens the app without creating an empty browser tab.
    window.location.assign(url);
  }
}
