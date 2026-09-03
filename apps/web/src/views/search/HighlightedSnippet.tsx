export function HighlightedSnippet({ snippet }: { snippet: string }) {
  return (
    <span className="mt-1 block line-clamp-2 text-[11px] leading-[1.6] text-ink-muted">
      {snippetParts(snippet).map((part, index) =>
        part.mark ? (
          <mark
            key={`${part.text}:${index}`}
            className="rounded-[2px] bg-accent-soft px-0.5 text-accent-strong"
          >
            {part.text}
          </mark>
        ) : (
          <span key={`${part.text}:${index}`}>{part.text}</span>
        ),
      )}
    </span>
  );
}

export function snippetParts(
  snippet: string,
): Array<{ text: string; mark: boolean }> {
  const parts: Array<{ text: string; mark: boolean }> = [];
  const pattern = /<b>(.*?)<\/b>/giu;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(snippet))) {
    if (match.index > cursor) {
      parts.push({
        text: decodeSnippetText(snippet.slice(cursor, match.index)),
        mark: false,
      });
    }
    parts.push({ text: decodeSnippetText(match[1] ?? ""), mark: true });
    cursor = match.index + match[0].length;
  }
  if (cursor < snippet.length) {
    parts.push({ text: decodeSnippetText(snippet.slice(cursor)), mark: false });
  }
  return parts.filter((part) => part.text.length > 0);
}

function decodeSnippetText(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}
