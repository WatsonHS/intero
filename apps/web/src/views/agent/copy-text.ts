type CopyTextOptions = {
  writeText?: ((value: string) => Promise<void>) | undefined;
  fallbackCopy?: ((value: string) => boolean) | undefined;
  writeTimeoutMs?: number | undefined;
};

const DEFAULT_WRITE_TIMEOUT_MS = 1_500;

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
      await withTimeout(
        writeText(value),
        options?.writeTimeoutMs ?? DEFAULT_WRITE_TIMEOUT_MS,
      );
      return;
    } catch {
      // Clipboard access can be rejected outside a secure context or after
      // focus moves to the native Codex app. Some browser implementations can
      // also leave the permission request pending, so continue after a bound.
    }
  }

  const fallbackCopy = options?.fallbackCopy ?? copyUsingSelection;
  if (!fallbackCopy(value)) {
    throw new Error("Clipboard copy was rejected.");
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Clipboard write timed out.")),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
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
