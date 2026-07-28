import { Fragment, type CSSProperties, type ReactNode } from "react";

import {
  FLUENT_EMOJI_INDEX,
  FLUENT_EMOJI_SPRITES,
} from "../emoji/fluent-emoji-manifest.js";
import { cn } from "../design/primitives.js";

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: "grapheme",
});

interface FluentEmojiLocation {
  column: number;
  row: number;
  sprite: (typeof FLUENT_EMOJI_SPRITES)[number];
}

export function FluentEmoji({
  emoji,
  className,
  decorative = false,
  label,
}: {
  emoji: string;
  className?: string;
  decorative?: boolean;
  label?: string;
}) {
  const location = fluentEmojiLocation(emoji);
  if (!location) {
    return (
      <span
        role={decorative ? undefined : "img"}
        aria-hidden={decorative ? true : undefined}
        aria-label={decorative ? undefined : (label ?? emoji)}
        className={cn("inline-block leading-none", className)}
      >
        {emoji}
      </span>
    );
  }

  const style: CSSProperties = {
    backgroundImage: `url("${import.meta.env.BASE_URL}fluent-emoji/${location.sprite.id}.png")`,
    backgroundPosition: `${spriteOffset(location.column, location.sprite.columns)}% ${spriteOffset(location.row, location.sprite.rows)}%`,
    backgroundSize: `${location.sprite.columns * 100}% ${location.sprite.rows * 100}%`,
  };

  return (
    <span
      role={decorative ? undefined : "img"}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : (label ?? emoji)}
      data-fluent-emoji={emoji}
      style={style}
      className={cn(
        "inline-block h-[1em] w-[1em] shrink-0 bg-no-repeat align-[-0.14em]",
        className,
      )}
    />
  );
}

export function FluentEmojiText({
  text,
  renderText,
}: {
  text: string;
  renderText: ((text: string) => ReactNode) | undefined;
}) {
  const parts = splitFluentEmojiText(text);
  return parts.map((part, index) =>
    part.kind === "emoji" ? (
      <FluentEmoji key={`${index}-${part.value}`} emoji={part.value} />
    ) : (
      <Fragment key={`${index}-${part.value}`}>
        {renderText ? renderText(part.value) : part.value}
      </Fragment>
    ),
  );
}

export function hasFluentEmoji(emoji: string): boolean {
  return Boolean(fluentEmojiIndex(emoji));
}

export function splitFluentEmojiText(
  text: string,
): Array<{ kind: "emoji" | "text"; value: string }> {
  const parts: Array<{ kind: "emoji" | "text"; value: string }> = [];
  let textBuffer = "";

  for (const { segment } of graphemeSegmenter.segment(text)) {
    if (hasFluentEmoji(segment)) {
      if (textBuffer) {
        parts.push({ kind: "text", value: textBuffer });
        textBuffer = "";
      }
      parts.push({ kind: "emoji", value: segment });
    } else {
      textBuffer += segment;
    }
  }
  if (textBuffer) parts.push({ kind: "text", value: textBuffer });
  return parts;
}

function fluentEmojiLocation(emoji: string): FluentEmojiLocation | undefined {
  const index = fluentEmojiIndex(emoji);
  if (!index) return undefined;
  const [spriteIndex, tileIndex] = index;
  const sprite = FLUENT_EMOJI_SPRITES[spriteIndex];
  if (!sprite) return undefined;
  return {
    sprite,
    column: tileIndex % sprite.columns,
    row: Math.floor(tileIndex / sprite.columns),
  };
}

function fluentEmojiIndex(
  emoji: string,
): readonly [spriteIndex: number, tileIndex: number] | undefined {
  const unicode = [...emoji]
    .map((character) => character.codePointAt(0)!.toString(16))
    .join("-");
  return (
    FLUENT_EMOJI_INDEX[unicode] ??
    FLUENT_EMOJI_INDEX[
      unicode
        .split("-")
        .filter((codepoint) => codepoint !== "fe0f")
        .join("-")
    ]
  );
}

function spriteOffset(index: number, dimension: number): number {
  return dimension <= 1 ? 0 : (index / (dimension - 1)) * 100;
}
