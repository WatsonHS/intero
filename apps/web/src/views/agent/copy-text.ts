type CopyTextOptions = {
  writeText?: ((value: string) => Promise<void>) | undefined;
  fallbackCopy?: ((value: string) => boolean) | undefined;
};

export async function copyTextToClipboard(
  value: string,
  options?: CopyTextOptions,
): Promise<void> {
  const writeText =
    options?.writeText ??
    (typeof navigator !== "undefined" && navigator.clipboard?.writeText
      ? navigator.clipboard.writeText.bind(navigator.clipboard)
      : undefined);

  if (writeText) {
    try {
      await writeText(value);
      return;
    } catch {
      // Clipboard access can be rejected outside a secure context or after
      // focus moves to the native Codex app. Continue with selection copy.
    }
  }

  const fallbackCopy = options?.fallbackCopy ?? copyUsingSelection;
  if (!fallbackCopy(value)) {
    throw new Error("Clipboard copy was rejected.");
  }
}

function copyUsingSelection(value: string): boolean {
  if (typeof document === "undefined" || !document.body) return false;

  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.opacity = "0";
  input.style.pointerEvents = "none";
  document.body.append(input);
  input.focus();
  input.select();
  input.setSelectionRange(0, input.value.length);

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    input.remove();
  }
}
